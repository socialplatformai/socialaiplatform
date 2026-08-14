import { describe, it, expect } from 'vitest'
import { compileBrandDesignSpec, applySpecPaletteToTokens, mixHex, relativeLuminance } from './design-spec.js'
import type { BrandConfigForPipeline, CarouselTemplate, VisualSpecification } from '@/types/pipeline'

// ADR-0012 — Design Compiler. O BrandDesignSpec é PURO, determinístico e fail-safe.
// Estes testes cobrem os aceites AC2 (determinismo), AC3 (fail-safe), AC7 (onImage por
// luminância) e AC8 (gradientFallback = iris-grad vendorizado).

function makeBrandConfig(overrides?: Partial<BrandConfigForPipeline['visualIdentity']['colors']>): BrandConfigForPipeline {
  return {
    handle: '@marca',
    visualIdentity: {
      logo: { url: null },
      colors: {
        primary: { hex: '#1B1F2E', name: 'Ink' },
        secondary: { hex: '#4A5266', name: 'Ink 3' },
        accent: { hex: '#D7C6FF', name: 'Lilac' },
        background: { hex: '#F5F1EE', name: 'Canvas' },
        text: { hex: '#1B1F2E', name: 'Ink' },
        ...overrides,
      },
      typography: {
        heading: { family: 'Satoshi', weights: [500, 700] },
        body: { family: 'Satoshi', weights: [400, 500] },
      },
    },
    voice: { attributes: ['profissional'], toneGuidelines: ['claro'], copyExamples: [] },
    examples: [],
  }
}

describe('compileBrandDesignSpec — determinismo e fail-safe (ADR-0012)', () => {
  it('AC2: mesmo input → spec deepEqual (idempotente)', () => {
    const cfg = makeBrandConfig()
    const a = compileBrandDesignSpec(cfg, 'apex')
    const b = compileBrandDesignSpec(cfg, 'apex')
    expect(a).toEqual(b)
  })

  it('AC3: brandConfig vazio/parcial NÃO lança e cai nos defaults APEX', () => {
    // Cast deliberado: simula um config degenerado (sem visualIdentity) — não pode quebrar.
    const spec = compileBrandDesignSpec({} as BrandConfigForPipeline)
    expect(spec.palette.primary.hex).toBe('#1B1F2E') // default APEX Ink
    expect(spec.palette.background.hex).toBe('#F5F1EE') // default APEX Canvas
    expect(spec.typography.heading.family).toBe('Satoshi')
    expect(spec.imageAesthetics.mood).toContain('etéreo') // preset default = apex
  })

  it('AC7: onImage é branco sobre fundo escuro e quase-preto sobre fundo claro', () => {
    const escuro = compileBrandDesignSpec(makeBrandConfig({ background: { hex: '#0A0A0A', name: 'Preto' } }))
    expect(escuro.palette.onImage.hex).toBe('#FFFFFF')

    const claro = compileBrandDesignSpec(makeBrandConfig({ background: { hex: '#FAFAFA', name: 'Branco-osso' } }))
    expect(claro.palette.onImage.hex).toBe('#0A0A0A')
  })

  it('AC8: gradientFallback === o iris-grad vendorizado (fonte única AM-4/R-2)', () => {
    const spec = compileBrandDesignSpec(makeBrandConfig())
    expect(spec.imageAesthetics.gradientFallback).toBe(
      'linear-gradient(120deg, #C8E0FF 0%, #D7C6FF 30%, #FFC6F0 55%, #FFD7C6 75%, #B6F0FF 100%)',
    )
  })

  it('a palette de imagem inclui as cores da marca (p/ o prompt)', () => {
    const spec = compileBrandDesignSpec(makeBrandConfig({ primary: { hex: '#FF3D2E', name: 'Vermelho' } }))
    expect(spec.imageAesthetics.palette).toContain('#FF3D2E')
  })

  it('mood muda por preset', () => {
    expect(compileBrandDesignSpec(makeBrandConfig(), 'bold').imageAesthetics.mood).toContain('dramático')
    expect(compileBrandDesignSpec(makeBrandConfig(), 'minimal').imageAesthetics.mood).toContain('editorial')
  })

  it('templateBinding.templateId vem do template quando fornecido', () => {
    const tpl = { id: 'product-launch', name: 'X' } as CarouselTemplate
    expect(compileBrandDesignSpec(makeBrandConfig(), 'apex', tpl).templateBinding.templateId).toBe('product-launch')
    expect(compileBrandDesignSpec(makeBrandConfig()).templateBinding.templateId).toBe('')
  })
})

describe('applySpecPaletteToTokens — fonte única de cor (AC13/R3)', () => {
  it('sobrescreve visual.tokens.colors com a palette do spec, preservando o resto', () => {
    const spec = compileBrandDesignSpec(makeBrandConfig({ accent: { hex: '#FF3D2E', name: 'A' } }))
    const visual = {
      slides: [],
      tokens: {
        colors: { background: '#1A1A1A', text: '#FFFFFF', accent: '#C9B298' }, // defaults do compositor
        fonts: { heading: 'Inter', body: 'Serif' },
        spacing: { margin: 80 },
      },
    } as unknown as VisualSpecification
    const out = applySpecPaletteToTokens(visual, spec)
    // accent do compositor (#C9B298) some — vence a do spec (#FF3D2E).
    expect(out.tokens.colors.accent).toBe('#FF3D2E')
    expect(out.tokens.colors.background).toBe(spec.palette.background.hex)
    // fonts/spacing intactos; função pura (não muta o original).
    expect(out.tokens.fonts).toEqual(visual.tokens.fonts)
    expect(visual.tokens.colors.accent).toBe('#C9B298')
  })
})

describe('helpers de cor (puros)', () => {
  it('mixHex(0)=a, mixHex(1)=b, mixHex(0.5)=meio', () => {
    expect(mixHex('#000000', '#FFFFFF', 0)).toBe('#000000')
    expect(mixHex('#000000', '#FFFFFF', 1)).toBe('#ffffff')
    expect(mixHex('#000000', '#FFFFFF', 0.5)).toBe('#808080')
  })

  it('mixHex com hex inválido cai no outro (fail-safe)', () => {
    expect(mixHex('lixo', '#123456', 0.5)).toBe('#123456')
    expect(mixHex('#123456', 'lixo', 0.5)).toBe('#123456')
  })

  it('relativeLuminance: preto≈0, branco≈1', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 2)
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 2)
    expect(relativeLuminance('lixo')).toBe(0)
  })
})
