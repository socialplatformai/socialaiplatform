#!/usr/bin/env node
// gen-enums.mjs — gerador do espelho de enums .NET → TS (E0.3 / protege B3).
//
// Lê a FONTE DA VERDADE (libs/SocialAi.Core/Domain/Enums.cs) com regex simples
// (KISS, sem parser de C#) e emite apps/web/lib/_enums.generated.ts com os
// mapas nome→valor. O teste de contrato compara este gerado com os espelhos
// escritos à mão na UI; divergir um lado sem o outro = teste vermelho.
//
// Suporta: valores explícitos (= N), incremento implícito, e comentários
// inline após o membro (ex.: `EphemeralPublished = 7, // ...`).
//
// Uso:
//   node scripts/gen-enums.mjs           # escreve o arquivo gerado
//   node scripts/gen-enums.mjs --check   # falha (exit 1) se o gerado divergir do disco
//
// Pode ser importado: `import { parseEnums } from './gen-enums.mjs'` (testável).

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENUMS_CS = resolve(HERE, '../libs/SocialAi.Core/Domain/Enums.cs')
const OUT_TS = resolve(HERE, '../apps/web/lib/_enums.generated.ts')

/**
 * Faz parse de um arquivo C# de enums em { NomeEnum: { Membro: valor, ... } }.
 * Robusto a comentários de linha, valores explícitos e incremento implícito.
 * @param {string} source conteúdo do .cs
 * @returns {Record<string, Record<string, number>>}
 */
export function parseEnums(source) {
  // 1) Remove comentários de bloco /* ... */ e de linha // ... para não confundir o parser.
  const noBlock = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const clean = noBlock.replace(/\/\/[^\n]*/g, '')

  const result = {}
  // 2) Captura cada `enum Nome { ... }` (corpo entre chaves, sem aninhamento — enums não aninham).
  const enumRe = /enum\s+([A-Za-z_]\w*)\s*\{([^}]*)\}/g
  let m
  while ((m = enumRe.exec(clean)) !== null) {
    const [, name, body] = m
    const members = {}
    let next = 0
    for (const rawMember of body.split(',')) {
      const member = rawMember.trim()
      if (!member) continue
      const eq = member.match(/^([A-Za-z_]\w*)\s*=\s*(-?\d+)$/)
      const bare = member.match(/^([A-Za-z_]\w*)$/)
      if (eq) {
        const value = parseInt(eq[2], 10)
        members[eq[1]] = value
        next = value + 1
      } else if (bare) {
        members[bare[1]] = next
        next += 1
      } else {
        throw new Error(`gen-enums: membro não reconhecido em enum ${name}: "${member}"`)
      }
    }
    result[name] = members
  }
  return result
}

/** Renderiza o objeto de enums como módulo TS gerado (estável/ordenado). */
export function renderTs(enums) {
  const header =
    '// GERADO por scripts/gen-enums.mjs a partir de libs/SocialAi.Core/Domain/Enums.cs.\n' +
    '// NÃO editar à mão. Rode `node scripts/gen-enums.mjs` após mudar o Enums.cs.\n' +
    '// O teste de contrato (lib/enums.contract.test.ts) compara isto com os espelhos da UI.\n\n'
  const names = Object.keys(enums).sort()
  const body = names
    .map((name) => {
      const members = enums[name]
      const entries = Object.entries(members)
        .map(([k, v]) => `  ${k}: ${v},`)
        .join('\n')
      return `export const ${name} = {\n${entries}\n} as const;`
    })
    .join('\n\n')
  return header + body + '\n'
}

function main() {
  const check = process.argv.includes('--check')
  const source = readFileSync(ENUMS_CS, 'utf8')
  const enums = parseEnums(source)
  const ts = renderTs(enums)

  if (check) {
    let current = ''
    try {
      current = readFileSync(OUT_TS, 'utf8')
    } catch {
      /* arquivo ainda não existe */
    }
    if (current !== ts) {
      console.error('gen-enums --check: _enums.generated.ts está desatualizado. Rode `node scripts/gen-enums.mjs`.')
      process.exit(1)
    }
    console.log('gen-enums --check: OK (espelho em dia).')
    return
  }

  writeFileSync(OUT_TS, ts)
  console.log(`gen-enums: escrito ${OUT_TS} (${Object.keys(enums).length} enums).`)
}

// Só roda main() quando executado como script (não quando importado pelo teste).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
