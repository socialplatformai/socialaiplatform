import { api } from "./api";

// C3 (ADR-0009): insights de aprendizado por workspace. Espelha LearningInsights (.NET).
// insufficientData=true quando sampleSize < 3 (nunca números inventados — DEC-5/L4).
export interface LearningInsights {
  bestFormat: string | null;
  bestFormatAvgEngagement: number;
  bestWindow: string | null;
  bestWindowAvgEngagement: number;
  sampleSize: number;
  insufficientData: boolean;
  // C3/DEC-5: quantas métricas da amostra são SIMULADAS (sem token IG). >0 → a UI rotula "Simulado".
  mockSampleCount: number;
  // A8: bootstrapping honesto. Sem dado de PUBLICAÇÃO (workspace fresco), o formato que a marca gera
  // com maior NOTA DE QUALIDADE — sinal real, pré-publicação. A UI o usa SÓ quando insufficientData,
  // rotulando "baseado na qualidade das suas peças (ainda sem dados de publicação)". null = sem amostra.
  provisionalBestFormat?: string | null;
  provisionalSampleSize?: number;
}

// A4 (ADR-0009): último motivo de rejeição da pauta para a marca atual. Espelha RejectFeedbackDto.
export interface RejectFeedback {
  pautaId: string;
  comments: string | null;
}

// SoT "Desempenho" (Fatia 3): uma linha da tabela densa de posts. Espelha PostMetricRow (.NET).
// Dado REAL do banco (PerformanceMetric + Content). isMock=true ⇒ métrica sintética → UI rotula.
export interface PostMetric {
  contentId: string;
  caption: string | null;
  type: string; // "Post" | "Carousel" | "Story"
  reach: number;
  engagement: number;
  likes: number;
  saves: number;
  qualityScore: number | null;
  window: string; // "manhã" | "tarde" | "noite"
  isMock: boolean;
  collectedAt: string;
  postedAt: string;
}

export const learningApi = {
  /** GET /api/learning/insights — melhor formato/janela + tamanho da amostra (workspace). */
  insights: () => api<LearningInsights>("/api/learning/insights"),
  /** GET /api/learning/posts — métricas por post (tabela densa de Desempenho), workspace-scoped. */
  posts: () => api<PostMetric[]>("/api/learning/posts"),
  // A4: último feedback de rejeição da pauta (brand-scoped). comments=null quando não houve rejeição.
  rejectFeedback: (pautaId: string) =>
    api<RejectFeedback>(`/api/learning/reject-feedback?pautaId=${pautaId}`),
};
