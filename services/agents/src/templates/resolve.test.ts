import { describe, it, expect, vi } from 'vitest'
import { validateCarouselTemplate, resolveTemplates } from './resolve.js'
import { TEMPLATE_LIST, TEMPLATES } from './index.js'
import type { CarouselTemplate } from '@/types/pipeline'

// D3/D4/D5 (ADR-0008) — a borda do agents que consome templates do request:
// valida shape (D5), monta o pool efetivo com fallback (D4), resolve o forçado (D3).

const validTemplate = (): CarouselTemplate => JSON.parse(JSON.stringify(TEMPLATES['announcement']))

describe('validateCarouselTemplate (D5 — guarda de shape, nunca crash)', () => {
  it('aceita todos os built-in canônicos (4 originais + 5 arquétipos v2)', () => {
    expect(TEMPLATE_LIST.length).toBe(9)
    for (const t of TEMPLATE_LIST) {
      const { template, reason } = validateCarouselTemplate(t)
      expect(reason, `built-in '${t.id}' deveria ser válido`).toBeUndefined()
      expect(template).not.toBeNull()
    }
  })

  it('rejeita não-objeto, sem crash', () => {
    for (const bad of [null, undefined, 42, 'x', []]) {
      expect(validateCarouselTemplate(bad as unknown).template).toBeNull()
    }
  })

  it("rejeita sem 'id'/'name'", () => {
    const t = validTemplate() as unknown as Record<string, unknown>
    delete t.id
    expect(validateCarouselTemplate(t).template).toBeNull()
  })

  it('rejeita slideCount ≠ slides.length (descasamento estrutural)', () => {
    const t = validTemplate()
    t.slideCount = t.slides.length + 1
    const { template, reason } = validateCarouselTemplate(t)
    expect(template).toBeNull()
    expect(reason).toContain('slideCount')
  })

  it("rejeita slide sem requiredElements (campo load-bearing do copywriter)", () => {
    const t = validTemplate()
    ;(t.slides[0] as unknown as Record<string, unknown>).requiredElements = []
    expect(validateCarouselTemplate(t).template).toBeNull()
  })

  it("rejeita slide com 'type'/'layout' fora do vocabulário conhecido", () => {
    const t = validTemplate()
    ;(t.slides[0] as unknown as Record<string, unknown>).type = 'inventado'
    expect(validateCarouselTemplate(t).template).toBeNull()
  })
})

describe('resolveTemplates (D4 — pool efetivo com fallback honesto)', () => {
  it('sem templates no request → fallback ao registry built-in (fromRequest=false)', () => {
    const r = resolveTemplates(undefined, undefined)
    expect(r.fromRequest).toBe(false)
    expect(r.available).toBe(TEMPLATE_LIST)
    expect(r.forced).toBeNull()
  })

  it('templates válidos no request → pool vem do request (fromRequest=true)', () => {
    const r = resolveTemplates([validTemplate()], undefined)
    expect(r.fromRequest).toBe(true)
    expect(r.available).toHaveLength(1)
    expect(r.available[0].id).toBe('announcement')
  })

  it('todos os templates do request inválidos → descarta com log e cai no built-in (D5→D4)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = resolveTemplates([{ id: 'x' }, null, 99], undefined)
    expect(r.fromRequest).toBe(false)        // nenhum válido → built-in
    expect(r.available).toBe(TEMPLATE_LIST)
    expect(warn).toHaveBeenCalled()          // cada inválido logado (D5)
    warn.mockRestore()
  })

  it('mistura válido+inválido → só os válidos entram no pool', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = resolveTemplates([validTemplate(), { id: 'lixo' }], undefined)
    expect(r.fromRequest).toBe(true)
    expect(r.available).toHaveLength(1)
    warn.mockRestore()
  })
})

describe('resolveTemplates (D3 — força por id dentro do pool)', () => {
  it('forcedTemplateId presente no built-in → resolve (sem templates no request)', () => {
    const r = resolveTemplates(undefined, 'educational')
    expect(r.forced?.id).toBe('educational')
  })

  it('forcedTemplateId presente no pool do request → resolve dali', () => {
    const r = resolveTemplates([validTemplate()], 'announcement')
    expect(r.forced?.id).toBe('announcement')
    expect(r.fromRequest).toBe(true)
  })

  it('forcedTemplateId inexistente → forced=null (seleção normal), com log, sem crash', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = resolveTemplates(undefined, 'nao-existe')
    expect(r.forced).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('forcedTemplateId fora do pool CURADO do request → forced=null (respeita curadoria)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // pool do request só tem 'announcement'; forçar 'educational' (built-in mas fora do pool) → null
    const r = resolveTemplates([validTemplate()], 'educational')
    expect(r.forced).toBeNull()
    warn.mockRestore()
  })
})
