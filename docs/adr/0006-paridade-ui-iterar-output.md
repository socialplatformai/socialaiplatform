---
adr: 0006
titulo: Paridade UI + iterar sobre o output (editar/detalhar pauta, modo de aprovação por conteúdo, regenerar, editar texto, exportar, promover ideia)
status: aceito
data: 2026-06-15
---

# ADR-0006 — Paridade UI + iterar sobre o output

> Fecha o **gap de operação**: o backend de pauta (PUT/GET) e de modo de aprovação por conteúdo
> (`ApprovalModeOverride` + `ResolveMode`) **já existem** mas não têm UI; o loop autônomo cria
> `IdeaCandidate` **sem porta de saída** (nenhum endpoint as promove); e o operador **não consegue
> iterar** sobre um conteúdo gerado (regenerar, corrigir o texto, baixar os arquivos). Esta fase entrega
> a UI faltante (E4) e os 3 verbos de iteração mais pedidos (E11.1/3/5). Depende de E1 (marca, ADR-0002),
> E2 (ADR-0005) e E3 (ADR-0003), todos aceitos. **A menor mudança por épico** — três dos sete épicos são
> UI pura sobre endpoint pronto.

## Critério de aceite (binário — no topo)

> Agrupado em 3 incrementos coesos, ordenados por dependência. Cada item vira teste (HTTP + Vitest UI).

### Incremento A — Paridade UI sobre backend pronto (sem IA, sem schema)
- [x] **E4.1 — Editar pauta:** na tela de pautas, abrir uma pauta em modo edição, alterar título e
      objetivo, salvar → `PUT /api/pautas/{id}` persiste; reabrir mostra os valores novos. (Endpoint já
      existe — `PautaController.Update`; **só falta UI + cliente `pautaApi.update`**.)
- [x] **E4.3 — Detalhe da pauta:** abrir uma pauta exibe **todos** os campos (título, objetivo, contexto,
      prioridade, categoria, objetivo de marketing, tipo desejado, data sugerida, status) **e os anexos**
      (lista de `referenceContext` url+rótulo). (Endpoint `GET /api/pautas/{id}` já existe; **só UI**.)
- [x] **E4.2 — Modo de aprovação por conteúdo:** na tela de um conteúdo, um Admin define o modo
      (`Manual`/`Automatic`/herdar) → `PUT /api/approval/mode/content/{id}` persiste; o modo **efetivo**
      (lido em `GET /api/approval/content/{id}/mode`) passa a ser o do conteúdo, **sobrepondo o do
      workspace** (precedência conteúdo > campanha > workspace, via `ResolveMode`). Não-Admin recebe 403.
      (Ambos os endpoints já existem; **só UI**.)

### Incremento B — Iterar sobre o output (E11.3/E11.5: sem IA; E11.1: depende de IA)
- [x] **E11.3 — Editar o texto gerado:** num conteúdo em `Draft` **ou** `PendingApproval`, editar a `Copy`
      de cada slide e a `Caption`/`Cta`/`Hashtags` do conteúdo → `PUT /api/content/{id}/slides` persiste; o
      texto editado é o que vai para publicação (o worker lê os mesmos campos). **Conjunto-permitido
      explícito:** edição vale **apenas** em `{Draft, PendingApproval}`; **qualquer outro status**
      (`Generating`, `Approved`, `Rejected`, `Scheduled`, `Published`, `EphemeralPublished`, `Failed`) →
      **409**. **Não depende de chave de IA.**
- [x] **E11.5 — Exportar:** `GET /api/content/{id}/export.zip` devolve um ZIP com **as imagens dos slides
      (JPEG) + um `legenda.txt`** (caption + CTA + hashtags). Slides sem imagem são omitidos sem quebrar.
      Conteúdo de outra marca → 404. O endpoint é `[Authorize]` e escopado por marca — a UI **baixa via
      `fetch` autenticado** (Authorization Bearer + X-Brand-Id), nunca por `<a href>` cru. **Não depende de
      chave de IA** (usa o que já está gerado).
- [x] **E11.1 — Regenerar:** num conteúdo ligado a uma pauta, `POST /api/content/{id}/regenerate` inicia
      **nova geração da MESMA pauta** (mesmo contrato async: `{ contentId, jobId }` + poll), criando um
      **novo `Content`** com o mesmo `PautaId`/`BrandId` — **sem recriar a pauta** e sem apagar o anterior.
      Concorrência da mesma pauta em `Generating` → 409 (regra C4 reusada). **Depende de chave de IA**
      (degradado: erro claro do pipeline, idêntico a `generate/async`).

