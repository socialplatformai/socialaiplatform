import { api } from "./api";
import type { Pauta } from "./pautas";

// E4.4 (ADR-0006): porta de saída do loop autônomo. O loop cria IdeaCandidate quando a
// fila de pautas esvazia; aqui o humano lista e promove a uma Pauta (na marca atual).

export interface Idea {
  id: string;
  title: string;
  rationale: string | null;
  suggestedType: number;
  brandId: string | null;
}

export const ideaApi = {
  list: () => api<Idea[]>("/api/ideas"),
  promote: (id: string) => api<Pauta>(`/api/ideas/${id}/promote`, { method: "POST" }),
};
