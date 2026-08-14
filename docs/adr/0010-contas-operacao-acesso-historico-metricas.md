---
adr: 0010
titulo: Contas (N por marca), conta-alvo por pauta, fuso/janela, acesso por convite, histórico, auditoria e métricas reais do IG
status: aceito
data: 2026-06-15
---

# ADR-0010 — Contas, operação, acesso, histórico, métricas reais

> **Entregue (11/11 aceites).** 364 testes verdes (.NET 150 · agents 142+2skip · web 72), migration
> aditiva única provada up→down→up contra Postgres real, enum `MetricSource` sincronizado nos 3 lados,
> sem bloqueador.
>
> **Divergências ADR↔código resolvidas:**
> - **`Workspace ↔ InstagramAccount` era 1:1** (índice UNIQUE de uma fase anterior) — travava N
>   contas/marca. Trocado para **1:N** (a cardinalidade fina já era 1:N por marca via `BrandId`). Dobrado
>   na migration única (drop+recria não-único; `Down()` recria o UNIQUE). Era pré-requisito silencioso de A1.
> - **Bug latente em `ApprovalController.Decide`** (pego pelo teste de aceite C2): a `Approval` nova com
>   PK Guid pré-preenchida virava `UPDATE` (0 linhas → `DbUpdateConcurrency`). Fix: `Add` explícito.
> - **OAuth bind snake_case** (`IgUserId` virou load-bearing): `user_id`/`access_token`
>   não bindavam — connect real (graph) quebrava. Fix: `SnakeCaseLower` + `UserId` como `long?`.
> - **A5 fuso** era config sem efeito: a conversão local↔UTC agora acontece na borda
>   (`ScheduleController` via `TimeZoneConversion.ToUtc(local, Workspace.TimeZoneId)`); `ScheduledFor`
>   permanece UTC. Janela de publicação = aviso soft (`OutsideWindow` no DTO).
> - **C3 honesto na leitura**: `LearningInsights.MockSampleCount` + badge "Simulado" na tela de insights
>   (a escrita já rotulava; faltava o loop fechar na UI).
>
> **Limites (fora de escopo, declarados):** entrega de convite por e-mail (Admin copia o link);
> publicação REAL depende de Meta App Review (`PUBLISHER_MODE=mock` é o default — o connect real foi
> corrigido mas não exercitado contra a Graph viva); nits cosméticos aceitos (Skeleton vs
> "Carregando…" na tela de Instagram, ARIA fino das Tabs do histórico).


> Fecha a **operação real multi-conta**: hoje um workspace tem **uma** conta IG (o callback OAuth faz
> upsert por `WorkspaceId`, `InstagramAuthController.cs:152-168`), o worker seleciona a conta por
> `WorkspaceId` (`PublishJob.cs:98-99`, `MetricsCollectorJob.cs:81`) e o parse de insights reais é um
> `TODO` que devolve `null` (`MetricsCollectorJob.cs:109-113`). `InstagramAccount` **já tem `BrandId`**
> (Entities.cs:237) e a cardinalidade já é 1:N marca (ADR-0005), mas nada lê N contas. Esta fase liga o
> que o modelo já permite e adiciona acesso (convite), histórico legível, auditoria e métricas reais.
> Depende de Marca (ADR-0002) e do `InstagramAccount.BrandId` (ADR-0005). Multi-tenancy por
> `WorkspaceId` permanece a chave de isolamento; **Brand é sub-chave** — nada aqui reabre o invariante.

## Critério de aceite (binário — no topo; cada item vira teste)

### Incremento A — Contas
- [x] **A1 — a marca é fixada no início do fluxo OAuth, não no callback:** `GET
      /api/instagram/connect-url` (Admin) passa a **exigir `X-Brand-Id`** e grava a marca-alvo no
      `OAuthState` (`OAuthState` ganha `BrandId`). O callback (redirect GET, sem header) resolve
      `{workspace, brand}` **do state consumido** (nunca de query param). Resultado: conectar **2 contas
      IG na mesma marca** (dois fluxos connect-url→callback com o mesmo `X-Brand-Id`) → `GET
      /api/instagram/accounts` (escopo `X-Brand-Id`) retorna **as 2**, cada uma com `id`, `username`,
      `isConnected`, `tokenExpiresAt`, `isPrimary`. O callback deixa de fazer upsert único por workspace:
      **insere uma nova conta por conexão**; dedup só quando o **mesmo `IgUserId`** já existe **na marca
      do state** → atualiza token em vez de duplicar. Teste: connect-url sem `X-Brand-Id` → 400; com
      `X-Brand-Id` grava `state{workspace,brand}`; callback insere na marca certa; reconectar mesmo
      `IgUserId` na mesma marca não duplica.
