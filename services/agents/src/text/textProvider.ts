/**
 * ITextProvider — abstração de geração de TEXTO trocável por env (E5.1/ADR-0004).
 * Espelha o padrão já aceito de IImageProvider (src/image/imageProvider.ts).
 *
 * Provider escolhido por TEXT_PROVIDER (fallback AI_PROVIDER): gemini | openai.
 * O default é gemini. Sem chave do provider, a chamada falha com erro
 * DIAGNOSTICÁVEL (igual ao image stub), nunca degrada em silêncio.
 *
 * O GeminiTextProvider é um WRAPPER FINO sobre o GeminiAPIClient existente: reusa
 * retry + JSON-repair (o coração do pipeline não é reescrito). O OpenAiTextProvider
 * (A/ADR-0008) fala REST puro com a Chat Completions API via fetch nativo (Node 20+),
 * espelhando o estilo do GeminiAPIClient — sem SDK. A troca de provider é config.
 */

import type { GeminiAPIClient } from '../gemini/client.js'
import type { AiConfig } from '../config.js'

export interface TextGenOptions {
  temperature?: number
  maxTokens?: number
  // F1b (ADR-0014/A4): JSON Schema (subset OpenAPI) p/ structured output NATIVO do provider.
  // Só o GeminiTextProvider o consome hoje (responseMimeType+responseSchema no generationConfig,
  // gated por GEMINI_STRUCTURED_OUTPUT); OpenAI/Grok já usam response_format:json_object e ignoram
  // este campo; Claude ignora. Ausente → comportamento atual (prompt-enhancement + parse resiliente).
  responseSchema?: object
}

export interface ITextProvider {
  readonly name: string
  /** Texto livre. Lança erro diagnosticável em falha. */
  complete(systemPrompt: string, userPrompt: string, options?: TextGenOptions): Promise<string>
  /** JSON tipado (com reparo/extração resiliente). Lança erro diagnosticável em falha. */
  completeJSON<T>(systemPrompt: string, userPrompt: string, options?: TextGenOptions): Promise<T>
}

/** Gemini — delega ao client REST já portado (retry + JSON-repair). */
export class GeminiTextProvider implements ITextProvider {
  readonly name = 'gemini'
  constructor(private client: GeminiAPIClient) {}

  complete(systemPrompt: string, userPrompt: string, options?: TextGenOptions): Promise<string> {
    return this.client.complete(systemPrompt, userPrompt, options)
  }

  completeJSON<T>(systemPrompt: string, userPrompt: string, options?: TextGenOptions): Promise<T> {
    // F1b (ADR-0014/A4): repassa o responseSchema ao client (structured output nativo, gated).
    return this.client.completeJSON<T>(systemPrompt, userPrompt, options)
  }
}

/** Resposta mínima da Chat Completions API que consumimos. */
interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

/**
 * "Dialeto" de um endpoint OpenAI-compatible — o único ponto de divergência real entre OpenAI e
 * xAI/Grok. Modelado explicitamente para evitar um corpo de requisição único que resultaria em HTTP 400:
 *
 * - OpenAI série GPT-5 (gpt-5.x): exige `max_completion_tokens` (NÃO `max_tokens` → 400) e
 *   rejeita `temperature`≠1 (→ 400). Controle de comportamento é via reasoning.effort, não temperature.
 * - xAI/Grok: aceita `max_tokens` e `temperature` normalmente (sem a restrição da série GPT-5).
 *
 * Fonte: documentação oficial (jun/2026), docs.x.ai + platform.openai.com. Ver
 * docs/sot/10-multi-provider.md (matriz + gatilhos de 400).
 */
export interface OpenAiDialect {
  /** Nome do parâmetro de limite de saída: 'max_completion_tokens' (GPT-5) | 'max_tokens' (Grok). */
  maxTokensKey: 'max_completion_tokens' | 'max_tokens'
  /** Se `false`, NÃO envia temperature (série GPT-5 rejeita ≠1). */
  sendTemperature: boolean
}

export const OPENAI_DIALECT: OpenAiDialect = { maxTokensKey: 'max_completion_tokens', sendTemperature: false }
export const GROK_DIALECT: OpenAiDialect = { maxTokensKey: 'max_tokens', sendTemperature: true }

/**
 * Provider de texto para endpoints OpenAI-compatible (REST puro via fetch nativo, sem SDK).
 * Serve OpenAI E xAI/Grok — mesma família de wire (POST /chat/completions, `messages`,
 * `choices[0].message.content`). A diferença é só baseURL + chave + modelo + dialeto de params.
 * Por isso `name`/endpoint/dialect são injetados: um wrapper serve os dois provedores.
 *
 * Sem chave → erro diagnosticável nomeando o provider; erro de HTTP → mensagem clara com o status.
 * Nunca degrada em silêncio.
 */