### Incremento C — Fechar a porta do loop (E4.4: sem IA)
- [x] **E4.4 — Promover IdeaCandidate:** `POST /api/ideas/{id}/promote` cria uma **`Pauta`** (na marca
      atual do request — X-Brand-Id, `Status=Backlog`) a partir da ideia (`Title`→título,
      `Rationale`→objetivo/contexto, `SuggestedType`→`DesiredType`), marca `IdeaCandidate.Promoted=true` e
      devolve a `PautaDto` criada. `GET /api/ideas` lista as não-promovidas; a UI tem um botão "Promover"
      que abre a pauta resultante. Ideia já promovida → 409. **O loop deixa de ser "sem porta".** Não
      depende de chave de IA.

### Invariantes (não-regressão — verde obrigatório)
- [x] **Isolamento intacto:** todo endpoint novo escopa por `WorkspaceId` (filtro global +
      `TenantSaveInterceptor`) **e** pela marca atual (`BrandResolver`/X-Brand-Id, 403 cross-workspace,
      404 cross-brand), como os irmãos no mesmo controller. Testes cross-brand/cross-workspace cobrem os
      4 endpoints novos.
- [x] **Enums em sincronia:** nenhum enum novo; nenhuma mudança em `Enums.cs` ⇒ o contrato E0.3 segue
      verde sem tocar `_enums.generated.ts`.
- [x] **Worker intocado:** `AutonomousLoopJob` **não muda** nesta fase — segue criando `IdeaCandidate`
      com `BrandId=null` (a coluna nasce nullable só para o promote/futuro). Zero acoplamento novo worker.

## Contexto (estado real hoje)

- **Pauta:** `PautaController` (`apps/api/Features/Pautas/PautaController.cs`) já tem `GET /{id}` (linha 69,
  com `Include(Attachments)`) e `PUT /{id}` (linha 110, persiste título/objetivo/contexto/prioridade/
  categoria/objetivo-mkt/tipo/data). O cliente web `apps/web/lib/pautas.ts` **não expõe `update` nem `get`**;
  a tela `apps/web/app/(app)/pautas/page.tsx` só lista/cria/muda-status/remove. → **E4.1/E4.3 = UI pura.**
- **Modo de aprovação:** `ApprovalController` (`apps/api/Features/Approval/ApprovalController.cs`) já tem
  `PUT mode/content/{id}` (linha 107, Admin-only), `GET content/{id}/mode` (linha 120, modo efetivo) e
  `ResolveMode` (linha 36: `content > campaign > workspace`). `Content.ApprovalModeOverride` existe
  (`Entities.cs:172`). → **E4.2 = UI pura.** (DEC-9: **sem CRUD de campanha** — a UI expõe só os níveis
  conteúdo e workspace; campanha permanece no backend como nível intermediário herdável, sem tela.)
- **Conteúdo:** `ContentController` (`apps/api/Features/Content/ContentController.cs`) só tem
  `List`/`generate/async`/`jobs/{jobId}`/`Get`. **Não há** regenerar, editar texto, nem export. A regra
  C4 de concorrência (linha 64: `pauta + Status==Generating` → 409) e a transição `pauta→InProgress`
  (linha 96) vivem em `GenerateAsyncStart`. `ContentSlide.Copy` é **uma string por slide**
  (`Entities.cs:187`), não campos estruturados; o conteúdo carrega `Caption`/`Cta`/`Hashtags` no próprio
  `Content`. Vários `Content` **já podem** apontar para a mesma `PautaId` (FK nullable, sem unique) — **não
  existe conceito de versão**.
- **Imagem/Export:** `ContentSlide.ImageUrl` é **data-url (base64 PNG/JPEG) ou URL** (vindo do
  `render-engine`). A conversão PNG→JPEG via `SixLabors.ImageSharp` e o MinIO **só existem no worker**
  (`apps/worker/Publishing/MediaService.cs`; `ImageSharp` referenciada **só** em `Worker.csproj`); a
  **API e o `SocialAi.Core` não referenciam ImageSharp nem MinIO**.
- **Auth/marca no web:** `apps/web/lib/api.ts` anexa `Authorization: Bearer <token do localStorage>` **e**
  `X-Brand-Id` **apenas** dentro do wrapper `api()`/`fetch`. Logo, qualquer chamada autenticada/escopada
  por marca **tem que passar por `fetch` com esses headers** — uma navegação por `<a href>` não os carrega
  (browser não envia header custom nem token de localStorage em link). **Isto define o shape do cliente de
  export.**