- [x] **A2:** `GET /status` e `POST /disconnect` passam a ser **por marca e por conta**:
      `GET /api/instagram/accounts` (lista da marca corrente) e `POST /api/instagram/accounts/{id}/disconnect`.
      Desconectar a conta de outra marca/workspace → **404** (resolvida via X-Brand-Id + filtro de tenant),
      nunca afeta conta alheia. Teste cross-brand e cross-workspace verdes.
- [x] **A3:** `Content` ganha `TargetInstagramAccountId` (nullable). Ao agendar/publicar,
      o worker resolve a conta-alvo por precedência **`Content.TargetInstagramAccountId` → conta principal
      da marca (`IsPrimary`) → primeira conta conectada da marca**. Teste: conteúdo com override publica
      pela conta X; sem override publica pela principal da marca; conta-alvo de outra marca é **rejeitada na
      API** (400) antes de chegar ao worker.
- [x] **A4:** exatamente **uma** conta principal por marca (`IsPrimary`). Marcar B como principal
      desmarca A (transação). A 1ª conta conectada de uma marca nasce `IsPrimary=true`. Teste cobre o flip.
- [x] **A5:** **`Workspace`** ganha `TimeZoneId` (IANA, default `America/Sao_Paulo`) e uma janela
      de publicação opcional (`PublishWindowStart`/`End`, hora local). (Fica no `Workspace`, não na marca —
      coerente com o invariante um-deploy/um-cliente; fuso por marca, se algum dia necessário, é outro ADR.)
      A UI de agendamento e o `SuggestedDate` interpretam horários **no fuso configurado**; o que
      persiste em `ScheduledFor` continua **UTC** (o worker não muda — `PublishSchedulerJob` segue
      comparando `<= now` UTC). Teste: agendar 09:00 local com fuso −03:00 grava `12:00Z`; fora da janela →
      aviso (não bloqueio rígido).

### Incremento B — Acesso
- [x] **B1:** Admin cria convite `POST /api/users/invite { email, role }` → retorna um **token +
      link** de convite (uso único, TTL). A **entrega por e-mail está fora de escopo desta fase** (o Admin
      copia-e-cola o link); no modo degradado (sem provedor de e-mail) o convite continua funcionando —
      não bloqueia o aceite. Member **não pode** convidar (403). Auto-registro de 2º+ usuário em workspace
      existente é **desabilitado** (só o 1º registro cria workspace+Admin; demais entram por convite).
      Teste: Member→403; Admin→201; aceitar convite cria `User` com o papel certo no workspace do convite.
- [x] **B2:** `GET /api/users` (Admin) lista membros; `DELETE /api/users/{id}` remove (Admin não
      pode remover o último Admin → 409). Teste cobre o guard do último Admin.

### Incremento C — Visibilidade
- [x] **C1:** `GET /api/history/publications` e `GET /api/history/generations` (escopo X-Brand-Id,
      paginado) devolvem o histórico **legível** — publicação: conteúdo, conta, resultado, quando, erro;
      geração: pauta, status, jobId, qualityScore, quando. A tela consome isso **sem SQL manual**. Teste de
      isolamento: histórico só traz linhas da marca/workspace corrente.
- [x] **C2:** ações sensíveis (conectar/desconectar conta, mudar config de App Meta, aprovar/rejeitar
      conteúdo, convidar/remover usuário, promover ideia) gravam **`AuditEntry`** `{ actor, action, target,
      occurredAt, workspaceId, brandId? }`. `GET /api/audit` (Admin) lista. Teste: aprovar um conteúdo gera
      1 `AuditEntry` com o autor do JWT; entrada não vaza entre workspaces.
