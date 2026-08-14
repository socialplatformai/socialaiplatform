import { describe, it, expect } from 'vitest'
import {
  resolveBlueprint,
  positionOf,
  COVER_BLUEPRINT,
  BODY_BLUEPRINT,
  LAST_BLUEPRINT,
  COMPARISON_A_BLUEPRINT,
  COMPARISON_B_BLUEPRINT,
} from './blueprint-map.js'
import type { SlideLayout } from '@/types/pipeline'

// ADR-0015 PR1 — a ponte planejamento→render. Nesta fatia TODO layout do miolo mapeia para os 3
// templates atuais (zero pixel novo, AC2). Os testes guardam: (a) capa/fecho prevalecem pela
// posição; (b) o miolo resolve pelo layout com fallback honesto; (c) o map é total (todo
// SlideLayout tem entrada — pega layout novo sem blueprint).

const ALL_LAYOUTS: SlideLayout[] = [
  'centered-headline',
  'headline-subheadline',
  'stat-highlight',
  'bullet-points',
  'icon-grid',
  'testimonial',
  'split-image-text',
  'offer-box',
  'cta-focused',
  'comparison-columns',
]

describe('blueprint-map — positionOf (AC3)', () => {
  it('índice 0 = first, último = last, meio = middle', () => {
    expect(positionOf(0, 5)).toBe('first')
    expect(positionOf(4, 5)).toBe('last')
    expect(positionOf(2, 5)).toBe('middle')
  })

  it('carrossel de 1 slide: índice 0 é first (capa vence o fecho)', () => {
    expect(positionOf(0, 1)).toBe('first')
  })
})

describe('blueprint-map — resolveBlueprint: posição prevalece (AC3)', () => {
  it('first → sempre cover, independente do layout', () => {
    for (const l of ALL_LAYOUTS) {
      expect(resolveBlueprint(l, 'first')).toBe(COVER_BLUEPRINT)
    }
  })

  it('last → sempre last, independente do layout', () => {
    for (const l of ALL_LAYOUTS) {
      expect(resolveBlueprint(l, 'last')).toBe(LAST_BLUEPRINT)
    }
  })
})

describe('blueprint-map — resolveBlueprint: miolo pelo layout (AC2/AC3)', () => {
  it('miolo: layouts ainda-sem-blueprint resolvem para BODY (não-regressão); só comparison-columns tem blueprint próprio (PR2)', () => {
    for (const l of ALL_LAYOUTS) {
      const got = resolveBlueprint(l, 'middle')
      if (l === 'comparison-columns') {
        // PR2: comparison-columns ganhou blueprint real (variante A por default, sem tom).
        expect(got).toBe(COMPARISON_A_BLUEPRINT)
      } else {
        expect(got).toBe(BODY_BLUEPRINT)
      }
    }
  })

  it('layout undefined no miolo → fallback honesto (body), não lança', () => {
    expect(resolveBlueprint(undefined, 'middle')).toBe(BODY_BLUEPRINT)
  })

  it('layout desconhecido (fora do enum) no miolo → fallback honesto (body)', () => {
    // força um valor inválido (entrada legada/LLM) — não deve lançar nem cair em undefined
    expect(resolveBlueprint('layout-que-nao-existe' as SlideLayout, 'middle')).toBe(BODY_BLUEPRINT)
  })

  it('o mapa é TOTAL: todo SlideLayout tem alvo (pega layout novo sem blueprint)', () => {
    for (const l of ALL_LAYOUTS) {
      expect(resolveBlueprint(l, 'middle')).toBeTruthy()
    }
  })
})

describe('blueprint-map — comparison-columns: variante A×B pelo tom (ADR-0015 PR2)', () => {
  it('type=problem/agitation → lado A (antes)', () => {
    expect(resolveBlueprint('comparison-columns', 'middle', { type: 'problem' })).toBe(COMPARISON_A_BLUEPRINT)
    expect(resolveBlueprint('comparison-columns', 'middle', { type: 'agitation' })).toBe(COMPARISON_A_BLUEPRINT)
  })

  it('type=solution/benefits → lado B (depois, painel acento)', () => {
    expect(resolveBlueprint('comparison-columns', 'middle', { type: 'solution' })).toBe(COMPARISON_B_BLUEPRINT)
    expect(resolveBlueprint('comparison-columns', 'middle', { type: 'benefits' })).toBe(COMPARISON_B_BLUEPRINT)
  })

  it('sem type, cai no beat: beat positivo → B; negativo → A', () => {
    expect(resolveBlueprint('comparison-columns', 'middle', { beat: 'hope' })).toBe(COMPARISON_B_BLUEPRINT)
    expect(resolveBlueprint('comparison-columns', 'middle', { beat: 'pain' })).toBe(COMPARISON_A_BLUEPRINT)
  })

  it('sem tom nenhum → default lado A (não inventa "depois")', () => {
    expect(resolveBlueprint('comparison-columns', 'middle')).toBe(COMPARISON_A_BLUEPRINT)
  })

  it('type prevalece sobre beat (solution+beat negativo ainda é B)', () => {
    expect(resolveBlueprint('comparison-columns', 'middle', { type: 'solution', beat: 'pain' })).toBe(COMPARISON_B_BLUEPRINT)
  })
})
