import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CopywriterAgentV2 } from './copywriter.js'
import { BrandStrategistAgent } from './brand-strategist.js'
import { QualityValidatorAgent } from './quality-validator.js'
import { VisualCompositorAgent } from './visual-compositor.js'
import { __resetPromptCacheForTests } from '../prompts/loader.js'
import type { ITextProvider } from '../text/textProvider.js'
import type { AiConfig } from '../config.js'
import type { PipelineInput, CopyOutput, StoryStructure, StrategyBlueprint } from '../types/pipeline.js'

// ADR-0011 / E10.2 — override de prompt com rede (flag → override → validação → fallback ao base).
// Provider de TEXTO mockado (sem rede), espelhando textProvider.test.ts. A EMISSÃO do override
// pela API .NET é FORA DE ESCOPO (declarado no ADR): aqui injetamos o override direto no payload
// do lado agents (PipelineInput.promptOverrides), com a flag controlada por AiConfig.

beforeEach(() => __resetPromptCacheForTests())

function makeAi(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    textProvider: 'gemini',
    imageProvider: 'gemini',
    apiKey: 'test-key',
    imageApiKey: '',
    model: { text: 'models/x', image: 'models/y' },
    temperature: 0.7,
    maxTokens: 16384,
    promptOverridesEnabled: false,
    ...overrides,
  }
}

/** Substitui o provider (protected) do agente por um fake cujo completeJSON é roteado por uma fila
 *  de respostas (1ª chamada = override-call; 2ª = base-call após fallback). Registra os
 *  systemPrompts recebidos para asserções. `agent: unknown` porque `provider` é protected — o
 *  acesso em teste é por cast (mesmo espírito de textProvider.test.ts). */
function injectFakeProvider<T>(agent: unknown, responses: T[]) {
  const calls: { systemPrompt: string }[] = []
  let i = 0
  const fake: ITextProvider = {
    name: 'fake',
    complete: vi.fn(async () => 'texto'),
    completeJSON: vi.fn(async (systemPrompt: string) => {
      calls.push({ systemPrompt })
      const r = responses[Math.min(i, responses.length - 1)]
      i++
      return r as never
    }),
  }
  ;(agent as { provider: ITextProvider }).provider = fake
  return { calls, fake }
}

/** PipelineInput mínimo para o copywriter (só o que buildUserPrompt toca + promptOverrides). */
function copyInput(promptOverrides?: PipelineInput['promptOverrides'], onPromptFallback?: PipelineInput['onPromptFallback']): {
  pipelineInput: PipelineInput
  strategy: StrategyBlueprint
  story: StoryStructure
} {
  const pipelineInput = {
    assetType: 'carousel',
    context: { productName: 'P', productDescription: 'D', targetAudience: 'A', keyBenefits: ['b'] },
    goal: { objective: 'awareness', angle: 'transformation' },
    content: { mainMessage: 'M' },
    promptOverrides,
    onPromptFallback,
    brandConfig: {
      visualIdentity: {
        logo: { url: null },
        colors: {
          primary: { hex: '#111111', name: 'p' }, secondary: { hex: '#222222', name: 's' },
          accent: { hex: '#333333', name: 'a' }, background: { hex: '#FFFFFF', name: 'bg' },
          text: { hex: '#000000', name: 't' },
        },
        typography: { heading: { family: 'Inter', weights: [700] }, body: { family: 'Inter', weights: [400] } },
      },
      voice: { attributes: [], toneGuidelines: [], copyExamples: [] },
      examples: [],
    },
  } as unknown as PipelineInput

  const strategy = {
    templateId: 'product-launch', templateName: 'Product Launch', slideCount: 2,
    narrativeAngle: 'problem-solution', emotionalArc: ['curiosity', 'empowerment'],
    constraints: { tone: 'on-brand', visualEnergy: 'moderate', ctaStyle: 'clear', avoidPatterns: [] },
    reasoning: { whyThisTemplate: 'w', whyThisAngle: 'w', keyInsights: [] },
  } as unknown as StrategyBlueprint
  const story = {
    totalSlides: 2, overallNarrative: 'n',
    slides: [
      { index: 1, type: 'cover', layout: 'centered-headline', purpose: 'p', emotionalBeat: 'curiosity', contentBrief: 'c', visualDirection: 'v' },
      { index: 2, type: 'cta', layout: 'cta-focused', purpose: 'p', emotionalBeat: 'empowerment', contentBrief: 'c', visualDirection: 'v' },
    ],
    copywriterNotes: { keyMessage: 'k', toneReminders: [], phrasesToUse: [], phrasesToAvoid: [] },
  } as unknown as StoryStructure

  return { pipelineInput, strategy, story }
}

