import { describe, it, expect } from 'vitest'
import { toGenerateResult, withUsageMeta } from './jobs.js'
import type { PipelineResult } from './types/pipeline.js'
import type { GenerateResult } from './types.js'

// C (ADR-0008) — propagação de uso (tokens/imagens) do PipelineResult ao GenerateResult.
//  - usageMetadata presente → GenerateResult.usage preenchido campo-a-campo.
//  - sem usage (mock/sem chave) → usage ausente (a API trata como custo 0).

/**
 * PipelineResult mínimo p/ exercitar toGenerateResult. Só preenchemos o que a função lê
 * (copy.slides, copy.microcopy, render/visual.slides, quality, usage). O resto é cast — o
 * objetivo é o mapeamento de usage, não validar o pipeline inteiro.
 */
function fakePipelineResult(
  usage?: PipelineResult['usage'],
  alternatives?: { headlines: string[]; ctas: string[] },
): PipelineResult {
  return {
    success: true,
    metadata: {
      pipelineId: 'p1',
      version: '2.0.0',
      generatedAt: new Date(),
      duration: 1,
      agentDurations: {},
    },
    // só o que toGenerateResult consome:
    copy: {
      slides: [{ index: 0, headline: 'Olá', charCounts: {} }],
      microcopy: { ctaButton: 'Vamos', swipeHint: '', profileCaption: 'legenda #tag' },
      ...(alternatives ? { alternatives } : {}),
    },
    visual: { slides: [], tokens: { colors: {}, fonts: {}, spacing: {} } },
    render: { slides: [], globalCSS: '', fontsToLoad: [], exportReady: { html: true, png: true, pdf: false } },
    quality: {
      passed: true,
      score: 90,
      checks: [],
      summary: { totalChecks: 0, passedChecks: 0, warnings: 0, errors: 0, criticalIssues: 0 },
    },
    // campos não lidos por toGenerateResult — cast mínimo p/ satisfazer o tipo:
    strategy: {} as PipelineResult['strategy'],
    story: {} as PipelineResult['story'],
    summary: { template: 't', slideCount: 1, qualityScore: 90, mainCTA: 'Vamos' },
    usage,
  }
}

describe('toGenerateResult — propaga usage (C)', () => {
  it('usageMetadata presente → usage preenchido (prompt→textInput, candidates→textOutput, imageCount)', () => {
    const r = toGenerateResult(
      fakePipelineResult({ textInputTokens: 1200, textOutputTokens: 800, imageCount: 2 }),
    )
    expect(r.usage).toEqual({ textInputTokens: 1200, textOutputTokens: 800, imageCount: 2 })
  })

  it('sem usage (mock/sem chave) → usage ausente no contrato (API estima custo 0)', () => {
    const r = toGenerateResult(fakePipelineResult(undefined))
    expect(r.usage).toBeUndefined()
  })

  it('usage zerado (mock que reporta 0) → propaga zeros (não vira ausente)', () => {
    const r = toGenerateResult(
      fakePipelineResult({ textInputTokens: 0, textOutputTokens: 0, imageCount: 0 }),
    )
    expect(r.usage).toEqual({ textInputTokens: 0, textOutputTokens: 0, imageCount: 0 })
  })
})

// G4 (A/B barato) — toGenerateResult repassa as alternativas que o copywriter já gera (2 headlines
// + 2 CTAs), antes descartadas. Estes testes travam o repasse e o degradado honesto (sem opção → ausente).
describe('toGenerateResult — repassa alternativas A/B (G4)', () => {
  it('alternatives presentes → repassa headlines/ctas no contrato', () => {
    const r = toGenerateResult(
      fakePipelineResult(undefined, { headlines: ['Ousado', 'Direto'], ctas: ['Saiba mais', 'Comece agora'] }),
    )
    expect(r.alternatives).toEqual({
      headlines: ['Ousado', 'Direto'],
      ctas: ['Saiba mais', 'Comece agora'],
    })
  })

  it('sem alternatives (mock/copywriter não gerou) → alternatives ausente (UI omite a faixa)', () => {
    const r = toGenerateResult(fakePipelineResult(undefined))
    expect(r.alternatives).toBeUndefined()
  })

  it('alternatives só com strings vazias/espaços → filtra e some (não emite faixa vazia)', () => {
    const r = toGenerateResult(fakePipelineResult(undefined, { headlines: ['  ', ''], ctas: [] }))
    expect(r.alternatives).toBeUndefined()
  })

  it('mistura vazias e reais → mantém só as reais (trim)', () => {
    const r = toGenerateResult(
      fakePipelineResult(undefined, { headlines: [' Forte ', ''], ctas: ['  '] }),
    )
    expect(r.alternatives).toEqual({ headlines: ['Forte'], ctas: [] })
  })
})

// F5 (Eixo D) — withUsageMeta anexa provider+modelos efetivos ao usage (a API estima o custo real).
describe('withUsageMeta — anexa provider/modelos ao usage (F5)', () => {
  const ai = { textProvider: 'openai', model: { text: 'gpt-4.1', image: 'gpt-image-1' } }

  it('com usage → anexa provider/textModel/imageModel sem perder os tokens', () => {
    const base: GenerateResult = {
      slides: [], caption: '', cta: '', hashtags: [],
      usage: { textInputTokens: 1200, textOutputTokens: 800, imageCount: 2 },
    }
    const out = withUsageMeta(base, ai)
    expect(out.usage).toEqual({
      textInputTokens: 1200, textOutputTokens: 800, imageCount: 2,
      provider: 'openai', textModel: 'gpt-4.1', imageModel: 'gpt-image-1',
    })
  })

  it('sem usage (mock/sem chave) → não inventa metadata (usage segue ausente)', () => {
    const base: GenerateResult = { slides: [], caption: '', cta: '', hashtags: [] }
    const out = withUsageMeta(base, ai)
    expect(out.usage).toBeUndefined()
  })
})
