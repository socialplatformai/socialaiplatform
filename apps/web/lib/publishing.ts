import { api } from "./api";

// C2 (ADR-0009): falhas de publicação da marca atual + re-tentar manual. Espelha FailureDto (.NET).
export interface PublishFailure {
  logId: string;
  contentId: string;
  error: string | null;
  attempts: number;
  lastTriedAt: string | null;
}

export const publishingApi = {
  /** GET /api/publishing/failures — PublishLog com Result=Error da marca atual. */
  failures: () => api<PublishFailure[]>("/api/publishing/failures"),
  // C2: re-tenta um log de erro → reseta para Pending + Content→Approved (o worker reprocessa). 204.
  // 409 se o conteúdo já foi publicado ou o log não está em erro; 404 se for de outra marca.
  retry: (logId: string) =>
    api<void>(`/api/publishing/${logId}/retry`, { method: "POST" }),
};
