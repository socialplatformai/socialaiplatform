// @vitest-environment node
// (lê o filesystem e usa import.meta.url como caminho de arquivo; jsdom finge
//  uma URL http:// e quebra fileURLToPath — node é o ambiente correto aqui.)
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

// gerador .mjs com JSDoc — o tsc infere os tipos de parseEnums/renderTs.
import { parseEnums, renderTs } from '../../../scripts/gen-enums.mjs'

import * as generated from './_enums.generated'
import { Priority, ContentType, PautaStatus } from './pautas'
import { CONTENT_STATUS_LABEL } from './content'
import { MetricSource, METRIC_SOURCE_LABEL } from './metrics'
import { Frequency, FREQUENCY_LABEL, APPROVAL_MODE_LABEL } from './workflow'

// Contrato de enums .NET ↔ TS (E0.3 / B3). A FONTE DA VERDADE é Enums.cs.
// Este teste fica VERMELHO se um espelho da UI divergir do .cs.

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ENUMS_CS = resolve(HERE, '../../../libs/SocialAi.Core/Domain/Enums.cs')
const csSource = readFileSync(ENUMS_CS, 'utf8')
const truth = parseEnums(csSource)

describe('gerador de enums (gen-enums.mjs)', () => {
  it('faz parse de valores explícitos, incremento implícito e comentários inline', () => {
    const fixture = `
      public enum Foo { A = 0, B = 1, C = 2 }
      public enum Bar {
        First,            // implícito 0
        Second,           // implícito 1
        Jump = 7,         // explícito
        After             // implícito 8 (continua do anterior)
      }
    `
    const parsed = parseEnums(fixture)
    expect(parsed.Foo).toEqual({ A: 0, B: 1, C: 2 })
    expect(parsed.Bar).toEqual({ First: 0, Second: 1, Jump: 7, After: 8 })
  })

  it('parseia os 14 enums reais do Enums.cs', () => {
    expect(Object.keys(truth).sort()).toEqual([
      'ApprovalMode',
      'ContentStatus',
      'ContentType',
      'CreativeStrategyMode', // Fase 2/task 2.1
      'Frequency',       // G5/ADR-0014
      'LibraryItemKind', // E1/ADR-0008
      'MetricSource',    // C3/ADR-0010
      'OperationMode',   // Fase 2/task 2.2
      'PautaStatus',
      'Priority',
      'PublishResult',
      'PublisherKind',
      'SecretKind',
      'UserRole',
    ])
  })
})

describe('espelho gerado está em dia com Enums.cs', () => {
  it('_enums.generated.ts bate com o re-parse do .cs (regenerar se vermelho)', () => {
    const fresh = renderTs(truth)
    const committed = readFileSync(resolve(HERE, '_enums.generated.ts'), 'utf8')
    expect(committed).toBe(fresh)
  })
})

describe('espelhos da UI ↔ fonte da verdade (.NET)', () => {
  it('Priority (pautas.ts) == Priority (.cs)', () => {
    // Comparação load-bearing é contra a FONTE DA VERDADE (reparse do .cs).
    expect({ ...Priority }).toEqual(truth.Priority)
  })

  it('o espelho gerado bate com a fonte (.cs) — guarda do próprio gerador', () => {
    expect({ ...generated.Priority }).toEqual(truth.Priority)
    expect({ ...generated.ContentType }).toEqual(truth.ContentType)
    expect({ ...generated.PautaStatus }).toEqual(truth.PautaStatus)
    expect({ ...generated.ContentStatus }).toEqual(truth.ContentStatus)
  })

  it('ContentType (pautas.ts) == ContentType (.cs)', () => {
    expect({ ...ContentType }).toEqual(truth.ContentType)
  })

  it('PautaStatus (pautas.ts) == PautaStatus (.cs)', () => {
    expect({ ...PautaStatus }).toEqual(truth.PautaStatus)
  })

  it('MetricSource (metrics.ts) == MetricSource (.cs)', () => {
    // Espelho manual da UI (C3/ADR-0010) bate com a fonte da verdade (reparse do .cs).
    expect({ ...MetricSource }).toEqual(truth.MetricSource)
  })

  it('Frequency (workflow.ts) == Frequency (.cs)', () => {
    // Espelho manual da UI (G5/ADR-0014) bate com a fonte da verdade (reparse do .cs).
    expect({ ...Frequency }).toEqual(truth.Frequency)
  })

  it('FREQUENCY_LABEL cobre exatamente os valores de Frequency (.cs)', () => {
    const labelKeys = Object.keys(FREQUENCY_LABEL)
      .map(Number)
      .sort((a, b) => a - b)
    const enumValues = Object.values(truth.Frequency).sort((a, b) => a - b)
    expect(labelKeys).toEqual(enumValues)
    for (const v of enumValues) {
      const label = FREQUENCY_LABEL[v]
      expect(typeof label).toBe('string')
      expect(label.trim().length).toBeGreaterThan(0)
    }
  })

  it('APPROVAL_MODE_LABEL (workflow.ts) cobre exatamente os valores de ApprovalMode (.cs)', () => {
    // Espelho por ÍNDICE (array): o label na posição N corresponde ao valor N do enum.
    const enumValues = Object.values(truth.ApprovalMode).sort((a, b) => a - b)
    expect(APPROVAL_MODE_LABEL.length).toBe(enumValues.length)
    for (const v of enumValues) {
      const label = APPROVAL_MODE_LABEL[v]
      expect(typeof label).toBe('string')
      expect(label.trim().length).toBeGreaterThan(0)
    }
  })

  it('METRIC_SOURCE_LABEL cobre exatamente os valores de MetricSource (.cs)', () => {
    const labelKeys = Object.keys(METRIC_SOURCE_LABEL)
      .map(Number)
      .sort((a, b) => a - b)
    const enumValues = Object.values(truth.MetricSource).sort((a, b) => a - b)
    expect(labelKeys).toEqual(enumValues)
    for (const v of enumValues) {
      const label = METRIC_SOURCE_LABEL[v]
      expect(typeof label).toBe('string')
      expect(label.trim().length).toBeGreaterThan(0)
    }
  })

  it('CONTENT_STATUS_LABEL cobre exatamente os valores de ContentStatus (.cs)', () => {
    const labelKeys = Object.keys(CONTENT_STATUS_LABEL)
      .map(Number)
      .sort((a, b) => a - b)
    const enumValues = Object.values(truth.ContentStatus).sort((a, b) => a - b)
    expect(labelKeys).toEqual(enumValues)
    // todo valor tem um label string NÃO-VAZIO (toBeTruthy aceitaria "" — não basta)
    for (const v of enumValues) {
      const label = CONTENT_STATUS_LABEL[v]
      expect(typeof label).toBe('string')
      expect(label.trim().length).toBeGreaterThan(0)
    }
  })
})
