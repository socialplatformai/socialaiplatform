/**
 * Input Adapter — versão microserviço (porte do branding-os).
 *
 * ORIGINAL: convertia AgentInput (wizardStore Zustand do frontend) → PipelineInput.
 * AQUI: converte o contrato HTTP { brandContext, pauta, format } → PipelineInput,
 * sem depender de store de frontend. O BrandContext vem da API .NET (E-3).
 *
 * Onde o BrandContext HTTP é mais pobre que o BrandConfigForPipeline rico do
 * branding-os (cores/tipografia/exemplos estruturados), aplicamos defaults
 * on-brand. Enriquecer o BrandContext é evolução futura (não bloqueia o pipeline).
 */

import type { PipelineInput, BrandConfigForPipeline } from '@/types/pipeline'
import type { BrandContext, Pauta, ContentFormat } from '../types.js'
import { resolvePreset } from '../brand/presets.js'
import type { ResolvedTemplates } from '../templates/resolve.js'
// Fonte única das 5 chaves (array runtime + união derivada) — ADR-0011/E10.2.
import { PROMPT_AGENT_KEYS, type PromptAgentKey } from '@/types/agent-keys'

/**
 * ADR-0011/E10.2: sanitiza os overrides de prompt vindos do payload (brandContext.promptOverrides).
 * Copia SÓ as 5 chaves conhecidas, e só quando o valor é texto não-vazio. Chaves desconhecidas e
 * valores inválidos são descartados (com aviso). Devolve undefined se nada sobrar — assim o
 * PipelineInput.promptOverrides fica ausente e os agentes usam o base. Pura/testável.
 */
export function sanitizePromptOverrides(raw: unknown): Partial<Record<PromptAgentKey, string>> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const src = raw as Record<string, unknown>
  const out: Partial<Record<PromptAgentKey, string>> = {}
  let count = 0
  for (const key of PROMPT_AGENT_KEYS) {
    const v = src[key]
    if (typeof v === 'string' && v.trim() !== '') {
      out[key] = v
      count++
    } else if (v !== undefined) {
      console.warn(`[input-adapter] override de prompt para '${key}' ignorado (não é texto não-vazio).`)
    }
  }
  // Avisa sobre chaves desconhecidas no payload (possível erro de integração) — sem incluí-las.
  for (const key of Object.keys(src)) {
    if (!PROMPT_AGENT_KEYS.includes(key as PromptAgentKey)) {
      console.warn(`[input-adapter] chave de override de prompt desconhecida ignorada: '${key}'.`)
    }
  }
  return count > 0 ? out : undefined
}

/** E3.2: normaliza o objetivo de marketing da pauta para o union de goal.objective.
 *  Aceita sinônimos comuns (PT/EN); sem casar → 'awareness' (fallback honesto). */
function mapMarketingObjective(raw?: string): PipelineInput['goal']['objective'] {
  const v = raw?.trim().toLowerCase()
  if (!v) return 'awareness'
  if (/(conver|venda|sale|purchase|checkout|compra)/.test(v)) return 'conversion'
  // meio-de-funil: consideração, interesse, leads, e tb engajamento/tráfego (objetivos
  // de meio comuns em PT) — mais próximos de 'consideration' que de 'awareness'.
  if (/(consider|avalia|interesse|consideration|lead|engaj|tráfeg|trafeg|tráfic|trafic)/.test(v)) return 'consideration'
  return 'awareness' // reconhecimento/alcance/awareness e qualquer desconhecido (fallback honesto)
}

/** E2 (ADR-0008): normaliza hashtags da marca — apara, garante o '#' inicial, remove vazias e
 *  duplicatas (case-insensitive). Função pura/testável. '#minha marca' → '#minhamarca' (sem espaços). */
