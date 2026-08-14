---
adr: 0009
titulo: Conteúdo avançado & uso diário (iterar output com teto + feedback→aprendizado + re-tentar/operação)
status: aceito
data: 2026-06-15
---

# ADR-0009 — Conteúdo avançado & uso diário

> KISS/brownfield. Este ADR fatia o conjunto de funcionalidades de conteúdo avançado & uso diário em
> **3 blocos coesos ordenados por dependência** e marca o que depende de chave de IA (degradado). Cada
> item do aceite vira teste.
>
> - **Bloco A — Iterar o output:** instrução de regeneração no briefing, regenerar
>   conteúdo inteiro vs. um slide, feedback de rejeição vira sinal de aprendizado, comparar/escolher variação,
>   "testar marca". (Depende de chave de IA para *executar*; o contrato/UI funcionam degradados.)
> - **Bloco B — Custo, teto & variações:** estimativa de custo ANTES de gerar + saldo de budget +
>   N variações com teto e confirmação. **Pré-requisito do Bloco A para variações** (depende do registro
>   de gasto, que hoje só existe no loop autônomo).
> - **Bloco C — Operação diária:** ações em lote, ver falhas de publish + re-tentar manual,
>   loop de aprendizado VISÍVEL, notificações in-app derivadas de estado.

## Critério de aceite (binário — no topo)

**Bloco A — Iterar o output**
- [x] **A1** O contrato `POST /generate` aceita um campo tipado `regenerationInstruction?: string` em `GenerateRequest` (top-level, **não** dentro de `pauta`), com espelho em `AgentsGenerateRequest`. **Mudança de plumbing declarada:** `server.ts` já repassa o `body` inteiro a `runJob`; a assinatura de `adaptHttpToPipelineInput` passa a receber um 4º argumento opcional `regenerationInstruction?: string` (o orquestrador o propaga do `GenerateRequest`). O adapter o injeta **literalmente** no início de `content.additionalNotes`, prefixado por `Instrução de regeneração: `. Teste do adapter (nova assinatura): dado `regenerationInstruction="mais curto"`, `additionalNotes` contém a string `mais curto` verbatim.
- [x] **A2** `POST /api/content/{id}/regenerate` (body `{ instruction?: string }`) inicia um **novo** job de geração para o mesmo `pauta/brand` do Content original, devolve `{ contentId, jobId }` (mesmo contrato de `generate/async`), cria um **novo** `Content` (não muta o original), e a `instruction` chega ao adapter (A1). Conteúdo de outra marca → 404.
- [x] **A3** A regeneração de "um slide" é entregue como **regenerar o conteúdo inteiro com instrução dirigida ao slide N** (ver Decisão D2): `POST /api/content/{id}/regenerate` aceita `slideIndex?: int`; quando presente, a instrução efetiva inclui `Refaça apenas o slide {N+1}, preservando os demais.` e o teste do adapter confirma essa string em `additionalNotes`. **Não** existe endpoint que prometa regen isolada in-place de 1 slide (seria mentira — ver D2).
- [x] **A4** Ao rejeitar (`POST /api/approval/content/{id}/decide` com `Approved=false`), `Approval.Comments` (já existente) é persistido como **motivo**. `GET /api/learning/reject-feedback?pautaId={id}` devolve o **último** motivo de rejeição da marca para aquela pauta, resolvido por: `SELECT TOP 1 a.Comments FROM Approval a JOIN Content c ON c.Id=a.ContentId WHERE c.PautaId=@pautaId AND c.BrandId=@current AND a.Approved=false ORDER BY a.DecidedAt DESC`. `BuildAgentRequestAsync` injeta o resultado como nota (`Feedback de rejeição anterior: {comments}`) quando a pauta da geração tem rejeição prévia. Teste: rejeitar o Content X da pauta P com comentário → regenerar a partir de P → a requisição ao agents contém o comentário.
- [x] **A5** `GET /api/content?pautaId={id}` devolve todas as variações (Contents) da pauta para comparação lado a lado. `POST /api/content/{id}/choose` opera **apenas** sobre Contents da marca em estado decidível (`Draft|PendingApproval`): a escolhida vira `Approved` se o modo efetivo (ApprovalController.ResolveMode) for `Automatic`, senão `PendingApproval`; **todas as demais variações da mesma pauta** em `Draft|PendingApproval` viram `Rejected` com `Approval.Comments="Não escolhida na comparação"`; variações já `Published|EphemeralPublished|Scheduled|Failed|Generating` são **ignoradas** (não regridem). `choose` **não** cria `ScheduledPost` (agendamento é fluxo separado). Idempotente: chamar `choose` na já-escolhida é no-op (`204`). Conteúdo de outra marca → 404.
- [x] **A6** `POST /api/brand/test-sample` gera **1** exemplo (single-post) usando o BrandKit atual **sem** pauta real (tema sintético), devolve `{ contentId, jobId }`; o Content nasce com flag `IsSample=true` e **não aparece** na listagem normal (`GET /api/content` filtra `IsSample=false`). Sem chave de IA → o job falha com a mensagem clara já existente (degradado honesto).