- **Loop/Ideia:** `AutonomousLoopJob` (`apps/worker/Jobs/AutonomousLoopJob.cs:101`) cria `IdeaCandidate`
  com `Promoted=false` e **`WorkspaceId` apenas — `IdeaCandidate` NÃO tem `BrandId`** (`Entities.cs:258`);
  `RunForWorkspaceAsync` só conhece `wsId` e **não tem `BrandResolver`/`ICurrentBrand`** (são API-only).
  **Nenhum endpoint** lê/promove ideias. → o loop é uma "fila sem saída".

## Decisão (KISS)

### D1 — Regenerar = novo `Content` na mesma `PautaId` (não versiona campo, não muta no lugar)
`POST /api/content/{id}/regenerate` resolve a `PautaId` do conteúdo de origem e **delega ao mesmo caminho
de `generate/async`** (reuso total: validação de marca, regra C4 de concorrência, transição
`pauta→InProgress`, `BuildAgentRequestAsync`, correlação jobId↔Content). Nasce um **novo `Content`** (mesmo
`PautaId`/`BrandId`/`Type`), o anterior é preservado. A UI mostra os conteúdos da pauta ordenados por
`CreatedAt desc` ("o mais recente é o atual").

> **Alternativa descartada — coluna `Version` + `ParentContentId` + "conteúdo ativo".** Introduz schema,
> migração, e a pergunta "qual versão publica?". YAGNI agora: a relação `Content.PautaId` 1:N **já** modela
> "várias gerações da mesma pauta"; ordenar por data resolve o aceite. Versionamento explícito (diff entre
> versões, rollback) vira ADR próprio se a operação pedir. **KISS vence.**

> **Estado da pauta ao regenerar:** reusa a transição existente — a pauta vai a `InProgress` ao iniciar e a
> `Done` ao concluir, exatamente como `generate/async` já faz (`ContentController:96,158`). Consequência
> intencional: regenerar um conteúdo cuja pauta já estava `Done` **reverte a pauta para `InProgress`** até
> a nova geração concluir (volta a `Done`). É reuso deliberado da transição existente, não estado novo.

### D2 — Editar texto = `PUT /api/content/{id}/slides` sobre `Copy` + `Caption/Cta/Hashtags` (string, não campos)
Um único endpoint recebe `{ caption?, cta?, hashtags?, slides: [{ index, copy }] }` e sobrescreve os campos
de texto **do conteúdo já gerado**. **Permitido apenas em `{Draft, PendingApproval}`; qualquer outro status
→ 409** (espelha a guarda G3 do `ApprovalController.Decide`, ampliada para o conjunto completo de status
não-editáveis). O worker já publica a partir de `Content.Caption/Cta/Hashtags` e `ContentSlide.Copy` — **o
texto editado vai para publicação sem outro toque.**

> **Alternativa descartada — decompor `Copy` em headline/corpo/CTA por slide.** O épico cita
> "headline/corpo/legenda/CTA por slide", mas hoje `ContentSlide.Copy` é **uma string** e o pipeline
> (copywriter→render) trata cada slide como um bloco. Estruturar exigiria schema novo no slide, mudança no
> contrato agents e no `render-engine`. **Descartada por escopo:** editar a string `Copy` inteira (mais
> `Caption/Cta/Hashtags` do conteúdo, que **são** campos distintos) satisfaz o aceite "editar o texto
> gerado e persistir". Edição por-campo estruturada fica **fora de escopo** (futuro).

### D3 — Export = ZIP montado na API a partir de `ImageUrl` as-is + `legenda.txt`
`GET /api/content/{id}/export.zip` lê os slides, escreve cada `ImageUrl` decodificado (data-url→bytes; se
for URL http, baixa via `HttpClient`) como `slide-{index}.jpg` e um `legenda.txt` (caption + CTA +
hashtags), usando `System.IO.Compression.ZipArchive` (BCL, zero dependência nova). Devolve
`application/zip` com `Content-Disposition: attachment`. O endpoint é `[Authorize]` e escopado por marca
(404 cross-brand) como os irmãos do controller.

