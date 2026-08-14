import { api } from "./api";

// ADR-0013: espelha os DTOs de PromptOverridesController.cs. Ao contrário da chave de IA, o
// texto da instrução VOLTA no GET (é asset de edição, não segredo). Endpoints Admin-only.

/** Os 5 agentes de IA cuja instrução-base pode ser sobrescrita. Espelha PROMPT_AGENT_KEYS
 *  (services/agents/src/types/agent-keys.ts) — fonte única do outro lado. */
export const PROMPT_AGENTS = [
  { key: "brand-strategist", label: "Estrategista de marca", desc: "Escolhe o template e a narrativa do conteúdo." },
  { key: "story-architect", label: "Arquiteto do roteiro", desc: "Monta o roteiro slide a slide." },
  { key: "copywriter", label: "Redator", desc: "Escreve os textos (títulos, legenda, chamadas)." },
  { key: "visual-compositor", label: "Compositor visual", desc: "Define o layout e o uso das cores da marca." },
  { key: "quality-validator", label: "Revisor de qualidade", desc: "Confere o resultado antes de entregar." },
] as const;

export type PromptAgentKey = (typeof PROMPT_AGENTS)[number]["key"];

/** Uma instrução personalizada salva para um agente. */
export interface PromptOverride {
  agentKey: string;
  promptText: string;
}

/** Resposta do GET: as instruções salvas + o tamanho máximo permitido. */
export interface PromptOverrides {
  overrides: PromptOverride[];
  maxLength: number;
}

export const promptsApi = {
  /** GET /api/settings/prompts — instruções personalizadas do workspace (texto volta). */
  list: () => api<PromptOverrides>("/api/settings/prompts"),

  /** PUT /api/settings/prompts/{agentKey} — salva/atualiza a instrução de um agente. */
  save: (agentKey: string, promptText: string) =>
    api<PromptOverride>(`/api/settings/prompts/${agentKey}`, {
      method: "PUT",
      body: JSON.stringify({ promptText }),
    }),

  /** DELETE /api/settings/prompts/{agentKey} — volta o agente ao texto padrão. */
  reset: (agentKey: string) =>
    api<void>(`/api/settings/prompts/${agentKey}`, { method: "DELETE" }),
};
