import { describe, it, expect, vi, beforeEach } from 'vitest'

// BUG "publica sem texto": a imagem publicada era só o FUNDO; o texto da IA vivia nas `layers` e
// nunca era rasterizado na imagem. composeSlideImages compõe (fundo+texto) em PNG via rasterizeSlide
// e grava em imageUrl. Mockamos rasterizeSlide p/ não depender de fonte/resvg (testado à parte).

const rasterizeSpy = vi.fn(async (_layers: unknown, _fallback?: string) => 'data:image/png;base64,COMPOSED')
vi.mock('./render/rasterizer.js', () => ({
  rasterizeSlide: (l: unknown, f?: string) => rasterizeSpy(l, f),
}))

import { composeSlideImages } from './jobs.js'
import type { GenerateResult } from './types.js'

function result(slides: Array<{ index: number; imageUrl?: string; layers?: unknown }>): GenerateResult {
  return { slides, caption: '', cta: '', hashtags: [] } as unknown as GenerateResult
}

describe('composeSlideImages — embute o texto na imagem publicada', () => {
  beforeEach(() => rasterizeSpy.mockClear())

  it('slide COM layers → imageUrl vira o PNG composto (texto embutido)', async () => {
    const layers = { background: { type: 'image', value: 'data:image/png;base64,BG' }, elements: [{ type: 'text', role: 'headline', content: 'Olá' }] }
    const r = result([{ index: 0, imageUrl: 'data:image/png;base64,BG', layers }])

    await composeSlideImages(r)

    expect(rasterizeSpy).toHaveBeenCalledOnce()
    expect(r.slides[0].imageUrl).toBe('data:image/png;base64,COMPOSED') // ← fundo+texto, não só fundo
  })

  it('slide SEM layers → imageUrl intocado (mock/degradado), não rasteriza', async () => {
    const r = result([{ index: 0, imageUrl: 'data:image/png;base64,ONLYBG' }])

    await composeSlideImages(r)

    expect(rasterizeSpy).not.toHaveBeenCalled()
    expect(r.slides[0].imageUrl).toBe('data:image/png;base64,ONLYBG')
  })

  it('falha ao rasterizar um slide → mantém o fundo (degradado honesto, não derruba)', async () => {
    rasterizeSpy.mockRejectedValueOnce(new Error('fonte ausente'))
    const layers = { background: { type: 'image', value: 'bg' }, elements: [] }
    const r = result([{ index: 0, imageUrl: 'data:image/png;base64,KEEP', layers }])

    await expect(composeSlideImages(r)).resolves.toBeUndefined() // não lança
    expect(r.slides[0].imageUrl).toBe('data:image/png;base64,KEEP') // manteve o fundo
  })
})
