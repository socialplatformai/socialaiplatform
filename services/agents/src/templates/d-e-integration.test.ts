import { describe, it, expect } from 'vitest'
import { mergeBrandHashtags } from '../jobs.js'
import { normalizeHashtags, adaptHttpToPipelineInput } from '../agents/input-adapter.js'
import { BrandStrategistAgent } from '../agents/brand-strategist.js'
import { resolveTemplates } from './resolve.js'
import { TEMPLATES } from './index.js'
import type { GenerateResult } from '../types.js'
import type { AiConfig } from '../config.js'
import type { CarouselTemplate } from '@/types/pipeline'

// E2 (hashtags da marca → saída) + D3 (brand-strategist short-circuit no template forçado).

const baseResult = (hashtags: string[]): GenerateResult => ({
  slides: [], caption: 'c', cta: '', hashtags,
})

describe('normalizeHashtags (E2 — diretriz de copy)', () => {
  it("garante '#', remove espaços internos e duplicatas (case-insensitive)", () => {
    expect(normalizeHashtags(['marca', '#Marca', 'minha marca', '  '])).toEqual(['#marca', '#minhamarca'])
  })
  it('vazio/undefined → []', () => {
    expect(normalizeHashtags(undefined)).toEqual([])
    expect(normalizeHashtags([])).toEqual([])
  })
  it('descarta hashtag > 30 chars (limite do Instagram), mantém as válidas', () => {
    const gigante = 'a'.repeat(31)
    const noLimite = 'b'.repeat(30)
    const out = normalizeHashtags(['ok', gigante, noLimite])
    expect(out).toContain('#ok')
    expect(out).toContain('#' + noLimite) // 30 chars: passa
    expect(out.some((t) => t.includes(gigante))).toBe(false) // 31 chars: descartada
  })
})

describe('mergeBrandHashtags (E2 — garantia na saída, sem duplicar)', () => {
  it('anexa as da marca às geradas, sem duplicar (hashtags são SEM #)', () => {
    const out = mergeBrandHashtags(baseResult(['ja', 'tinha']), ['nova', '#ja'])
    expect(out.hashtags).toEqual(['ja', 'tinha', 'nova']) // '#ja' já existe (case-insensitive) → não duplica
  })
  it('sem hashtags da marca → resultado intacto (byte-equivalente)', () => {
    const r = baseResult(['x'])
    expect(mergeBrandHashtags(r, undefined)).toBe(r)
    expect(mergeBrandHashtags(r, [])).toBe(r)
  })
  it('NÃO altera a caption (só o array hashtags)', () => {
    const out = mergeBrandHashtags(baseResult([]), ['marca'])
    expect(out.caption).toBe('c')
    expect(out.hashtags).toEqual(['marca'])
  })
})

describe('adaptHttpToPipelineInput — hashtags na diretriz (E2) + pool/forçado (D3/D4)', () => {
  const ctx = { workspaceId: 'w', hashtags: ['marca', '#promo'] }
  it('hashtags da marca entram em additionalNotes', () => {
    const input = adaptHttpToPipelineInput(ctx, { id: 'p', title: 'T' }, 'carousel')
    expect(input.content.additionalNotes).toContain('#marca')
    expect(input.content.additionalNotes).toContain('#promo')
  })
  it('sem templates resolvidos → preferences sem pool (byte-equivalente Z1)', () => {
    const input = adaptHttpToPipelineInput(ctx, { id: 'p', title: 'T' }, 'carousel')
    expect(input.preferences?.availableTemplates).toBeUndefined()
    expect(input.preferences?.forcedTemplate).toBeUndefined()
  })
  it('com pool do request → preferences carrega availableTemplates', () => {
    const resolved = resolveTemplates([JSON.parse(JSON.stringify(TEMPLATES['announcement']))], undefined)
    const input = adaptHttpToPipelineInput(ctx, { id: 'p', title: 'T' }, 'carousel', { templates: resolved })
    expect(input.preferences?.availableTemplates).toHaveLength(1)
  })
})