**Bloco B — Custo, teto & variações**
- [x] **B1** `GET /api/budget` (workspace atual) devolve `{ monthlyCapUsd, spentThisMonthUsd, remainingUsd, autonomousLoopEnabled }`, somando `SpendEntry` do mês corrente. Sem `Budget` configurado → `monthlyCapUsd=0`, `remainingUsd=0` (não 500).
- [x] **B2** `GET /api/content/estimate?format={post|carousel|story}&count={n}` devolve `{ unitCostUsd, count, totalCostUsd, currency:"USD", isEstimate:true }` calculado de uma **tabela de custo por formato versionada em config** (`Generation:UnitCostUsd:*`), sem chamar a IA. **Fail-safe:** se a chave de config do formato estiver ausente ou `<=0`, usa-se o **default versionado em `appsettings.json`** (post=0.05, carousel=0.15, story=0.05 — ajustáveis), **nunca 0** (custo zero silencioso furaria o teto de B3). `count` é **clampado** a `[1, Generation:MaxVariations]` (default 5).
- [x] **B3** `POST /api/content/variations` (body `{ pautaId, format, count, confirm:true }`) só dispara se `confirm==true` **e** `count <= Generation:MaxVariations` **e** `totalCostUsd <= remainingUsd` (B1, usando o custo de B2 com o fail-safe). Códigos fixos e testados: sem `confirm` ou `count` acima do teto → `400` com motivo; saldo insuficiente → `402` com motivo. Cria N Contents (N jobs), cada um com a mesma pauta, devolve `[{contentId, jobId}]`.
- [x] **B4** Cada geração que **conclui com sucesso** (regenerate, variations, test-sample, generate/async) grava **exatamente 1** `SpendEntry{ AmountUsd=unitCost(format), BrandId, Reason="generate:{format}" }` no `Budget` do workspace. O registro é **idempotente e desacoplado do poll do cliente** (ver D3): a transição `Generating→Draft` que persiste o resultado e grava o `SpendEntry` ocorre tanto pela via do poll (`GET jobs/{jobId}`) quanto por um **reconciliador no worker** que detecta jobs `done` órfãos de poll. Dedupe garantido por **índice único `SpendEntry(ContentId, Reason)`** para gerações (entries do loop autônomo, sem `ContentId` de geração manual, ficam fora desse índice). `SpendEntry` ganha colunas `BrandId` (nullable) e `ContentId` (nullable, FK lógica para dedupe). Teste: gerar 1 carrossel → existe **1** `SpendEntry` com `Reason="generate:carousel"` e `BrandId` da marca atual, mesmo se o cliente parou de pollar antes do `done`.

