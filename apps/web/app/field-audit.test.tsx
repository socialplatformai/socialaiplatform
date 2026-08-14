import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// E9.1 — auditoria automatizada de placeholders/hints. Varre TODAS as telas do
// grupo de rotas (app) e falha se algum controle de formulário dentro de um
// <Field> não tiver placeholder (Input/Textarea) ou se o <Field> não tiver hint
// (ou error, que substitui a dica). Contagem alvo: 0 campos sem placeholder/hint.
//
// Mecanismo: análise estática do código-fonte das telas (determinística, sem
// montar a árvore React inteira — que exigiria mockar React Query/api/router).
// Select é isento de `placeholder` (HTML não suporta; usa <option value=""> guia),
// mas o Field que o envolve ainda precisa de hint.

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '(app)')

function listScreens(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...listScreens(full))
    } else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) {
      out.push(full)
    }
  }
  return out
}

// Extrai os blocos <Field ...> ... </Field> de um arquivo (suporta aninhamento
// simples — Field não aninha Field nas telas; controles ficam diretos dentro).
function extractFieldBlocks(src: string): { openTag: string; body: string }[] {
  const blocks: { openTag: string; body: string }[] = []
  const openRe = /<Field\b/g
  let m: RegExpExecArray | null
  while ((m = openRe.exec(src)) !== null) {
    const start = m.index
    // Fim da tag de abertura: '>' fora de qualquer expressão {...} e não-parte
    // de '=>' (mesma lógica de controlTags — atributos como
    // error={cond ? a : b} não contêm '>', mas guardamos a robustez).
    let depth = 0
    let openEnd = -1
    for (let i = start + 1; i < src.length; i++) {
      const ch = src[i]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      else if (ch === '>' && depth === 0 && src[i - 1] !== '=') {
        openEnd = i
        break
      }
    }
    if (openEnd === -1) continue
    const openTag = src.slice(start, openEnd + 1)
    // Tag self-closing não tem corpo (não ocorre nas telas, mas guardamos).
    if (openTag.trimEnd().endsWith('/>')) {
      blocks.push({ openTag, body: '' })
      continue
    }
    const close = src.indexOf('</Field>', openEnd)
    const body = close === -1 ? '' : src.slice(openEnd + 1, close)
    blocks.push({ openTag, body })
  }
  return blocks
}

// Encontra as tags de controle (Input/Textarea/Select) no corpo de um Field.
// Varre caractere a caractere a partir de <Input|Textarea|Select> até o fim da
// tag, ignorando '>' que faça parte de uma arrow function (`=>`) dentro de
// expressões JSX como `onChange={(e) => ...}`. Sem isso o regex truncaria a tag
// antes do `placeholder` quando este viesse depois do `onChange`.
function controlTags(body: string): { name: string; tag: string }[] {
  const out: { name: string; tag: string }[] = []
  const openRe = /<(Input|Textarea|Select)\b/g
  let m: RegExpExecArray | null
  while ((m = openRe.exec(body)) !== null) {
    const start = m.index
    let depth = 0 // profundidade de chaves de expressão JSX {...}
    let end = -1
    for (let i = start + 1; i < body.length; i++) {
      const ch = body[i]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      else if (ch === '>' && depth === 0 && body[i - 1] !== '=') {
        // '>' fora de expressão e não-parte de '=>' fecha a tag.
        end = i
        break
      }
    }
    if (end === -1) continue
    out.push({ name: m[1], tag: body.slice(start, end + 1) })
    openRe.lastIndex = end + 1
  }
  return out
}

describe('field-audit (E9.1) — placeholders e hints em todas as telas (app)', () => {
  const screens = listScreens(APP_DIR)

  it('encontra ao menos uma tela e um Field (sanidade da varredura)', () => {
    expect(screens.length).toBeGreaterThan(0)
    const total = screens.reduce(
      (n, f) => n + extractFieldBlocks(readFileSync(f, 'utf8')).length,
      0,
    )
    expect(total).toBeGreaterThan(0)
  })

  it('0 campos sem placeholder/hint', () => {
    const offenders: string[] = []

    for (const file of screens) {
      const src = readFileSync(file, 'utf8')
      const rel = file.slice(APP_DIR.length).replace(/\\/g, '/')

      for (const { openTag, body } of extractFieldBlocks(src)) {
        const controls = controlTags(body)
        if (controls.length === 0) continue // Field sem controle direto: fora do escopo do audit

        const hasHint = /\bhint=/.test(openTag)
        const hasError = /\berror=/.test(openTag)
        if (!hasHint && !hasError) {
          offenders.push(`${rel}: <Field> sem hint/error → ${openTag.slice(0, 80)}`)
        }

        for (const c of controls) {
          // Select não suporta placeholder em HTML; o hint do Field cobre a guia.
          if (c.name === 'Select') continue
          // Inputs de data/hora (type=date|time|datetime-local) ignoram placeholder
          // no HTML — o navegador renderiza um picker; o hint do Field cobre a guia.
          // (mesma isenção semântica do Select; o type fica no <Input type="...">).
          if (/\btype=["'](?:datetime-local|date|time|month|week)["']/.test(c.tag)) continue
          if (!/\bplaceholder=/.test(c.tag)) {
            offenders.push(`${rel}: <${c.name}> sem placeholder → ${c.tag.slice(0, 80)}`)
          }
        }
      }
    }

    expect(offenders, `Campos sem placeholder/hint:\n${offenders.join('\n')}`).toEqual([])
  })
})