export class OpenAiTextProvider implements ITextProvider {
  readonly name: string
  private endpoint: string
  private dialect: OpenAiDialect

  /**
   * @param apiKey chave do provider
   * @param model slug do modelo
   * @param opts baseUrl/name/dialect — default = OpenAI. Para Grok: { name:'grok',
   *   baseUrl:'https://api.x.ai/v1', dialect: GROK_DIALECT }.
   */
  constructor(
    private apiKey: string,
    private model: string,
    opts?: { baseUrl?: string; name?: string; dialect?: OpenAiDialect },
  ) {
    this.name = opts?.name ?? 'openai'
    this.endpoint = `${opts?.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`
    this.dialect = opts?.dialect ?? OPENAI_DIALECT
  }

  /** POST cru à Chat Completions; devolve o content da 1ª choice. `json` pede JSON estrito. */
  private async chat(
    systemPrompt: string,
    userPrompt: string,
    options: TextGenOptions | undefined,
    json: boolean,
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error(`Chave da ${this.name} ausente (AI_PROVIDER_KEY) — defina-a para usar TEXT_PROVIDER=${this.name}.`)
    }

    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }
    // DIALETO: temperature só quando o provider aceita (série GPT-5 rejeita ≠1 com 400).
    if (this.dialect.sendTemperature && options?.temperature !== undefined) {
      body.temperature = options.temperature
    }
    // DIALETO: nome correto do limite de saída (max_completion_tokens p/ GPT-5, max_tokens p/ Grok).
    if (options?.maxTokens) body[this.dialect.maxTokensKey] = options.maxTokens
    // Pede JSON estrito quando suportado; o parse resiliente cobre o caso de o modelo ainda
    // devolver cercas/markdown (response_format pode ser ignorado). json_object é GA em ambos.
    if (json) body.response_format = { type: 'json_object' }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as OpenAiChatResponse
      const detail = data.error?.message ?? response.statusText
      throw new Error(`Falha na API da ${this.name} (texto) — HTTP ${response.status}: ${detail}`)
    }

    const data = (await response.json()) as OpenAiChatResponse
    const content = data.choices?.[0]?.message?.content
    if (!content) {
      throw new Error(`Resposta da ${this.name} (texto) sem conteúdo (choices[0].message.content vazio).`)
    }
    return content
  }

  complete(systemPrompt: string, userPrompt: string, options?: TextGenOptions): Promise<string> {
    return this.chat(systemPrompt, userPrompt, options, false)
  }

  async completeJSON<T>(systemPrompt: string, userPrompt: string, options?: TextGenOptions): Promise<T> {
    const raw = await this.chat(systemPrompt, userPrompt, options, true)
    return extractJson<T>(raw, this.name)
  }
}

/** Resposta mínima da Messages API da Anthropic que consumimos. */
interface AnthropicMessagesResponse {
  content?: Array<{ type?: string; text?: string }>
  error?: { message?: string }
}

/**
 * Anthropic / Claude (texto) — Messages API, REST puro via fetch nativo (sem SDK). Wrapper PRÓPRIO
 * porque o shape de wire é distinto (NÃO OpenAI-compatible). Diferenças tratadas (fonte:
 * documentação oficial, docs.claude.com — ver docs/sot/10-multi-provider.md):
 *   - Auth: header `x-api-key` (NÃO Authorization: Bearer) + `anthropic-version: 2023-06-01` OBRIGATÓRIO.
 *   - `system` é TOP-LEVEL (não um {role:'system'} dentro de messages → 400).
 *   - `max_tokens` é OBRIGATÓRIO e snake_case top-level.
 *   - Opus 4.7+ (incl. opus-4-8) REJEITA temperature≠default → NÃO enviamos temperature.
 *   - Resposta é `content[]` (array de blocos); extraímos só os de type 'text' (content[0] pode ser
 *     'thinking'/'tool_use'). JSON é pedido via instrução no system + parse resiliente (sem prefill,
 *     removido nos modelos atuais).
 */
export class ClaudeTextProvider implements ITextProvider {
  readonly name = 'anthropic'
  private endpoint = 'https://api.anthropic.com/v1/messages'
  private readonly DEFAULT_MAX_TOKENS = 8192

  constructor(private apiKey: string, private model: string) {}