**Bloco C — Operação diária**
- [x] **C1** `POST /api/approval/batch` (body `{ ids:[], action:"approve"|"reject", comments? }`) aplica a decisão a todos os Contents da marca atual em estado decidível (`Draft|PendingApproval`); ignora silenciosamente ids inválidos/de outra marca/estado errado e devolve `{ applied:[], skipped:[] }`. `POST /api/content/batch-delete` deleta os Contents da marca atual informados (cascata de slides) e devolve a mesma forma.
- [x] **C2** `GET /api/publishing/failures` lista `PublishLog{ Result=Error }` da marca atual (via `ScheduledPost→Content.BrandId`) com `{ logId, contentId, error, attempts, lastTriedAt }`. `POST /api/publishing/{logId}/retry` só atua sobre log `Result=Error` cujo `Content` **não** esteja `Published|EphemeralPublished`; reseta o log para `Result=Pending, Attempts=0, NextRetryAt=null, Error=null` **e** repõe o Content para `Approved` (se estava `Failed`), de modo que o `PublishJob` (consumidor de `Pending`) o reprocesse sem código novo no worker. Falhas permanentes (ex.: mídia inválida) podem reincidir — comportamento aceito e documentado. Log de outra marca → 404.
- [x] **C3** `GET /api/learning/insights` devolve, para a marca/workspace atual, `{ bestFormat, bestFormatAvgEngagement, bestWindow, bestWindowAvgEngagement, sampleSize }` derivado das mesmas regras do `PerformanceAnalyzer`; quando `sampleSize < 3` devolve `{ insufficientData:true }` (nunca números inventados). A UI mostra esses números + um botão "gerar mais assim" que leva ao `/create` (o **pré-preenchimento** do melhor formato via query param fica como ROADMAP — declarado na tela `insights/page.tsx`).
- [x] **C4** `GET /api/notifications` devolve uma lista **derivada de estado** (sem nova tabela): aprovações pendentes (Contents `PendingApproval`/`Draft` da marca), falhas de publish (`PublishLog.Error` via `ScheduledPost→Content.BrandId`), e token IG expirando (`InstagramAccount.TokenExpiresAt < now+7d`, já brand-scoped), cada item `{ kind, title, ref, severity }`. E-mail fica **fora de escopo** desta fase (ver D6 e "Fora de escopo").
- [x] **C5 (contrato)** Nenhum enum `.NET` muda de valor (`ContentStatus` já tem `Generating=1`, `Rejected=4`, `Failed=8` — verificado); se algum enum novo for necessário, `scripts/gen-enums.mjs` é re-rodado e o teste de contrato de enums (`apps/web/lib/enums.contract.test.ts`) passa.
- [x] **C6 (isolamento)** Todos os novos endpoints respeitam o triplo isolamento (`WorkspaceId` global filter + `TenantFilter` 403 sem claim + `TenantSaveInterceptor`) e a sub-chave `X-Brand-Id` via `BrandResolver`; um teste cross-brand cobre pelo menos `regenerate`, `variations`, `choose`, `publishing/retry` (acesso a recurso de outra marca → 404/403).

## Contexto

Estado real hoje (caminhos verificados):

