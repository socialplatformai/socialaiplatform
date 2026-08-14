---
adr: 0002
titulo: Entidade Marca (Brand) — Workspace → N Marcas → N Contas IG
status: aceito
data: 2026-06-14
---

# ADR-0002 — Entidade Marca (Brand)

> Fundação estrutural de quase tudo (identidade visual, coleta↔engine, multi-conta, custo por marca).
> Implementa DP1 (várias marcas/workspace) e DP2 (várias contas IG/marca).

## Critério de aceite (binário)

- [x] Migration aplica e reverte (`Down()`); `dotnet test` verde. → A/B com round-trip Up→Down→Up contra Postgres real; **22/22**.
- [x] Existe entidade `Brand : TenantEntity`; cada workspace existente recebe **1 marca-default**
      (nome = nome do workspace, ou `"Marca principal"` se vazio) no backfill — **idempotente** (DEC-1). → `INSERT 0 0` na 2ª execução; 6/6 workspaces.
- [x] `BrandKit`, `Competitor`, `InstagramAccount`, `Pauta`, `Content`, `Campaign` referenciam
      `BrandId`; os dados pré-existentes apontam para a marca-default do seu workspace. → 0 nulls, 0 mismatch cross-workspace.
- [x] **Isolamento intacto:** o filtro global e o `TenantSaveInterceptor` continuam por `WorkspaceId`
      (Brand é sub-chave, NÃO substitui) — teste cobre **cross-workspace E cross-brand**. → `BrandIsolationTests` + `CrossBrandEndpointTests` (furo de Approval/Schedule **corrigido**, com teste que prova pegar o furo).
- [x] Seletor de marca na UI troca o contexto; criar pauta na marca A não aparece na marca B. → **E1-d entregue**: `lib/brands.ts` + `X-Brand-Id` automático em `lib/api.ts` (único ponto) + seletor no topbar (persiste a marca *antes* de invalidar — ordem load-bearing contra leak A→B) + tela `Configurações→Marcas`. Guardas Vitest cobrem a regressão (25/25). Dois furos corrigidos: (1) cross-session leak — o `QueryClient` da raiz sobrevivia à navegação SPA pós-login/logout; corrigido com `clearToken()` esvaziando o cache via clearer registrado nos Providers; (2) ordem de `setBrandId`/`invalidate` sem teste — agora travada. Furo theórico declarado e NÃO corrigido (KISS): request já em voo mantém o `X-Brand-Id` antigo — invalidação refetcha e last-write-wins; corrigir exige AbortController (prematuro).
- [x] Worker (jobs sistêmicos, `WorkspaceId=null`) continua processando todos — sem regressão. → worker rebuilda; não cria entidades de marca diretamente.

> **Backend + UI implementados em 2026-06-15.** Dois furos corrigidos: no backend, furo cross-brand
> em Approval/Schedule; na UI, cross-session leak de cache do React Query no logout. Ambos cobertos
> por teste de regressão.

## Contexto (schema real hoje)

Tudo pendura direto em `Workspace` via `TenantEntity` (`WorkspaceId`). Relações 1:1 com workspace:
`BrandKit`, `InstagramAccount`, `Budget` (`AppDbContext.OnModelCreating` linhas 41–43). Pertencem ao
workspace: `Competitor`, `Pauta`, `Content`, `Campaign`. `VisualReference` pendura em `BrandKit`.
Isolamento: filtro global por `WorkspaceId` (`ApplyTenantFilter`) + `TenantSaveInterceptor` (carimba e
barra cross-tenant).

## Decisão central (KISS, e elimina o risco B2)

**`Brand` é uma `TenantEntity` (carrega `WorkspaceId`); as entidades de marca ganham `BrandId` como
SUB-CHAVE, mantendo `WorkspaceId`.** O mecanismo de isolamento **não muda**: continua por
`WorkspaceId` (filtro global + interceptor intactos). Brand é um **agrupador dentro do workspace**, não
um novo nível de tenancy.

> Por que assim: redesenhar o isolamento (filtro por Brand, interceptor por Brand) seria arriscado e
> desnecessário (B2). Mantendo `WorkspaceId` em tudo, o invariante multi-tenant testado **permanece
> verdadeiro sem tocar no `AppDbContext`/interceptor**; só adicionamos um agrupador. Mais simples,
> mais seguro, reversível.

### Modelo de dados (alvo)

```
Workspace (1) ──< Brand (N)            Brand : TenantEntity { Name; + campos de E2 (cores/tipo/logo) }
   │
   ├── Brand (1) ──1 BrandKit          (era 1:1 Workspace → vira 1:1 Brand)
   ├── Brand (1) ──< Competitor
   ├── Brand (1) ──< InstagramAccount  (era 1:1 Workspace → vira 1:N Brand — DP2)
   ├── Brand (1) ──< Pauta
   ├── Brand (1) ──< Content           (+ TargetInstagramAccountId opcional — DEC-8, entregue em E7)
   └── Brand (1) ──< Campaign
```

