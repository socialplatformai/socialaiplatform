/**
 * Config de IA — FONTE ÚNICA DA VERDADE (E5.2 / ADR-0004).
 *
 * Antes desta fase, modelo/params/provider viviam espalhados e DIVERGENTES:
 *   - modelo de texto efetivo: 'models/gemini-flash-latest' (gemini/client.ts)
 *   - GeminiAPIConfig.model = 'models/gemini-2.5-pro' (types/agent.ts) — NUNCA lido (campo fantasma)
 *   - comentários citavam 'gemini-3-pro-preview' (base.ts) — terceiro nome, nenhum rodava
 *   - temperature/maxTokens hardcoded em base.ts (16384), jobs.ts (8192), types/agent.ts (8192)
 * Isso é o "drift" que este módulo elimina: tudo passa a derivar daqui, lido do ambiente uma vez.
 *
 * Trocar o modelo é CONFIG, não código: defina AI_TEXT_MODEL / AI_IMAGE_MODEL no .env.
 * Trocar o provider é CONFIG: TEXT_PROVIDER / IMAGE_PROVIDER (default gemini).
 *
 * NOTA: os defaults abaixo == o que HOJE roda em produção. Esta fase não muda
 * comportamento de geração — só remove o drift e torna configurável. O default
 * "mais capaz atual por provider" é decisão do ADR de E5.3 (DEC-6), não daqui.
 */

import type { GeminiAPIConfig } from './types/agent.js'

// Providers de TEXTO suportados (ADR-0008):
// - grok: texto via endpoint OpenAI-compatible (reusa o OpenAiTextProvider trocando baseURL/model/key).
// - anthropic: texto via Messages API (wrapper próprio — shape de wire distinto, NÃO OpenAI-compat).
// imagen segue stub. Imagem real por gemini (default), openai, flux (Replicate) e stock (Pexels).
export type ProviderKind = 'gemini' | 'openai' | 'grok' | 'anthropic' | 'imagen'

// Providers de IMAGEM (task 1.2). DISTINTO de ProviderKind de propósito: flux e stock são SÓ
// imagem — um tipo separado impede `TEXT_PROVIDER=flux` por construção (estado inválido não
// representável, L9). Os que também fazem texto (gemini/openai/imagen) repetem aqui porque
// imageProvider é escolhido independentemente do textProvider.
// - flux:  foto generativa de alto padrão via Replicate (FLUX da Black Forest Labs).
// - stock: banco de imagens curado via Pexels (busca temática, não geração).
export type ImageProviderKind = 'gemini' | 'openai' | 'imagen' | 'flux' | 'stock'

export interface AiConfig {
  /** Provider de texto, de TEXT_PROVIDER (fallback AI_PROVIDER). Default 'gemini'. */
  textProvider: ProviderKind
  /** Provider de imagem, de IMAGE_PROVIDER. Default 'gemini'. Tipo SÓ-imagem (inclui flux/stock). */
  imageProvider: ImageProviderKind
  /** Chave de IA: AI_PROVIDER_KEY || GEMINI_API_KEY. '' quando ausente (modo degradado). */
  apiKey: string
  /** Chave separada do provider de imagem (IMAGE_PROVIDER_KEY). '' quando ausente. */
  imageApiKey: string
  /** Modelos por modalidade — trocáveis por AI_TEXT_MODEL / AI_IMAGE_MODEL. */
  model: {
    text: string
    image: string
  }
  /** Parâmetros de geração de texto — trocáveis por AI_TEMPERATURE / AI_MAX_TOKENS. */
  temperature: number
  maxTokens: number
  /**
   * ADR-0011/E10.2: liga o override de prompt por workspace (PROMPT_OVERRIDES_ENABLED).
   * Default false (opt-in) — "poder perigoso". DESLIGADA → o pipeline usa sempre o
   * prompt-base do arquivo, ignorando qualquer override no payload. O override em si viaja
   * por run no brandContext; esta flag só decide se ele é lido.
   */
  promptOverridesEnabled: boolean
  // CAMPOS FUTUROS (Z): reservados para overrides vindos da API por workspace/marca
  // (B7) e seleção de template (C). Opcionais e NÃO usados nesta fase — só existem
  // para que a AiConfig efetiva seja o ÚNICO objeto a propagar pela cadeia sem
  // mudar a assinatura de novo quando A/B/C chegarem.
  /** Lista de templates permitidos, quando a API restringir (não usado em Z). */
  templates?: string[]
  /** Template forçado pelo operador, quando houver (não usado em Z). */
  forcedTemplateId?: string
}