> **Como a UI baixa (o furo real de auth).** O JWT (Bearer/localStorage) e o `X-Brand-Id` são anexados
> **só** pelo wrapper `api()` (`apps/web/lib/api.ts`) — um `<a href="…/export.zip">` cru **não** os envia,
> resultando em **401** e/ou marca-default errada. Decisão: a UI **baixa via `fetch` autenticado** (mesmos
> headers do `api()`), recebe o corpo como `Blob` e dispara o download com `URL.createObjectURL` + um
> `<a download>` programático. O cliente é `content.downloadExport(id): Promise<Blob>` (**não** uma URL
> crua). **Alternativa descartada — link `<a href>` direto:** quebra auth e isolamento de marca.

> **Decisão sobre reconversão JPEG.** O worker reconverte PNG→JPEG via ImageSharp antes de publicar (Graph
> exige JPEG fetchável). **A API não tem ImageSharp** (só `Worker.csproj` a referencia). Para o aceite
> "baixar imagens JPEG": se a `ImageUrl` já é JPEG (caso comum pós-render), escreve direto; se for
> PNG/data-url, **a menor mudança que satisfaz** é adicionar `PackageReference SixLabors.ImageSharp@3.1.12`
> ao `apps/api` (**mesma versão já pinada no worker, sem novo CVE**) e reusar **apenas o snippet de
> conversão** (`Image.Load` + `SaveAsync(JpegEncoder{Quality=90})`) num util local da feature — **não** o
> `MediaService` inteiro (que depende de MinIO, ausente na API). **Alternativa descartada — chamar o
> worker/`MediaService`:** a API não fala com o worker (compartilham só o DB); criar endpoint interno
> worker→API inverteria a topologia. **Alternativa descartada — exportar PNG cru sem reconverter:** mais
> simples, mas falha o aceite literal "JPEG". Escolha: **ImageSharp na API**, conversão determinística (sem
> IA). KISS dentro da restrição do aceite.

### D4 — Promover ideia exige marca (`IdeaCandidate` ganha `BrandId` nullable) — único toque de schema da fase
`POST /api/ideas/{id}/promote` cria uma `Pauta` na **marca atual do request** (X-Brand-Id). Como
`IdeaCandidate` hoje é só `WorkspaceId`, a promoção precisa saber **a qual marca** a pauta pertence.
Decisão: **adicionar `BrandId` (nullable) a `IdeaCandidate`** (expand-only). **Nesta fase o
`AutonomousLoopJob` NÃO é tocado** — ideias nascem com `BrandId=null`; a promoção sempre usa a **marca atual
do request** (degradado honesto, nunca cross-brand silencioso). A coluna nasce nullable para um *futuro*
carimbo pelo loop, sem custo agora.

> **Por que o loop não carimba a marca aqui.** O worker não tem `BrandResolver`/`ICurrentBrand` (são
> API-only, dependem do header X-Brand-Id) e `RunForWorkspaceAsync` só conhece `wsId`; resolver "marca
> default" no worker seria **acoplamento novo + lógica replicada + teste extra**, e é **desnecessário**: o
> promote já resolve a marca pelo request. **KISS:** coluna nullable, loop intocado, promote resolve.
> Carimbo da marca pelo loop fica **fora de escopo** (abre-se quando houver razão).

> **Alternativa descartada — promover sem `BrandId`, herdando "alguma" marca do workspace
> silenciosamente.** Ambíguo em workspace multi-marca (qual marca?) e violaria o invariante "Brand é
> sub-chave de tudo". A promoção usa a marca **explícita** do request (X-Brand-Id), não infere.
> **Alternativa descartada — `IdeaCandidate.BrandId` NOT NULL já na expand.** Quebraria o
> `AutonomousLoopJob` atual (cria sem brand) e exigiria backfill de ideias órfãs. Nullable na expand é o
> brownfield correto.

## Modelo de dados / Contrato / UI

### Schema (mínimo)
```
IdeaCandidate.BrandId  Guid?   // E4.4 — sub-chave de marca (nullable; expand-only).
                                // FK p/ Brand. NESTA fase nasce sempre null (loop intocado);
                                // promoção usa a marca atual do request (X-Brand-Id).
```
Nenhum outro campo. **Nenhum enum novo.** Regenerar/editar/export **não** mudam schema.

