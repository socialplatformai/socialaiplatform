import { describe, it, expect } from 'vitest'
import { toGenerateResult } from './jobs.js'
import type { PipelineResult, SlideVisualSpec } from './types/pipeline.js'

// FASE 0 (ADR-0014/B1) — regressão do bug raiz: a imagem gerada pode acabar em
// background.value OU em elements[].content (cover/last vêm como elemento). O extrator
// antigo lia só background.value → ImageUrl vazio no banco → preview cinza.

function resultWithVisual(slides: Partial<SlideVisualSpec>[]): PipelineResult {
  return {
    success: true,
    metadata: { pipelineId: 'p1', version: '2.0.0', generatedAt: new Date(), duration: 1, agentDurations: {} },
    copy: {
      slides: slides.map((_, i) => ({ index: i, headline: `H${i}`, charCounts: {} })),
      microcopy: { ctaButton: 'Vamos', swipeHint: '', profileCaption: 'cap' },
    },
    visual: { slides: slides as SlideVisualSpec[], tokens: { colors: {}, fonts: {}, spacing: {} } },
    render: { slides: [], globalCSS: '', fontsToLoad: [], exportReady: { html: true, png: true, pdf: false } },
    quality: { passed: true, score: 90, checks: [], summary: { totalChecks: 0, passedChecks: 0, warnings: 0, errors: 0, criticalIssues: 0 } },
    strategy: {} as PipelineResult['strategy'],
    story: {} as PipelineResult['story'],
    summary: { template: 't', slideCount: slides.length, qualityScore: 90, mainCTA: 'Vamos' },
  }
}

const DATA_URI = 'data:image/jpeg;base64,/9j/AAAA'

describe('toGenerateResult — extração de imagem por slide (B1)', () => {
  it('imagem em background.value (fundo) → vira imageUrl', () => {
    const r = toGenerateResult(resultWithVisual([{ background: { type: 'image', value: DATA_URI } }]))
    expect(r.slides[0].imageUrl).toBe(DATA_URI)
  })

  it('imagem em elements[].content (role image) → vira imageUrl — ERA O BUG', () => {
    const r = toGenerateResult(
      resultWithVisual([{ elements: [{ type: 'image', role: 'image', content: DATA_URI, style: {}, position: { x: 0, y: 0, width: 100, height: 100 } }] }]),
    )
    expect(r.slides[0].imageUrl).toBe(DATA_URI)
  })

  it('imagem em element role=background (cover) → vira imageUrl', () => {
    const r = toGenerateResult(
      resultWithVisual([{ elements: [{ type: 'image', role: 'background', content: DATA_URI, style: {}, position: { x: 0, y: 0, width: 100, height: 100 } }] }]),
    )
    expect(r.slides[0].imageUrl).toBe(DATA_URI)
  })

  it('prompt de TEXTO LIVRE (imagem não gerada ainda) → NÃO vira imageUrl', () => {
    const r = toGenerateResult(resultWithVisual([{ background: { type: 'image', value: 'uma cena minimalista neon' } }]))
    expect(r.slides[0].imageUrl).toBeUndefined()
  })

  it('background tem precedência sobre element', () => {
    const bgUri = 'data:image/jpeg;base64,BG'
    const elUri = 'data:image/jpeg;base64,EL'
    const r = toGenerateResult(
      resultWithVisual([{ background: { type: 'image', value: bgUri }, elements: [{ type: 'image', role: 'image', content: elUri, style: {}, position: { x: 0, y: 0, width: 1, height: 1 } }] }]),
    )
    expect(r.slides[0].imageUrl).toBe(bgUri)
  })

  it('URL http também conta como imagem real', () => {
    const url = 'https://cdn.example.com/img.jpg'
    const r = toGenerateResult(resultWithVisual([{ background: { type: 'image', value: url } }]))
    expect(r.slides[0].imageUrl).toBe(url)
  })

  it('contrato não emite mais renderHtml (B2)', () => {
    const r = toGenerateResult(resultWithVisual([{ background: { type: 'image', value: DATA_URI } }]))
    expect('renderHtml' in r.slides[0]).toBe(false)
  })
})

// FASE 1 (ADR-0014) — o contrato agora carrega as CAMADAS de composição (background + elements +
// canvas), sem achatar. A API persiste isso em LayersJson (opaco). Estes testes travam o repasse.
describe('toGenerateResult — repasse de camadas (F1, LayersJson)', () => {
  it('repassa background + elements posicionados em slide.layers', () => {
    const r = toGenerateResult(
      resultWithVisual([
        {
          canvas: { width: 1080, height: 1350 },
          background: { type: 'image', value: DATA_URI },
          elements: [
            { type: 'text', role: 'headline', content: 'Olá', style: { color: '#fff' }, position: { x: 80, y: 120, width: 920, height: 'auto' } },
          ],
        },
      ]),
    )
    const layers = r.slides[0].layers!
    expect(layers).toBeDefined()
    expect(layers.background).toEqual({ type: 'image', value: DATA_URI })
    expect(layers.canvas).toEqual({ width: 1080, height: 1350 })
    expect(layers.elements).toHaveLength(1)
    expect(layers.elements![0]).toMatchObject({ type: 'text', role: 'headline', content: 'Olá', position: { x: 80, y: 120, width: 920, height: 'auto' } })
  })

  it('slide sem spec visual → layers undefined (degradado honesto)', () => {
    const r = toGenerateResult({
      success: true,
      metadata: { pipelineId: 'p', version: '2', generatedAt: new Date(), duration: 1, agentDurations: {} },
      copy: { slides: [{ index: 0, headline: 'H', charCounts: {} }], microcopy: { ctaButton: '', swipeHint: '', profileCaption: '' } },
      visual: { slides: [], tokens: { colors: {}, fonts: {}, spacing: {} } },
      render: { slides: [], globalCSS: '', fontsToLoad: [], exportReady: { html: true, png: true, pdf: false } },
      quality: { passed: true, score: 80, checks: [], summary: { totalChecks: 0, passedChecks: 0, warnings: 0, errors: 0, criticalIssues: 0 } },
      strategy: {} as PipelineResult['strategy'],
      story: {} as PipelineResult['story'],
      summary: { template: 't', slideCount: 1, qualityScore: 80, mainCTA: '' },
    })
    expect(r.slides[0].layers).toBeUndefined()
  })
})
