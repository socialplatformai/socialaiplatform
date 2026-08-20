/**
 * Gemini API Service
 * Social AI Platform — portado do branding-os.
 * E2: Multi-Agent Engine
 *
 * Os modelos (texto/imagem) NÃO são mais literais aqui — vêm da config resolvida
 * (GeminiAPIConfig.textModel/imageModel), cuja fonte da verdade é src/config.ts
 * (E5.2/ADR-0004). Trocar o modelo é config (AI_TEXT_MODEL/AI_IMAGE_MODEL), não código.
 */

import type { GeminiAPIConfig } from '@/types/agent'

// ============================================
// API TYPES
// ============================================

interface GeminiContent {
  role: 'user' | 'model'
  parts: Array<{
    text?: string
    inlineData?: {
      mimeType: string
      data: string
    }
  }>
}

interface GeminiRequest {
  contents: GeminiContent[]
  systemInstruction?: {
    parts: Array<{ text: string }>
  }
  generationConfig?: {
    temperature?: number
    maxOutputTokens?: number
    topP?: number
    topK?: number
    // F1b (ADR-0014/A4): structured output NATIVO do Gemini. Forma "flat clássica"
    // (responseMimeType + responseSchema) — funciona em gemini-3.5-flash E em slugs 2.x
    // que um workspace possa fixar; mais portável que o responseFormat (Gemini-3-only).
    // Fonte: ai.google.dev/gemini-api/docs/structured-output (verificado jun/2026).
    responseMimeType?: string
    responseSchema?: object
  }
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text?: string
        inlineData?: {
          mimeType: string
          data: string
        }
      }>
      role: string
    }
    finishReason: string
  }>
  usageMetadata?: {
    promptTokenCount: number
    candidatesTokenCount: number
    totalTokenCount: number
  }
}

// ============================================
// API CLIENT
// ============================================

/**
 * F1b (ADR-0014/A4): liga o structured output nativo do Gemini (responseSchema).
 * OPT-IN por env GEMINI_STRUCTURED_OUTPUT='true'. Default OFF → mantém o caminho atual
 * (prompt-enhancement + parse resiliente), porque o v1beta pode rejeitar JSON mode em
 * alguns modelos/contas (fonte: google-gemini/cookbook#1028, jun/2026). Quando ON e um
 * schema é fornecido, o request manda responseMimeType+responseSchema e o parse vira direto.
 */
function structuredOutputEnabled(): boolean {
  return (process.env.GEMINI_STRUCTURED_OUTPUT ?? '').trim().toLowerCase() === 'true'
}

/** C (ADR-0008): uso acumulado por client (tokens de texto + nº de imagens geradas). */
export interface GeminiUsage {
  textInputTokens: number
  textOutputTokens: number
  imageCount: number
}

export class GeminiAPIClient {
  private config: GeminiAPIConfig
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta'

  // C (ADR-0008): acumulador de uso desta instância. O usageMetadata da resposta
  // (prompt/candidatesTokenCount) era DESCARTADO; agora é somado aqui p/ a API estimar
  // o custo. imageCount conta só imagens REAIS geradas (o fallback de gradiente é do
  // agente, que lança antes de chegar aqui). Leitura via getUsage(); reset por job.
  private usage: GeminiUsage = { textInputTokens: 0, textOutputTokens: 0, imageCount: 0 }

  /** Snapshot do uso acumulado desta instância (cópia — não mutável por fora). */
  getUsage(): GeminiUsage {
    return { ...this.usage }
  }

  /** Zera o acumulador (chamado no início de um job p/ não somar entre gerações). */
  resetUsage(): void {
    this.usage = { textInputTokens: 0, textOutputTokens: 0, imageCount: 0 }
  }

  constructor(config: GeminiAPIConfig) {
    // 🔴 §6.6 (B/ADR-0008): NUNCA logar a chave (nem prefixo). Com chave por workspace
    // (B4), qualquer eco da chave no console vaza segredo de tenant no log compartilhado.
    // Validate API key format — sem ecoar a chave no erro.
    if (!config.apiKey || config.apiKey.startsWith('models/')) {
      console.error('[GeminiAPI] Chave de IA inválida ou ausente — verifique as Configurações.')
      throw new Error('Invalid API key. Please check your Settings.')
    }
    this.config = config
    // Log de inicialização SEM a chave (nem prefixo) — só sinal de que o client subiu.
    console.log('[GeminiAPI] Client inicializado.')
  }

