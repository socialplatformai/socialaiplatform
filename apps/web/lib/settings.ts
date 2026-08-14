import { api } from "./api";

// B (ADR-0008): espelha os DTOs de AiConfigController.cs. A apiKey é write-only —
// NUNCA volta no GET (só metadados + flag Configured). Endpoints Admin-only.

/** Estado salvo da config de IA do workspace (sem a chave — ela nunca volta). */
export interface AiConfig {
  configured: boolean;
  provider: string | null;
  textModel: string | null;
  imageModel: string | null;
}

/** Payload de gravação. A apiKey é obrigatória ao salvar (cifrada em repouso, some). */
export interface SaveAiConfig {
  provider: string;
  textModel?: string | null;
  imageModel?: string | null;
  apiKey: string;
}

/** Resultado do "Testar conexão" — sempre HTTP 200; ok distingue sucesso de falha. */
export interface AiTestResult {
  ok: boolean;
  detail: string;
}

export const settingsApi = {
  /** GET /api/settings/ai — metadados (sem a chave). */
  getAi: () => api<AiConfig>("/api/settings/ai"),

  /** POST /api/settings/ai — salva provider/modelos/chave (chave cifrada, não volta). */
  saveAi: (body: SaveAiConfig) =>
    api<AiConfig>("/api/settings/ai", { method: "POST", body: JSON.stringify(body) }),

  /** POST /api/settings/ai/test — testa a chave salva contra o provider. */
  testAi: () => api<AiTestResult>("/api/settings/ai/test", { method: "POST" }),

  /** DELETE /api/settings/ai — remove a config de IA do workspace. */
  deleteAi: () => api<void>("/api/settings/ai", { method: "DELETE" }),
};
