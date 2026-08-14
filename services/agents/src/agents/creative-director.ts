/**
 * Creative Director — roteamento de estratégia visual (Pilar I · task 1.1, ADR a registrar).
 *
 * Decide, POR SLIDE, COMO a imagem deve nascer: foto generativa / banco de imagens / composição
 * gráfica. É o passo entre o Story Architect e o Visual Compositor — não gera nada, só ROTEIA.
 *
 * POR QUE PURO (sem LLM): a regra de roteamento é uma TABELA explícita da auditoria
 * (lançamento+destaque → foto generativa · depoimento+confiança → banco · comparativo+dados →
 * composição gráfica). Decisão conhecível a partir de (tipo de slide + beat emocional + objetivo):
 * determinística, grátis, testável, sem risco de 429. Uma chamada de LLM aqui seria mais lenta,
 * custaria tokens e seria não-determinística para um lookup. (L8/L3 da constituição.)
 *   Alternativa descartada: um agente LLM que "raciocina" a estratégia. Fica para quando o
 *   roteamento precisar de julgamento que a tabela não captura (ex.: ler a imagem de referência) —
 *   aí sim entra um modelo. Hoje, a tabela basta.
 *
 * FRONTEIRA HONESTA (escopo "agente + roteamento mapeado"): só `generative-photo` tem provider
 * real hoje (Gemini/OpenAI). `stock-photo` e `graphic-composition` são ROTEADAS — a decisão é
 * registrada e auditável — mas EXECUTAM via foto generativa até 1.2/1.3 plugarem os providers.
 * Isso é explícito em `effectiveStrategy`/`deferred`, nunca mascarado.
 */

import type {
  StoryStructure,
  StorySlide,
  StrategyBlueprint,
  CreativeDirection,
  SlideCreativeDirection,
  ImageStrategy,
  SlideType,
  EmotionalBeat,
} from '@/types/pipeline'
import type { ImageProviderKind } from '@/config'
import type { BrandDesignSpec } from '../brand/design-spec.js'

/**
 * task 1.2: qual ImageStrategy o provider de imagem do JOB realmente serve. O provider é GLOBAL por
 * job (um `IMAGE_PROVIDER`), então a estratégia ROTEADA por slide só é "real" se o provider do job a
 * serve; as demais são deferidas (executam via o provider do job). LIMITAÇÃO DECLARADA: não há
 * seleção de provider POR SLIDE ainda — um job não mistura flux (cover) + stock (depoimento). Isso é
 * evolução futura (mover a resolução de provider para dentro do loop do image-generator).
 * - flux/gemini/openai/imagen → 'generative-photo' (foto, gerada ou da IA do provider)
 * - stock                     → 'stock-photo' (banco Pexels)
 * - (graphic-composition ainda sem provider — fica sempre deferida nesta fase)
 */
export function strategyServedBy(provider: ImageProviderKind): ImageStrategy {
  return provider === 'stock' ? 'stock-photo' : 'generative-photo'
}

/**
 * task 1.4 — estratégia ALTERNATIVA para retry quando a visual reprova. Roteia a estratégia atual
 * para a "próxima melhor". Determinístico e FINITO (nunca cicla): cada estratégia mapeia para UMA
 * alternativa distinta; o teto de tentativas do orquestrador impede repetição. Racional:
 *   - generative-photo falhou (uncanny/pobre) → tenta stock-photo (foto real curada).
 *   - stock-photo falhou (sem match no banco) → tenta generative-photo.
 *   - graphic-composition falhou → cai em generative-photo (foto como plano B).
 * Retorna null se não há alternativa sensata (não deveria ocorrer com o mapa acima; defensivo).
 */
export function alternativeStrategy(current: ImageStrategy): ImageStrategy | null {
  switch (current) {
    case 'generative-photo': return 'stock-photo'
    case 'stock-photo': return 'generative-photo'
    case 'graphic-composition': return 'generative-photo'
    default: return null
  }
}

/**
 * Beats que pedem CONFIANÇA/prova social → banco de imagens (rostos reais, autenticidade).
 * Foto generativa de pessoa ainda escorrega para o "uncanny"; banco curado é mais seguro aqui.
 */
const BEATS_CONFIANCA: ReadonlySet<EmotionalBeat> = new Set<EmotionalBeat>(['trust'])

/**
 * Tipos de slide orientados a DADOS/comparação → composição gráfica (números, antes/depois,
 * tabelas) em vez de foto. A foto não comunica um comparativo; o gráfico sim.
 */
