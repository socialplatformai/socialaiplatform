import { api } from "./api";

// Freio-mestre GLOBAL do robô (SystemSetting["Loop:Enabled"]). Config de deploy (não por workspace),
// admin-only. Traz o kill-switch do env-var para a tela. Espelha MasterSwitchDto (.NET).
export interface MasterSwitch {
  enabled: boolean;
}

// Máximo de gerações do robô por dia (SystemSetting["Loop:MaxPostsPerDay"] → env → 1). Config global
// do deploy (single-tenant por cliente), admin-only. Espelha MaxPostsPerDayDto (.NET).
export interface MaxPostsPerDay {
  value: number;
}

export const automationApi = {
  /** GET /api/automation/master-switch — estado do freio-mestre (banco → fallback env). */
  getMasterSwitch: () => api<MasterSwitch>("/api/automation/master-switch"),
  /** PUT /api/automation/master-switch — liga/desliga o robô globalmente. Admin-only. */
  saveMasterSwitch: (enabled: boolean) =>
    api<MasterSwitch>("/api/automation/master-switch", {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }),
  /** GET /api/automation/max-posts-per-day — teto de gerações/dia do robô. */
  getMaxPostsPerDay: () => api<MaxPostsPerDay>("/api/automation/max-posts-per-day"),
  /** PUT /api/automation/max-posts-per-day — ajusta o teto (mínimo 1). Admin-only. */
  saveMaxPostsPerDay: (value: number) =>
    api<MaxPostsPerDay>("/api/automation/max-posts-per-day", {
      method: "PUT",
      body: JSON.stringify({ value }),
    }),
};
