/**
 * Resolução de templates por job (D/ADR-0008).
 *
 * O agents agora pode receber templates da API (curados por marca) no request, em vez de
 * usar SÓ o registry hardcoded (TEMPLATES em ./index.ts). Este módulo é a BORDA que:
 *   D5 — valida o shape de cada template recebido (guarda de CarouselTemplate); inválido →
 *        DESCARTADO com log, nunca crash.
 *   D4 — monta o pool EFETIVO: templates válidos do request; se nenhum válido → fallback ao
 *        registry built-in (degradado honesto).
 *   D3 — resolve o template FORÇADO (por id) dentro do pool efetivo; ausente/inválido → null
 *        (o brand-strategist roda a seleção normal).
 *
 * Funções puras (sem process.env, sem efeito além de console.warn em template inválido) —
 * testáveis isoladamente.
 */

import type { CarouselTemplate, TemplateSlide } from '@/types/pipeline'
import { TEMPLATE_LIST, getTemplateById } from './index.js'

const SLIDE_TYPES = new Set([
  'cover', 'problem', 'agitation', 'solution', 'benefits', 'features',
  'social-proof', 'stats', 'comparison', 'offer', 'urgency', 'cta', 'transition',
])
const SLIDE_LAYOUTS = new Set([
  'centered-headline', 'headline-subheadline', 'stat-highlight', 'bullet-points',
  'icon-grid', 'testimonial', 'split-image-text', 'offer-box', 'cta-focused', 'comparison-columns',
])
const EMOTIONAL_BEATS = new Set([
  'curiosity', 'pain', 'frustration', 'hope', 'excitement', 'trust', 'urgency', 'relief', 'empowerment',
])

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

/** D5: valida UM slide de template. Retorna a razão da falha, ou null se válido. */
function validateSlide(s: unknown, i: number): string | null {
  if (typeof s !== 'object' || s === null) return `slide ${i} não é objeto`
  const slide = s as Record<string, unknown>
  if (typeof slide.index !== 'number') return `slide ${i} sem 'index' numérico`
  if (!isNonEmptyString(slide.type) || !SLIDE_TYPES.has(slide.type)) return `slide ${i} com 'type' inválido`
  if (!isNonEmptyString(slide.layout) || !SLIDE_LAYOUTS.has(slide.layout)) return `slide ${i} com 'layout' inválido`
  if (!isNonEmptyString(slide.emotionalBeat) || !EMOTIONAL_BEATS.has(slide.emotionalBeat)) return `slide ${i} com 'emotionalBeat' inválido`
  if (!isNonEmptyString(slide.purpose)) return `slide ${i} sem 'purpose'`
  // requiredElements é o campo load-bearing (o copywriter o usa); precisa ser array não-vazio de strings.
  if (!Array.isArray(slide.requiredElements) || slide.requiredElements.length === 0
      || !slide.requiredElements.every(isNonEmptyString)) {
    return `slide ${i} com 'requiredElements' inválido (esperado array não-vazio de strings)`
  }
  if (typeof slide.copyConstraints !== 'object' || slide.copyConstraints === null) {
    return `slide ${i} sem 'copyConstraints'`
  }
  return null
}

/**
 * D5: guarda de shape do CarouselTemplate. Retorna o template TIPADO se válido, ou null
 * (com a razão) se inválido. NÃO lança — o chamador decide o fallback.
 */
export function validateCarouselTemplate(input: unknown): { template: CarouselTemplate | null; reason?: string } {
  if (typeof input !== 'object' || input === null) return { template: null, reason: 'não é objeto' }
  const t = input as Record<string, unknown>

  if (!isNonEmptyString(t.id)) return { template: null, reason: "sem 'id'" }
  if (!isNonEmptyString(t.name)) return { template: null, reason: `'${String(t.id)}' sem 'name'` }
  if (typeof t.slideCount !== 'number' || t.slideCount <= 0) {
    return { template: null, reason: `'${t.id}' com 'slideCount' inválido` }
  }
  if (!Array.isArray(t.slides) || t.slides.length === 0) {
    return { template: null, reason: `'${t.id}' sem 'slides'` }
  }
  // slideCount DEVE bater com o nº de slides (senão o pipeline pede N slides e o template tem M).
  if (t.slides.length !== t.slideCount) {
    return { template: null, reason: `'${t.id}': slideCount (${t.slideCount}) ≠ slides.length (${t.slides.length})` }
  }
  for (let i = 0; i < t.slides.length; i++) {
    const reason = validateSlide(t.slides[i], i)
    if (reason) return { template: null, reason: `'${t.id}': ${reason}` }
  }
  // recommendedFor/bestFor: o brand-strategist os lê no prompt; toleramos ausência (default []).
  return { template: input as CarouselTemplate }
}

/** Pool de templates efetivo para um job + o template forçado resolvido. */
export interface ResolvedTemplates {
  /** Templates que o brand-strategist pode escolher (request validado OU registry built-in). */
  available: CarouselTemplate[]
  /** true se 'available' veio do request (não do fallback built-in) — só p/ log/diagnóstico. */
  fromRequest: boolean
  /** Template FORÇADO (D3), já validado e presente em 'available'; null = seleção normal. */
  forced: CarouselTemplate | null
}

/**
 * D3/D4/D5: resolve o pool efetivo de templates para um job.
 * - Valida cada template do request (D5); descarta inválidos com log (nunca crash).
 * - Se sobrou ≥1 válido → esse é o pool (D4). Senão → fallback ao registry built-in (degradado).
 * - Resolve o forçado (D3) por id, dentro do pool; ausente/inválido → null.
 */
export function resolveTemplates(
  requestTemplates: unknown[] | undefined,
  forcedTemplateId: string | undefined,
): ResolvedTemplates {
  const valid: CarouselTemplate[] = []
  for (const raw of requestTemplates ?? []) {
    const { template, reason } = validateCarouselTemplate(raw)
    if (template) valid.push(template)
    else console.warn(`[templates] template do request descartado (D5): ${reason}`)
  }

  const fromRequest = valid.length > 0
  const available = fromRequest ? valid : TEMPLATE_LIST

  // D3: força por id dentro do pool efetivo. Se o forçado não está no pool (foi inválido,
  // ou não veio no request mas é built-in), tenta o registry built-in como último recurso —
  // mas só se o pool É o built-in (senão respeitamos a curadoria: forçar fora do pool = ignorar).
  let forced: CarouselTemplate | null = null
  if (isNonEmptyString(forcedTemplateId)) {
    forced = available.find((t) => t.id === forcedTemplateId) ?? null
    if (!forced && !fromRequest) {
      // Pool é o built-in e o id é built-in conhecido (caminho normal sem templates no request).
      forced = getTemplateById(forcedTemplateId)
    }
    if (!forced) {
      console.warn(`[templates] forcedTemplateId '${forcedTemplateId}' não está no pool efetivo — seleção normal (D3).`)
    }
  }

  return { available, fromRequest, forced }
}
