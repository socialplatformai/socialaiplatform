import { describe, it, expect, vi } from 'vitest'
import { StoryArchitectAgent } from './story-architect.js'
import { TEMPLATE_LIST } from '../templates/index.js'
import type { AiConfig } from '@/config'
import type { PipelineInput, StrategyBlueprint, StoryStructure } from '@/types/pipeline'

// REGRESSÃO (bug "post vira carrossel", 2ª causa): o brand-strategist trunca o blueprint a
// slideCount=1 para single-post, MAS o story-architect re-expandia: montava o prompt sobre
// `template.slides` CRU (5-8 slides) e não validava a saída. O LLM via "Slide Count: 1" + 6 blocos
// de estrutura → devolvia 6 slides, que cascateavam até o image-generator gerar 6 imagens.
// Fix em DOIS pontos: (1) buildUserPrompt recorta template.slides ao slideCount; (2) execute
// trunca a SAÍDA do LLM ao slideCount (defesa em profundidade — o caminho feliz não roda parseOutput).
// Este teste guarda o ponto cego que deixou o bug reincidir: o story-architect NÃO tinha teste.

const ai = {
  textProvider: 'gemini', imageProvider: 'gemini', apiKey: 'k', imageApiKey: '',
  model: { text: 't', image: 'i' }, temperature: 1.0, maxTokens: 100,
} as AiConfig

// Template real de carrossel (≥5 slides) — é o que o strategist escolhe; o story-architect o lê.
const carouselTemplate = TEMPLATE_LIST.find((t) => t.slideCount >= 5)!

function blueprint(slideCount: number): StrategyBlueprint {
  return {
    templateId: carouselTemplate.id,
    templateName: carouselTemplate.name,
    slideCount,
    narrativeAngle: 'problem-solution',
    emotionalArc: Array.from({ length: slideCount }, () => 'empowerment'),
    constraints: { tone: 'on-brand', visualEnergy: 'moderate', ctaStyle: 'clear-value', avoidPatterns: [] },
    reasoning: { whyThisTemplate: 'x', whyThisAngle: 'y', keyInsights: [] },
  }
}

// PipelineInput mínimo — só o que buildUserPrompt do story-architect lê.
const pipelineInput = {
  assetType: 'single-post',
  context: { productName: 'P', productDescription: 'D', targetAudience: 'A', keyBenefits: ['b'] },
  content: { mainMessage: 'M' },
  brandConfig: { voice: { attributes: [], toneGuidelines: [], copyExamples: [] } },
  preferences: {},
} as unknown as PipelineInput

// Saída de LLM que DESOBEDECE: devolve 6 slides mesmo quando o briefing pede 1.
function llmReturningSlides(n: number): StoryStructure {
  return {
    totalSlides: n,
    slides: Array.from({ length: n }, (_, i) => ({ index: i, purpose: `slide ${i}` })),
    copywriterNotes: 'notes',
  } as unknown as StoryStructure
}

describe('StoryArchitectAgent — post único trunca a saída a 1 slide', () => {
  it('strategy.slideCount=1 + LLM devolve 6 slides → execute trunca para 1 (totalSlides sincronizado)', async () => {
    const agent = new StoryArchitectAgent(ai)
    // Stub do provider: o LLM "desobedece" e devolve 6 slides.
    vi.spyOn((agent as unknown as { provider: { completeJSON: unknown } }).provider, 'completeJSON')
      .mockResolvedValue(llmReturningSlides(6) as never)

    const out = await agent.execute({ pipelineInput, strategy: blueprint(1) })

    expect(out.slides).toHaveLength(1) // ← o fix: a saída é truncada ao slideCount
    expect(out.totalSlides).toBe(1)    // metadado coerente com o array
  })

  it('carrossel: strategy.slideCount=6 + LLM devolve 6 slides → mantém os 6 (sem regressão)', async () => {
    const agent = new StoryArchitectAgent(ai)
    vi.spyOn((agent as unknown as { provider: { completeJSON: unknown } }).provider, 'completeJSON')
      .mockResolvedValue(llmReturningSlides(6) as never)

    const out = await agent.execute({ pipelineInput, strategy: blueprint(6) })

    expect(out.slides).toHaveLength(6) // carrossel intacto — o slice é no-op
    expect(out.totalSlides).toBe(6)
  })

  it('buildUserPrompt recorta o template ao slideCount (single-post → 1 bloco de slide)', () => {
    const agent = new StoryArchitectAgent(ai)
    const prompt = agent.buildUserPrompt({ pipelineInput, strategy: blueprint(1) })
    // Conta os blocos "### Slide N:" no prompt — deve haver exatamente 1 para single-post.
    const blocos = (prompt.match(/### Slide \d+:/g) || []).length
    expect(blocos).toBe(1)
  })
})