const VALID_COPY: CopyOutput = {
  slides: [
    { index: 1, headline: 'Headline 1', charCounts: {} },
    { index: 2, headline: 'Headline 2', charCounts: {} },
  ],
  microcopy: { ctaButton: 'Vai', swipeHint: '→', profileCaption: 'salva' },
}
// Sem headline no 2º slide → o parseOutput do copywriter LANÇA (contrato real, forte).
const INVALID_COPY = {
  slides: [{ index: 1, headline: 'ok', charCounts: {} }, { index: 2, headline: '', charCounts: {} }],
  microcopy: { ctaButton: 'x', swipeHint: '→', profileCaption: 'y' },
}

describe('E10.2.a — flag OFF (default): override presente é IGNORADO, usa o base', () => {
  it('com flag OFF, o systemPrompt usado é o base mesmo com override no payload', async () => {
    const agent = new CopywriterAgentV2(makeAi({ promptOverridesEnabled: false }))
    const { calls } = injectFakeProvider(agent, [VALID_COPY])
    const input = copyInput({ copywriter: 'OVERRIDE DO OPERADOR — NÃO DEVE SER USADO' })

    await agent.execute(input)

    expect(calls).toHaveLength(1) // 1 chamada (caminho feliz)
    expect(calls[0].systemPrompt).toContain('# COPYWRITER — Branding OS') // base do .md
    expect(calls[0].systemPrompt).not.toContain('OVERRIDE DO OPERADOR')
  })
})

describe('plumbing — o getter systemPrompt isolado SEMPRE retorna o base', () => {
  it('mesmo com flag ON e override no payload, agent.systemPrompt == base', () => {
    const agent = new CopywriterAgentV2(makeAi({ promptOverridesEnabled: true }))
    // O getter é parameterless: não tem como ver o override. Prova estrutural.
    expect(agent.systemPrompt).toContain('# COPYWRITER — Branding OS')
    expect(agent.systemPrompt).not.toContain('OVERRIDE')
  })
})

describe('E10.2.b — flag ON + override VÁLIDO: execute usa o override', () => {
  it('o systemPrompt da chamada é o override (1 chamada, sem fallback)', async () => {
    const agent = new CopywriterAgentV2(makeAi({ promptOverridesEnabled: true }))
    const { calls } = injectFakeProvider(agent, [VALID_COPY])
    const fallback = vi.fn()
    const input = copyInput({ copywriter: 'PROMPT CUSTOMIZADO VÁLIDO DO OPERADOR' }, fallback)

    const out = await agent.execute(input)

    expect(calls).toHaveLength(1)
    expect(calls[0].systemPrompt).toBe('PROMPT CUSTOMIZADO VÁLIDO DO OPERADOR')
    expect(fallback).not.toHaveBeenCalled()
    expect(out.slides).toHaveLength(2)
  })
})