- [x] **C3 — depende de chave/token IG (degradado):** com token IG válido,
      `MetricsCollectorJob` **parseia** `data[].values[].value` de `reach,likes,saved` e grava
      `PerformanceMetric` **real** (origem `Real`); **sem** token, grava mock **rotulado** (`Source=Mock`).
      A UI de métricas mostra o rótulo "simulado" quando `Source=Mock`. Teste: payload de insights fixo →
      métrica parseada bate; sem token → mock rotulado; o analyzer nunca recebe métrica zerada silenciosa.

### Incremento D (contrato) — sincronização de enum (3 lados)
- [x] **D-enum:** o novo enum `MetricSource { Mock=0, Real=1 }` é sincronizado em **três lados**:
      (1) `libs/SocialAi.Core/Domain/Enums.cs` (fonte da verdade), (2) regenerar
      `apps/web/lib/_enums.generated.ts` via `node scripts/gen-enums.mjs`, (3) adicionar `MetricSource` ao
      **espelho manual da UI** comparado por `apps/web/lib/enums.contract.test.ts`. Só com os três o
      contrato fica verde. Teste: `gen-enums --check` OK **e** `enums.contract.test.ts` verde.

> **Ordem por dependência:** A (contas) é a base — A1 fixa a marca no state e A3/A4 destravam a seleção de
> conta no worker, de que C3 (métricas por conta certa) depende. B é independente. C2 (auditoria) atravessa
> A e B (registra as ações delas), então fecha por último. C3 depende de token IG real (degradado honesto
> sem token).

## Contexto (estado real hoje — caminhos de arquivo)

- **`InstagramAccount`** (`libs/SocialAi.Core/Domain/Entities.cs:234-244`) já é `TenantEntity` **com
  `BrandId`** e a cardinalidade já está 1:N marca desde ADR-0005 (sem unique index em `BrandId`). Falta
  `IsPrimary`. Nada no código lê mais de uma conta.
- **OAuth — onde a marca se perde hoje:** `connect-url` (`InstagramAuthController.cs:57-86`) é
  `[Authorize(Roles="Admin")]`, lê só `Ws` e grava `OAuthState{ State, WorkspaceId, UserId, ExpiresAt }`
  (`OAuthState` em Entities.cs:272-280 **não tem `BrandId`**). O `callback` (linhas 89-179) é
  `[AllowAnonymous]` GET de redirect (sem `X-Brand-Id`), consome o state e deriva **apenas o workspace**;
  hoje cria a conta na **marca-default** (mais antiga, linhas 157-166) → não há como saber a marca que o
  operador quis conectar. **Esta fase corrige isso fixando a marca no `OAuthState` no connect-url.**
  `Status`/`Disconnect` (linhas 181-201) pegam o primeiro `InstagramAccount` sem filtro de marca.
- **Worker — ponto que toca o invariante de publicação:** `PublishJob.cs:98-99` resolve a conta por
  `WorkspaceId` (`FirstOrDefaultAsync(a => a.WorkspaceId == post.WorkspaceId)`); `SelectPublisher`
  (linhas 231-244) escolhe Mock/Graph pela validade do token **dessa** conta. `MetricsCollectorJob.cs:81`
  faz o mesmo lookup por workspace.
- **Métricas reais:** `FetchRealMetricAsync` (`MetricsCollectorJob.cs:78-116`) já resolve `RemoteId` por
  conteúdo+workspace e **chama** `/insights`, mas o parse é `TODO` → `return null`
  → cai no `MockMetric` determinístico (linhas 62-76). `PerformanceMetric` (Entities.cs:246-255) escreve
  `Reach/Engagement/Likes/Saves` e **não tem campo de origem** (mock vs real é indistinguível hoje).
- **Acesso:** `User.Role` (Entities.cs:72) já é `Admin/Member`; auth em `apps/api/Features/Auth/`. Hoje há
  auto-registro; não há controller de convite/listagem de usuários.
- **Auditoria:** **não existe** tabela nem trilha. Ações sensíveis (App Meta, approve) hoje só logam.
- **Fuso:** `ScheduledFor` é `DateTimeOffset` UTC; o `PublishSchedulerJob.cs:44-45` compara `<= now` UTC.
  Não há `TimeZoneId` persistido.