const TIPOS_GRAFICOS: ReadonlySet<SlideType> = new Set<SlideType>(['comparison', 'stats'])

/**
 * Roteia UM slide para uma estratégia visual (a "ideal", antes do filtro de provider).
 * Ordem de precedência (mais específico primeiro):
 *   1. dados/comparação (tipo)      → graphic-composition
 *   2. confiança/prova social (beat)→ stock-photo
 *   3. social-proof (tipo)          → stock-photo (depoimento sem o beat 'trust' explícito)
 *   4. default                      → generative-photo (lançamento, destaque, capa, oferta…)
 */
function rotearSlide(slide: StorySlide): { strategy: ImageStrategy; reason: string } {
  if (TIPOS_GRAFICOS.has(slide.type)) {
    return { strategy: 'graphic-composition', reason: `slide de ${slide.type} (dados/comparativo) → composição gráfica` }
  }
  if (BEATS_CONFIANCA.has(slide.emotionalBeat) || slide.type === 'social-proof') {
    return { strategy: 'stock-photo', reason: `beat '${slide.emotionalBeat}'/${slide.type} (confiança/prova) → banco de imagens` }
  }
  return { strategy: 'generative-photo', reason: `slide de ${slide.type} (beat '${slide.emotionalBeat}') → foto generativa` }
}

/**
 * Aplica o filtro de provider: estratégia ideal → executável (fronteira honesta). `served` é a
 * estratégia que o provider do job atende; tudo ≠ served é DEFERIDO (executa via o provider do job).
 */
function resolverExecutavel(
  ideal: ImageStrategy,
  served: ImageStrategy,
): { effectiveStrategy: ImageStrategy; deferred: boolean } {
  if (ideal === served) return { effectiveStrategy: ideal, deferred: false }
  return { effectiveStrategy: served, deferred: true }
}

/** A estratégia mais frequente entre os slides (resumo para a UI). Empate → a do 1º slide. */
function predominante(perSlide: SlideCreativeDirection[]): ImageStrategy {
  if (perSlide.length === 0) return 'generative-photo'
  const contagem = new Map<ImageStrategy, number>()
  for (const s of perSlide) contagem.set(s.strategy, (contagem.get(s.strategy) ?? 0) + 1)
  let melhor = perSlide[0].strategy
  let max = 0
  for (const s of perSlide) {
    const c = contagem.get(s.strategy) ?? 0
    if (c > max) {
      max = c
      melhor = s.strategy
    }
  }
  return melhor
}

/**
 * Decide a direção criativa da pauta inteira. PURO, determinístico, fail-safe (story sem slides →
 * direção vazia com primary 'generative-photo'). Não lança.
 *
 * @param story   estrutura do Story Architect (tipos + beats por slide).
 * @param strategy blueprint do Brand Strategist (ângulo narrativo — entra no rationale global).
 * @param served  estratégia que o provider de imagem do JOB atende (task 1.2). Default
 *                'generative-photo' (provider de foto). Tudo ≠ served é deferido p/ esse provider.
 * @param _designSpec spec canônico (paleta/mood) — reservado p/ refino futuro do roteamento; hoje
 *                    a decisão não depende dele (mantido na assinatura para 1.4 estender sem quebrar).
 */
export function decideCreativeDirection(
  story: StoryStructure,
  strategy: StrategyBlueprint,
  served: ImageStrategy = 'generative-photo',
  _designSpec?: BrandDesignSpec,
): CreativeDirection {
  const slides = story?.slides ?? []
  const perSlide: SlideCreativeDirection[] = slides.map((slide) => {
    const { strategy: ideal, reason } = rotearSlide(slide)
    const { effectiveStrategy, deferred } = resolverExecutavel(ideal, served)
    return { index: slide.index, strategy: ideal, reason, effectiveStrategy, deferred }
  })

  const primaryStrategy = predominante(perSlide)
  const deferidos = perSlide.filter((s) => s.deferred).length
  const rationale =
    `Roteamento por ângulo '${strategy?.narrativeAngle ?? 'n/d'}': ` +
    `estratégia predominante ${primaryStrategy}; provider do job serve '${served}'` +
    (deferidos > 0
      ? `; ${deferidos} slide(s) com estratégia ideal diferente executam via '${served}' (sem provider por-slide ainda).`
      : '.')

  return { primaryStrategy, rationale, perSlide }
}
