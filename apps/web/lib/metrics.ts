// C3 (ADR-0010/DEC-5): origem de uma métrica de performance. ESPELHO MANUAL do enum
// MetricSource (Enums.cs) — a fonte da verdade é o .NET; este espelho é comparado por
// enums.contract.test.ts (invariante E0.3). Mudar o enum sem atualizar aqui = teste vermelho.
export const MetricSource = {
  Mock: 0,
  Real: 1,
} as const;

// Rótulo de honestidade de estado: a UI mostra "Simulado" quando a métrica veio do mock
// (sem token IG ou parse de /insights falho). Nunca número falso mudo — DEC-5.
export const METRIC_SOURCE_LABEL: Record<number, string> = {
  0: "Simulado",
  1: "Real",
};
