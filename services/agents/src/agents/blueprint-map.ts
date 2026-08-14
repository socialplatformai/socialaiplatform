/**
 * Blueprint Map — a ponte que faltava (ADR-0015 PR1).
 *
 * O PLANEJAMENTO já escolhe um `SlideLayout` rico por slide (story-architect + archetypes-v2),
 * mas o RENDER só conhece 3 templates físicos (`branding-os-{cover,body,last}-v1`). Hoje o
 * `layoutId` é CRAVADO no prompt do visual-compositor por posição (1º/último/resto) e todo
 * `SlideLayout` colapsa em 3 caixas.
 *
 * Este módulo é o ÚNICO ponto de tradução `SlideLayout → blueprintId`. É uma função pura e
 * determinística — sem IA, sem estado. Layout sem blueprint dedicado cai no fallback honesto
 * (`branding-os-body-v1`), nunca lança.
 *
 * INVARIANTE PR1 (ADR-0015 AC2/AC3): nesta fatia TODO layout mapeia para um dos 3 templates
 * ATUAIS — o render não ganha pixel novo, os snapshots ficam byte-idênticos. As fatias seguintes
 * (PR2+) registram blueprints novos trocando o alvo de um layout específico AQUI, num só lugar.
 */

import type { SlideLayout, SlideType, EmotionalBeat } from '@/types/pipeline'

/** Os 3 templates físicos que o render-engine conhece hoje. */
export const COVER_BLUEPRINT = 'branding-os-cover-v1'
export const BODY_BLUEPRINT = 'branding-os-body-v1'
export const LAST_BLUEPRINT = 'branding-os-last-v1'

/**
 * ADR-0015 PR2 — 1º blueprint novo: comparison-columns (o `comparison-vs` da spec). Renderiza UM
 * lado forte por slide (rótulo + descrição grande), reusando a linguagem visual da spec sem inventar
 * um 2º lado sem copy (decisão "1 lado por slide", honestidade L5). Dois variantes compartilham a
 * família CSS: o lado B (solução/depois) ganha o painel com --bd-accent; o lado A (problema/antes)
 * fica no fundo da marca. A sequência A→B faz o contraste.
 */
export const COMPARISON_A_BLUEPRINT = 'comparison-columns-a'
export const COMPARISON_B_BLUEPRINT = 'comparison-columns-b'

/**
 * "Tom" do slide para desambiguar variantes de um mesmo layout (ex.: lado A×B do comparativo).
 * Derivado do que o planejamento já decidiu (SlideType + EmotionalBeat) — não é dado novo.
 */
export interface SlideTone {
  type?: SlideType
  beat?: EmotionalBeat
}

/** Beats "positivos" (solução/virada) → lado B (acento). Os demais → lado A (antes/problema). */
const POSITIVE_BEATS = new Set<EmotionalBeat>(['hope', 'relief', 'excitement', 'empowerment', 'trust'])

/** O slide é o "lado B" (solução/depois/certo) de um comparativo? */
function isPositiveSide(tone?: SlideTone): boolean {
  if (!tone) return false
  if (tone.type === 'solution' || tone.type === 'benefits') return true
  if (tone.type === 'problem' || tone.type === 'agitation') return false
  return tone.beat ? POSITIVE_BEATS.has(tone.beat) : false
}

/**
 * Posição do slide no carrossel — o eixo que hoje decide cover/last. O blueprint final combina
 * a posição (capa/fecho) com o layout semântico (o que o slide É). Capa e fecho têm forma própria
 * que prevalece; no miolo, o layout manda.
 */
export type SlidePosition = 'first' | 'middle' | 'last'

/**
 * Mapa `SlideLayout → blueprintId` para slides do MIOLO (nem capa, nem fecho).
 *
 * PR1: todos apontam para BODY_BLUEPRINT (o body-v1 já honra stat/quote/bullets/cta condicional —
 * a variedade visual ainda vem do conteúdo, não da geometria). Cada PR seguinte troca UMA entrada
 * aqui para o blueprint novo correspondente (ex.: PR2 → 'comparison-columns': COMPARISON_BLUEPRINT).
 */
const MIDDLE_LAYOUT_BLUEPRINT: Record<SlideLayout, string> = {
  'centered-headline': BODY_BLUEPRINT,
  'headline-subheadline': BODY_BLUEPRINT,
  'stat-highlight': BODY_BLUEPRINT,
  'bullet-points': BODY_BLUEPRINT,
  'icon-grid': BODY_BLUEPRINT,
  'testimonial': BODY_BLUEPRINT,
  'split-image-text': BODY_BLUEPRINT,
  'offer-box': BODY_BLUEPRINT,
  'cta-focused': BODY_BLUEPRINT,
  // PR2: 1º blueprint real. A variante (A/B) é resolvida pelo tom em resolveBlueprint.
  'comparison-columns': COMPARISON_A_BLUEPRINT,
}

/**
 * Resolve o blueprintId físico de um slide a partir do seu layout semântico e da posição.
 *
 * - Capa (`first`) → sempre o blueprint de capa (forma de abertura prevalece).
 * - Fecho (`last`) → sempre o blueprint de fecho (CTA final prevalece).
 * - Miolo → o blueprint do layout; ausente/desconhecido → fallback honesto (body).
 *
 * @param layout   SlideLayout escolhido pelo planejamento (pode ser undefined em entradas legadas).
 * @param position posição do slide no carrossel.
 */
export function resolveBlueprint(
  layout: SlideLayout | undefined,
  position: SlidePosition,
  tone?: SlideTone,
): string {
  if (position === 'first') return COVER_BLUEPRINT
  if (position === 'last') return LAST_BLUEPRINT
  // comparison-columns: a variante (lado A×B) vem do tom do slide (solução/depois → painel acento).
  if (layout === 'comparison-columns') {
    return isPositiveSide(tone) ? COMPARISON_B_BLUEPRINT : COMPARISON_A_BLUEPRINT
  }
  if (layout && layout in MIDDLE_LAYOUT_BLUEPRINT) {
    return MIDDLE_LAYOUT_BLUEPRINT[layout]
  }
  return BODY_BLUEPRINT
}

/** Deriva a posição a partir do índice (0-based) e do total de slides. */
export function positionOf(index: number, total: number): SlidePosition {
  if (index === 0) return 'first'
  if (index === total - 1) return 'last'
  return 'middle'
}
