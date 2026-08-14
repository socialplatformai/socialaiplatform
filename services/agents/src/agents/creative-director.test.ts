import { describe, it, expect } from 'vitest'

// task 1.1 — Creative Director: roteamento de estratégia visual por slide. PURO/determinístico.
// Cobre as 3 regras da auditoria (foto generativa / banco / composição gráfica) + a fronteira
// honesta (stock/gráfico roteados mas executando via foto até 1.2/1.3 → deferred=true).

import { decideCreativeDirection, strategyServedBy } from './creative-director.js'
import type {
  StoryStructure,
  StorySlide,
  StrategyBlueprint,
  SlideType,
  EmotionalBeat,
} from '@/types/pipeline'

function slide(index: number, type: SlideType, emotionalBeat: EmotionalBeat): StorySlide {
  return {
    index,
    type,
    layout: 'centered-headline',
    purpose: 'p',
    emotionalBeat,
    contentBrief: 'b',
    visualDirection: 'v',
  }
}

function story(slides: StorySlide[]): StoryStructure {
  return {
    totalSlides: slides.length,
    overallNarrative: 'n',
    slides,
    copywriterNotes: { keyMessage: 'k', toneReminders: [], phrasesToUse: [], phrasesToAvoid: [] },
  }
}

const strategy = {
  templateId: 't',
  templateName: 'T',
  slideCount: 1,
  narrativeAngle: 'problem-solution',
  emotionalArc: [],
  constraints: { tone: '', visualEnergy: 'moderate', ctaStyle: '', avoidPatterns: [] },
  reasoning: { whyThisTemplate: '', whyThisAngle: '', keyInsights: [] },
} as StrategyBlueprint

describe('decideCreativeDirection — roteamento por regra da auditoria', () => {
  it('lançamento/destaque (cover + excitement) → foto generativa (provider real → não deferida)', () => {
    const cd = decideCreativeDirection(story([slide(1, 'cover', 'excitement')]), strategy)
    expect(cd.perSlide[0].strategy).toBe('generative-photo')
    expect(cd.perSlide[0].effectiveStrategy).toBe('generative-photo')
    expect(cd.perSlide[0].deferred).toBe(false)
  })

  it('depoimento + confiança (beat trust) → banco de imagens, mas DEFERIDO (sem provider real hoje)', () => {
    const cd = decideCreativeDirection(story([slide(1, 'social-proof', 'trust')]), strategy)
    expect(cd.perSlide[0].strategy).toBe('stock-photo')
    // fronteira honesta: roteado para banco, mas EXECUTA via foto generativa até 1.2.
    expect(cd.perSlide[0].effectiveStrategy).toBe('generative-photo')
    expect(cd.perSlide[0].deferred).toBe(true)
  })

  it('comparativo/dados (comparison) → composição gráfica, DEFERIDA até 1.2/1.3', () => {
    const cd = decideCreativeDirection(story([slide(1, 'comparison', 'curiosity')]), strategy)
    expect(cd.perSlide[0].strategy).toBe('graphic-composition')
    expect(cd.perSlide[0].effectiveStrategy).toBe('generative-photo')
    expect(cd.perSlide[0].deferred).toBe(true)
  })

  it('stats também roteia para composição gráfica', () => {
    const cd = decideCreativeDirection(story([slide(1, 'stats', 'curiosity')]), strategy)
    expect(cd.perSlide[0].strategy).toBe('graphic-composition')
  })

  it('dados precedem confiança: stats + trust → gráfico (não banco)', () => {
    const cd = decideCreativeDirection(story([slide(1, 'stats', 'trust')]), strategy)
    expect(cd.perSlide[0].strategy).toBe('graphic-composition')
  })
})

describe('decideCreativeDirection — agregação e fail-safe', () => {
  it('primaryStrategy = estratégia mais frequente entre os slides', () => {
    const cd = decideCreativeDirection(
      story([
        slide(1, 'cover', 'excitement'), // foto
        slide(2, 'benefits', 'hope'), // foto
        slide(3, 'comparison', 'curiosity'), // gráfico
      ]),
      strategy,
    )
    expect(cd.primaryStrategy).toBe('generative-photo')
  })

  it('o rationale anuncia quantos slides foram deferidos (fronteira honesta visível)', () => {
    const cd = decideCreativeDirection(
      story([slide(1, 'social-proof', 'trust'), slide(2, 'comparison', 'curiosity')]),
      strategy,
    )
    const deferidos = cd.perSlide.filter((s) => s.deferred).length
    expect(deferidos).toBe(2)
    expect(cd.rationale).toMatch(/2 slide\(s\)/)
  })

  it('story sem slides → direção vazia, fail-safe (não lança, primary generative-photo)', () => {
    const cd = decideCreativeDirection(story([]), strategy)
    expect(cd.perSlide).toEqual([])
    expect(cd.primaryStrategy).toBe('generative-photo')
  })
})

describe('decideCreativeDirection — served (task 1.2: provider do job define o deferred)', () => {
  it('quando o provider do job serve stock-photo, um slide de depoimento NÃO é deferido', () => {
    const cd = decideCreativeDirection(story([slide(1, 'social-proof', 'trust')]), strategy, 'stock-photo')
    expect(cd.perSlide[0].strategy).toBe('stock-photo')
    expect(cd.perSlide[0].effectiveStrategy).toBe('stock-photo')
    expect(cd.perSlide[0].deferred).toBe(false) // provider stock atende → não deferido
  })

  it('com served=stock-photo, um slide de foto generativa passa a ser o DEFERIDO (executa via stock)', () => {
    const cd = decideCreativeDirection(story([slide(1, 'cover', 'excitement')]), strategy, 'stock-photo')
    expect(cd.perSlide[0].strategy).toBe('generative-photo')
    expect(cd.perSlide[0].effectiveStrategy).toBe('stock-photo')
    expect(cd.perSlide[0].deferred).toBe(true)
  })

  it('strategyServedBy: stock→stock-photo; flux/gemini/openai→generative-photo', () => {
    expect(strategyServedBy('stock')).toBe('stock-photo')
    expect(strategyServedBy('flux')).toBe('generative-photo')
    expect(strategyServedBy('gemini')).toBe('generative-photo')
    expect(strategyServedBy('openai')).toBe('generative-photo')
  })
})
