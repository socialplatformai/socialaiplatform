import { api } from "./api";

export interface InstagramStatus {
  connected: boolean;
  username: string | null;
  tokenExpiresAt: string | null;
}

// A2 (ADR-0010): conta IG de uma marca. N contas por marca (DP2). Espelha InstagramAccountDto (.NET).
export interface InstagramAccount {
  id: string;
  username: string | null;
  isConnected: boolean;
  tokenExpiresAt: string | null;
  isPrimary: boolean;
}

export interface MetaAppConfig {
  configured: boolean;
  appId: string | null;
}

export const instagramApi = {
  // Status resumido (conta principal/1ª conectada da marca) — badge "conectado?".
  status: () => api<InstagramStatus>("/api/instagram/status"),
  // A1: connect-url exige X-Brand-Id (injetado por lib/api.ts). A marca é fixada no OAuthState.
  connectUrl: () => api<{ url: string }>("/api/instagram/connect-url"),

  // A2: gestão multi-conta por marca.
  accounts: () => api<InstagramAccount[]>("/api/instagram/accounts"),
  disconnect: (accountId: string) =>
    api<void>(`/api/instagram/accounts/${accountId}/disconnect`, { method: "POST" }),
  // A4: marca uma conta como principal (flip transacional, ≤1 principal/marca).
  setPrimary: (accountId: string) =>
    api<void>(`/api/instagram/accounts/${accountId}/primary`, { method: "POST" }),

  // Credenciais do App Meta (admin). O App Secret nunca volta em claro no GET.
  getAppConfig: () => api<MetaAppConfig>("/api/instagram/app-config"),
  saveAppConfig: (appId: string, appSecret: string) =>
    api<MetaAppConfig>("/api/instagram/app-config", {
      method: "POST",
      body: JSON.stringify({ appId, appSecret }),
    }),
  deleteAppConfig: () => api<void>("/api/instagram/app-config", { method: "DELETE" }),
};