// Defaults == comportamento atual (não mudar nesta fase; ver nota no topo).
// maxTokens=16384 é o valor EFETIVO que os agentes-base usavam (base.ts passava
// 16384 literal, que vencia o config.maxOutputTokens=8192 — este era fantasma).
// Preservar 16384 mantém a fase invisível (sem mudar o teto real de geração).
export const AI_DEFAULTS = {
  textProvider: 'gemini' as ProviderKind,
  imageProvider: 'gemini' as ImageProviderKind,
  // Slugs GA verificados na documentação oficial dos provedores (jun/2026):
  // - gemini-3.5-flash: GA durável; pin > alias flutuante 'gemini-flash-latest' (que troca de
  //   versão subjacente com 2 semanas de aviso — drift silencioso em produção).
  // - gemini-3.1-flash-image: GA (28/mai/2026), sem prazo de morte conhecido; substitui o
  //   2.5-flash-image, que tem SHUTDOWN agendado p/ 02/out/2026.
  textModel: 'models/gemini-3.5-flash',
  imageModel: 'models/gemini-3.1-flash-image',
  // Gemini 3.x recomenda manter temperature no default 1.0 — baixar (<1.0) causa looping/
  // degradação em raciocínio. O default sobe de 0.7 → 1.0 ao pinar 3.5-flash (decisão consciente,
  // sem regressão silenciosa). Trocável por AI_TEMPERATURE p/ quem usar slugs 2.5/openai.
  temperature: 1.0,
  maxTokens: 16384,
} as const

/**
 * Default de modelo por (provider × modalidade) — ÚNICO ponto com os literais de id
 * de modelo por provider (A4/ADR-0008). Trocar o modelo continua sendo CONFIG
 * (AI_TEXT_MODEL/AI_IMAGE_MODEL sobrescrevem); este é apenas o fallback quando o env
 * não fixa um modelo, escolhido conforme o provider EFETIVO.
 *
 * REQUISITO DURO (A4b): os ids de modelo OpenAI aparecem AQUI e em lugar nenhum mais
 * em services/agents/src — um único ponto a editar quando a OpenAI virar o modelo.
 * Default OpenAI = "o mais capaz atual" de chat e de imagem (ver os literais abaixo).
 * Gemini reusa AI_DEFAULTS (sem duplicar literal).
 */
export function defaultModelFor(provider: ProviderKind | ImageProviderKind, modality: 'text' | 'image'): string {
  // Slugs GA verificados na documentação oficial dos provedores (jun/2026).
  // Documentação completa em docs/sot/10-multi-provider.md (matriz + gotchas de HTTP 400).
  // Trocável por AI_TEXT_MODEL/AI_IMAGE_MODEL — este é só o fallback quando o env não fixa.
  switch (provider) {
    case 'flux':
      // task 1.2: FLUX via Replicate. Slug do modelo (owner/name) — ponto único. flux-1.1-pro é o
      // GA de foto de alto padrão da Black Forest Labs no Replicate (jun/2026). Só faz imagem.
      return modality === 'image' ? 'black-forest-labs/flux-1.1-pro' : 'n/a-flux-so-imagem'
    case 'stock':
      // task 1.2: banco Pexels. Não há "modelo" — o slug documenta a fonte (consumido pelo provider
      // só como rótulo; a busca usa o endpoint fixo). Só faz imagem.
      return modality === 'image' ? 'pexels-search' : 'n/a-stock-so-imagem'
    case 'openai':
      // gpt-5.5 (frontier GA) e gpt-image-2 (imagem GA). ATENÇÃO ao param-compat da série GPT-5:
      // exige max_completion_tokens (não max_tokens) e rejeita temperature≠1 (HTTP 400) — tratado
      // no OpenAiTextProvider via "dialect". gpt-image-2 NÃO aceita response_format (tratado no provider).
      return modality === 'image' ? 'gpt-image-2' : 'gpt-5.5'
    case 'grok':
      // grok-4.3 (frontier GA, 1M ctx). Endpoint OpenAI-compatible → reusa o OpenAiTextProvider.
      // Imagem do Grok tem endpoint próprio (/v1/images), não integrado aqui; cai no slug
      // de imagem documentado, mas o provider de imagem efetivo continua gemini/openai.
      return modality === 'image' ? 'grok-imagine-image-quality' : 'grok-4.3'
    case 'anthropic':
      // Claude não gera imagem — só texto. claude-opus-4-8 (frontier GA, cobre quase tudo).
      // O caminho de imagem para 'anthropic' nunca deve ser tomado; o provider lança erro claro.
      return modality === 'image' ? 'n/a-claude-nao-gera-imagem' : 'claude-opus-4-8'
    case 'gemini':
    case 'imagen':
    default:
      // gemini (e imagen, stub) reusam os defaults Gemini.
      return modality === 'image' ? AI_DEFAULTS.imageModel : AI_DEFAULTS.textModel
  }
}

