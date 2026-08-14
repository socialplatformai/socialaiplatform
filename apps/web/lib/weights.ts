import { api } from "./api";

// Fase 3 (task 3.1/3.2) — "o que é um bom post": pesos por sinal (0-10) que definem sucesso.
// Espelha MetricWeightsDto (.NET). GET sempre devolve algo (defaults se não há config).
export interface MetricWeights {
  savesWeight: number;
  reachWeight: number;
  likesWeight: number;
  commentsWeight: number;
}

// Rótulos dos sinais para a UI (ordem = a que aparece no painel).
export const SIGNAL_LABELS: { key: keyof MetricWeights; label: string; hint: string }[] = [
  { key: "savesWeight", label: "Salvamentos", hint: "Quanto vale alguém salvar o post (forte sinal de valor)." },
  { key: "commentsWeight", label: "Comentários", hint: "Quanto vale gerar conversa nos comentários." },
  { key: "likesWeight", label: "Curtidas", hint: "Quanto vale uma curtida." },
  { key: "reachWeight", label: "Alcance", hint: "Quanto vale chegar a mais pessoas." },
];

export const weightsApi = {
  get: () => api<MetricWeights>("/api/learning/weights"),
  save: (body: MetricWeights) =>
    api<MetricWeights>("/api/learning/weights", { method: "PUT", body: JSON.stringify(body) }),
};