describe('E10.2.c (CENTRAL) — flag ON + override INVÁLIDO: fallback ao base, pipeline completa', () => {
  it('override produz saída que parseOutput rejeita → 2ª chamada usa o base, onPromptFallback registrado', async () => {
    const agent = new CopywriterAgentV2(makeAi({ promptOverridesEnabled: true }))
    // 1ª chamada (override) → saída inválida (slide sem headline); 2ª chamada (base) → válida.
    const { calls } = injectFakeProvider(agent, [INVALID_COPY as unknown as CopyOutput, VALID_COPY])
    const fallback = vi.fn()
    const input = copyInput({ copywriter: 'PROMPT RUIM QUE INDUZ SAÍDA SEM HEADLINE' }, fallback)

    const out = await agent.execute(input)

    // (i) houve fallback: 2 chamadas, a 2ª com o base.
    expect(calls).toHaveLength(2)
    expect(calls[0].systemPrompt).toBe('PROMPT RUIM QUE INDUZ SAÍDA SEM HEADLINE')
    expect(calls[1].systemPrompt).toContain('# COPYWRITER — Branding OS')
    // (ii) o resultado é o do base (válido) — o agente NÃO quebrou.
    expect(out.slides.every((s) => s.headline && s.headline.trim() !== '')).toBe(true)
    // (iii) evento de fallback registrado (não-silencioso) com a agentKey correta.
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(fallback).toHaveBeenCalledWith('copywriter', expect.stringMatching(/headline/i))
  })

  it('RED-guard: sem a rede de fallback, a saída inválida do override PROPAGARIA (prova que o fallback é o que salva)', async () => {
    // Simula "remover o fallback": chama executeWithPrompt direto com o override e valida — deve lançar.
    const agent = new CopywriterAgentV2(makeAi({ promptOverridesEnabled: true }))
    injectFakeProvider(agent, [INVALID_COPY as unknown as CopyOutput])
    const input = copyInput()
    const raw = await (agent as unknown as {
      executeWithPrompt: (i: unknown, s: string) => Promise<CopyOutput>
    }).executeWithPrompt(input, 'override ruim')
    // executeWithPrompt NÃO valida (completeJSON não chama parseOutput) — a saída ruim "passa";
    // é a validação explícita do caminho-override (execute) que dispara o fallback. Provamos que
    // parseOutput do copywriter rejeitaria essa saída (logo, sem fallback, o pipeline quebraria).
    expect(() => agent.parseOutput(JSON.stringify(raw))).toThrow(/headline/i)
  })
})

describe('E10.2.d — reset: override ausente/null → base, sem resíduo entre runs', () => {
  it('run 1 com override, run 2 sem override → run 2 usa o base (cache não "gruda" override)', async () => {
    const agent = new CopywriterAgentV2(makeAi({ promptOverridesEnabled: true }))
    const { calls } = injectFakeProvider(agent, [VALID_COPY])

    await agent.execute(copyInput({ copywriter: 'OVERRIDE DO RUN 1' }))
    await agent.execute(copyInput(undefined)) // run 2: sem override

    expect(calls).toHaveLength(2)
    expect(calls[0].systemPrompt).toBe('OVERRIDE DO RUN 1')
    expect(calls[1].systemPrompt).toContain('# COPYWRITER — Branding OS') // base, sem resíduo
  })

  it('override vazio/whitespace → tratado como ausente (base)', async () => {
    const agent = new CopywriterAgentV2(makeAi({ promptOverridesEnabled: true }))
    const { calls } = injectFakeProvider(agent, [VALID_COPY])
    await agent.execute(copyInput({ copywriter: '   ' }))
    expect(calls[0].systemPrompt).toContain('# COPYWRITER — Branding OS')
  })
})

