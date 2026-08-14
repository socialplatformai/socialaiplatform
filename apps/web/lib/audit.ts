import { api } from "./api";

// C2 (ADR-0010): trilha de auditoria (Admin). Espelha AuditEntryDto/AuditPage (.NET).
export interface AuditEntry {
  id: string;
  brandId: string | null;
  actorUserId: string;
  actorEmail: string;
  action: string; // ex.: "content.approve", "instagram.connect", "user.invite"
  target: string;
  occurredAt: string;
}

export interface AuditPage {
  items: AuditEntry[];
  page: number;
  pageSize: number;
  total: number;
}

// Rótulos legíveis das ações sensíveis (a trilha é técnica; a UI traduz). Fallback = a própria ação.
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  "instagram.connect": "Conectou conta Instagram",
  "instagram.disconnect": "Desconectou conta Instagram",
  "content.approve": "Aprovou conteúdo",
  "content.reject": "Rejeitou conteúdo",
  "meta.app-config.save": "Alterou credenciais do App Meta",
  "idea.promote": "Promoveu ideia do loop",
  "user.invite": "Convidou usuário",
  "user.remove": "Removeu usuário",
};

export const auditApi = {
  list: (page = 1, pageSize = 20) =>
    api<AuditPage>(`/api/audit?page=${page}&pageSize=${pageSize}`),
};