### Endpoints novos (API)
```
POST /api/content/{id}/regenerate    → { contentId, jobId }   (E11.1; 404 cross-brand; 400 se sem pauta;
                                                                409 se a pauta já está Generating)
PUT  /api/content/{id}/slides        → 204                     (E11.3; body abaixo; 409 se status ∉
                                                                {Draft, PendingApproval}; 404 cross-brand)
GET  /api/content/{id}/export.zip    → application/zip         (E11.5; 404 cross-brand; [Authorize])
GET  /api/ideas                      → IdeaDto[]               (E4.4; não-promovidas da marca/workspace)
POST /api/ideas/{id}/promote         → PautaDto                (E4.4; 404 cross-brand; 409 se já promovida)
```
```ts
// E11.3 — corpo de PUT /content/{id}/slides
{ caption?: string|null, cta?: string|null, hashtags?: string|null,
  slides: { index: number, copy: string|null }[] }
// E4.4 — IdeaDto
{ id: string, title: string, rationale: string|null, suggestedType: number, brandId: string|null }
```
> `regenerate` **reusa** `GenerateAsyncResponse` e o store de job in-memory dos agents (contrato async
> inalterado). `export.zip` é síncrono (sem IA, sem poll).

### Clientes web (`apps/web/lib`)
- `pautas.ts`: `+ get(id)`, `+ update(id, input)` (E4.1/E4.3).
- `content.ts`: `+ regenerate(id)`, `+ updateText(id, body)`, `+ downloadExport(id): Promise<Blob>`
  (E11; **`downloadExport` usa `fetch` com Authorization + X-Brand-Id e devolve Blob — nunca uma URL crua
  para `<a href>`**).
- `approval.ts` (novo ou estende existente): `+ setContentMode(id, mode|null)` →
  `PUT /api/approval/mode/content/{id}`; `+ getEffectiveMode(id)` → `GET /api/approval/content/{id}/mode`
  (E4.2).
- `ideas.ts` (novo): `list()`, `promote(id)` (E4.4).

### UI
- **Pauta (E4.1/E4.3):** painel/rota de detalhe com todos os campos + anexos; botão Editar → formulário
  reusando o de criação (mesmo `PautaInput`), `Salvar`→`update`.
- **Conteúdo (E11.3/E11.5/E11.1):** na tela do conteúdo, campos editáveis de `Copy` por slide +
  caption/CTA/hashtags (Salvar→`updateText`); botão **Baixar** → chama `downloadExport`, materializa o Blob
  e dispara o download (`URL.createObjectURL` + `<a download>` programático); botão **Regenerar** (visível
  quando há pauta; dispara poll igual ao wizard).
- **Aprovação (E4.2):** seletor de modo por conteúdo (Manual/Automático/Herdar) visível só a Admin; mostra
  o **modo efetivo** resolvido (`getEffectiveMode` → `GET /api/approval/content/{id}/mode`).
- **Ideias (E4.4):** lista das ideias do loop com botão **Promover** → cria pauta e navega ao detalhe dela.

## Estratégia de migração (expand-only; sem contract destrutivo)
```
Migration AddIdeaCandidateBrand (aditiva):
  - ADD COLUMN IdeaCandidate.BrandId uuid NULL  (+ FK p/ Brand, índice não-único)
  - SEM data step: ideias existentes ficam com BrandId NULL (promoção usa a marca do request)
Down(): DROP da FK + DROP COLUMN BrandId.
```
> Sem backfill: `BrandId` nulo é estado válido (degradado). `WorkspaceId` e o mecanismo de isolamento
> **não mudam**. `AutonomousLoopJob` **não muda** (segue inserindo sem `BrandId`). Provar round-trip
> Up→Down→Up contra Postgres real (runbook `docs/sot/05-operacao.md` §11); backup antes em prod. **É a
> única migration desta fase** — os outros seis itens não tocam schema.

## Plano de teste (fecha o aceite)

1. **.NET (`tests/SocialAi.Tests`):**
   - **E11.1:** `regenerate` num conteúdo com pauta cria 2º `Content` com mesmo `PautaId`/`BrandId`; sem
     pauta → 400; pauta já `Generating` → 409; cross-brand → 404. Caso extra: pauta `Done` regredida a
     `InProgress` ao regenerar (transição reusada).
   - **E11.3:** `PUT slides` em `Draft` persiste `Copy`/`Caption`/`Cta`/`Hashtags` (reler retorna o
     editado); em `PendingApproval` também persiste; **em `Approved` → 409**, em `Published` → 409, em
     `Scheduled` → 409 (cobre ≥1 status fora do par além de Published/Scheduled); cross-brand → 404.
   - **E11.5:** `export.zip` devolve `application/zip`; contém `slide-0.jpg`… + `legenda.txt`; slide sem
     imagem é omitido sem erro; data-url PNG é convertido a JPEG; cross-brand → 404; sem JWT → 401.
   - **E4.4:** `promote` cria `Pauta` na marca atual (X-Brand-Id) com campos mapeados, marca
     `Promoted=true`, 2ª promoção → 409; promoção de ideia com `BrandId=null` usa a marca do request;
     ideia com `BrandId` de outra marca não vaza (promoção respeita a marca do request); cross-workspace →
     403/404.
   - **E4.2:** `PUT mode/content` por Admin muda o efetivo (caso "sobrepõe workspace"); não-Admin → 403;
     `GET content/{id}/mode` reflete a precedência conteúdo > campanha > workspace.
   - **Não-regressão:** cross-brand/cross-workspace verdes nos 4 endpoints novos; contrato de enums verde;
     `AutonomousLoopJob` continua criando `IdeaCandidate` com `BrandId=null` (suíte do worker verde).
