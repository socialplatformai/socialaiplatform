---
adr: 0001
titulo: Fundação de QA — malha mínima de testes (TS) + contrato de enums + smoke E2E
status: aceito
data: 2026-06-14
implementado-em: 2026-06-15
---

# ADR-0001 — Fundação de QA

> **Quadrante:** decisão de arquitetura (MADR enxuto). Pré-requisito do gate de QA: sem ele,
> o portão "teste do aceite verde" é fictício para qualquer feature de UI/agents.

## Critério de aceite (binário)

- [x] `cd services/agents && npm test` roda e passa, com ≥1 teste real do `input-adapter`. → **11/11 verde** (`src/agents/input-adapter.test.ts`).
- [x] `cd apps/web && npm test` roda e passa, com ≥1 teste de componente (`Field`/form). → **14/14 verde** (`components/ui.test.tsx` + contrato de enums).
- [x] Teste de **contrato de enum** falha (vermelho) se um valor de `libs/SocialAi.Core/Domain/Enums.cs`
      divergir do espelho em `apps/web/lib/*.ts`. → **provado**: `High:2→99` em `pautas.ts` → vermelho; restaurado → verde.
- [x] Script de **smoke E2E** roda o fluxo registrar→marca→pauta→gerar(degradado)→401 e sai verde
      contra a stack local. → **7/7 verde, exit 0** (`scripts/smoke-e2e.mjs` contra API viva :5080).
- [x] `dotnet test` (os 10 invariantes atuais) continua verde — não-regressão. → **10/10 verde** após o fix em `TokenService`.

> **Implementado em 2026-06-15.** Achado extra do smoke: bug real em `TokenService` (boot
> Dev sem `JWT_SECRET` dava 500 no register por `IDX10703`) — corrigido para espelhar a guarda do
> `Program.cs`. Endurecidos: asserts de modo degradado no smoke (exigem mensagem que
> aponta a causa) e do contrato de enums (remoção de assert redundante; label não-vazio real).

## Contexto

Hoje só existem ~10 testes .NET (`tests/SocialAi.Tests`, xUnit). **Zero teste** no `apps/web` e no
`services/agents`. O gate de QA exige "teste do aceite verde" — inexecutável para features
de frontend/agents sem uma malha mínima. A sincronia de enums .NET↔TS (invariante conhecido, sem
contrato — ver `ARCHITECTURE.md`) não tem proteção automática.

## Decisão

**Adotar [Vitest](https://vitest.dev) como runner único de testes TS** (agents e web), criar um
**teste de contrato de enums** e versionar um **script de smoke E2E**. KISS: o menor aparato que
torna os portões de QA honestos — nada de framework e2e pesado (Playwright/Cypress) nesta fase.

### Por que Vitest (KISS)
- `services/agents` é ESM + TypeScript (`tsx`, `tsc-alias`); Vitest roda ESM/TS **sem build** e sem
  config de Babel — atrito mínimo.
- `apps/web` (Next 15) tem suporte oficial a Vitest + React Testing Library (component testing).
- Um runner só nos dois pacotes = menos superfície que Jest (que exigiria `ts-jest`/ESM workarounds).
- Alternativa **descartada**: Jest (atrito com ESM); Playwright nesta fase (e2e de browser é exagero
  antes de haver features de UI novas — entra mais tarde se necessário).

## Escopo (o que entra)

### Runner no `services/agents`
- Adicionar `vitest` (devDependency) + script `"test": "vitest run"` e `"test:watch": "vitest"`.
- 1º teste: `src/agents/input-adapter.test.ts` — exercita `adaptHttpToPipelineInput` e
  `validatePipelineInput` (entrada conhecida → asserções no `PipelineInput`). É a peça mais crítica e
  mais testável (função pura), e serve de base para os testes de coleta↔engine.

### Runner no `apps/web`
- Adicionar `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` + `vitest.config.ts`
  (environment `jsdom`).
- 1º teste: `components/ui.test.tsx` — renderiza `<Field label hint>` + `<Input placeholder>` e
  afirma que label/hint/placeholder aparecem (base dos testes de UX guiada).

### Teste de contrato de enums (.NET ↔ TS)
- Fonte da verdade: `libs/SocialAi.Core/Domain/Enums.cs`.
- Espelhos TS: `apps/web/lib/content.ts` (`CONTENT_STATUS_LABEL`), `apps/web/lib/pautas.ts`
  (`Priority`, `ContentType`, `PautaStatus`, labels).
- Implementação **KISS, sem parser de C#**: um teste em `apps/web` mantém uma tabela-espelho dos
  enums **derivada do .cs por um script de geração** (`scripts/gen-enums.mjs` lê o `Enums.cs` com
  regex simples e emite `apps/web/lib/_enums.generated.ts`); o teste compara o gerado com os mapas
  usados na UI. Mudar um enum em um lado sem o outro → teste vermelho.
- O script roda no CI antes do `vitest`; o arquivo gerado é commitado (revisável no diff).

### Smoke E2E roteirizado
- Versionar `scripts/smoke-e2e.mjs` (o roteiro já validado manualmente nesta fundação): registrar →
  salvar marca → criar pauta → listar → gerar (espera erro degradado claro sem chave) → checar 401
  sem token. Usa `fetch` contra `http://localhost:5080`.
- Não sobe a stack (assume rodando); é um **smoke**, não um e2e de browser. Documentar no
  `docs/sot/05-operacao.md` como "verificação rápida pós-deploy".

## Fora de escopo (KISS)
- Cobertura mínima de % (coverage gate) — adicionar só quando a malha crescer.
- E2E de browser (Playwright) — só se/quando houver fluxo de UI complexo a blindar.
- Mock server dedicado — o smoke usa a stack real local.

## Consequências
- **Positivas:** o portão de teste passa a ser real para TS; enums ganham rede; o smoke vira parte do
  deploy. Destrava honestamente todas as fases seguintes.
- **Custo:** ~1 dia de setup + manutenção dos espelhos de enum (mitigado pela geração automática).
- **Risco:** o gerador de enums por regex é frágil se o `Enums.cs` mudar de formato — teste do próprio
  gerador cobre isso; se ficar complexo, troca-se por um pequeno programa .NET que serializa os enums.

## Impacto no critério de pronto (a partir daqui)
- Feature de UI sem teste automatizável usa **aceite demonstrável marcado como manual** até a
  malha cobrir aquele caminho — explícito, nunca silencioso.
- Mudança de enum exige os dois lados no mesmo PR + o teste de contrato de enums verde.