describe('caso especial — brand-strategist: override sem {{TEMPLATES}} é estruturalmente inválido', () => {
  it('override sem placeholder → fallback ao base SEM gastar chamada de IA no override', async () => {
    const agent = new BrandStrategistAgent(makeAi({ promptOverridesEnabled: true }))
    const validStrategy = {
      templateId: 'product-launch', templateName: 'Product Launch', slideCount: 8,
      narrativeAngle: 'problem-solution',
      emotionalArc: ['curiosity', 'pain', 'frustration', 'hope', 'excitement', 'trust', 'urgency', 'empowerment'],
      constraints: { tone: 't', visualEnergy: 'moderate', ctaStyle: 'c', avoidPatterns: [] },
      reasoning: { whyThisTemplate: 'w', whyThisAngle: 'w', keyInsights: [] },
    }
    const { calls } = injectFakeProvider(agent, [validStrategy as unknown as StrategyBlueprint])
    const fallback = vi.fn()
    const pipelineInput = {
      assetType: 'carousel',
      context: { productName: 'P', productDescription: 'D', targetAudience: 'A', keyBenefits: ['b'] },
      goal: { objective: 'awareness', angle: 'transformation' },
      content: { mainMessage: 'M' },
      promptOverrides: { 'brand-strategist': 'OVERRIDE SEM O PLACEHOLDER DE TEMPLATES' },
      onPromptFallback: fallback,
      brandConfig: {
        visualIdentity: {
          logo: { url: null },
          colors: {
            primary: { hex: '#111', name: 'p' }, secondary: { hex: '#222', name: 's' },
            accent: { hex: '#333', name: 'a' }, background: { hex: '#fff', name: 'bg' }, text: { hex: '#000', name: 't' },
          },
          typography: { heading: { family: 'Inter', weights: [700] }, body: { family: 'Inter', weights: [400] } },
        },
        voice: { attributes: [], toneGuidelines: [], copyExamples: [] },
        examples: [],
      },
    } as unknown as PipelineInput

    await agent.execute({ pipelineInput })

    // Override sem {{TEMPLATES}} → applyOverride devolve null → NÃO chama IA com override; 1 chamada (base).
    expect(calls).toHaveLength(1)
    expect(calls[0].systemPrompt).toContain('# BRAND STRATEGIST — Branding OS')
    expect(calls[0].systemPrompt).not.toContain('OVERRIDE SEM O PLACEHOLDER')
    expect(fallback).toHaveBeenCalledWith('brand-strategist', expect.stringMatching(/inválido/i))
  })

  it('caminho FELIZ: override COM {{TEMPLATES}} válido → execute usa o override com o pool injetado', async () => {
    const agent = new BrandStrategistAgent(makeAi({ promptOverridesEnabled: true }))
    const validStrategy = {
      templateId: 'product-launch', templateName: 'Product Launch', slideCount: 8,
      narrativeAngle: 'problem-solution',
      emotionalArc: ['curiosity', 'pain', 'frustration', 'hope', 'excitement', 'trust', 'urgency', 'empowerment'],
      constraints: { tone: 't', visualEnergy: 'moderate', ctaStyle: 'c', avoidPatterns: [] },
      reasoning: { whyThisTemplate: 'w', whyThisAngle: 'w', keyInsights: [] },
    }
    const { calls } = injectFakeProvider(agent, [validStrategy as unknown as StrategyBlueprint])
    const fallback = vi.fn()
    const pipelineInput = {
      assetType: 'carousel',
      context: { productName: 'P', productDescription: 'D', targetAudience: 'A', keyBenefits: ['b'] },
      goal: { objective: 'awareness', angle: 'transformation' },
      content: { mainMessage: 'M' },
      promptOverrides: { 'brand-strategist': 'PROMPT CUSTOMIZADO DO OPERADOR\n## TEMPLATES:\n{{TEMPLATES}}\nFim.' },
      onPromptFallback: fallback,
      brandConfig: {
        visualIdentity: {
          logo: { url: null },
          colors: {
            primary: { hex: '#111', name: 'p' }, secondary: { hex: '#222', name: 's' },
            accent: { hex: '#333', name: 'a' }, background: { hex: '#fff', name: 'bg' }, text: { hex: '#000', name: 't' },
          },
          typography: { heading: { family: 'Inter', weights: [700] }, body: { family: 'Inter', weights: [400] } },
        },
        voice: { attributes: [], toneGuidelines: [], copyExamples: [] },
        examples: [],
      },
    } as unknown as PipelineInput

    await agent.execute({ pipelineInput })

    // 1 chamada (override válido, sem fallback). O systemPrompt é o override COM o placeholder
    // já resolvido pelo pool efetivo (não sobra {{TEMPLATES}}; o texto customizado está presente).
    expect(calls).toHaveLength(1)
    expect(calls[0].systemPrompt).toContain('PROMPT CUSTOMIZADO DO OPERADOR')
    expect(calls[0].systemPrompt).not.toContain('{{TEMPLATES}}')
    expect(calls[0].systemPrompt).toContain('(ID: product-launch)') // pool injetado no lugar do placeholder
    expect(calls[0].systemPrompt).not.toContain('# BRAND STRATEGIST — Branding OS') // não é o base
    expect(fallback).not.toHaveBeenCalled()
  })
})

