import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Acessibilidade — axe-core no percurso dashboard → create → approvals → calendar.
// O critério de PRONTO: 0 violações SÉRIAS no fluxo. Aqui falhamos em `serious` E `critical`
// (as duas faixas que importam para entrega); `moderate`/`minor` são reportadas mas não bloqueiam.
//
// Sem backend: a sessão é injetada no localStorage (passa o guard de auth client-side) e as
// chamadas /api/** são mockadas no browser. Fixtures mínimas populam os ELEMENTOS dos fixes desta
// fase — a fila de aprovação (checkbox com alvo ≥44px) e o calendário (chip "Desagendar" ≥44px) —
// para o axe auditar a a11y real desses controles, não só telas vazias.

const FAKE_TOKEN = "e2e-fake-jwt-token";

// Fixtures por endpoint. Default (abaixo) cobre o resto com [] / {} para a tela não quebrar.
function fixtureFor(pathname: string): unknown | undefined {
  // Fila de aprovação: 1 item com qualityScore baixo (renderiza o checkbox de lote — o fix 1.3).
  if (pathname.endsWith("/api/approval/pending")) {
    return [
      { contentId: "c1", caption: "Peça de exemplo para auditoria de acessibilidade", type: 1, status: 2, effectiveMode: 0, qualityScore: 62 },
      { contentId: "c2", caption: "Segunda peça da fila", type: 1, status: 2, effectiveMode: 0, qualityScore: 88 },
    ];
  }
  // Calendário: 1 post agendado NÃO despachado (renderiza o chip com o botão "Desagendar" — fix 1.3).
  if (pathname.endsWith("/api/schedule/calendar") || pathname.includes("/api/schedule/calendar?")) {
    const inOneHour = new Date(Date.now() + 3_600_000).toISOString();
    return [
      { id: "s1", contentId: "c1", scheduledFor: inOneHour, frequency: 0, dispatched: false, idempotencyKey: "k1", contentStatus: 5 },
    ];
  }
  if (pathname.endsWith("/api/instagram/status")) {
    return { connected: false, accountName: null, tokenExpiresAt: null };
  }
  if (pathname.endsWith("/api/approval/mode/workspace")) return { mode: 0 };
  if (pathname.endsWith("/api/brand/kit")) {
    return { handle: "@marca", visualIdentity: null, voice: null };
  }
  if (pathname.endsWith("/api/learning/insights")) return { bestFormat: null, bestWindow: null, samples: 0 };
  if (pathname.endsWith("/api/templates")) return [];
  if (pathname.endsWith("/api/settings/ai")) return { textProvider: "gemini", imageProvider: "gemini" };
  // Estimativa de custo (create): objeto CostEstimate — a tela faz .toFixed nos valores numéricos.
  if (pathname.endsWith("/api/content/estimate")) {
    return { unitCostUsd: 0.05, count: 1, totalCostUsd: 0.05, currency: "USD", isEstimate: true };
  }
  // Prévia do briefing (create): objeto com campos textuais; vazio honesto não quebra a render.
  if (pathname.endsWith("/api/content/briefing/preview")) {
    return { theme: "Tema de exemplo", angle: "", audience: "", format: 1 };
  }
  if (pathname.endsWith("/api/budget")) return { autonomousLoopEnabled: false, monthlyCapUsd: 0, spentUsd: 0 };
  if (pathname.endsWith("/api/notifications")) return [];
  return undefined; // cai no default
}

async function mockApi(page: Page) {
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const fixture = fixtureFor(url.pathname);
    const body = fixture !== undefined
      ? fixture
      // Default sensato: GET de coleção → []; resto → {}. Mantém as telas renderizando "vazio honesto".
      : (route.request().method() === "GET" ? [] : {});
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

async function seedSession(page: Page) {
  await page.addInitScript((token) => {
    window.localStorage.setItem("sap_token", token);
    window.localStorage.setItem("sap_role", "Admin");
  }, FAKE_TOKEN);
}

// Roda axe na página atual e devolve as violações sérias/críticas (as que bloqueiam a entrega).
async function seriousViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

const ROUTES = [
  { name: "dashboard", path: "/dashboard" },
  { name: "create", path: "/create" },
  { name: "approvals", path: "/approvals" },
  { name: "calendar", path: "/calendar" },
];

// WARM-UP (determinismo): o `next dev` compila cada rota SOB DEMANDA no 1º acesso (cold-compile
// pode passar de 1min para telas pesadas como /create). Sem aquecer, o teste que pega a rota fria
// estoura o timeout — flake que NÃO é violação de a11y. Aqui visitamos as 4 rotas uma vez antes da
// suíte, num contexto descartável, forçando a compilação. Depois os testes rodam com páginas quentes.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(600_000); // 4 rotas frias podem levar vários minutos de compilação no 1º acesso.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  for (const r of ROUTES) {
    await page.goto(r.path, { waitUntil: "domcontentloaded", timeout: 180_000 }).catch(() => {});
  }
  await ctx.close();
});

test.beforeEach(async ({ page }) => {
  // Falha de runtime na página (ex.: fixture incompatível) renderiza o __next_error__ do Next,
  // que dispara violações de a11y falso-positivas. Capturamos o erro real para diagnóstico.
  page.on("pageerror", (err) => console.error(`[pageerror] ${err.message}`));
  await seedSession(page);
  await mockApi(page);
});

for (const r of ROUTES) {
  // Timeout generoso: a 1ª navegação a cada rota compila a página sob demanda no `next dev`
  // (cold-compile), que pode passar de 60s na 1ª vez. Não é lentidão de runtime — é o dev server.
  test(`axe — ${r.name} sem violações sérias/críticas`, async ({ page }) => {
    // Cobre cold-compile do `next dev` (goto até 120s) + a varredura do axe na árvore DOM (telas
    // pesadas como /create têm muitos nós). Folga ampla: o gargalo é o dev server, não o runtime.
    test.setTimeout(240_000);
    // `domcontentloaded` (não `load`): a SPA hidrata client-side; esperar todos os recursos é
    // frágil e desnecessário para a auditoria de a11y (que roda após o conteúdo montar, abaixo).
    await page.goto(r.path, { waitUntil: "domcontentloaded", timeout: 120_000 });
    // Espera o shell autenticado montar (o guard troca o placeholder pelo conteúdo).
    await page.waitForSelector("#main, main, [role='main']", { timeout: 30_000 }).catch(() => {});
    // Espera FIXA curta para o React Query resolver os mocks e renderizar (checkbox/chip). NÃO usamos
    // `networkidle`: o dashboard faz polling/refetch, então a rede nunca fica ociosa e o axe esperaria
    // para sempre. 1.5s é suficiente pois as respostas são mockadas (instantâneas), não rede real.
    await page.waitForTimeout(1500);

    const violations = await seriousViolations(page);
    if (violations.length > 0) {
      const summary = violations
        .map((v) => `  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nó(s))`)
        .join("\n");
      console.error(`Violações sérias/críticas em ${r.name}:\n${summary}`);
    }
    expect(violations, `axe encontrou violações sérias/críticas em ${r.name}`).toEqual([]);
  });
}