- **Geração** é async fire-and-forget: `apps/api/Features/Content/ContentController.cs` (`generate/async` + `jobs/{jobId}`) → `AgentsClient` (`StartAsync`/`GetJobAsync`) → `services/agents/src/server.ts` (`POST /generate`→202+jobId, `GET /generate/:jobId`) → `jobs.ts` (`runJob`, store **in-memory**, não sobrevive a restart) → `pipeline-v2.ts` (orquestra os 6 agentes, **roda o carrossel inteiro de ponta a ponta**; não há entrada para regenerar 1 slide). **A transição `Generating→Draft` que persiste o resultado vive HOJE só dentro do `GET jobs/{jobId}` — disparada pelo poll do cliente** (ContentController.cs L131-169); se o cliente para de pollar, a transição só acontece via reaper (que marca `Failed` após 10min). Esse acoplamento ao poll é endereçado por D3.
- O **briefing** ao pipeline é montado em `input-adapter.ts` (`adaptHttpToPipelineInput(brandContext, pauta, format)`): `content.additionalNotes` já concatena contexto da pauta + `learningSummary` + categoria + concorrentes (linhas 102-111). É o ponto onde uma instrução de regeneração entra — **mas o adapter NÃO recebe o `GenerateRequest` inteiro hoje**, só os 3 campos; A1/D1 declaram a mudança de assinatura. O contrato de fronteira está em `services/agents/src/types.ts` (`GenerateRequest{ brandContext, pauta, format }`) e espelhado em `AgentsClient.cs` (`AgentsGenerateRequest`/`AgentsPauta`). `server.ts` já repassa o `body` completo a `createJob`/`runJob`.
- **Aprendizado**: `apps/api/Features/Learning/PerformanceAnalyzer.cs` agrega `PerformanceMetric` (pós-publicação) e produz o `learningSummary` textual injetado no `BrandContext`. **Não há controller** que exponha esses números à UI (ainda invisível). O **feedback de rejeição** não existe como sinal — `Approval.Comments` (em `Entities.cs`, L199) já guarda o texto ao rejeitar via `ApprovalController.Decide`, mas nada o lê de volta. **`Approval` não tem `PautaId`** — a ligação à pauta é via `Content.PautaId` (A4 define a junção).
- **Budget/custo**: `Budget` + `SpendEntry` existem em `libs/SocialAi.Core/Domain/Entities.cs` (L293-307). `SpendEntry` é gravado **apenas** pelo `apps/worker/Jobs/AutonomousLoopJob.cs`; o caminho de geração manual (api) **não registra gasto** e **não há `BudgetController`**. `SpendEntry` ainda **não tem `BrandId`** **nem `ContentId`** (necessário para o dedupe de B4). Não existe estimativa de custo em lugar nenhum.
- **Publicação/falhas**: `PublishLog` (em `Entities.cs`, L215) carrega `Result{Pending|Success|Error|Skipped}`, `Attempts`, `NextRetryAt`, `Error`. O `apps/worker/Jobs/PublishJob.cs` consome `Pending` pronto (`NextRetryAt==null || <=now`) com retry/backoff automático para falhas **transitórias**; falha permanente/esgotada vira `Error` + `Content.Status=Failed`. Há **dedup de negócio**: se já existe `Success` para o `ScheduledPostId`, novo log vira `Skipped` (L86-96). **Re-tentar manual** = repor um `Error` para `Pending` + `Content→Approved` (o worker já faz o resto). Não há endpoint para listar/retentar.
- **Lote/notificações**: `ApprovalController` decide 1 a 1; não há ação em lote. Não há entidade nem controller de notificação. A trilha de auditoria (dependência das notificações) **ainda não existe**.
- **Enums** crus `.NET`↔TS: fonte é `libs/SocialAi.Core/Domain/Enums.cs`; gerador `scripts/gen-enums.mjs`; teste de contrato `apps/web/lib/enums.contract.test.ts`. `ContentStatus` já tem `Generating=1`, `Rejected=4`, `Failed=8` — **nada novo é necessário** para esta fase.

## Decisão

Esta entrega traz **3 blocos coesos**. O fio condutor é a **reutilização do pipeline existente como caixa-preta**: nenhuma das features novas modifica os 6 agentes nem o store de jobs; elas (a) enriquecem o briefing por um campo tipado, (b) multiplicam chamadas com governança de custo, e (c) operam sobre estado já persistido (`PublishLog`, `Approval`, `PerformanceMetric`).

### D1 — Iterar = novo job + instrução no briefing, nunca mutação in-place
Regenerar (com instrução, ou variar) é **disparar o mesmo pipeline com `regenerationInstruction` no contrato**, criando um **novo `Content`**. A instrução entra como campo **tipado de primeira classe** em `GenerateRequest` (não escondida dentro de `pauta`). **Plumbing declarado:** como `adaptHttpToPipelineInput` hoje só recebe `(brandContext, pauta, format)`, sua assinatura ganha um 4º argumento opcional `regenerationInstruction?`; `pipeline-v2.ts`/`runJob` propagam o campo do `body` (já disponível em `server.ts`). O adapter o concatena verbatim no início de `additionalNotes`.
- *Alternativa descartada:* mutar o `Content` original e regenerar slides "no lugar". Rejeitada: perde o histórico/comparação (o requisito de comparação exige variações coexistindo) e cria corrida com o poll de status (`jobs/{jobId}` já tem lógica atômica Generating→Draft frágil a duplicação). Novo Content é mais simples e habilita a comparação de variações de graça.
- *Alternativa descartada:* carregar a instrução dentro de `pauta`. Rejeitada: polui o tipo de domínio `Pauta` com um campo efêmero de UI e quebra a coesão do contrato (a instrução é da *requisição*, não da pauta persistida).