describe('caso especial — visual-compositor: override que produz spec vazia → fallback', () => {
  it('saída sem slides → validateOverrideOutput lança → fallback ao base', async () => {
    const agent = new VisualCompositorAgent(makeAi({ promptOverridesEnabled: true }))
    const emptyVisual = { slides: [], tokens: { colors: {}, fonts: {}, spacing: {} } }
    const validVisual = {
      slides: [{ index: 1, layoutId: 'x', canvas: { width: 1080, height: 1350 }, background: { type: 'solid', value: '#111' }, elements: [{ type: 'text', role: 'headline', content: 'h', style: {} }] }],
      tokens: { colors: {}, fonts: {}, spacing: {} },
    }
    const { calls } = injectFakeProvider(agent, [emptyVisual, validVisual])
    const fallback = vi.fn()
    const pipelineInput = {
      assetType: 'carousel',
      context: { productName: 'P', productDescription: 'D', targetAudience: 'A', keyBenefits: ['b'] },
      goal: { objective: 'awareness', angle: 'transformation' },
      content: { mainMessage: 'M' },
      promptOverrides: { 'visual-compositor': 'OVERRIDE QUE GERA SPEC VAZIA' },
      onPromptFallback: fallback,
      brandConfig: {
        visualIdentity: {
          logo: { url: null },
          colors: {
            primary: { hex: '#111', name: 'p' }, secondary: { hex: '#222', name: 's' },
            accent: { hex: '#333', name: 'a' }, background: { hex: '#fff', name: 'bg' }, text: { hex: '#000', name: 't' },
          },
          typography: { heading: { family: 'Inter', weights: [700] }, body: { family: 'Inter', weights: [400] } },
        },
        voice: { attributes: [], toneGuidelines: [], copyExamples: [] },
        examples: [],
      },
    } as unknown as PipelineInput

    const out = await agent.execute({
      pipelineInput,
      strategy: {} as unknown as StrategyBlueprint,
      story: {} as unknown as StoryStructure,
      copy: { slides: [{ index: 1, headline: 'h', charCounts: {} }], microcopy: { ctaButton: 'c', swipeHint: '→', profileCaption: 'p' } } as unknown as CopyOutput,
    })

    expect(calls).toHaveLength(2) // override (vazio) + base
    expect(out.slides.length).toBeGreaterThan(0)
    expect(fallback).toHaveBeenCalledWith('visual-compositor', expect.stringMatching(/slides|elemento/i))
  })
})

describe('caso especial — quality-validator: override inválido na chamada qualitativa → fallback', () => {
  it('saída qualitativa sem notas numéricas → assertQualitativeShape lança → fallback ao base', async () => {
    const agent = new QualityValidatorAgent(makeAi({ promptOverridesEnabled: true }))
    const badQualitative = { voiceChecks: [], copyQualityChecks: [], overallAssessment: { recommendations: [] } } // sem números
    const goodQualitative = {
      voiceChecks: [], copyQualityChecks: [],
      overallAssessment: { brandConsistency: 90, copyQuality: 85, visualHarmony: 88, recommendations: [] },
    }
    const { calls } = injectFakeProvider(agent, [badQualitative, goodQualitative])
    const fallback = vi.fn()
    const pipelineInput = {
      assetType: 'carousel',
      context: { productName: 'P', productDescription: 'D', targetAudience: 'A', keyBenefits: ['b'] },
      goal: { objective: 'awareness', angle: 'transformation' },
      content: { mainMessage: 'M' },
      promptOverrides: { 'quality-validator': 'OVERRIDE QUE NÃO PRODUZ NOTAS' },
      onPromptFallback: fallback,
      brandConfig: {
        visualIdentity: {
          logo: { url: null },
          colors: {
            primary: { hex: '#111', name: 'p' }, secondary: { hex: '#222', name: 's' },
            accent: { hex: '#333', name: 'a' }, background: { hex: '#fff', name: 'bg' }, text: { hex: '#000', name: 't' },
          },
          typography: { heading: { family: 'Inter', weights: [700] }, body: { family: 'Inter', weights: [400] } },
        },
        voice: { attributes: [], toneGuidelines: [], copyExamples: [] },
        examples: [],
      },
    } as unknown as PipelineInput

    const out = await agent.execute({
      pipelineInput,
      copy: { slides: [{ index: 1, headline: 'h', charCounts: {} }], microcopy: { ctaButton: 'c', swipeHint: '→', profileCaption: 'p' } } as unknown as CopyOutput,
      visual: { slides: [{ index: 1, background: { type: 'solid', value: '#111' }, elements: [], canvas: { width: 1080, height: 1350 } }], tokens: { colors: {}, fonts: {}, spacing: {} } } as never,
    })

    expect(calls).toHaveLength(2) // override (ruim) + base
    expect(typeof out.score).toBe('number') // pipeline completou
    expect(fallback).toHaveBeenCalledWith('quality-validator', expect.stringMatching(/numéricas|checks/i))
  })
})
