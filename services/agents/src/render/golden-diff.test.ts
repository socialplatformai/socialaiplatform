import { describe, it, expect } from 'vitest'
import { resolveBg, resolveTextColor, type RasterLayers } from './rasterizer.js'

// R4.0 — HARNESS DE GOLDEN-DIFF (contrato preview==raster).
//
// O invariante preview==raster (F3/ADR-0014 §4e) não pode ser provado "a olho". Um diff
// de PIXELS entre os 2 engines exige headless-browser (o SlideCanvas é React/DOM); aqui
// provamos o nível que de fato DIVERGIA (PB-2): as DECISÕES de composição — cor de fundo,
// cor de texto, presença de scrim — por fixtures. Cada fixture declara o resultado que
// AMBOS os renderers DEVEM produzir (o SlideCanvas web é o oráculo, ver slide-canvas.tsx).
//
// Se o rasterizer divergir do oráculo, este teste falha — o golden-diff em forma estrutural.
// (Quando R4.1 introduzir layouts polimórficos, novas fixtures cobrem cada layout.)

// O ORÁCULO: as regras que o SlideCanvas web aplica (slide-canvas.tsx:55-63, 136-145).
// bgColor: solid → bg.value · imagem → base de scrim · senão → creme (#F0EBE6 = canvas-2).
// textColor: explícito vence · sobre imagem → branco · senão → ink (#1B1F2E).
// scrim: presente sse há imagem de fundo.
const ORACLE = {
  fallbackSurface: '#F0EBE6', // === var(--color-canvas-2)
  ink: '#1B1F2E', // === var(--color-ink)
  whiteOnImage: '#FFFFFF',
}

type Fixture = {
  name: string
  layers: RasterLayers
  fallbackImageUrl?: string
  expect: { bgColor: string; hasImage: boolean; headlineColor: string; hasGradient?: boolean }
}

const IRIS_GRAD = 'linear-gradient(120deg, #C8E0FF 0%, #D7C6FF 30%, #FFC6F0 55%, #FFD7C6 75%, #B6F0FF 100%)'

const PX_1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const FIXTURES: Fixture[] = [
  {
    // O CASO DO PB-2: slide tipográfico SEM imagem. Antes: web creme / raster preto. Agora: ambos creme.
    name: 'slide tipográfico sem imagem → creme nos dois (PB-2 corrigido)',
    layers: {
      anchorY: 'center',
      elements: [{ type: 'text', role: 'headline', content: 'Sem foto' }],
    },
    expect: { bgColor: ORACLE.fallbackSurface, hasImage: false, headlineColor: ORACLE.ink },
  },
  {
    name: 'slide com solid da marca → usa a cor da marca; texto explícito vence',
    layers: {
      background: { type: 'solid', value: '#0B0B0C' },
      elements: [{ type: 'text', role: 'headline', content: 'Marca', style: { color: '#FFFFFF' } }],
    },
    expect: { bgColor: '#0B0B0C', hasImage: false, headlineColor: '#FFFFFF' },
  },
  {
    name: 'slide com imagem → base de scrim + texto branco default',
    layers: {
      background: { type: 'image', value: PX_1x1 },
      elements: [{ type: 'text', role: 'headline', content: 'Sobre foto' }],
    },
    expect: { bgColor: '#1A1A1A', hasImage: true, headlineColor: ORACLE.whiteOnImage },
  },
  {
    name: 'fallbackImageUrl (F0) é imagem → trata como imagem',
    layers: { elements: [{ type: 'text', role: 'headline', content: 'Fallback' }] },
    fallbackImageUrl: PX_1x1,
    expect: { bgColor: '#1A1A1A', hasImage: true, headlineColor: ORACLE.whiteOnImage },
  },
  {
    name: 'sem nada → creme + ink (nunca preto-sobre-creme invisível)',
    layers: {},
    expect: { bgColor: ORACLE.fallbackSurface, hasImage: false, headlineColor: ORACLE.ink },
  },
  {
    // R0 PROTEGE: gradiente NÃO está morto → o iridescente é fundo válido nos DOIS renderers.
    name: 'background gradiente → renderizado como gradiente (não imagem); texto ink',
    layers: {
      background: { type: 'gradient', value: IRIS_GRAD },
      elements: [{ type: 'text', role: 'headline', content: 'Sobre gradiente' }],
    },
    expect: { bgColor: ORACLE.fallbackSurface, hasImage: false, headlineColor: ORACLE.ink, hasGradient: true },
  },
  {
    name: 'fallback gradiente iridescente (F0) → tratado como gradiente, não imagem',
    layers: { elements: [{ type: 'text', role: 'headline', content: 'Fallback iris' }] },
    fallbackImageUrl: IRIS_GRAD,
    expect: { bgColor: ORACLE.fallbackSurface, hasImage: false, headlineColor: ORACLE.ink, hasGradient: true },
  },
]

describe('R4.0 — golden-diff estrutural (preview==raster)', () => {
  it.each(FIXTURES)('$name', (f) => {
    const bg = resolveBg(f.layers, f.fallbackImageUrl)
    const hasImage = !!bg.image
    const headline = f.layers.elements?.find((e) => e.role === 'headline')
    const headlineColor = resolveTextColor(headline?.style?.color as string | undefined, hasImage)

    expect(bg.color).toBe(f.expect.bgColor)
    expect(hasImage).toBe(f.expect.hasImage)
    expect(headlineColor).toBe(f.expect.headlineColor)
    expect(!!bg.gradient).toBe(!!f.expect.hasGradient)
  })

  it('GARANTIA anti-regressão PB-2: nenhum slide sem-imagem cai em preto (#1A1A1A)', () => {
    const semImagem = FIXTURES.filter((f) => !f.expect.hasImage)
    for (const f of semImagem) {
      const bg = resolveBg(f.layers, f.fallbackImageUrl)
      expect(bg.color).not.toBe('#1A1A1A') // o bug do PB-2
    }
  })

  it('GARANTIA R0: o gradiente iridescente é preservado verbatim (não vira flat)', () => {
    const bg = resolveBg({ background: { type: 'gradient', value: IRIS_GRAD } })
    expect(bg.gradient).toBe(IRIS_GRAD)
  })

  it('GARANTIA legibilidade: texto default nunca é branco sobre superfície clara', () => {
    // sem imagem → bg claro (creme/marca) → texto default = ink escuro, nunca branco.
    const color = resolveTextColor(undefined, false)
    expect(color).toBe(ORACLE.ink)
    expect(color).not.toBe('#FFFFFF')
  })
})