2. **agents:** sem mudança (regenerate reusa `generate`) — suíte existente permanece verde.
3. **web (Vitest, `apps/web` já tem `vitest@2.1.8` + `vitest.config.ts`):** clientes novos
   (`pautas.update/get`, `content.regenerate/updateText`, `ideas.*`) chamam as rotas certas com
   método/headers (X-Brand-Id) corretos; `content.downloadExport` faz `fetch` carregando
   Authorization + X-Brand-Id e devolve Blob (não href); `approval.getEffectiveMode` bate em
   `GET /api/approval/content/{id}/mode`; render do detalhe de pauta mostra todos os campos + anexos.

## Riscos e mitigação
- **Export por link crua quebraria auth (401)** → a UI baixa via `fetch` autenticado (Authorization +
  X-Brand-Id) → Blob → `URL.createObjectURL`; o cliente é `downloadExport(id): Promise<Blob>`, nunca uma
  URL para `<a href>`.
- **Export sem ImageSharp na API** → adicionar `SixLabors.ImageSharp@3.1.12` ao `apps/api` (já pinada no
  worker, sem novo CVE) e reusar **só** o snippet de conversão (`Image.Load` + `JpegEncoder`); se a
  `ImageUrl` já for JPEG, escrever direto (evita reconversão). Não chama o worker (mantém a topologia).
- **`ImageUrl` http e SSRF** → o usuário edita só `Copy` (E11.3), nunca `ImageUrl`; o valor vem do pipeline
  (data-url/render controlado). O download por `HttpClient` no export trata a URL como dado já confiável do
  próprio conteúdo; sem entrada de URL arbitrária pelo operador.
- **"Qual é o conteúdo atual" após regenerar** → UI ordena por `CreatedAt desc` e rotula "mais recente";
  sem coluna de versão (KISS). Se virar ambíguo na operação, abre-se ADR de versionamento.
- **Regenerar reverte pauta `Done`→`InProgress`** → consequência intencional do reuso da transição
  existente; volta a `Done` ao concluir. Documentado; sem estado de pauta novo.
- **Editar texto de conteúdo fora de `{Draft, PendingApproval}`** → bloqueado por estado (409 para todos os
  demais status); espelha a guarda G3 do `Decide`.
- **Ideia legada/sem `BrandId`** → promoção usa a marca atual do request (X-Brand-Id), nunca infere marca
  silenciosamente; documentado como degradado.
- **Dependência de IA (B5)** → só `regenerate` (E11.1) precisa de chave; em modo degradado falha com o
  mesmo erro claro do `generate/async`. Editar texto, exportar, promover e toda a paridade E4 **funcionam
  sem chave de IA**.

## Fora de escopo (outros ADRs/incrementos)
- **Carimbo da marca pelo loop autônomo** (`AutonomousLoopJob` preencher `IdeaCandidate.BrandId`) — exige
  resolução de "marca default" no worker (que hoje não tem `BrandResolver`); abre-se quando houver razão.
- **Versionamento explícito de conteúdo** (diff entre versões, rollback, "ativar versão N") — ADR próprio
  se a operação pedir.
- **Edição estruturada por-campo do slide** (headline/corpo/CTA separados em colunas) — exige schema +
  contrato agents; futuro.
- **CRUD de Campanha** (DEC-9: adiado por YAGNI) — a campanha segue como nível herdável sem UI.
- **Conta-alvo por pauta** (DEC-8 override por pauta) — E7/contas.
- **Custo por marca** (DEC-7, `SpendEntry.BrandId`) — fase de IA configurável/custos.
- **Mover a conversão JPEG para um serviço compartilhado** entre worker e API — só se um 2º consumidor
  aparecer; aqui basta o util local da feature de export.