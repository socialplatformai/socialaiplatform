import { api } from "./api";

// C4 (ADR-0009): notificações in-app DERIVADAS de estado (sem tabela). Espelha NotificationDto (.NET).
// kind: "approval_pending" | "publish_failed" | "ig_token_expiring"; severity: "info" | "error" | "warning".
// Nome AppNotification (não "Notification") para não sombrear o global Notification do DOM (lib "dom").
export interface AppNotification {
  kind: string;
  title: string;
  ref: string | null;
  severity: string;
}

export const notificationsApi = {
  /** GET /api/notifications — alertas derivados de estado para a marca/workspace atual. */
  list: () => api<AppNotification[]>("/api/notifications"),
};
