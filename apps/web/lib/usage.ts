import { api } from "./api";

// C (ADR-0008): espelha os DTOs de UsageController.cs. Valores em USD, ESTIMADOS.
export interface UsageByBrand {
  brandId: string | null;
  brandName: string | null;
  totalUsd: number;
}

export interface UsageByReason {
  reason: string;
  totalUsd: number;
}

export interface UsageSummary {
  from: string;
  to: string;
  totalUsd: number;
  monthlyCapUsd: number;
  spentThisMonthUsd: number;
  byBrand: UsageByBrand[];
  byReason: UsageByReason[];
}

export const usageApi = {
  // Período opcional (ISO). Sem from/to → backend usa os últimos 30 dias.
  summary: (from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return api<UsageSummary>(`/api/usage${suffix}`);
  },
};