- **Contrato de enums (3 lados):** `scripts/gen-enums.mjs` gera `apps/web/lib/_enums.generated.ts` a partir
  de `Enums.cs`; `enums.contract.test.ts` compara o gerado com **espelhos escritos à mão na UI**. Adicionar
  enum sem tocar o espelho manual deixa o teste vermelho.

## Decisão (state-of-art + KISS — a menor mudança que satisfaz o aceite)

### D1 — N contas/marca: a marca é fixada no `OAuthState`; novas conexões INSEREM; seleção por precedência
O fluxo OAuth captura a marca **no início** (`connect-url` exige `X-Brand-Id`, grava `OAuthState.BrandId`),
não no callback. O `callback` (redirect sem header) deriva `{workspace, brand}` do **state consumido** —
mesmo princípio anti-CSRF já provado (nunca confiar em query param). O callback deixa de fazer upsert único
por workspace: **insere uma nova `InstagramAccount`** por conexão; só atualiza (em vez de inserir) quando o
**mesmo `IgUserId`** já existe **na marca do state** (reconectar a mesma conta = renovar token, não
duplicar). A conta-alvo na publicação resolve por `Content.TargetInstagramAccountId → IsPrimary da marca →
1ª conta conectada da marca`. O worker continua sem contexto de tenant (`SystemWorkspace=null`); o
isolamento na seleção vem dos **predicados explícitos** (`a.BrandId == content.BrandId && a.WorkspaceId ==
content.WorkspaceId`), como já é a regra do worker.

> **Alternativa descartada — derivar a marca no callback (marca-default/mais antiga).** É o que o código faz
> hoje, mas não satisfaz A1 (conectar em N marcas distintas) — o operador não escolhe a marca. Descartada:
> obriga uma única marca por workspace na prática. Fixar no `OAuthState` é a menor mudança que destrava A1.

> **Alternativa descartada — manter 1 conta/workspace e modelar "perfis" como rótulos.** Evitaria mexer no
> worker, mas contradiz o objetivo de publicar em N contas reais e o `BrandId` já existente em
> `InstagramAccount` ficaria decorativo. Descartada: não satisfaz o aceite e desperdiça modelo já existente.

> **Alternativa descartada — conta-alvo só por marca (sem override por pauta).** Mais simples, mas o
> requisito pede override opcional por pauta/conteúdo. O override é **um campo nullable**
> (`TargetInstagramAccountId`) com fallback à principal — custo marginal. Mantida a versão com override.

### D2 — `IsPrimary` na conta (não "default" em outra tabela)
A "conta principal da marca" é um flag `IsPrimary` em `InstagramAccount`, garantido único por marca via
transação no momento de marcar (set-all-false-then-true). KISS: sem tabela de relacionamento nem coluna
"defaultAccountId" em `Brand` (que exigiria FK e sincronização). Invariante "≤1 principal/marca" é regra
de aplicação coberta por teste (não unique index parcial — Postgres suporta, mas adiciona complexidade de
migration que o flag transacional dispensa).

### D3 — Fuso na borda; UTC no núcleo (não tocar o worker)
`TimeZoneId` (IANA) + janela vivem em **`Workspace`** (config global do cliente; um deploy/cliente). A
**conversão local↔UTC acontece na API/UI** ao agendar; `ScheduledFor` permanece UTC e o
`PublishSchedulerJob` **não muda** (continua comparando `<= now` UTC). A janela de publicação é **aviso**
(soft), não trava o agendamento manual (o operador manda).

> **Alternativa descartada — worker passa a converter por fuso.** Espalharia lógica de tempo pelo job e
> reabriria um caminho testado (idempotência/dispatch). Descartada: viola não-regressão; a borda é o lugar
> natural da conversão (o instante absoluto já está em UTC).

### D4 — Acesso por convite (token uso único), reusa o padrão do `OAuthState`
Convite = `UserInvite` (`TenantEntity`, herda `Guid Id` PK) com **`Token` em índice único** (token
aleatório), papel-alvo, workspace, TTL, `Consumed` — reusa o **padrão anti-replay** do `OAuthState`
(`ExecuteUpdate` condicional de uso único). (Nota: `OAuthState` **não** é `TenantEntity` e usa `State` como
PK; `UserInvite` é `TenantEntity`, então mantém `Guid Id` como PK e `Token` como coluna única — não se
mistura os dois modelos.) Auto-registro de 2º+ usuário em workspace existente é desligado; o 1º registro
continua criando workspace+Admin. `[Authorize(Roles="Admin")]` nos endpoints de gestão (igual ao
`MetaAppConfigController`).