### D2 — "Regenerar um slide" = regenerar tudo com instrução dirigida, e ser honesto sobre isso
O `pipeline-v2.ts` não tem entrada para produzir só o slide N preservando os demais (cada agente consome a saída do anterior para o carrossel inteiro). Construir regen-isolada-real exigiria reescrever o orquestrador, persistir estado intermediário do pipeline por slide e re-render parcial — **fora do orçamento KISS** e de alto risco. Entregamos a **promessa que conseguimos cumprir de verdade**: `slideIndex` vira a instrução `Refaça apenas o slide {N+1}, preservando os demais.`; o pipeline faz o melhor esforço; a UI substitui o slide N do Content na escolha. O critério A3 proíbe explicitamente prometer regen isolada in-place.
- *Alternativa descartada:* regen isolada real do slide N. Rejeitada agora por custo/risco; registrada como evolução futura (precisa de pipeline com checkpoints por slide). KISS: a menor mudança que satisfaz a necessidade do usuário ("o slide 3 ficou ruim").

### D3 — Custo é estimativa por tabela versionada em config; gasto é registrado no resultado, desacoplado do poll
Não chamamos a IA para estimar custo (seria caro e não-determinístico). Uma **tabela `Generation:UnitCostUsd:{post|carousel|story}`** em config (a verdade versionada, "arquivo versionado é a verdade") dá `estimate`, com **default versionado e não-zero** quando a chave falta (evita custo silencioso = teto furado).

O **gasto real** é gravado como `SpendEntry` no instante em que o `Content` efetivamente recebe o resultado (`Generating→Draft`), **não no instante do poll**. Como hoje essa transição vive só no `GET jobs/{jobId}` (dependente do navegador), introduzimos um **reconciliador no worker** (estende o reaper existente): a cada tick, para Contents presos em `Generating` cujo job no agents está `done`, faz a transição (persiste slides + caption + score) e grava o `SpendEntry`. O caminho do poll continua funcionando para feedback imediato. **Idempotência por índice único `SpendEntry(ContentId, Reason)`** garante que poll e reconciliador nunca dupliquem. `SpendEntry` ganha `BrandId` e `ContentId` (dedupe); `Reason="generate:{format}"`. Agregação por workspace (B1) soma o mês corrente.
- *Alternativa descartada:* gravar o gasto dentro do `ExecuteUpdateAsync` do poll apenas. Rejeitada: gerações bem-sucedidas porém não-polladas (aba fechada) nunca registrariam gasto — o teto vazaria e o invariante de B4 seria falso. O reconciliador fecha o buraco sem acoplar o billing ao navegador.
- *Alternativa descartada:* medir tokens reais do provider por chamada e converter em USD. Rejeitada nesta fase: o pipeline não expõe contagem de tokens por agente de forma confiável e o objetivo de produto é **teto + previsibilidade**, não contabilidade fiscal. Tabela por formato é suficiente.

### D4 — Variações com teto: gate no controller, antes de qualquer job
O teto (`Generation:MaxVariations`, default 5) e o saldo (`remainingUsd`) são verificados **no `POST /api/content/variations` antes de disparar qualquer job** (B3), usando o custo de B2 (com fail-safe não-zero). `confirm:true` é obrigatório (`400` sem ele); saldo insuficiente → `402`. Comparar/escolher reusa `GET /api/content?pautaId=` (variações são Contents da mesma pauta) e `choose` promove uma (conforme modo efetivo) e arquiva as outras decidíveis.
- *Alternativa descartada:* enfileirar N e validar custo job a job no worker. Rejeitada: estoura budget antes de cortar e espalha a regra de negócio. Gate único no ponto de entrada é mais simples e seguro (KISS + falha-cedo).

### D5 — Re-tentar publicação = repor `Error`→`Pending`, reusando o worker
O `PublishJob` já é um consumidor idempotente de `PublishLog.Pending` com dedup por `Success`. Re-tentar manual **não escreve código novo no worker**: o endpoint (só para `Error` cujo Content não está publicado) reseta o log (`Pending`, `Attempts=0`, `NextRetryAt=null`, `Error=null`) e repõe `Content.Approved` se estava `Failed`. O próximo tick publica. Falha permanente reincide — aceito e documentado.
- *Alternativa descartada:* publicar sincronicamente dentro do request da API. Rejeitada: duplica a lógica de mídia/publisher do worker e quebra o invariante "fila de publicação = `PublishLog` no Postgres, consumida pelo worker".

