import { defineConfig, devices } from "@playwright/test";

// Acessibilidade (a11y) — harness E2E mínimo: roda axe-core no percurso
// dashboard → create → approvals → calendar e falha em violações sérias/críticas. NÃO depende de
// API/postgres/minio vivos: o Next sobe em dev, a sessão é injetada no localStorage e as chamadas
// /api/** são mockadas no browser (page.route) com fixtures mínimas (ver e2e/a11y.spec.ts).
//
// Roda com: `npm run test:a11y` (sobe o Next dev automaticamente via webServer).
export default defineConfig({
  testDir: "./e2e",
  // Um worker: o axe é determinístico e o webServer é único; evita corrida na porta.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3100",
    // Viewport de desktop: alvos de toque e contraste valem para o layout renderizado.
    ...devices["Desktop Chrome"],
  },
  webServer: {
    // Porta dedicada (3100) p/ não colidir com um dev server em 3000. Modo dev: sobe rápido e
    // basta p/ a auditoria de a11y (estrutura + contraste do CSS real, idênticos a prod).
    command: "npm run dev -- --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