### D5 — `AuditEntry`: tabela nova, append-only, escrita no ponto da ação
Tabela `AuditEntry` (`TenantEntity`) gravada **explicitamente** no handler de cada ação sensível (lista
fechada no aceite C2), não por interceptor mágico (auditar "tudo" seria ruidoso e acoplaria ao
`SaveChanges`). Append-only: sem update/delete. Autor = claim `sub` do JWT.

> **Alternativa descartada — auditoria via `ISaveChangesInterceptor` (como o tenant guard).** Capturaria
> tudo automaticamente, mas: (a) não sabe "quem" sem reler o JWT no interceptor (camada errada), (b) gera
> ruído (toda escrita vira auditoria), (c) acopla auditoria ao caminho crítico de persistência. KISS:
> escrita explícita nos ~6 pontos sensíveis enumerados. Descartada.

### D6 — Métricas: campo de origem + parse real
`PerformanceMetric` ganha `Source` (`Mock=0 | Real=1`). `FetchRealMetricAsync` passa a **parsear**
`data[].values[0].value` por métrica (`reach`,`likes`,`saved` → `Reach`,`Likes`,`Saves`). As **colunas
existentes continuam preenchidas**: `Engagement` segue sendo escrito (`= Likes + Saves` enquanto a Graph
não expõe um agregado estável), preservando o contrato atual do `PerformanceAnalyzer`. Sem token → mock com
`Source=Mock`; com token e parse OK → `Source=Real`. A UI rotula "simulado" quando `Source=Mock`. Nunca
métrica zerada silenciosa: parse vazio/falho → `return null` → cai no mock rotulado (comportamento atual
preservado, agora **honesto na UI**). **Este item é o único degradado por credencial** (precisa token IG).

## Modelo de dados / Contrato / UI

### Entidades (campos novos — todos aditivos)
```
InstagramAccount  + bool IsPrimary           // ≤1 true por marca (regra transacional)
Content           + Guid? TargetInstagramAccountId  // override por pauta; null = principal da marca
Workspace         + string TimeZoneId = "America/Sao_Paulo"   // IANA
                  + TimeOnly? PublishWindowStart, PublishWindowEnd  // hora local, aviso
PerformanceMetric + MetricSource Source = Mock        // novo enum: Mock=0, Real=1
OAuthState        + Guid? BrandId              // marca-alvo fixada no connect-url (null = states em voo)
UserInvite (TenantEntity)  { Guid Id (PK herdado), string Token (índice ÚNICO), string Email,
                             UserRole Role, DateTimeOffset ExpiresAt, bool Consumed }
AuditEntry (TenantEntity)  { Guid? BrandId, Guid ActorUserId, string ActorEmail,
                             string Action, string Target, DateTimeOffset OccurredAt }
```
Novo enum `MetricSource { Mock = 0, Real = 1 }` em `Enums.cs` → **sincronizar em 3 lados** (Enums.cs →
`gen-enums.mjs` → espelho manual da UI lido por `enums.contract.test.ts`).
`Content.TargetInstagramAccountId` e `OAuthState.BrandId` são `Guid`, **não** viram enum, então não tocam o
contrato de enums.

### Contrato API (novos/alterados)
```
GET    /api/instagram/connect-url              (Admin, X-Brand-Id)  → grava OAuthState{ws,brand}; 400 sem X-Brand-Id
GET    /api/instagram/accounts                 (X-Brand-Id)  → [{id,username,isConnected,tokenExpiresAt,isPrimary}]
POST   /api/instagram/accounts/{id}/disconnect (X-Brand-Id)  → 204 | 404
POST   /api/instagram/accounts/{id}/primary    (X-Brand-Id)  → 204  (flip transacional)
       (callback inalterado na rota; passa a derivar brand do state e a inserir N)
PATCH  /api/content/{id}  { targetInstagramAccountId }        (valida pertence à marca → 400 se não)
GET/PUT /api/workspace/settings { timeZoneId, publishWindowStart/End }
POST   /api/users/invite { email, role }       (Admin)        → { token, link }
POST   /api/auth/accept-invite { token, password, name }      → cria User (papel do convite)
GET    /api/users        (Admin) | DELETE /api/users/{id} (Admin, guard último Admin → 409)
GET    /api/history/publications | /generations  (X-Brand-Id, paginado)
GET    /api/audit        (Admin, paginado)
```
Status integers de `Content` **não mudam** (Enums.cs já sincronizado). Nenhum enum existente muda de valor.