### D6 — Notificações = projeção de estado, sem nova tabela; e-mail fora de escopo
As notificações dependeriam de uma trilha de auditoria, que **não existe ainda**. Em vez de bloquear ou inventar infraestrutura de fila de e-mail, entregamos o que é verificável e útil hoje: um `GET /api/notifications` que **deriva** alertas do estado já persistido (pendências, falhas, token expirando). Sem tabela, sem job, sem regressão. E-mail e auditoria-trail ficam para uma fase de operação posterior — declarado honestamente.
- *Alternativa descartada:* tabela `Notification` + envio de e-mail (SMTP) nesta fase. Rejeitada: acopla à trilha de auditoria inexistente e adiciona infra (fila/credenciais SMTP) desproporcional ao aceite. Projeção de estado é a menor coisa que entrega valor real.

## Modelo de dados / Contrato de API / UI

**Schema (3 colunas novas, todas aditivas):**
- `SpendEntry.BrandId : Guid?` **nullable**. Sem backfill obrigatório (entries antigas do loop ficam null = "workspace-wide").
- `SpendEntry.ContentId : Guid?` **nullable** — habilita o dedupe de B4. **Índice único `(ContentId, Reason)` filtrado para `ContentId IS NOT NULL`** (entries do loop autônomo, sem ContentId, não colidem).
- `Content.IsSample : bool` (default `false`) — exclui exemplos de teste-marca da listagem normal (A6).
- *(Nenhum enum novo. `ContentStatus.Generating/Rejected/Failed` já existem.)*

**Contrato agents (`services/agents/src/types.ts` + `AgentsClient.cs`):**
- `GenerateRequest` ganha `regenerationInstruction?: string` (e o espelho `AgentsGenerateRequest`). `server.ts` já repassa o `body` a `runJob`; `pipeline-v2.ts` propaga o campo ao adapter.
- `adaptHttpToPipelineInput(brandContext, pauta, format, regenerationInstruction?)` — **assinatura nova**; injeta no início de `additionalNotes`: `Instrução de regeneração: {instruction}` e, se `slideIndex` veio embutido na instrução, a frase de D2.

**Endpoints novos (api, todos `[Authorize]`, escopados por `X-Brand-Id`):**
- `POST /api/content/{id}/regenerate` `{ instruction?, slideIndex? }` → `{ contentId, jobId }` (A2/A3)
- `POST /api/content/variations` `{ pautaId, format, count, confirm }` → `[{ contentId, jobId }]` (B3); `400`/`402` conforme gate
- `POST /api/content/{id}/choose` → `204` (A5)
- `GET  /api/content?pautaId=` → variações (A5); `GET /api/content` passa a filtrar `IsSample=false` (A6)
- `GET  /api/content/estimate?format=&count=` → custo estimado, fail-safe não-zero (B2)
- `POST /api/brand/test-sample` → `{ contentId, jobId }` (A6)
- `GET  /api/budget` → saldo (B1)
- `GET  /api/learning/insights` → formato/janela (C3); `GET /api/learning/reject-feedback?pautaId=` (A4)
- `POST /api/approval/batch`, `POST /api/content/batch-delete` (C1)
- `GET  /api/publishing/failures`, `POST /api/publishing/{logId}/retry` (C2)
- `GET  /api/notifications` (C4)

**Config nova (`appsettings`/env):** `Generation:UnitCostUsd:{Post|Carousel|Story}` (decimais, com defaults versionados não-zero), `Generation:MaxVariations` (default 5).

**UI (`apps/web`, PT-BR):** botão "Regenerar" com campo de instrução livre (lib `content.ts`); "Refazer este slide" no slide N; tela de comparação de variações (grid) com "Escolher"; modal de "Gerar variações" mostrando **custo estimado + saldo** e exigindo confirmação; banner de **modo simulado/sem chave** quando estimativa existe mas geração falha por falta de chave (degradado); tela "Falhas de publicação" com "Re-tentar"; cartão de **insights** ("formato/janela de maior engajamento" + "gerar mais assim"); sino de notificações lendo `GET /api/notifications`; ações em lote (checkbox + aprovar/rejeitar/excluir) na tela de aprovações.

## Estratégia de migração (expand → migrate → contract)

