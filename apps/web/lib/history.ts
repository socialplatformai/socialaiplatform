import { api } from "./api";

// C1 (ADR-0010): histórico legível, brand-scoped, paginado. Espelha os DTOs do HistoryController (.NET).
export interface PublicationHistory {
  contentId: string;
  caption: string | null;
  accountUsername: string | null;
  result: string; // PublishResult.ToString(): "Pending" | "Success" | "Error" | "Skipped"
  when: string;
  error: string | null;
  // PublisherKind.ToString(): "Mock" | "InstagramGraph" — distingue demonstração de publicação real.
  publisher: string;
}

export interface GenerationHistory {
  contentId: string;
  pautaId: string | null;
  pautaTitle: string | null;
  status: string; // ContentStatus.ToString()
  jobId: string | null;
  qualityScore: number | null;
  when: string;
  // Imagem de capa (1º slide com imagem) — path relativo do proxy autenticado. Use mediaUrl()
  // p/ anexar o token. null quando a geração não produziu slide com imagem.
  coverImageUrl: string | null;
}

export interface Page<T> {
  items: T[];
  pageNumber: number;
  pageSize: number;
  total: number;
}

export const historyApi = {
  publications: (page = 1, pageSize = 20) =>
    api<Page<PublicationHistory>>(`/api/history/publications?page=${page}&pageSize=${pageSize}`),
  generations: (page = 1, pageSize = 20) =>
    api<Page<GenerationHistory>>(`/api/history/generations?page=${page}&pageSize=${pageSize}`),
};