### Worker (o ponto sensível — mudança cirúrgica)
- `PublishJob.cs:98-99` → resolver a conta por precedência:
  `account = byId(post.Content.TargetInstagramAccountId) ?? primaryOf(BrandId,WorkspaceId) ?? firstConnected(...)`,
  sempre com predicado `BrandId == post.Content.BrandId && WorkspaceId == post.WorkspaceId`. `SelectPublisher`
  recebe essa conta — **lógica Mock/Graph inalterada** (token válido → Graph; senão Mock). Isolamento
  segue dos predicados explícitos (worker é `SystemWorkspace=null` por design).
- `MetricsCollectorJob.cs:81` → mesmo resolver de conta (por marca do conteúdo) + parse real (D6) + `Source`.
- `PublishSchedulerJob` → **sem mudança** (UTC).

### UI (Next.js — sem IA)
Tela de contas (lista N, marcar principal, desconectar; o botão "conectar" envia `X-Brand-Id` da marca
corrente); seletor de conta-alvo na pauta/agendamento; config de fuso/janela; tela de membros + convite
(Admin copia o link); tela de histórico (publicações/gerações); badge "simulado" nas métricas mock.
Entregáveis de UI podem vir em incremento próprio sobre o backend (padrão ADR-0005); o aceite binário é
provável por HTTP + teste.

## Estratégia de migração (expand → migrate → contract; `Down()` reversível, provada em Postgres real)

```
Expand (uma migration, aditiva):
  ADD InstagramAccount.IsPrimary (bool, default false)
  ADD Content.TargetInstagramAccountId (uuid null, FK InstagramAccount, ON DELETE SET NULL)
  ADD Workspace.TimeZoneId (text, default 'America/Sao_Paulo'), PublishWindowStart/End (time null)
  ADD PerformanceMetric.Source (int, default 0 = Mock)   // linhas legadas = Mock (verdade histórica)
  ADD OAuthState.BrandId (uuid null)   // nullable: states em voo no deploy não têm brand → callback cai na marca-default
  CREATE TABLE UserInvite (com WorkspaceId; CREATE UNIQUE INDEX em Token), AuditEntry (com WorkspaceId, índices)
Migrate (data step idempotente):
  UPDATE: para cada (BrandId), marca IsPrimary=true na conta mais antiga conectada (1 por marca).
  (PerformanceMetric.Source já = Mock por default — coerente: o passado ERA mock.)
Contract: nenhum drop nesta fase (campos novos nullable/aditivos; sem coluna a remover).
Down(): DROP das colunas/tabelas/índices criados (reversível).
```
> `WorkspaceId` intacto em tudo; `TenantSaveInterceptor` e filtro global **não mudam**. Provar
> Up→Down→Up + no-op contra Postgres real (runbook `docs/sot/05-operacao.md`); backup antes em prod.

## Plano de teste (o aceite vira teste)

1. **.NET (`tests/SocialAi.Tests`):**
   - **A1/A2:** connect-url sem `X-Brand-Id` → 400; com `X-Brand-Id` grava `OAuthState{ws,brand}`; callback
     deriva brand do state e insere na marca certa; 2 contas na mesma marca persistem e listam; reconectar
     mesmo `IgUserId` na marca atualiza (não duplica); disconnect cross-brand/cross-workspace → 404;
     não-regressão de isolamento verde.
   - **A3:** resolver de conta-alvo no worker — override > principal > 1ª; conta de outra marca rejeitada
     na API (400).
   - **A4:** flip de `IsPrimary` desmarca a anterior (1 principal/marca); 1ª conexão nasce principal.
   - **A5:** conversão local→UTC ao agendar (09:00 −03:00 → 12:00Z); `ScheduledFor` segue UTC; scheduler
     job inalterado (teste existente verde).
   - **B1/B2:** Member convida → 403; Admin → 201 (devolve token+link); aceitar convite cria User com papel
     certo; guard do último Admin → 409.
   - **C1:** histórico paginado isolado por marca/workspace.
   - **C2:** aprovar conteúdo grava 1 `AuditEntry` com autor do JWT; não vaza entre workspaces.
