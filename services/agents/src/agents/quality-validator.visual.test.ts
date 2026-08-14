import { describe, it, expect } from 'vitest'
import { QualityValidatorAgent } from './quality-validator.js'
import { alternativeStrategy } from './creative-director.js'
import type { AiConfig } from '@/config'
import type { VisualSpecification, CreativeDirection } from '@/types/pipeline'

// task 1.4 — EIXO VISUAL (determinístico) + estratégia alternativa para retry.
// runVisualChecks é público e puro (não toca rede/LLM) → testável direto.

const ai = {
  textProvider: 'gemini', imageProvider: 'gemini', apiKey: 'k', imageApiKey: '',
  model: { text: 't', image: 'i' }, temperature: 0.7, maxTokens: 100,
} as AiConfig

// O gradiente-fallback que o image-generator produz para um ELEMENTO é um data-URI SVG com
// linearGradient. Reproduzimos a forma mínima que runVisualChecks reconhece.
const GRADIENT_FALLBACK_DATA_URI =
  'data:image/svg+xml,' + encodeURIComponent('<svg><defs><linearGradient id="g"></linearGradient></defs></svg>')

function direction(strategy: 'generative-photo' | 'stock-photo' | 'graphic-composition'): CreativeDirection {
  return {
    primaryStrategy: strategy,
    rationale: 'test',
    perSlide: [{ index: 1, strategy, reason: 'test', effectiveStrategy: strategy, deferred: false }],
  }
}

/** Slide com imagem REAL (data-url png) → eixo visual passa. */
function visualComImagemReal(): VisualSpecification {
  return {
    slides: [{
      index: 1, layoutId: 'cover', canvas: { width: 1080, height: 1350 },
      background: { type: 'image', value: 'data:image/png;base64,AAA' },
      elements: [],
    }],
    tokens: { colors: {}, fonts: {}, spacing: {} },
  }
}

/** Slide cujo background caiu no fallback de gradiente (type:'gradient'). */
function visualComBackgroundGradiente(): VisualSpecification {
  return {
    slides: [{
      index: 1, layoutId: 'cover', canvas: { width: 1080, height: 1350 },
      background: { type: 'gradient', value: 'linear-gradient(120deg,#C8E0FF,#FFC6F0)' },
      elements: [],
    }],
    tokens: { colors: {}, fonts: {}, spacing: {} },
  }
}

/** Slide cujo ELEMENTO de imagem virou o data-URI SVG de gradiente (fallback). */
function visualComElementoFallback(): VisualSpecification {
  return {
    slides: [{
      index: 1, layoutId: 'body', canvas: { width: 1080, height: 1350 },
      background: { type: 'solid', value: '#000000' },
      elements: [{ role: 'image', type: 'image', content: GRADIENT_FALLBACK_DATA_URI, style: {}, position: { x: 0, y: 0, width: 100, height: 100 } }],
    }],
    tokens: { colors: {}, fonts: {}, spacing: {} },
  } as unknown as VisualSpecification
}

describe('QualityValidator — eixo visual (task 1.4)', () => {
  const agent = new QualityValidatorAgent(ai)

  it('imagem real → eixo visual PASSA (check informativo, nenhum erro)', () => {
    const checks = agent.runVisualChecks(visualComImagemReal(), direction('generative-photo'))
    expect(checks.every((c) => c.passed)).toBe(true)
    expect(checks.some((c) => c.severity === 'error')).toBe(false)
  })

  it('background em gradiente-fallback (estratégia foto) → REPROVA com erro visual', () => {
    const checks = agent.runVisualChecks(visualComBackgroundGradiente(), direction('generative-photo'))
    const erro = checks.find((c) => c.category === 'visual' && c.severity === 'error' && !c.passed)
    expect(erro).toBeDefined()
    expect(erro!.rule).toContain('slide-1')
    expect(erro!.rule).toContain('background-fallback')
  })

  it('elemento de imagem em gradiente-fallback → REPROVA com erro visual', () => {
    const checks = agent.runVisualChecks(visualComElementoFallback(), direction('generative-photo'))
    const erro = checks.find((c) => c.category === 'visual' && c.severity === 'error' && !c.passed)
    expect(erro).toBeDefined()
    expect(erro!.rule).toContain('element-fallback')
  })

  it('NÃO-REGRESSÃO: estratégia graphic-composition não é reprovada por não ter foto', () => {
    // Composição gráfica pode legitimamente ter background gradiente/sólido — não cobramos foto real.
    const checks = agent.runVisualChecks(visualComBackgroundGradiente(), direction('graphic-composition'))
    expect(checks.some((c) => c.severity === 'error')).toBe(false)
  })

  it('NÃO-REGRESSÃO: sem direção criativa, imagem real passa (mock/degradado)', () => {
    const checks = agent.runVisualChecks(visualComImagemReal())
    expect(checks.every((c) => c.passed)).toBe(true)
  })
})

describe('alternativeStrategy — retry finito (task 1.4)', () => {
  it('generative-photo → stock-photo', () => {
    expect(alternativeStrategy('generative-photo')).toBe('stock-photo')
  })
  it('stock-photo → generative-photo', () => {
    expect(alternativeStrategy('stock-photo')).toBe('generative-photo')
  })
  it('graphic-composition → generative-photo (plano B)', () => {
    expect(alternativeStrategy('graphic-composition')).toBe('generative-photo')
  })
})
