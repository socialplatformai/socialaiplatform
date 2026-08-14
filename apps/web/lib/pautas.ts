import { api } from "./api";

export const Priority = { Low: 0, Medium: 1, High: 2 } as const;
export const ContentType = { Post: 0, Carousel: 1, Story: 2 } as const;
export const PautaStatus = {
  Backlog: 0,
  Queued: 1,
  InProgress: 2,
  Done: 3,
  Archived: 4,
} as const;

export const PRIORITY_LABEL = ["Baixa", "Média", "Alta"];
export const TYPE_LABEL = ["Post", "Carrossel", "Story"];
export const STATUS_LABEL = ["Backlog", "Na fila", "Em andamento", "Concluída", "Arquivada"];

export interface Attachment {
  id: string;
  url: string;
  fileName: string | null;
  contentType: string | null;
}

export interface Pauta {
  id: string;
  title: string;
  objective: string | null;
  context: string | null;
  priority: number;
  category: string | null;
  desiredType: number;
  suggestedDate: string | null;
  status: number;
  attachments: Attachment[];
  marketingObjective: string | null;
}

export interface PautaInput {
  title: string;
  objective?: string;
  context?: string;
  priority: number;
  category?: string;
  desiredType: number;
  suggestedDate?: string | null;
  attachments?: { url: string; fileName?: string }[];
  marketingObjective?: string;
}

export const pautaApi = {
  // E12.1: `search` é o 4º parâmetro posicional opcional — retrocompatível com os
  // call sites existentes (list(), list(undefined, priority, category)).
  list: (status?: number, priority?: number, category?: string, search?: string) => {
    const q = new URLSearchParams();
    if (status !== undefined) q.set("status", String(status));
    if (priority !== undefined) q.set("priority", String(priority));
    // E3.5: filtra a lista por categoria.
    if (category) q.set("category", category);
    // E12.1: só envia `search` quando não-vazio (server-side, ILike por título).
    if (search) q.set("search", search);
    const qs = q.toString();
    return api<Pauta[]>(`/api/pautas${qs ? `?${qs}` : ""}`);
  },
  // E3.5: categorias distintas da marca atual (para popular o filtro).
  categories: () => api<string[]>("/api/pautas/categories"),
  queue: () => api<Pauta[]>("/api/pautas/queue"),
  get: (id: string) => api<Pauta>(`/api/pautas/${id}`),
  create: (input: PautaInput) =>
    api<Pauta>("/api/pautas", { method: "POST", body: JSON.stringify(input) }),
  update: (id: string, input: PautaInput) =>
    api<Pauta>(`/api/pautas/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  setStatus: (id: string, status: number) =>
    api<void>(`/api/pautas/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  remove: (id: string) => api<void>(`/api/pautas/${id}`, { method: "DELETE" }),
};
