import { describe, it, expect } from 'vitest'
import { BrandStrategistAgent } from './brand-strategist.js'
import { adaptHttpToPipelineInput } from './input-adapter.js'
import { TEMPLATE_LIST } from '../templates/index.js'
import type { AiConfig } from '@/config'
import type { BrandContext, Pauta } from '../types.js'

// REGRESSÃO (bug "post vira carrossel"): quando o usuário pede um POST único (não carrossel), o
// blueprint deve sair com slideCount=1 — mesmo que o template (forçado ou escolhido) seja de
// carrossel (5-8 slides). O caminho de template FORÇADO é determinístico (sem LLM), então testável
// direto; é também o caminho do wizard quando o operador escolhe um template na galeria.

const ai = {
  textProvider: 'gemini', imageProvider: 'gemini', apiKey: 'k', imageApiKey: '',
  model: { text: 't', image: 'i' }, temperature: 1.0, maxTokens: 100,
} as AiConfig

const brand: BrandContext = { workspaceId: 'w' } as BrandContext
const pauta: Pauta = { id: 'p', title: 'Tema de teste', objective: 'gerar leads' } as Pauta

describe('BrandStrategistAgent — post único não vira carrossel', () => {
  it('format=post + template de 7 slides FORÇADO → blueprint com slideCount=1', async () => {
    // Um template real de carrossel (7 slides) forçado, como quando o operador o escolhe na galeria.
    const forced = TEMPLATE_LIST.find((t) => t.slideCount >= 5)!
    expect(forced.slideCount).toBeGreaterThan(1) // sanidade: o template é mesmo de carrossel

    const input = adaptHttpToPipelineInput(brand, pauta, 'post', {
      templates: { available: [forced], forced, fromRequest: true },
    })
    expect(input.assetType).toBe('single-post') // o adapter mapeou post → single-post

    const bp = await new BrandStrategistAgent(ai).execute({ pipelineInput: input })

    expect(bp.slideCount).toBe(1) // ← o fix: NÃO herda os 7 slides do template
    expect(bp.emotionalArc).toHaveLength(1)
  })

  it('format=carousel + mesmo template FORÇADO → mantém os slides do carrossel (sem regressão)', async () => {
    const forced = TEMPLATE_LIST.find((t) => t.slideCount >= 5)!

    const input = adaptHttpToPipelineInput(brand, pauta, 'carousel', {
      templates: { available: [forced], forced, fromRequest: true },
    })
    expect(input.assetType).toBe('carousel')

    const bp = await new BrandStrategistAgent(ai).execute({ pipelineInput: input })

    expect(bp.slideCount).toBe(forced.slideCount) // carrossel intacto
    expect(bp.slideCount).toBeGreaterThan(1)
  })
})
