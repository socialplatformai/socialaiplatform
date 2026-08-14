import { describe, it, expect, vi } from 'vitest'
import { VisualCompositorAgent } from './visual-compositor.js'
import type { ITextProvider } from '../text/textProvider.js'
import type { AiConfig } from '../config.js'
import type { PipelineInput, StoryStructure, StrategyBlueprint } from '../types/pipeline.js'
import { COVER_BLUEPRINT, LAST_BLUEPRINT, COMPARISON_A_BLUEPRINT } from './blueprint-map.js'

// ADR-0015 PR1 / AC6 — o wire planejamento→render. O `layoutId` deixa de ser cravado pelo LLM e
// passa a ser DERIVADO do `story.slides[i].layout`. Estes testes provam que, mesmo que o LLM emita
// um layoutId QUALQUER, o compositor o sobrescreve com o blueprint resolvido pela posição/layout.

function makeAi(): AiConfig {
  return {
    textProvider: 'gemini', imageProvider: 'gemini', apiKey: 'test-key', imageApiKey: '',
    model: { text: 'models/x', image: 'models/y' }, temperature: 0.7, maxTokens: 16384,
    promptOverridesEnabled: false,
  } as AiConfig
}

/** Provider fake: completeJSON devolve sempre o mesmo JSON (com layoutId bogus de propósito). */
function injectFake(agent: unknown, json: unknown) {
  const fake: ITextProvider = {
    name: 'fake',
    complete: vi.fn(async () => 'x'),
    completeJSON: vi.fn(async () => json as never),
  }
  ;(agent as { provider: ITextProvider }).provider = fake
}

const PIPELINE_INPUT = {
  assetType: 'carousel',
  context: { productName: 'P', productDescription: 'D', targetAudience: 'A', keyBenefits: ['b'] },
  goal: { objective: 'awareness', angle: 'transformation' },
  content: { mainMessage: 'M' },
  brandConfig: {
    visualIdentity: {
      logo: { url: null },
      colors: {
        primary: { hex: '#111', name: 'p' }, secondary: { hex: '#222', name: 's' },
        accent: { hex: '#333', name: 'a' }, background: { hex: '#FFF', name: 'bg' }, text: { hex: '#000', name: 't' },
      },
      typography: { heading: { family: 'Inter', weights: [700] }, body: { family: 'Inter', weights: [400] } },
    },
    voice: { attributes: [], toneGuidelines: [], copyExamples: [] },
    examples: [],
  },
} as unknown as PipelineInput

const STRATEGY = { templateId: 't', templateName: 'T', slideCount: 3, narrativeAngle: 'problem-solution',
  emotionalArc: [], constraints: { tone: 't', visualEnergy: 'moderate', ctaStyle: 'c', avoidPatterns: [] },
  reasoning: { whyThisTemplate: 'w', whyThisAngle: 'w', keyInsights: [] } } as unknown as StrategyBlueprint

// 3 slides: capa, miolo (comparison-columns), fecho.
const STORY = {
  totalSlides: 3, overallNarrative: 'n',
  slides: [
    { index: 1, type: 'cover', layout: 'centered-headline', purpose: 'p', emotionalBeat: 'curiosity', contentBrief: 'c', visualDirection: 'v' },
    { index: 2, type: 'comparison', layout: 'comparison-columns', purpose: 'p', emotionalBeat: 'pain', contentBrief: 'c', visualDirection: 'v' },
    { index: 3, type: 'cta', layout: 'cta-focused', purpose: 'p', emotionalBeat: 'empowerment', contentBrief: 'c', visualDirection: 'v' },
  ],
  copywriterNotes: { keyMessage: 'k', toneReminders: [], phrasesToUse: [], phrasesToAvoid: [] },
} as unknown as StoryStructure

// O LLM emite layoutId BOGUS em todos — o wire deve ignorá-los.
const LLM_RESPONSE = {
  slides: [
    { index: 1, layoutId: 'BOGUS-DO-LLM', elements: [{ type: 'text', role: 'headline', content: 'H1' }] },
    { index: 2, layoutId: 'BOGUS-DO-LLM', elements: [{ type: 'text', role: 'headline', content: 'H2' }] },
    { index: 3, layoutId: 'BOGUS-DO-LLM', elements: [{ type: 'text', role: 'headline', content: 'H3' }] },
  ],
}

describe('VisualCompositor — wire layout→layoutId (ADR-0015 AC6)', () => {
  it('o layoutId é DERIVADO da posição/layout, não do que o LLM emitiu', async () => {
    const agent = new VisualCompositorAgent(makeAi())
    injectFake(agent, LLM_RESPONSE)

    const out = await agent.execute({ pipelineInput: PIPELINE_INPUT, strategy: STRATEGY, story: STORY, copy: { slides: [], microcopy: { ctaButton: '', swipeHint: '', profileCaption: '' } } as never })

    // Nenhum slide mantém o layoutId bogus do LLM.
    expect(out.slides.map((s) => s.layoutId)).not.toContain('BOGUS-DO-LLM')
    // Capa → cover; miolo (comparison-columns, type=comparison/beat=pain) → variante A (antes);
    // fecho → last. (PR2: comparison-columns vira blueprint real.)
    expect(out.slides[0].layoutId).toBe(COVER_BLUEPRINT)
    expect(out.slides[1].layoutId).toBe(COMPARISON_A_BLUEPRINT)
    expect(out.slides[2].layoutId).toBe(LAST_BLUEPRINT)
  })
})
