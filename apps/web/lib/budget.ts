import { api } from "./api";

// B1 (ADR-0009): saldo de budget do workspace atual. Espelha BudgetDto (.NET).
// Sem Budget configurado → monthlyCapUsd=0, remainingUsd=0 (não inventa valor — DEC-5/L4).
export interface BudgetStatus {
  monthlyCapUsd: number;
  spentThisMonthUsd: number;
  remainingUsd: number;
  autonomousLoopEnabled: boolean;
}

// ADR-0010/§2.4: patch do budget — teto mensal + flag "inventar pauta sozinho". Campos opcionais:
// enviar só o que muda (o backend preserva o resto). Admin-only no backend.
export interface UpdateBudgetRequest {
  monthlyCapUsd?: number;
  autonomousLoopEnabled?: boolean;
}

export const budgetApi = {
  /** GET /api/budget — cap, gasto do mês, restante, flag do loop autônomo. */
  get: () => api<BudgetStatus>("/api/budget"),
  /** PUT /api/budget — liga/desliga o loop e ajusta o teto. Admin-only. */
  save: (req: UpdateBudgetRequest) =>
    api<BudgetStatus>("/api/budget", {
      method: "PUT",
      body: JSON.stringify(req),
    }),
};