  private getEndpoint(model: string): string {
    // §6.6: a chave NÃO vai na query string (a URL pode acabar em logs/proxies). Vai no
    // header x-goog-api-key (ver buildHeaders), tirando a chave inteira da URL.
    return `${this.baseUrl}/${model}:generateContent`
  }

  /** Headers de toda chamada REST: Content-Type + a chave no header (nunca na URL). */
  private buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-goog-api-key': this.config.apiKey,
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async complete(
    systemPrompt: string,
    userPrompt: string,
    options?: {
      temperature?: number
      maxTokens?: number
      /** Modalidade do modelo a usar; 'text' (default) ou 'image'. */
      modality?: 'text' | 'image'
      // F1b (ADR-0014/A4): JSON Schema p/ structured output nativo. Aplicado só quando
      // GEMINI_STRUCTURED_OUTPUT='true' (flag) E presente; senão ignorado (caminho atual).
      responseSchema?: object
    }
  ): Promise<string> {
    const model = options?.modality === 'image' ? this.config.imageModel : this.config.textModel
    const maxRetries = 3
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: 2s, 4s, 8s
        const waitTime = Math.pow(2, attempt) * 1000
        console.log(`[GeminiAPI] Rate limited. Waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}...`)
        await this.delay(waitTime)
      }