Mudança de schema é **puramente aditiva** — não há contract destrutivo nesta fase.
- **Expand:** migration `AddSpendBrandContentAndSample` adiciona `SpendEntry.BrandId` (nullable), `SpendEntry.ContentId` (nullable) + **índice único filtrado `(ContentId, Reason)` WHERE `ContentId IS NOT NULL`**, e `Content.IsSample` (bool, default `false`). `Down()` remove índice e colunas (reversível). Sem backfill: `BrandId/ContentId` null = gasto não atribuído a marca/conteúdo (compatível com o loop autônomo atual).
- Migration em `libs/SocialAi.Core/Migrations` (`--project libs/SocialAi.Core --startup-project apps/api`); provada contra Postgres real (up+down). `DesignTimeDbContextFactory` passa `WorkspaceId=null` (sem tenant) — inalterado.
- Sem mudança no `TenantSaveInterceptor` (as colunas novas não afetam o carimbo de `WorkspaceId`).

## Plano de teste (o aceite vira teste)

- **Adapter (Vitest, `input-adapter.test.ts`)**: A1 (instrução literal em `additionalNotes`, **chamando a nova assinatura de 4 args**), A3 (frase de slide dirigido), A4 (feedback de rejeição na nota). Determinístico, sem IA.
- **API (`tests/SocialAi.Tests`, contra Postgres real)**: A2/A5/A6 (cria novo Content, choose promove conforme modo efetivo e arquiva irmãs decidíveis, sample fora da lista), B1/B2/B3 (saldo, estimativa clampada e fail-safe não-zero, gate de teto/confirm/budget → `400`/`402`), B4 (**SpendEntry único** com `BrandId`+`ContentId`+`Reason`; gravado pelo reconciliador mesmo sem poll; índice único barra dupla contagem), C1 (batch applied/skipped), C2 (retry só sobre Error não-publicado; repõe Pending+Approved; worker reprocessa), C3 (`insufficientData` quando sample<3; números quando ≥3), C4 (projeção de estado).
- **Isolamento (C6)**: teste cross-brand para `regenerate`/`variations`/`choose`/`publishing/retry` → 404/403 (reusa o padrão dos testes de isolamento existentes).
- **Contrato (C5)**: `enums.contract.test.ts` continua verde (nenhum enum mudou).
- **Custo estimado vs. gravado**: assert que `estimate.totalCostUsd == count * unitCost(format)` (com fail-safe) e que cada conclusão grava **exatamente 1** `SpendEntry` por Content (índice único `(ContentId, Reason)` é a rede final contra poll concorrente + reconciliador).

## Riscos e mitigação

- **Dupla contagem de gasto** (poll + reconciliador, ou dois polls na janela do `done`): mitigada pelo **índice único `SpendEntry(ContentId, Reason)`** — a segunda inserção falha e é absorvida (mesmo padrão do índice único de slide). O billing não depende mais de "quem ganha a corrida do poll".
- **Gasto não registrado por aba fechada**: mitigado pelo reconciliador no worker (D3) — a conclusão do job no agents é a fonte de verdade do gasto, não o navegador.
- **Custo zero silencioso por config faltante**: mitigado pelo default versionado não-zero em B2 (fail-safe), garantindo que o gate de B3 nunca libere por estimativa=0.
- **Variações estouram custo real** (estimativa ≠ real): o teto é por **contagem** (`MaxVariations`) e por **saldo estimado**; como o custo é tabelado, estimativa = real por construção nesta fase. Quando houver medição de tokens reais, a tabela vira piso e revisita-se.
- **Regenerar um slide frustra expectativa** ("achei que regenerava só o slide"): mitigado por D2 + A3 (UI diz "refaz o conteúdo priorizando o slide N") — honestidade sobre a limitação, não promessa falsa.
- **Notificações parecem incompletas sem e-mail**: declarado em escopo; `GET /api/notifications` é a base que uma fase posterior estende com push/e-mail/auditoria.
- **Job in-memory perde a regeneração no restart**: já coberto pelo reaper/janela de 10min no `JobStatus` (Content preso em Generating → Failed) — sem regressão; o usuário re-tenta. (O reconciliador só age sobre jobs ainda `done` no agents.)
- **`SpendEntry.BrandId/ContentId` nullable indefinidamente**: aceito nesta fase (loop autônomo grava sem marca/contentId de geração manual). Contract para NOT NULL fica para quando o loop também atribuir marca (fora de escopo).

## Fora de escopo