describe('BrandStrategistAgent (D3 — short-circuit determinístico no forçado, sem LLM)', () => {
  // AiConfig mínima: o short-circuit NÃO chama o provider, então não precisa de chave real.
  const ai = {
    textProvider: 'gemini', imageProvider: 'gemini', apiKey: 'x', imageApiKey: 'x',
    model: { text: 'm', image: 'm' }, temperature: 0.7, maxTokens: 1024,
  } as unknown as AiConfig

  it('forcedTemplate setado → blueprint vem do template, sem chamar o provider (LLM)', async () => {
    const forced = JSON.parse(JSON.stringify(TEMPLATES['social-proof'])) as CarouselTemplate
    const agent = new BrandStrategistAgent(ai)
    // Se chamasse o provider, lançaria/timeoutaria (sem chave real). Não chama → retorna direto.
    const bp = await agent.execute({
      pipelineInput: {
        assetType: 'carousel',
        context: { productName: 'P', productDescription: 'D', targetAudience: 'A', keyBenefits: ['b'] },
        goal: { objective: 'awareness', angle: 'transformation' },
        content: { mainMessage: 'M' },
        preferences: { forcedTemplate: forced, availableTemplates: [forced] },
        brandConfig: {
          visualIdentity: { logo: { url: null }, colors: {} as never, typography: {} as never },
          voice: { attributes: [], toneGuidelines: [], copyExamples: [] }, examples: [],
        } as never,
      },
    })
    expect(bp.templateId).toBe('social-proof')
    expect(bp.slideCount).toBe(forced.slideCount)
    expect(bp.emotionalArc).toHaveLength(forced.slideCount) // arco = beats dos slides do template
    expect(bp.reasoning.whyThisTemplate).toContain('forçado')
  })
})

// O sinal TIPADO de aprendizado (formato vencedor) ENVIESA a escolha do brand-strategist
// — aparece como um viés EXPLÍCITO no prompt quando presente, e some quando ausente (sem amostra).
describe('BrandStrategistAgent — viés de performance no prompt', () => {
  const ai = {
    textProvider: 'gemini', imageProvider: 'gemini', apiKey: 'x', imageApiKey: 'x',
    model: { text: 'm', image: 'm' }, temperature: 0.7, maxTokens: 1024,
  } as unknown as AiConfig

  const basePipelineInput = (performanceBestFormat?: 'post' | 'carousel' | 'story') => ({
    assetType: 'carousel' as const,
    context: { productName: 'P', productDescription: 'D', targetAudience: 'A', keyBenefits: ['b'] },
    goal: { objective: 'awareness' as const, angle: 'transformation' },
    content: { mainMessage: 'M' },
    preferences: { performanceBestFormat },
    brandConfig: {
      visualIdentity: { logo: { url: null }, colors: {} as never, typography: {} as never },
      voice: { attributes: [], toneGuidelines: [], copyExamples: [] }, examples: [],
    } as never,
  })

  it('com performanceBestFormat → o prompt traz a seção "Performance Signal" com o formato vencedor', () => {
    const agent = new BrandStrategistAgent(ai)
    const prompt = agent.buildUserPrompt({ pipelineInput: basePipelineInput('carousel') as never })
    expect(prompt).toContain('Performance Signal')
    expect(prompt).toContain('carousel')          // o formato vencedor aparece no viés
    expect(prompt).toContain('BIAS, not an order') // é viés, não ordem (não substitui o LLM/brief)
  })

  it('sem performanceBestFormat (amostra <3 na API) → sem seção de viés (comportamento atual preservado)', () => {
    const agent = new BrandStrategistAgent(ai)
    const prompt = agent.buildUserPrompt({ pipelineInput: basePipelineInput(undefined) as never })
    expect(prompt).not.toContain('Performance Signal')
  })

  it('o input-adapter mapeia brandContext.bestFormat → preferences.performanceBestFormat (sinal tipado)', () => {
    const input = adaptHttpToPipelineInput(
      { workspaceId: 'w', bestFormat: 'carousel' }, { id: 'p', title: 'T' }, 'post',
    )
    expect(input.preferences?.performanceBestFormat).toBe('carousel')
  })

  it('bestFormat fora da união (ex. "reels") vira undefined (sem viés, não propaga lixo)', () => {
    const input = adaptHttpToPipelineInput(
      { workspaceId: 'w', bestFormat: 'reels' as never }, { id: 'p', title: 'T' }, 'post',
    )
    expect(input.preferences?.performanceBestFormat).toBeUndefined()
  })
})