      const request: GeminiRequest = {
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }],
          },
        ],
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        generationConfig: {
          temperature: options?.temperature ?? this.config.temperature,
          maxOutputTokens: options?.maxTokens ?? this.config.maxOutputTokens,
          topP: 0.95,
          topK: 40,
        },
      }

      // F1b (ADR-0014/A4): structured output nativo — só quando a flag ON e há schema. Forma flat
      // (responseMimeType+responseSchema): o modelo passa a devolver JSON estrito conforme o schema,
      // eliminando o parse frágil. Sem flag/schema, o request fica byte-equivalente ao anterior.
      if (options?.responseSchema && structuredOutputEnabled()) {
        request.generationConfig!.responseMimeType = 'application/json'
        request.generationConfig!.responseSchema = options.responseSchema
      }

      try {
        const response = await fetch(this.getEndpoint(model), {
          method: 'POST',
          headers: this.buildHeaders(),
          body: JSON.stringify(request),
        })

        if (response.status === 429) {
          // Rate limited - will retry
          lastError = new Error('Rate limited (429). Retrying...')
          continue
        }

        if (!response.ok) {
          const error = (await response.json()) as { error?: { message?: string } }
          throw new Error(error.error?.message || 'API request failed')
        }

        const data = (await response.json()) as GeminiResponse

        // C (ADR-0008): soma o uso de tokens (era descartado). Tolerante: sem
        // usageMetadata na resposta, não soma nada (mock/respostas sem métricas).
        if (data.usageMetadata) {
          this.usage.textInputTokens += data.usageMetadata.promptTokenCount ?? 0
          this.usage.textOutputTokens += data.usageMetadata.candidatesTokenCount ?? 0
        }

        if (data.candidates && data.candidates.length > 0) {
          const content = data.candidates[0].content
          if (content.parts && content.parts.length > 0 && content.parts[0].text) {
            return content.parts[0].text
          }
        }

        throw new Error('No content in response')
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        if (attempt === maxRetries - 1) {
          throw lastError
        }
      }
    }

    throw lastError || new Error('Max retries exceeded')
  }

  async completeJSON<T>(
    systemPrompt: string,
    userPrompt: string,
    options?: {
      temperature?: number
      maxTokens?: number
      // F1b (ADR-0014/A4): schema p/ structured output nativo (gated por GEMINI_STRUCTURED_OUTPUT).
      responseSchema?: object
    }
  ): Promise<T> {
    // F1b (ADR-0014/A4): com structured output ATIVO (flag + schema), o modelo já devolve JSON
    // estrito — dispensa o "enhanced prompt" (as regras de JSON viram redundantes e poluiriam o
    // system instruction). Sem isso, mantém o reforço de prompt que sempre existiu (fallback robusto).
    const useStructured = !!options?.responseSchema && structuredOutputEnabled()
    const systemForJson = useStructured
      ? systemPrompt
      : `${systemPrompt}

CRITICAL JSON RULES:
1. Response MUST be valid JSON only - no markdown, no explanations
2. Start with { and end with }
3. Use double quotes for all strings
4. No trailing commas
5. Escape special characters in strings: \\n \\t \\" \\\\
6. Keep response concise to avoid truncation`

    const response = await this.complete(systemForJson, userPrompt, {
      ...options,
      maxTokens: options?.maxTokens || 8192, // Ensure large enough for complex JSON
    })

    // Extract JSON from response (in case there's extra text or markdown)
    let jsonString = response.trim()

    // Remove markdown code blocks if present
    if (jsonString.startsWith('```json')) {
      jsonString = jsonString.slice(7)
    } else if (jsonString.startsWith('```')) {
      jsonString = jsonString.slice(3)
    }
    if (jsonString.endsWith('```')) {
      jsonString = jsonString.slice(0, -3)
    }
    jsonString = jsonString.trim()

    // Find JSON object
    const jsonMatch = jsonString.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('No valid JSON found in response')
    }

    let extracted = jsonMatch[0]

    // Try to repair common JSON issues
    try {
      return JSON.parse(extracted) as T
    } catch (firstError) {
      console.warn('[GeminiAPI] First parse failed, attempting repair...', firstError)

      // Attempt repairs
      let repaired = extracted

      // Fix trailing commas before } or ]
      repaired = repaired.replace(/,(\s*[}\]])/g, '$1')

      // Remove incomplete last element (truncated JSON)
      // Find last complete object/array and remove anything after
      repaired = repaired.replace(/,\s*"[^"]*"?\s*:?\s*[^,}\]]*$/g, '')
      repaired = repaired.replace(/,\s*{\s*"[^}]*$/g, '')
      repaired = repaired.replace(/,\s*\[\s*[^\]]*$/g, '')

      // Fix unescaped newlines in strings
      repaired = repaired.replace(/([^\\])\\n/g, '$1\\\\n')

      // Try to close unclosed structures
      const openBraces = (repaired.match(/{/g) || []).length
      const closeBraces = (repaired.match(/}/g) || []).length
      const openBrackets = (repaired.match(/\[/g) || []).length
      const closeBrackets = (repaired.match(/]/g) || []).length

      // Add missing closing brackets/braces
      for (let i = 0; i < openBrackets - closeBrackets; i++) {
        repaired += ']'
      }
      for (let i = 0; i < openBraces - closeBraces; i++) {
        repaired += '}'
      }

      try {
        const result = JSON.parse(repaired) as T
        console.log('[GeminiAPI] JSON repair successful')
        return result
      } catch (secondError) {
        // Last resort: try to extract a minimal valid structure
        console.error('[GeminiAPI] JSON repair failed:', secondError)
        console.error('[GeminiAPI] Raw response (first 500 chars):', extracted.slice(0, 500))
        throw new Error(`Failed to parse JSON response: ${firstError}`)
      }
    }
  }

  async generateImage(
    prompt: string,
    options?: {
      aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '4:5'
      style?: string
    }
  ): Promise<string> {
    const model = this.config.imageModel
    const started = Date.now()

    // Construct a more detailed prompt for the model
    let detailedPrompt = prompt
    if (options?.aspectRatio) {
      detailedPrompt += ` Aspect ratio: ${options.aspectRatio}.`
    }
    if (options?.style) {
      detailedPrompt += ` Style: ${options.style}.`
    }

    console.log('[GeminiAPI] Generating image with model:', model)
    console.log('[GeminiAPI] Prompt:', detailedPrompt)

    const request: GeminiRequest = {
      contents: [
        {
          role: 'user',
          parts: [{ text: detailedPrompt }],
        },
      ],
    }

    try {
      const response = await fetch(this.getEndpoint(model), {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(request),
      })
      const durationMs = Date.now() - started

      if (!response.ok) {
        const error = (await response.json().catch(() => ({ error: { message: response.statusText } }))) as {
          error?: { message?: string; status?: string; code?: number }
        }
        // Sem API key / body bruto com credenciais — só status + mensagem do provedor + duração.
        const providerMsg = error.error?.message || response.statusText
        console.error('[GeminiAPI] Image generation failed:', {
          model,
          httpStatus: response.status,
          statusText: response.statusText,
          providerStatus: error.error?.status,
          providerCode: error.error?.code,
          message: providerMsg,
          durationMs,
        })
        throw new Error(
          `Image generation failed: HTTP ${response.status} (${providerMsg})` +
            (error.error?.status ? ` [${error.error.status}]` : ''),
        )
      }

      const data = (await response.json()) as GeminiResponse

      // C (ADR-0008): soma também o uso de tokens da chamada de imagem (algumas variantes
      // do modelo reportam usageMetadata mesmo gerando imagem).
      if (data.usageMetadata) {
        this.usage.textInputTokens += data.usageMetadata.promptTokenCount ?? 0
        this.usage.textOutputTokens += data.usageMetadata.candidatesTokenCount ?? 0
      }

      if (data.candidates && data.candidates.length > 0) {
        const content = data.candidates[0].content
        if (content?.parts && content.parts.length > 0) {
          const imagePart = content.parts.find(p => p.inlineData)
          if (imagePart?.inlineData) {
            // C (ADR-0008): conta 1 imagem REAL gerada (o fallback de gradiente do agente
            // lança antes de chegar aqui, então não é contado — fica honesto p/ o custo).
            this.usage.imageCount += 1
            console.log('[GeminiAPI] Image generation OK', { model, durationMs, httpStatus: response.status })
            return `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`
          }
        }
      }

      // FIX (AM-4/R-2): a "imagem preta" vinha de cair aqui sem diagnóstico.
      // Lê finishReason/safetyRatings antes de lançar — torna a falha visível
      // (SAFETY, RECITATION, MAX_TOKENS, ou texto no lugar de imagem).
      const candidate = data.candidates?.[0] as
        | { finishReason?: string; safetyRatings?: unknown }
        | undefined
      const finishReason = candidate?.finishReason ?? 'UNKNOWN'
      const textInstead = data.candidates?.[0]?.content?.parts?.find(p => p.text)?.text
      console.error('[GeminiAPI] Image generation returned no inlineData.', {
        model,
        httpStatus: response.status,
        durationMs,
        finishReason,
        safetyRatings: candidate?.safetyRatings,
        textInstead: textInstead?.slice(0, 200),
      })
      throw new Error(
        `No image in response (HTTP ${response.status}, finishReason=${finishReason})` +
          (textInstead ? ` — model returned text instead: ${textInstead.slice(0, 120)}` : '')
      )
    } catch (error) {
      const durationMs = Date.now() - started
      // Evita logar o Error duas vezes quando já logamos o HTTP !ok / no-inlineData acima.
      if (!(error instanceof Error && /Image generation failed: HTTP|No image in response/.test(error.message))) {
        console.error('[GeminiAPI] Network or parsing error:', {
          model,
          durationMs,
          errorName: error instanceof Error ? error.name : typeof error,
          message: error instanceof Error ? error.message : String(error),
        })
      }
      throw error
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.complete(
        'You are a helpful assistant.',
        'Say "connected" if you can hear me.',
        { maxTokens: 10 }
      )
      return true
    } catch {
      return false
    }
  }
}

