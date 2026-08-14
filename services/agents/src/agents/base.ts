/**
 * Base Agent Class
 * Social AI Platform — portado do branding-os.
 * E2: Multi-Agent Engine
 *
 * Provider de texto abstraído atrás de ITextProvider (E5.1/ADR-0004): o agente
 * fala com a INTERFACE, não com o GeminiAPIClient concreto. Trocar o provider é
 * config (TEXT_PROVIDER). Modelo/params vêm da config tipada (E5.2), não de
 * literais — o drift morreu aqui. O default de maxTokens (16384) preserva o teto
 * EFETIVO que estes agentes já usavam (fase invisível: sem mudar comportamento).
 *
 * ADR-0011/E10.2 — override de prompt com rede:
 *   - `systemPrompt` (getter parameterless) SEMPRE retorna o prompt-base (do arquivo).
 *     O override NÃO entra por ele (os agentes nascem só com `ai`; o contexto do run chega
 *     em execute(input)).
 *   - `executeWithPrompt(input, systemPrompt)` é o caminho que aceita um prompt explícito —
 *     corpo IDÊNTICO ao execute clássico (preserva completeJSON: JSON-repair + usage no client).
 *   - `execute(input)` resolve o override do run (quando a flag está ON e há override para
 *     este agente), tenta-o, e — só no caminho-override — VALIDA a saída com `parseOutput`
 *     (que de outra forma não roda). Se a validação falhar, chama `onPromptFallback` e refaz
 *     UMA vez com o base. Caminho feliz (sem override) = 1 chamada, byte-equivalente ao atual.
 */

import type { AgentId } from '@/types/agent'
import type { PipelineInput } from '@/types/pipeline'
import type { PromptAgentKey } from '@/prompts/loader'
import { getGeminiClient } from '@/services/gemini'
import type { ITextProvider } from '@/text/textProvider'
import { resolveTextProvider } from '@/text/textProvider'
import type { AiConfig } from '@/config'
import { aiToGeminiConfig } from '@/config'

/** Todo input de agente carrega o contexto do run (`pipelineInput`). É por ele que o override
 *  e o sink de fallback (ADR-0011/E10.2) chegam ao execute sem mudar as 5 assinaturas. */
export interface AgentInputBase {
  pipelineInput: PipelineInput
}

export abstract class BaseAgent<TInput extends AgentInputBase, TOutput> {
  protected provider: ITextProvider
  protected agentId: AgentId
  /** temperature/maxTokens efetivos, vindos da AiConfig efetiva (sem literais). */
  protected genParams: { temperature: number; maxTokens: number }
  /** ADR-0011/E10.2: flag de processo (lida da AiConfig). OFF → override nunca é aplicado. */
  protected promptOverridesEnabled: boolean

  /**
   * ADR-0011/E10.2: chave deste agente no mapa de overrides (ex.: 'copywriter'). É a chave
   * ESTÁVEL do prompt (igual à do arquivo .md), NÃO o `agentId` legado ('copywriter'/'analyzer'/
   * 'quality-gate', que existem por compat de pipeline). Cada classe declara a sua.
   * `null` = agente que não participa de override (determinísticos: image-generator).
   */
  protected abstract readonly overrideKey: PromptAgentKey | null

  constructor(ai: AiConfig, agentId: AgentId) {
    // A AiConfig efetiva (Z/ADR-0008) é o objeto rico que percorre a cadeia. O
    // provider de texto é escolhido A PARTIR DELA (ai.textProvider), não de env;
    // o client concreto (que reusa retry + JSON-repair) é derivado via
    // aiToGeminiConfig. gemini é o default e o único implementado de fato.
    this.provider = resolveTextProvider(ai, getGeminiClient(aiToGeminiConfig(ai)))
    this.agentId = agentId
    this.genParams = { temperature: ai.temperature, maxTokens: ai.maxTokens }
    this.promptOverridesEnabled = ai.promptOverridesEnabled
  }

  abstract get systemPrompt(): string
  abstract buildUserPrompt(input: TInput): string
  abstract parseOutput(response: string): TOutput

  /**
   * F1b (ADR-0014/A4): JSON Schema (subset OpenAPI) p/ structured output nativo deste agente.
   * Default `undefined` (mantém o caminho atual: prompt + parse resiliente). Um agente que define
   * isto pede ao provider JSON estrito conforme o schema — APLICADO só quando GEMINI_STRUCTURED_OUTPUT
   * está ON (gate no client). Opt-in por agente: começamos pelo visual-compositor (JSON mais complexo).
   */
  protected get responseSchema(): object | undefined {
    return undefined
  }