2. **agents/web (vitest):** **3 lados** do enum — `gen-enums.mjs` re-gera `_enums.generated.ts` com
   `MetricSource`, o **espelho manual da UI** recebe `MetricSource`, e `enums.contract.test.ts` fica verde;
   `gen-enums --check` OK. UI rotula `Source=Mock` como "simulado".
3. **C3 (degradado por token):** payload fixo de `/insights` → `FetchRealMetricAsync` parseia
   `reach/likes/saved` corretamente (`Source=Real`, com `Engagement=Likes+Saves`); sem token → `MockMetric`
   com `Source=Mock`; parse vazio → `null` → mock rotulado (sem métrica zerada no analyzer).

## Riscos e mitigação
- **Marca errada na conexão** (conta cai na marca-default por falta de contexto) → marca fixada no
  `OAuthState` no connect-url (exige `X-Brand-Id`, 400 sem ela) e derivada do state consumido no callback;
  teste A1 cobre. States em voo durante o deploy (`BrandId` null) caem na marca-default — degradação
  conhecida e temporária (TTL de 10 min).
- **Worker publica pela conta errada** (regressão crítica do invariante de publicação) → resolver de conta
  com precedência explícita **testado** (A3) e sempre com predicado `BrandId+WorkspaceId`; `SelectPublisher`
  Mock/Graph **não muda**. Idempotência/dedup do `PublishJob` intactos.
- **Duas contas "principais" na mesma marca** → flip transacional (set-all-false→true) + teste A4;
  fallback do resolver tolera 0 principais (cai na 1ª conectada).
- **Parse de insights frágil** (Meta versiona a Graph) → parse defensivo; falha/vazio → `null` → mock
  rotulado (degrada honesto, nunca zera o learning). `Source` torna o degradado **visível**.
- **Fuso/horário de verão** → usar IANA (`America/Sao_Paulo`) com `TimeZoneInfo`/NodaTime na borda; UTC no
  banco evita ambiguidade no núcleo. Janela é aviso, não trava.
- **Convite reaproveitado (replay)** → token uso único com `ExecuteUpdate` condicional (padrão `OAuthState`
  já provado); `Token` em índice único.
- **Convite sem entrega** (sem provedor de e-mail no modo degradado) → Admin copia o link; e-mail fora de
  escopo desta fase, não bloqueia o fluxo.
- **Auditoria incompleta** (esquecer um ponto sensível) → lista fechada e enumerada no aceite C2; teste por
  ação. Append-only evita adulteração.
- **Enum dessincronizado** (esquecer o espelho manual da UI) → aceite D-enum trava os 3 lados; `gen-enums
  --check` + `enums.contract.test.ts` no CI.
- **Migration dupla** → uma única migration aditiva cobre todos os campos da fase; `Down()` reversível.

## Fora de escopo (outros ADRs/incrementos)
- **CRUD de Campanha** → ADIADO (YAGNI). `Content.CampaignId` já existe; conta-alvo por campanha
  reaproveita o mesmo resolver se/quando campanha voltar.
- **Entrega de convite por e-mail** (provedor SMTP/transacional) → futuro; nesta fase o Admin copia o link.
- **Fuso por marca** (TimeZoneId em `Brand`) → fora; o fuso é do `Workspace` (um deploy/cliente).
- **Janela de publicação como trava rígida / reagendamento automático** → futuro; nesta fase é só aviso.
- **Multi-workspace por usuário** (um usuário em N workspaces) → fora; convite é dentro de um workspace
  (um deploy/cliente — invariante de secrets).
- **Métricas avançadas** (impressões, profile_visits, séries temporais, dashboards) → futuro; esta fase
  fecha o parse de `reach/likes/saved` e a honestidade mock↔real.
- **Refresh de token multi-conta automatizado** → `IgTokenRefreshJob` já existe; estendê-lo para N contas é
  ajuste mecânico do mesmo loop (não exige decisão arquitetural nova).