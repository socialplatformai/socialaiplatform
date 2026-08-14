import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

// E3.6 — rede de rastreabilidade campo → engine (protege B7). A FONTE da lista de
// campos é src/types.ts (BrandContext, Pauta); o destino é src/agents/input-adapter.ts.
// Regras:
//   - 'destino'    : o campo DEVE ser referenciado no input-adapter (chega à engine).
//   - 'identidade' : campo de id/roteamento — NÃO deve ir à engine (correto não usar).
//   - 'orfao'      : declarado como dívida (sem destino hoje) — ver docs/RASTREABILIDADE-CAMPO-ENGINE.md.
// Um campo NOVO em types.ts sem classificação aqui torna o teste VERMELHO.

const HERE = fileURLToPath(new URL('.', import.meta.url))
const TYPES = readFileSync(resolve(HERE, '../types.ts'), 'utf8')
const ADAPTER = readFileSync(resolve(HERE, './input-adapter.ts'), 'utf8')

type Classe = 'destino' | 'identidade' | 'orfao'

// Classificação esperada (espelha docs/RASTREABILIDADE-CAMPO-ENGINE.md).
const BRAND_CONTEXT: Record<string, Classe> = {
  workspaceId: 'identidade',
  branding: 'destino',
  tone: 'destino',
  guidelines: 'destino',
  positioningRules: 'destino',
  learningSummary: 'destino',
  bestFormat: 'destino',      // sinal tipado → preferences.performanceBestFormat (input-adapter)
  desiredContentTypes: 'destino',
  handle: 'destino',
  competitors: 'destino',     // E3: referência textual em additionalNotes
  visualReferences: 'orfao',
  // E2 (ADR-0005): identidade visual + texto de marca → input-adapter (merge c/ preset).
  visualIdentity: 'destino',
  targetAudience: 'destino',
  copyExamples: 'destino',
  hashtags: 'destino',        // E2 (ADR-0008): additionalNotes (diretriz de copy) + merge na saída
  promptOverrides: 'destino', // ADR-0011/0013: sanitizePromptOverrides → PipelineInput (atrás da flag)
}

const PAUTA: Record<string, Classe> = {
  id: 'identidade',
  title: 'destino',
  objective: 'destino',
  context: 'destino',
  attachments: 'destino',         // E3.4: referenceContext (url + rótulo)
  marketingObjective: 'destino',  // E3.2: goal.objective normalizado
  category: 'destino',            // E3.5: additionalNotes
}

/** Extrai os nomes de membros de uma interface do fonte .ts (regex KISS). */
function interfaceFields(source: string, name: string): string[] {
  const m = source.match(new RegExp(`interface\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`))
  if (!m) throw new Error(`interface ${name} não encontrada em types.ts`)
  const body = m[1]
  const fields: string[] = []
  for (const line of body.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue
    // ignora a index signature [key: string]: unknown
    if (t.startsWith('[')) continue
    const fm = t.match(/^([A-Za-z_]\w*)\??\s*:/)
    if (fm) fields.push(fm[1])
  }
  return fields
}

function checkType(name: string, expected: Record<string, Classe>) {
  describe(`rastreabilidade — ${name}`, () => {
    const actual = interfaceFields(TYPES, name)

    it('todo campo do tipo está classificado (nenhum campo novo sem destino declarado)', () => {
      const naoClassificados = actual.filter((f) => !(f in expected))
      expect(naoClassificados, `campos novos sem classificação em RASTREABILIDADE-CAMPO-ENGINE.md: ${naoClassificados}`).toEqual([])
    })

    it('a classificação não tem campos que sumiram do tipo (sem entrada morta)', () => {
      const sumidos = Object.keys(expected).filter((f) => !actual.includes(f))
      expect(sumidos, `entradas de classificação sem campo correspondente no tipo: ${sumidos}`).toEqual([])
    })

    for (const [field, classe] of Object.entries(expected)) {
      if (classe === 'destino') {
        it(`'${field}' (destino) é referenciado no input-adapter`, () => {
          const ref = new RegExp(`\\b${field}\\b`).test(ADAPTER)
          expect(ref, `'${field}' classificado como destino mas não aparece no input-adapter`).toBe(true)
        })
      }
    }
  })
}

checkType('BrandContext', BRAND_CONTEXT)
checkType('Pauta', PAUTA)

describe('rastreabilidade — órfãos são declarados (não silenciosos)', () => {
  it('o único órfão restante é visualReferences (E3 ligou competitors e attachments)', () => {
    const orfaos = [
      ...Object.entries(BRAND_CONTEXT).filter(([, c]) => c === 'orfao').map(([f]) => `BrandContext.${f}`),
      ...Object.entries(PAUTA).filter(([, c]) => c === 'orfao').map(([f]) => `Pauta.${f}`),
    ]
    // visualReferences (refs como IMAGEM p/ o image-generator) segue futuro (ADR-0005 §fora de escopo).
    expect(orfaos.sort()).toEqual(['BrandContext.visualReferences'])
  })
})