export function normalizeHashtags(raw?: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw ?? []) {
    if (typeof item !== 'string') continue
    // remove '#' iniciais e espaços internos; mantém letras/números/_ (válidos em hashtag).
    const core = item.trim().replace(/^#+/, '').replace(/\s+/g, '')
    if (!core) continue
    // O Instagram limita hashtags a ~30 caracteres (sem o '#'). Uma tag gigante seria
    // rejeitada/truncada pela Graph na publicação — descarta cedo, com aviso rastreável, em vez
    // de carregá-la até o publish falhar silenciosamente.
    if (core.length > 30) {
      console.warn(`[input-adapter] hashtag descartada (>30 chars, limite do Instagram): "${core.slice(0, 40)}…"`)
      continue
    }
    const tag = '#' + core
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}

/** Type-guard p/ o viés de performance (formato vencedor). O bestFormat vem da API já em lowercase
 *  (ContentType→string), mas um valor fora da união ('reels', 'destino', '') não deve virar viés
 *  silencioso — só 'post'|'carousel'|'story' são aceitos; o resto vira "sem viés" (undefined). */
function asValidFormat(v: unknown): ContentFormat | undefined {
  return v === 'post' || v === 'carousel' || v === 'story' ? v : undefined
}

function mapFormat(format: ContentFormat): PipelineInput['assetType'] {
  switch (format) {
    case 'carousel':
      return 'carousel'
    case 'post':
    case 'story':
      return 'single-post'
    default:
      return 'carousel'
  }
}

/**
 * Constrói um BrandConfigForPipeline a partir do BrandContext HTTP (E2/ADR-0005).
 * Resolução visual por MERGE: campo-da-marca ?? token-do-preset ?? default-APEX.
 * O preset é a unidade coerente; overrides pontuais da marca sobrescrevem campo-a-campo.
 * Marca sem identidade visual (ou sem BrandKit) → cai 100% no preset (degradado honesto).
 */
function buildBrandConfig(ctx: BrandContext): BrandConfigForPipeline {
  const vi = ctx.visualIdentity
  const preset = resolvePreset(vi?.preset)

  // Uma cor da marca sobrescreve a do preset (mantendo o nome); senão, usa a do preset.
  const color = (
    override: string | undefined,
    base: { hex: string; name: string },
  ): { hex: string; name: string } => (override ? { hex: override, name: base.name } : base)

  return {
    // S-12: propaga o handle do tenant para que o render-engine use no cabeçalho
    // dos slides. String vazia quando ausente — nunca um handle de terceiro.
    handle: ctx.handle || '',
    visualIdentity: {
      logo: { url: vi?.logoUrl || null },
      colors: {
        primary: color(vi?.colors?.primary, preset.colors.primary),
        secondary: color(vi?.colors?.secondary, preset.colors.secondary),
        accent: color(vi?.colors?.accent, preset.colors.accent),
        background: color(vi?.colors?.background, preset.colors.background),
        text: color(vi?.colors?.text, preset.colors.text),
      },
      typography: {
        heading: vi?.headingFont
          ? { family: vi.headingFont, weights: preset.typography.heading.weights }
          : preset.typography.heading,
        body: vi?.bodyFont
          ? { family: vi.bodyFont, weights: preset.typography.body.weights }
          : preset.typography.body,
      },
    },
    voice: {
      attributes: ctx.tone ? ctx.tone.split(/[,;]/).map((s) => s.trim()).filter(Boolean) : [],
      // guidelines + posicionamento entram como diretrizes de tom para os agentes.
      toneGuidelines: [ctx.guidelines, ctx.positioningRules].filter((s): s is string => !!s),
      // E3.3: exemplos reais da marca (deixam de ser []); o pipeline espera objetos.
      copyExamples: (ctx.copyExamples ?? [])
        .map((s) => s.trim())
        .filter(Boolean)
        .map((text) => ({ text, isGood: true, context: 'Exemplo de copy da marca' })),
    },
    examples: [],
  }
}

/** Opções extras do adapter (4º arg). Objeto extensível em vez de empilhar posicionais —
 *  D (ADR-0008) trouxe `templates`, FASE 7 (ADR-0009) traz `regenerationInstruction`. */
export interface AdapterOptions {
  /** D (ADR-0008): pool efetivo já resolvido/validado (resolveTemplates); ausente → registry built-in. */
  templates?: ResolvedTemplates
  /** A1 (ADR-0009): instrução de regeneração — injetada VERBATIM no início de additionalNotes
   *  (prefixo "Instrução de regeneração: "). A frase de slide dirigido (D2/A3) já vem embutida aqui. */
  regenerationInstruction?: string
  /** ADR-0011/E10.2: overrides de prompt JÁ sanitizados e GATEADOS pela flag (o gate vive em
   *  jobs.ts). Ausente → cada agente usa o base. O adapter só os repassa ao PipelineInput. */
  promptOverrides?: Partial<Record<PromptAgentKey, string>>
  /** Toggle por-geração ("usar identidade do logo"): estampa o logo da marca nos slides.
   *  Ausente/false → render byte-equivalente ao atual. Repassado a preferences.useLogoIdentity. */
  useLogoIdentity?: boolean
  /** FASE 0 (auditoria — fundação de input criativo): direção criativa por-geração que o operador
   *  fornece no wizard. Tudo OPCIONAL → ausente/vazio = briefing byte-equivalente ao atual.
   *  - `referenceUrl`: link de imagem de referência → entra no referenceContext (mesmo canal dos
   *    anexos da pauta). É referência TEXTUAL (url), não análise de imagem (isso é Pilar I).
   *  - `backgroundUrl`: fundo desejado → DIREÇÃO ao pipeline (additionalNotes) + referenceContext
   *    (decisão do operador: "como direção", a IA compõe respeitando a marca — não sobrescrita fixa).
   *  - `cta`: chamada-para-ação que o operador fixa → o copywriter a respeita (não inventa outra).
   *  - `subtitle`: subtítulo/linha de apoio que o operador fixa → direção ao copywriter. */
  creativeInput?: {
    referenceUrl?: string
    backgroundUrl?: string
    cta?: string
    subtitle?: string
  }
}

/** Adapter principal: { brandContext, pauta, format } → PipelineInput.
 *  4º arg `opts` opcional — ausente → comportamento atual byte-equivalente. */
export function adaptHttpToPipelineInput(
  brandContext: BrandContext,
  pauta: Pauta,
  format: ContentFormat,
  opts?: AdapterOptions,
): PipelineInput {
  const templates = opts?.templates
  const regenerationInstruction = opts?.regenerationInstruction?.trim()
  const brandConfig = buildBrandConfig(brandContext)

  // FASE 0: direção criativa do operador (referência/fundo/CTA/subtítulo), aparada. Strings vazias
  // viram undefined → não entram no briefing (byte-equivalência quando o operador não preencheu nada).
  const ci = opts?.creativeInput
  const ciReferenceUrl = ci?.referenceUrl?.trim() || undefined
  const ciBackgroundUrl = ci?.backgroundUrl?.trim() || undefined
  const ciCta = ci?.cta?.trim() || undefined
  const ciSubtitle = ci?.subtitle?.trim() || undefined

  // E2 (ADR-0008): hashtags da biblioteca da marca, normalizadas (com '#', sem duplicata).
  // A engine as considera no copy E elas são garantidas na caption final (ver jobs.ts).
  const brandHashtags = normalizeHashtags(brandContext.hashtags)

  // learningSummary (E-8) + tipos de conteúdo desejados + categoria (E3.5) entram como notas.
  // A1 (ADR-0009): a instrução de regeneração entra PRIMEIRO (mais saliente p/ o copywriter),
  // verbatim, prefixada. A frase de slide dirigido (A3/D2) já vem dentro da própria instrução.
  const additionalNotes = [
    regenerationInstruction ? `Instrução de regeneração: ${regenerationInstruction}` : undefined,
    pauta.context,
    brandContext.learningSummary,
    brandContext.desiredContentTypes ? `Tipos de conteúdo desejados: ${brandContext.desiredContentTypes}` : undefined,
    pauta.category ? `Categoria: ${pauta.category}` : undefined,
    // E3: concorrentes da marca como referência textual (não comparação automática).
    brandContext.competitors && brandContext.competitors.length > 0
      ? `Concorrentes de referência: ${brandContext.competitors.join(', ')}`
      : undefined,
    // E2: hashtags da marca como diretriz de copy (a caption deve incluí-las).
    brandHashtags.length > 0
      ? `Hashtags da marca (inclua-as na legenda): ${brandHashtags.join(' ')}`
      : undefined,
    // FASE 0: direção criativa do operador. CTA e subtítulo são instruções de COPY (o copywriter as
    // respeita em vez de inventar); o fundo é direção VISUAL (o compositor/gerador a consideram,
    // respeitando a marca — decisão "como direção, não sobrescrita fixa").
    ciCta ? `CTA desejado pelo operador (use-o como chamada-para-ação): ${ciCta}` : undefined,
    ciSubtitle ? `Subtítulo/linha de apoio desejada pelo operador: ${ciSubtitle}` : undefined,
    ciBackgroundUrl
      ? `Fundo de referência desejado pelo operador (use como direção visual, mantendo a identidade da marca): ${ciBackgroundUrl}`
      : undefined,
  ].filter(Boolean).join('\n\n') || undefined

  // E3.4 (DEC-2): anexos da pauta como referência textual (url + rótulo derivado do arquivo).
  // FASE 0: a referência e o fundo que o operador colou no wizard entram pelo MESMO canal (url +
  // rótulo legível) — anexos da pauta primeiro, depois a direção por-geração do operador.
  const referenceContext = [
    ...(pauta.attachments ?? []),
    ciReferenceUrl,
    ciBackgroundUrl,
  ]
    .map((url) => url?.trim())
    .filter((u): u is string => !!u)
    .map((url) => ({ url, label: url.split('/').pop() || undefined }))
  const refs = referenceContext.length > 0 ? referenceContext : undefined

  return {
    assetType: mapFormat(format),
    context: {
      productName: pauta.title,
      productDescription: pauta.objective || pauta.title,
      // E3.1 (via E2): público-alvo real da marca; default genérico só como fallback.
      targetAudience: brandContext.targetAudience?.trim() || 'Audiência da marca',
      keyBenefits: pauta.objective ? [pauta.objective] : [pauta.title],
      uniqueSellingPoint: brandContext.branding || undefined,
    },
    goal: {
      // E3.2: objetivo de marketing real da pauta (normalizado); 'awareness' só como fallback.
      objective: mapMarketingObjective(pauta.marketingObjective),
      angle: 'transformation',
      specificGoal: pauta.objective || undefined,
    },
    content: {
      mainMessage: pauta.objective || pauta.title,
      supportingPoints: pauta.objective ? [pauta.objective] : [],
      additionalNotes,
      mustInclude: undefined,
      mustAvoid: undefined,
      referenceContext: refs,
    },
    preferences: {
      slideCount: format === 'carousel' ? 6 : 1,
      // D3: id do forçado (compat com o campo existente) — só quando há forçado de verdade.
      templateId: templates?.forced?.id,
      tone: undefined,
      // D4: pool efetivo SÓ quando veio do request (curadoria da marca). Quando é o built-in
      // (fromRequest=false) e sem forçado, deixamos undefined → caminho atual byte-equivalente (Z1).
      availableTemplates: templates?.fromRequest ? templates.available : undefined,
      // D3: template forçado já resolvido (presente no pool). Pular selectBestTemplate.
      forcedTemplate: templates?.forced ?? undefined,
      // Viés de performance (sinal TIPADO do loop de aprendizado). Vem da API (formato vencedor por
      // engajamento); o brand-strategist o trata como preferência, não ordem. Ausente → sem viés.
      // Valida a união (post/carousel/story) — valor inesperado vira undefined (sem viés),
      // nunca propaga uma string fora do contrato para o pipeline.
      performanceBestFormat: asValidFormat(brandContext.bestFormat),
      // Toggle por-geração: estampar o logo da marca nos slides. Default false (omitido) → o
      // Design Compiler compila logo.enabled=false → render byte-equivalente ao atual.
      useLogoIdentity: opts?.useLogoIdentity,
    },
    // ADR-0011/E10.2: overrides já sanitizados/gateados (jobs.ts). Ausente → base sempre.
    promptOverrides: opts?.promptOverrides,
    brandConfig,
  }
}

/** Validação mínima (independe de store). */
export function validatePipelineInput(input: PipelineInput): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!input.context.productName.trim()) errors.push('Product name is required')
  if (!input.content.mainMessage.trim()) errors.push('Main message is required')
  if (!input.brandConfig.visualIdentity.colors.primary.hex) errors.push('Primary brand color is required')
  return { valid: errors.length === 0, errors }
}