  private async message(
    systemPrompt: string,
    userPrompt: string,
    options: TextGenOptions | undefined,
    json: boolean,
  ): Promise<string> {
    if (!this.apiKey) {
      throw new Error('Chave da Anthropic ausente (AI_PROVIDER_KEY) — defina-a para usar TEXT_PROVIDER=anthropic.')
    }

    // JSON sem prefill (removido nos modelos atuais): instrução no system + parse resiliente.
    const system = json
      ? `${systemPrompt}\n\nResponda APENAS com um objeto JSON válido — sem markdown, sem texto fora do JSON.`
      : systemPrompt

    const body: Record<string, unknown> = {
      model: this.model,
      system, // TOP-LEVEL — nunca como role na lista de messages.
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: options?.maxTokens ?? this.DEFAULT_MAX_TOKENS, // OBRIGATÓRIO.
    }
    // temperature deliberadamente OMITIDA: Opus 4.7+ rejeita ≠default (400). Controle via prompt.

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey, // NÃO Authorization: Bearer.
        'anthropic-version': '2023-06-01', // valor fixo da versão da API (obrigatório).
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as AnthropicMessagesResponse
      const detail = data.error?.message ?? response.statusText
      throw new Error(`Falha na API da Anthropic (texto) — HTTP ${response.status}: ${detail}`)
    }

    const data = (await response.json()) as AnthropicMessagesResponse
    // content[] é um array de blocos; junta só os de texto (content[0] pode ser thinking/tool_use).
    const text = (data.content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('')
    if (!text) {
      throw new Error('Resposta da Anthropic (texto) sem bloco de texto (content[] sem type=text).')
    }
    return text
  }

  complete(systemPrompt: string, userPrompt: string, options?: TextGenOptions): Promise<string> {
    return this.message(systemPrompt, userPrompt, options, false)
  }

  async completeJSON<T>(systemPrompt: string, userPrompt: string, options?: TextGenOptions): Promise<T> {
    const raw = await this.message(systemPrompt, userPrompt, options, true)
    return extractJson<T>(raw, 'anthropic')
  }
}

/**
 * Extração resiliente de JSON do texto do modelo, espelhando a ideia do
 * GeminiAPIClient.completeJSON: tira cercas markdown e pega o 1º bloco {..}.
 * `provider` entra na mensagem de erro p/ diagnóstico (ex.: "openai").
 */
function extractJson<T>(response: string, provider: string): T {
  let s = response.trim()
  if (s.startsWith('```json')) s = s.slice(7)
  else if (s.startsWith('```')) s = s.slice(3)
  if (s.endsWith('```')) s = s.slice(0, -3)
  s = s.trim()

  const match = s.match(/\{[\s\S]*\}/)
  if (!match) {
    throw new Error(`Resposta da ${provider} (texto) não contém JSON válido.`)
  }
  try {
    return JSON.parse(match[0]) as T
  } catch (err) {
    throw new Error(`Falha ao parsear JSON da ${provider} (texto): ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Factory: escolhe o provider de texto a partir da AiConfig efetiva (Z/ADR-0008).
 * NÃO lê process.env — provider e chave vêm de `ai` (resolvida uma vez no topo por
 * loadAiConfig). Default gemini (único implementado de fato).
 * @param ai config efetiva propagada pela cadeia (provider + chave + modelo).
 * @param geminiClient client concreto já configurado (modelo/params da AiConfig).
 */
export function resolveTextProvider(
  ai: AiConfig,
  geminiClient: GeminiAPIClient,
): ITextProvider {
  switch (ai.textProvider) {
    case 'openai':
      // Modelo já resolvido na AiConfig (default via defaultModelFor quando o env
      // não fixa AI_TEXT_MODEL). Dialeto OpenAI (max_completion_tokens, sem temperature).
      return new OpenAiTextProvider(ai.apiKey, ai.model.text)
    case 'grok':
      // xAI/Grok: MESMO wrapper OpenAI-compatible, só muda baseURL + dialeto (max_tokens, temperature OK).
      return new OpenAiTextProvider(ai.apiKey, ai.model.text, {
        name: 'grok',
        baseUrl: 'https://api.x.ai/v1',
        dialect: GROK_DIALECT,
      })
    case 'anthropic':
      // Claude: wrapper próprio (Messages API, shape distinto — não OpenAI-compat).
      return new ClaudeTextProvider(ai.apiKey, ai.model.text)
    case 'gemini':
    default:
      // gemini (e 'imagen', que não é provider de texto) caem no Gemini.
      return new GeminiTextProvider(geminiClient)
  }
}