- Regeneração **isolada real** de 1 slide preservando os demais (precisa de pipeline com checkpoints por slide) — D2.
- Medição de **custo por tokens reais** do provider (aqui entrega-se só o registro de gasto por formato) — D3.
- **E-mail/push** e trilha de **auditoria** por trás das notificações — D6; `GET /api/notifications` é projeção de estado apenas.
- Override de **prompts por workspace** (atrás de feature-flag desligado) — não tocado.
- CRUD de **Campanha** (adiado/YAGNI).
- Contract de `SpendEntry.BrandId`/`ContentId`/`Campaign.BrandId` para NOT NULL — adiado.

## Divergências ADR↔código — resolvidas

- **A4 — GET dedicado adicionado (não só injeção).** O backend inicial cumpria o *intento* de A4 (o
  feedback de rejeição chega à engine via injeção no briefing), mas faltava o `GET
  /api/learning/reject-feedback?pautaId=` da *letra* do aceite. **Resolvido:** a regra foi extraída
  para `RejectFeedbackService` (dono único, padrão do `GenerationCompletionService`), reusada pela
  injeção no briefing (`ContentController`) e pelo novo endpoint brand-scoped no `LearningController`.
  Fecha a letra de A4 e serve a UI. Coberto por `Fase7RejectFeedbackTests` (inclui isolamento cross-brand).

- **`UsageCostEstimator` (custo por tokens) — preservado como semente da medição por tokens, não removido.** Ficou
  órfão dos endpoints ativos (substituído por `GenerationCostService`, custo por formato).
  **Decisão:** manter o código + teste (`UsageCostEstimatorTests`) e declarar como dívida
  para a futura medição de custo por tokens reais do provider (D3). Remover agora trocaria dívida ínfima
  (carga) por dívida de reconstrução e baixaria a baseline de testes sem ganho. Reversível.

- **`Reason` de `SpendEntry` migrou** de `geracao:{provider}` (ADR-0008 C2) para `generate:{format}`
  (B4): o reconciliador computa o custo a partir de `Content.Type` sem decifrar segredo. `UsageController`
  agrega por `Reason` agnosticamente — sem regressão.

- **4º arg do adapter consolidado em `AdapterOptions` (objeto), não `regenerationInstruction?: string` nu.**
  A letra do A1/D1/§Contrato descreve um 4º arg `string`; o código usa
  `adaptHttpToPipelineInput(brandContext, pauta, format, opts?: AdapterOptions)` com
  `AdapterOptions { templates?, regenerationInstruction? }` (`input-adapter.ts`). Motivo: o objeto já
  carregava `templates` (ADR-0008 D) — empilhar outro posicional seria frágil; objeto é KISS/extensível.
  Efeito idêntico ao aceite A1 (instrução verbatim no início de `additionalNotes`); coberto por
  `input-adapter.test.ts` (A1/A3) e `d-e-integration.test.ts` (templates).

- **A5 idempotência — precisão da redação.** "chamar `choose` na já-escolhida é no-op (204)" vale
  *literalmente* no modo `Automatic` (early-return em `Approved`). No modo `Manual` (default), a escolhida
  fica `PendingApproval` e um `choose` repetido re-executa o corpo, mas é **idempotente em efeito**:
  reescreve `PendingApproval→PendingApproval` e as irmãs já `Rejected` ficam fora do filtro de arquivamento
  (`Draft|PendingApproval`) — mesma saída `204`, zero mutação observável. Sem mudança de código.

## Bug latente pego pela rede de testes

Os testes de aceite B3 (saldo) revelaram um **bug real, latente desde o Bloco B** e nunca coberto:
`ContentController.SaldoRestanteDoMesAsync` e `BudgetController.Get` filtravam `SpendEntry` por
`OccurredAt` (`DateTimeOffset`) **no SQL**. O SQLite não traduz comparação de `DateTimeOffset` sob o
filtro global de tenant (GOTCHA 4 do codebase) → `InvalidOperationException` em qualquer chamada com
`Budget` presente. **Fix:** materializar (valor + data) e filtrar/somar em memória, padrão já usado em
`PerformanceAnalyzer`/`NotificationsController`. Portável Postgres↔SQLite. Lição: escrever o teste do
aceite *junto* com o endpoint teria pego isto no Bloco B.