  /**
   * Caminho de execução com um systemPrompt EXPLÍCITO. Corpo idêntico ao execute clássico
   * (completeJSON preserva JSON-repair + contabilidade de usage). É o ÚNICO ponto que aceita
   * um prompt ≠ base; o getter `systemPrompt` continua sempre-base.
   */
  protected async executeWithPrompt(input: TInput, systemPrompt: string): Promise<TOutput> {
    const userPrompt = this.buildUserPrompt(input)
    // F1b (ADR-0014/A4): inclui o responseSchema do agente (quando definido). O provider/client
    // só o aplica se GEMINI_STRUCTURED_OUTPUT estiver ON; senão é ignorado (caminho atual intacto).
    return this.provider.completeJSON<TOutput>(systemPrompt, userPrompt, {
      ...this.genParams,
      ...(this.responseSchema ? { responseSchema: this.responseSchema } : {}),
    })
  }

  /**
   * ADR-0011/E10.2: resolve o override deste agente para o run (ou undefined). Só devolve algo
   * quando a flag está ON, há `overrideKey`, e o input traz um texto não-vazio para essa chave.
   */
  protected resolveOverride(input: TInput): string | undefined {
    if (!this.promptOverridesEnabled || this.overrideKey === null) return undefined
    const ov = input.pipelineInput.promptOverrides?.[this.overrideKey]
    return typeof ov === 'string' && ov.trim() !== '' ? ov : undefined
  }

  /**
   * Hook do override → systemPrompt final. Default: o texto cru do override JÁ É o systemPrompt.
   * O brand-strategist sobrescreve (precisa injetar o pool de templates no placeholder).
   * Devolver `null` = override estruturalmente inválido → fallback ao base (sem chamar a IA à toa).
   */
  protected applyOverride(override: string): string | null {
    return override
  }

  async execute(input: TInput): Promise<TOutput> {
    const override = this.resolveOverride(input)

    // Caminho feliz (sem override): 1 chamada, byte-equivalente ao comportamento atual.
    if (override === undefined) {
      try {
        return await this.executeWithPrompt(input, this.systemPrompt)
      } catch (error) {
        console.error(`[${this.agentId}] Execution failed:`, error)
        throw error
      }
    }

    // Caminho com override: tenta o override, VALIDA a saída (parseOutput — que de outra forma
    // não roda) e, se falhar, cai no base (não-silencioso). É a "rede" do ADR-0011/E10.2.c.
    const onFallback = input.pipelineInput.onPromptFallback
    const finalPrompt = this.applyOverride(override)
    if (finalPrompt === null) {
      this.notifyFallback(onFallback, 'override estruturalmente inválido (não aplicável a este agente)')
      return this.runBase(input)
    }

    try {
      const out = await this.executeWithPrompt(input, finalPrompt)
      // Ativa a validação de contrato do agente APENAS no caminho-override, tornando a falha
      // do prompt customizado OBSERVÁVEL (o caminho base não muda — preserva byte-equivalência).
      this.validateOverrideOutput(out)
      return out
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      this.notifyFallback(onFallback, reason)
      return this.runBase(input)
    }
  }

  /** Execução com o prompt-base (o retry do fallback). Mantém o tratamento de erro clássico. */
  private async runBase(input: TInput): Promise<TOutput> {
    try {
      return await this.executeWithPrompt(input, this.systemPrompt)
    } catch (error) {
      console.error(`[${this.agentId}] Execution failed:`, error)
      throw error
    }
  }

  /**
   * Validação da saída produzida por um OVERRIDE. Default: roda o `parseOutput` do agente
   * (o contrato de saída — ex.: copywriter exige headline em todo slide). Lança se inválida.
   * Agentes cujo parseOutput é tolerante/stub (visual/quality) sobrescrevem com uma asserção
   * de shape mínima. NÃO roda no caminho base.
   */
  protected validateOverrideOutput(output: TOutput): void {
    this.parseOutput(JSON.stringify(output))
  }

  /** Notifica o fallback de prompt sem acoplar a base ao pipeline (sink fino e opcional). */
  protected notifyFallback(
    sink: ((agentKey: PromptAgentKey, reason: string) => void) | undefined,
    reason: string,
  ): void {
    if (this.overrideKey === null) return
    console.warn(`[${this.agentId}] override de prompt rejeitado — usando o base. Causa: ${reason}`)
    sink?.(this.overrideKey, reason)
  }
}