// ============================================
// CLIENT CACHE (por config efetiva)
// ============================================
//
// Antes: um único `clientInstance` keyado SÓ por apiKey. Isso regredia quando o
// modelo/params mudavam com a MESMA chave (reusava o client antigo) e, sobretudo,
// não habilita B7 — onde a chave/modelo passam a vir por workspace e o mesmo
// processo serve configs distintas concorrentemente.
//
// Agora: cache por TUPLA (apiKey|textModel|imageModel|temperature|maxOutputTokens).
// É o MÍNIMO que (a) não regride hoje — config idêntica => mesma instância, mesmo
// caminho byte-equivalente — e (b) abre B7 — configs diferentes => clients
// separados, sem vazar chave/modelo de um workspace para outro. Mantém o cache de
// conexão (não recria o client a cada chamada) sem o efeito-fantasma do singleton.
const clientCache = new Map<string, GeminiAPIClient>()

function cacheKey(config: GeminiAPIConfig): string {
  return [
    config.apiKey,
    config.textModel,
    config.imageModel,
    config.temperature,
    config.maxOutputTokens,
  ].join('|')
}

export function getGeminiClient(config: GeminiAPIConfig): GeminiAPIClient {
  const key = cacheKey(config)
  let client = clientCache.get(key)
  if (!client) {
    client = new GeminiAPIClient(config)
    clientCache.set(key, client)
  }
  return client
}

export function clearGeminiClient(): void {
  clientCache.clear()
}
