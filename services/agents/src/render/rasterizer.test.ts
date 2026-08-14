import { describe, it, expect } from 'vitest'
import { rasterizeSlide, type RasterLayers } from './rasterizer.js'

// F7/D-1 — o rasterizador SUPERA a ausência de Satoshi local buscando uma fonte web (CDN imutável,
// cacheada em disco) ANTES de cair na fonte do sistema. Este teste prova que, mesmo sem TTF no
// bundle, a rasterização produz um PNG válido (composição fiel) — não quebra nem fica sem fonte.
//
// Depende de rede (jsDelivr) na 1ª execução; depois usa o cache em disco. Se o ambiente de CI for
// offline, o fallback de fonte do sistema ainda entrega um PNG — o invariante "sempre sai um PNG"
// vale nos dois caminhos.

describe('rasterizeSlide (F7/D-1 — fonte web/fallback)', () => {
  const layers: RasterLayers = {
    background: { type: 'solid', value: '#0B0B0C' },
    anchorY: 'center',
    elements: [
      { type: 'text', role: 'headline', content: 'Título de Teste', style: { color: '#FFFFFF' } },
      { type: 'text', role: 'body', content: 'Corpo do slide rasterizado.', style: { color: '#DDDDDD' } },
      { type: 'text', role: 'cta', content: 'Saiba mais', style: {} },
    ],
  }

  it('produz um PNG data-uri mesmo sem Satoshi local (busca fonte web ou cai no sistema)', async () => {
    const out = await rasterizeSlide(layers)
    expect(out.startsWith('data:image/png;base64,')).toBe(true)
    // PNG não-trivial (cabeçalho + conteúdo) — base64 com tamanho real, não vazio.
    expect(out.length).toBeGreaterThan(1000)
  }, 30_000)

  it('rasteriza um slide com imagem de fundo (data-uri) sem lançar', async () => {
    // 1x1 PNG transparente como "imagem" de fundo — exercita o caminho com <img> + scrim.
    const px =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    const out = await rasterizeSlide({ ...layers, background: { type: 'image', value: px } }, px)
    expect(out.startsWith('data:image/png;base64,')).toBe(true)
  }, 30_000)

  it('R4.0 — rasteriza um slide com fundo GRADIENTE (iridescente) sem lançar (Satori aceita)', async () => {
    // R0 protege o gradiente: prova que o caminho de gradiente do raster produz PNG válido
    // (não só o resolver — o Satori de fato renderiza o linear-gradient).
    const iris = 'linear-gradient(120deg, #C8E0FF 0%, #D7C6FF 30%, #FFC6F0 55%, #B6F0FF 100%)'
    const out = await rasterizeSlide({
      anchorY: 'center',
      background: { type: 'gradient', value: iris },
      elements: [{ type: 'text', role: 'headline', content: 'Gradiente' }],
    })
    expect(out.startsWith('data:image/png;base64,')).toBe(true)
    expect(out.length).toBeGreaterThan(1000)
  }, 30_000)
})
