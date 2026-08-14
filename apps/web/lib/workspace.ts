import { api } from "./api";

// A5 (ADR-0010): config de fuso + janela de publicação do workspace. Espelha WorkspaceSettingsDto (.NET).
// Horas em formato "HH:mm" (TimeOnly serializa assim); fuso é um ID IANA (ex.: "America/Sao_Paulo").
// Fase 2 (task 2.1/2.2): estende com as flags de automação (o "volante"). Espelha os campos novos do
// WorkspaceSettingsDto/UpdateWorkspaceSettingsRequest (.NET).
export interface WorkspaceSettings {
  timeZoneId: string;
  publishWindowStart: string | null;
  publishWindowEnd: string | null;
  // Fase 2 — automação
  autoPostEnabled: boolean;
  postingScheduleDays: string;   // CSV de dias 0=Dom..6=Sáb (ex.: "1,3,5")
  postingScheduleTimes: string;  // CSV de horas "HH:mm" (ex.: "09:00,18:00")
  creativeStrategy: number;      // CreativeStrategyMode: Hybrid=0, AlwaysPhoto=1, AlwaysGraphic=2
  autoApprovalThreshold: number; // 0-100
}

// Espelho do enum CreativeStrategyMode (.NET). SINCRONIZADO via _enums.generated.ts (contrato E0.3).
export const CREATIVE_STRATEGY = { Hybrid: 0, AlwaysPhoto: 1, AlwaysGraphic: 2 } as const;

// Dias da semana p/ o seletor (índice = valor no CSV; 0=Dom).
export const WEEKDAYS: { value: number; label: string }[] = [
  { value: 0, label: "Dom" }, { value: 1, label: "Seg" }, { value: 2, label: "Ter" },
  { value: 3, label: "Qua" }, { value: 4, label: "Qui" }, { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
];

// Fusos IANA comuns no Brasil + alguns internacionais — lista curada (a UI não precisa de todos).
export const COMMON_TIMEZONES: { id: string; label: string }[] = [
  { id: "America/Sao_Paulo", label: "Brasília (GMT-3)" },
  { id: "America/Manaus", label: "Manaus (GMT-4)" },
  { id: "America/Rio_Branco", label: "Rio Branco (GMT-5)" },
  { id: "America/Noronha", label: "Fernando de Noronha (GMT-2)" },
  { id: "America/New_York", label: "Nova York (GMT-5/-4)" },
  { id: "Europe/Lisbon", label: "Lisboa (GMT/+1)" },
  { id: "UTC", label: "UTC (GMT)" },
];

export const workspaceApi = {
  getSettings: () => api<WorkspaceSettings>("/api/workspace/settings"),
  saveSettings: (settings: WorkspaceSettings) =>
    api<WorkspaceSettings>("/api/workspace/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
};
