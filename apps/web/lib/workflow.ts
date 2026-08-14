import { api } from "./api";
import type { BatchResult } from "./content";

export const APPROVAL_MODE_LABEL = ["Manual", "Automático"];

// G5 (ADR-0014): recorrência. Espelho MANUAL de Frequency (Enums.cs) — sincronia travada por
// enums.contract.test.ts (E0.3). None=publica 1×; Daily/Weekly/Monthly reagendam no worker.
export const Frequency = { None: 0, Daily: 1, Weekly: 2, Monthly: 3 } as const;
export type FrequencyValue = (typeof Frequency)[keyof typeof Frequency];
export const FREQUENCY_LABEL: Record<number, string> = {
  0: "Não repetir",
  1: "Todo dia",
  2: "Toda semana",
  3: "Todo mês",
};
// Opções na ordem em que aparecem no seletor de agendamento.
export const FREQUENCY_OPTIONS = [
  { value: Frequency.None, label: FREQUENCY_LABEL[Frequency.None] },
  { value: Frequency.Daily, label: FREQUENCY_LABEL[Frequency.Daily] },
  { value: Frequency.Weekly, label: FREQUENCY_LABEL[Frequency.Weekly] },
  { value: Frequency.Monthly, label: FREQUENCY_LABEL[Frequency.Monthly] },
] as const;

export interface PendingContent {
  contentId: string;
  caption: string | null;
  type: number;
  status: number;
  effectiveMode: number;
  // S-14: espelha ContentDto.QualityScore da API. Opcional porque endpoints mais antigos
  // podem não retornar o campo; undefined e null tratados como "sem score".
  qualityScore?: number | null;
}

export interface ScheduledPost {
  id: string;
  contentId: string;
  scheduledFor: string;
  // G5 (ADR-0014): recorrência (Frequency). None=0 publica 1×; Daily/Weekly/Monthly reagendam.
  frequency: number;
  dispatched: boolean;
  idempotencyKey: string;
  contentStatus: number;
  // A5 (ADR-0010): aviso suave devolvido só na criação — o horário caiu fora da janela de
  // publicação configurada (true), dentro (false), ou não há janela (null/ausente).
  outsideWindow?: boolean | null;
}

export const approvalApi = {
  pending: () => api<PendingContent[]>("/api/approval/pending"),
  decide: (contentId: string, approved: boolean, comments?: string) =>
    api<void>(`/api/approval/content/${contentId}/decide`, {
      method: "POST",
      body: JSON.stringify({ approved, reviewer: "operador", comments }),
    }),
  // Modo de aprovação padrão da conta (workspace). GET aberto; PUT só Admin (o backend gateia).
  getWorkspaceMode: () =>
    api<{ mode: number }>("/api/approval/mode/workspace"),
  setWorkspaceMode: (mode: number) =>
    api<void>("/api/approval/mode/workspace", {
      method: "PUT",
      body: JSON.stringify({ mode }),
    }),
  // E4.2: modo de aprovação por CONTEÚDO (Admin). mode=null herda (workspace/campanha).
  setContentMode: (contentId: string, mode: number | null) =>
    api<void>(`/api/approval/mode/content/${contentId}`, {
      method: "PUT",
      body: JSON.stringify({ mode }),
    }),
  // E4.2: modo EFETIVO resolvido (conteúdo > campanha > workspace).
  getEffectiveMode: (contentId: string) =>
    api<number>(`/api/approval/content/${contentId}/mode`),
  // C1 (ADR-0009): decisão em lote. action "approve"|"reject"; comments só para reject.
  // Ignora silenciosamente ids inválidos/de outra marca/estado errado → { applied, skipped }.
  batch: (ids: string[], action: "approve" | "reject", comments?: string) =>
    api<BatchResult>("/api/approval/batch", {
      method: "POST",
      body: JSON.stringify({ ids, action, comments }),
    }),
};

export const scheduleApi = {
  calendar: (from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    const qs = q.toString();
    return api<ScheduledPost[]>(`/api/schedule/calendar${qs ? `?${qs}` : ""}`);
  },
  // G5 (ADR-0014): frequency opcional (default None=publica 1×). Daily/Weekly/Monthly fazem o
  // worker reagendar a próxima ocorrência. A5 (ADR-0010): scheduledForLocal é a hora de PAREDE
  // local (ex.: "2026-06-20T09:00", do <input type=datetime-local>). O servidor converte pelo fuso
  // do workspace → UTC; o horário NÃO depende do fuso do navegador. scheduledFor é placeholder.
  schedule: (contentId: string, scheduledForLocal: string, frequency: number = Frequency.None) =>
    api<ScheduledPost>("/api/schedule", {
      method: "POST",
      body: JSON.stringify({
        contentId,
        scheduledFor: new Date().toISOString(), // ignorado quando scheduledForLocal vem
        scheduledForLocal,
        frequency,
      }),
    }),
  unschedule: (id: string) => api<void>(`/api/schedule/${id}`, { method: "DELETE" }),
  // task 2.7 — LOOKAHEAD: os próximos N posts agendados (não-despachados) da marca atual.
  lookahead: (count = 10) => api<ScheduledPost[]>(`/api/schedule/lookahead?count=${count}`),
  // task 2.7 — EDITAR o horário de um agendamento (não-despachado). scheduledForLocal = hora de parede.
  reschedule: (id: string, scheduledForLocal: string, frequency?: number) =>
    api<ScheduledPost>(`/api/schedule/${id}`, {
      method: "PUT",
      body: JSON.stringify({ scheduledFor: new Date().toISOString(), scheduledForLocal, frequency }),
    }),
  // task 2.7 — agendamento em LOTE. Resultado por item (scheduled + id, ou error).
  scheduleBatch: (items: { contentId: string; scheduledFor: string; frequency?: number }[]) =>
    api<{ contentId: string; scheduled: boolean; scheduledPostId: string | null; error: string | null }[]>(
      "/api/schedule/batch",
      { method: "POST", body: JSON.stringify({ items }) },
    ),
  // "Publicar agora": agenda para o instante atual (o servidor define o now). O worker publica no
  // próximo tick (≤60s). Mesmo gate de aprovação do agendamento — só publica conteúdo aprovado.
  publishNow: (contentId: string) =>
    api<ScheduledPost>("/api/schedule/publish-now", {
      method: "POST",
      body: JSON.stringify({ contentId }),
    }),
};