function normProvider(v: string | undefined, fallback: ProviderKind): ProviderKind {
  const k = (v ?? '').trim().toLowerCase()
  if (k === 'gemini' || k === 'openai' || k === 'grok' || k === 'anthropic' || k === 'imagen') return k
  return fallback
}

/** Normaliza IMAGE_PROVIDER p/ ImageProviderKind (só-imagem). Inválido/ausente → fallback.
 *  Aceita flux/stock (task 1.2); rejeita grok/anthropic (não geram imagem) → cai no fallback. */
export function normImageProvider(v: string | undefined, fallback: ImageProviderKind): ImageProviderKind {
  const k = (v ?? '').trim().toLowerCase()
  if (k === 'gemini' || k === 'openai' || k === 'imagen' || k === 'flux' || k === 'stock') return k
  return fallback
}

function numEnv(v: string | undefined, fallback: number): number {
  if (v === undefined || v.trim() === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** Flag booleana de env: só a string 'true' (case/space-insensitive) liga. Default false. */
function boolEnv(v: string | undefined): boolean {
  return (v ?? '').trim().toLowerCase() === 'true'
}

/**
 * Lê a config de IA do ambiente. Pura em relação a `env` (injetável p/ teste).
 * @param env normalmente process.env; injetável nos testes para evitar mutar global.
 */
export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const textProvider = normProvider(env.TEXT_PROVIDER ?? env.AI_PROVIDER, AI_DEFAULTS.textProvider)
  const imageProvider = normImageProvider(env.IMAGE_PROVIDER, AI_DEFAULTS.imageProvider)
  return {
    textProvider,
    imageProvider,
    apiKey: env.AI_PROVIDER_KEY || env.GEMINI_API_KEY || '',
    imageApiKey: env.IMAGE_PROVIDER_KEY || '',
    model: {
      // Sem AI_TEXT_MODEL/AI_IMAGE_MODEL, o default segue o PROVIDER EFETIVO da
      // modalidade (A4): openai → modelo OpenAI; gemini → modelo Gemini. Com gemini
      // default (env vazio) o resultado é idêntico ao anterior (byte-equivalente).
      text: (env.AI_TEXT_MODEL ?? '').trim() || defaultModelFor(textProvider, 'text'),
      image: (env.AI_IMAGE_MODEL ?? '').trim() || defaultModelFor(imageProvider, 'image'),
    },
    temperature: numEnv(env.AI_TEMPERATURE, AI_DEFAULTS.temperature),
    maxTokens: numEnv(env.AI_MAX_TOKENS, AI_DEFAULTS.maxTokens),
    // ADR-0011/E10.2: opt-in. Ausente/qualquer-coisa-≠-'true' → false (comportamento atual).
    promptOverridesEnabled: boolEnv(env.PROMPT_OVERRIDES_ENABLED),
  }
}

/**
 * Converte a AiConfig efetiva no GeminiAPIConfig que o GeminiAPIClient consome
 * internamente. O client REST ainda fala GeminiAPIConfig (não reescrevemos o
 * coração do pipeline nesta fase); a AiConfig é só o objeto rico que PROPAGA pela
 * cadeia e do qual o client concreto é derivado quando preciso (Z). Sem leitura
 * de process.env — tudo vem da `ai` já resolvida.
 */
export function aiToGeminiConfig(ai: AiConfig): GeminiAPIConfig {
  return {
    apiKey: ai.apiKey,
    textModel: ai.model.text,
    imageModel: ai.model.image,
    temperature: ai.temperature,
    maxOutputTokens: ai.maxTokens,
  }
}