`Budget` permanece em `Workspace` (custo agrega por marca via `SpendEntry.BrandId` — DEC-7, entregue
em E5.5/E7, fora deste ADR). `User`, `OAuthState`, `Secret` permanecem como estão.

Campos novos em `Brand` nesta fase: `Id`, `WorkspaceId` (de `TenantEntity`), `Name`. Os campos de
identidade visual (paleta/tipografia/logo) entram no **ADR de E2** (não aqui — KISS, uma mudança por
vez). `BrandId` em cada entidade de marca: **NOT NULL após o backfill**.

## Estratégia de migração (expand → migrate → contract) — sem big-bang

```
Migration A (expand):
  - cria tabela Brand (Id, WorkspaceId, Name, CreatedAt, UpdatedAt) + índice (WorkspaceId)
  - adiciona BrandId NULLABLE em BrandKit, Competitor, InstagramAccount, Pauta, Content, Campaign
  - data step (no Up(), SQL determinístico):
      INSERT 1 Brand por workspace (Name = Workspace.Name; se vazio → 'Marca principal')
      UPDATE cada tabela SET BrandId = (a marca-default do seu WorkspaceId)
  - (idempotente: o INSERT só cria se o workspace ainda não tem marca)

Migration B (contract), só depois do código novo no ar e backfill verde:
  - BrandId vira NOT NULL
  - ajusta relações: BrandKit 1:1 Brand; InstagramAccount 1:N Brand
  - mantém WorkspaceId em todas (NÃO remover — é a chave de isolamento)
```

`Down()` de ambas reverte (drop coluna / drop tabela). **Backup (`pg_dump`) antes de aplicar** em
produção (runbook B6, a documentar em `docs/sot/05-operacao.md`).

## Contrato de API (mínimo desta fase)

```
GET    /api/brands              → lista marcas do workspace
POST   /api/brands             → cria marca { name }
PUT    /api/brands/{id}        → renomeia
DELETE /api/brands/{id}        → remove (bloqueia se for a última do workspace)
```

- Resolução de marca atual: header `X-Brand-Id` (como o workspace vem do JWT). A API valida que a
  marca pertence ao workspace do JWT (defense-in-depth) — 403 se não.
- Endpoints existentes de marca/pauta/conteúdo passam a filtrar **por `BrandId` do header** (além do
  `WorkspaceId` do JWT que o filtro global já aplica).

> Decisão de escopo: a resolução de marca é por **header**, não por claim no JWT — assim trocar de
> marca não exige reemitir token. Espelha o padrão de workspace sem inflá-lo.

## Esboço de UI (KISS)

- **Seletor de marca** no `topbar` (ao lado do tema), persistido em `localStorage.sap_brand`, enviado
  como `X-Brand-Id` por `lib/api.ts` (um único ponto, como já é o `Authorization`).
- Tela mínima **Configurações → Marcas**: lista + criar/renomear/remover.
- Sem marca selecionada (1ª vez) → usa a marca-default automaticamente.

## Plano de teste (fecha o aceite)

1. `tests/SocialAi.Tests` (.NET): **cross-brand isolation** — duas marcas no mesmo workspace; query de
   pauta com `BrandId=A` não retorna pauta de `B`. **Cross-workspace** continua verde (não-regressão).
2. Teste do interceptor: insert com `BrandId` de outra marca/workspace é barrado.
3. Backfill idempotente: rodar a migration data-step 2× não duplica marca (teste de migração ou script).
4. Web (Vitest): `lib/api.ts` anexa `X-Brand-Id`; seletor troca contexto.

## Riscos e mitigação
- **FK órfã se backfill falhar no meio** → data step numa única transação; `Down()` testado; backup antes.
- **Worker com `WorkspaceId=null`** itera todos os workspaces; como filtra por marca? **Não filtra por
  marca** — jobs sistêmicos operam por `WorkspaceId` e, onde precisam de marca (ex.: publicar via conta
  da marca), leem `BrandId` explícito do registro. Sem mudança no `SystemWorkspace`.
- **Sincronia de enums**: esta fase não adiciona enum; se adicionar status, segue B3/E0.3.

## Fora de escopo (vai para outros ADRs)
- Campos de identidade visual em `Brand` (cores/tipo/logo) → **ADR de E2**.
- Multi-conta IG operacional (conta-alvo por pauta) → **ADR de E7** (a coluna `BrandId` em
  `InstagramAccount` já entra aqui; a lógica de seleção, não).
- Custo por marca (`SpendEntry.BrandId`) → **ADR de E5.5/E7**.
