---
adr: 0008
titulo: IA configurável + UI (provider/modelo/custo por workspace) + templates e refs em dados
status: aceito
data: 2026-06-15
---

# ADR-0008 — IA configurável + UI (provider/modelo/custo) + templates e biblioteca de refs por marca

## Critério de aceite (binário — no topo, cada item vira teste)

**Incremento 0 — refatoração de assinatura (pré-requisito de A/B/D, sem mudança de comportamento)**
- [ ] Z1. `runPipelineV2` e `BaseAgent`/`ImageGeneratorAgent` passam a receber uma **AiConfig efetiva** (`{ textProvider, imageProvider, apiKey, imageApiKey, model:{text,image}, temperature, maxTokens, templates?, forcedTemplateId? }`) propagada de `jobs.ts`, **em vez de** apenas `GeminiAPIConfig`. Sem override no request, o resultado de geração é **byte-equivalente** ao atual (teste de não-regressão: mesma config → mesmo caminho de provider Gemini).
- [ ] Z2. `resolveTextProvider`/`resolveImageProvider` passam a receber a **AiConfig efetiva** (provider + key + model) como argumento e selecionam provider/chave **a partir dela**, não de `process.env` direto. `process.env` continua sendo a origem de `loadAiConfig()` (uma vez, no topo), preservando o `.env` como default.

**Incremento A — OpenAI real (depende de chave de IA → degradado sem ela)**
- [ ] A1. Com `TEXT_PROVIDER=openai` + chave válida, `resolveTextProvider(config).completeJSON()` retorna JSON tipado válido (não lança "não implementado"). (integração marcada, pulada sem `OPENAI_TEST_KEY`)
- [ ] A2. Com `IMAGE_PROVIDER=openai` + chave válida, `resolveImageProvider(config).generate()` retorna um data-URL `data:image/...;base64,...`.
- [ ] A3. Sem chave, `OpenAiTextProvider`/`OpenAiImageProvider` lançam erro **diagnosticável** com a palavra `openai` e a env/campo faltante — nunca degradam em silêncio (invariante: falha clara em vez de degradação silenciosa).
- [ ] A4. **Cria-se `defaultModelFor(provider, modality)` em `config.ts` como o ÚNICO ponto com o literal de default por (provider × modalidade).** O default OpenAI texto/imagem é "o mais capaz atual", trocável por `AI_TEXT_MODEL`/`AI_IMAGE_MODEL`. Teste: (a) `defaultModelFor('openai','text')` e `('openai','image')` retornam não-vazio e ≠ id de Gemini; (b) **grep em `services/agents/src` encontra ZERO ids de modelo OpenAI fora de `defaultModelFor`**; (c) as envs sobrescrevem o default (princípio: nunca cravar id de modelo disperso pelo código).

**Incremento B — chave/modelo de IA por workspace + testar conexão (degradado sem chave)**
- [ ] B1. `POST /api/settings/ai` salva `{ provider, textModel?, imageModel?, apiKey }` cifrado (AES-GCM via `SecretProtector`) em `Secret{Kind=AiProviderKey}` do workspace atual.
- [ ] B2. `GET /api/settings/ai` retorna `{ configured, provider, textModel, imageModel }` e **nunca** a chave em claro (espelha `MetaAppConfigController`).
- [ ] B3. `POST /api/settings/ai/test` faz uma chamada mínima ao provider com a chave salva e retorna `{ ok, detail }` com **status HTTP 200** em todos os casos de validação, distinguindo no `detail` (PT-BR): (i) chave inválida (401 do provider) → `ok:false`; (ii) provider sem suporte a teste → `ok:false`; (iii) erro de rede/timeout → `ok:false`; (iv) sucesso → `ok:true`.
- [ ] B4. A geração injeta provider/modelo/chave do workspace **na AiConfig efetiva** do request aos agents; quando o workspace não tem `Secret{AiProviderKey}`, o agents cai no `.env` (`AI_PROVIDER_KEY`) — comportamento atual preservado.
- [ ] B4-bis. Com `aiOverride.apiKey=X` e `aiOverride.provider=openai`, a factory de provider constrói `OpenAiTextProvider`/`OpenAiImageProvider` **com a chave X** (não a de `process.env`) — teste unitário sobre a AiConfig efetiva.
- [ ] B5. O agents só aceita override por request se vier autenticado com `x-internal-token` (rota `/generate` já protegida); request sem token + sem env-key → falha diagnosticável.
- [ ] B6. Endpoints de settings restritos a `Admin` (dono do workspace), como `MetaAppConfigController` (403 para `Member`).
- [ ] B7. **Nenhuma instância de provider/cliente de IA é compartilhada entre jobs concorrentes.** A AiConfig efetiva é resolvida **por job**; o cliente/provider é construído por execução (ou cacheado por chave-composta `provider|apiKey|model`, nunca só por `apiKey`). Teste de concorrência: 2 jobs paralelos com chaves/modelos distintos — cada um usa exclusivamente o seu (sem thrash do singleton `getGeminiClient`).

**Incremento C — painel de uso/custo**
- [ ] C1. Migration adiciona `SpendEntry.BrandId` (`Guid?`, nullable na fase expand; FK p/ Brand) com `Down()` reversível, provada contra Postgres real (up→down→up). (Entregue na migration dedicada `AddSpendEntryBrand`.)
- [ ] C2. **O `GenerateResult` passa a carregar `usage?: { textInputTokens, textOutputTokens, imageCount }`** (propagado de `usageMetadata` do client; ausente/zero em mock). **A API**, ao detectar o job `done` no poll (`ContentController`), grava **um `SpendEntry{Reason, BrandId, AmountUsd}`** no escopo do workspace+brand do `Content` (o agents, sem DB, não escreve). **0 em modo mock**.
  > **Estado entregue (parcial declarado):** o custo é estimado por uma **tabela fixa por formato**
  > (Post/Carousel/Story) em `GenerationCostService`, e não pelo `usage × preço-por-modelo` que este
  > critério previa. O campo `usage` é propagado mas ainda não alimenta o cálculo. O valor é rotulado
  > como **estimado** na UI (C4). Refinar para custo por token/modelo é roadmap.
- [ ] C3. `GET /api/usage?from=&to=` retorna agregado do **workspace** por período: total USD, por marca (`BrandId`), por motivo (`Reason`). Isolamento por `WorkspaceId` intacto.
- [ ] C4. UI: painel de uso mostra total do período, quebra por marca e por motivo, e o status do cap mensal (`Budget.MonthlyCapUsd`). Custo é **rotulado como estimado** (honestidade sobre a precisão da medição).

**Incremento D — templates em dados + curadoria por marca**
- [ ] D1. Tabela `Template` (workspace-scoped, seed dos 4 templates hardcoded atuais) com listar/descrever via `GET /api/templates`.
- [ ] D2. `BrandTemplate` (BrandId+TemplateId, `Enabled`) permite ativar/desativar/curar templates por marca; `GET /api/brands/{id}/templates` reflete o estado curado.
- [ ] D3. Pauta pode forçar um template (`Pauta.ForcedTemplateId` nullable); quando setado, o agents usa **exatamente** esse template e não roda `selectBestTemplate`.
- [ ] D4. O agents recebe o(s) template(s) da marca via request (na AiConfig/request efetivo) e os usa no lugar do registry hardcoded; sem templates no request → fallback ao registry built-in (degradado honesto).
- [ ] D5. **O agents valida o shape de cada template recebido (mesma guarda de `CarouselTemplate`); template inválido → fallback ao registry built-in com erro logado, nunca crash** (validação de schema na borda do serviço).

**Incremento E — biblioteca de refs/exemplos/hashtags por marca**
- [ ] E1. CRUD `GET/POST/DELETE /api/brands/{id}/references` para itens `{ kind: example|hashtag|reference, value, label? }` (workspace+brand scoped).
- [ ] E2. Os itens chegam à engine no `brandContext` (hashtags → `brandContext.hashtags`; examples → `copyExamples`; references → `referenceContext`) — religando com os campos de `brandContext` já existentes.

## Contexto (estado real, com caminhos)

- **Providers já abstraídos, OpenAI é stub.** `services/agents/src/text/textProvider.ts` (`ITextProvider`, `resolveTextProvider`) e `src/image/imageProvider.ts` (`IImageProvider`, `resolveImageProvider`): Gemini é wrapper fino sobre `gemini/client.ts`; `OpenAiTextProvider`/`OpenAiImageProvider` **lançam** "ainda não implementado". **Ponto crítico verificado:** as factories selecionam provider/chave **a partir de `process.env`** (`env.TEXT_PROVIDER`/`env.AI_PROVIDER_KEY`), NÃO do objeto config; `base.ts:27` faz `resolveTextProvider(getGeminiClient(config))` — o `config` só alimenta o client Gemini. Por isso o Incremento Z (refator de assinatura) é pré-requisito de A/B/D.
- **Config tipada é a fonte única.** `src/config.ts` (`loadAiConfig`) deriva provider/modelo/params/chave do ambiente; `jobs.ts > geminiConfig()` consome e chama `runPipelineV2(config, ...)`. **Não existe `defaultModelFor` hoje** — os defaults vivem em `AI_DEFAULTS` como literais **Gemini-only** (A4 cria a função).
- **`GenerateResult` (`types.ts:77-89`) não carrega usage/tokens;** o `usageMetadata` existe no client (`gemini/client.ts:55`) mas é descartado em `toGenerateResult` (`jobs.ts:46-78`). C2 precisa propagá-lo.
- **`getGeminiClient` (`client.ts:362-369`) é singleton de módulo keyado SÓ por `apiKey`.** Em processo único multi-workspace com jobs concorrentes (`runJob` sem await), override por workspace exige B7 para não corromper entre jobs.
- **Slot de chave por workspace existe mas está vazio.** `SecretKind.AiProviderKey = 1` (`Enums.cs`) — nunca escrito/lido. A chave de IA hoje vive só em `.env`.
- **Padrão de secret-por-workspace já provado.** `apps/api/Features/Instagram/MetaAppConfigController.cs`: Admin-only, cifra JSON, persiste em `Secret`, `GET` devolve só flag. Gabarito exato para a chave de IA.
- **Contrato api⇄agents.** `apps/api/Features/Content/AgentsClient.cs` ⇄ `src/types.ts` (camelCase). Montado em `ContentController.BuildAgentRequestAsync`. `/generate` async + protegido por `x-internal-token`. Não há campo de chave/modelo/template no request hoje.
- **Templates hardcoded.** `src/templates/index.ts`: `TEMPLATES` (4), `selectBestTemplate()`, `getTemplateById()`. Sem persistência nem curadoria.
- **Custo.** `SpendEntry` (`Entities.cs:300`) **sem `BrandId`**. Único escritor hoje: `apps/worker/Jobs/AutonomousLoopJob.cs` (`Reason="loop:idea"`). A geração não grava spend; não há controller de Budget/Spend/Settings/Usage no API.
- **Multi-tenancy / enums.** Filtro global por `WorkspaceId` (`AppDbContext`), `TenantSaveInterceptor`, `X-Brand-Id`→`ICurrentBrand` (`Features/Brands/BrandResolver.cs`). Enums crus .NET↔TS travados por `scripts/gen-enums.mjs` + `apps/web/lib/enums.contract.test.ts` (+ `_enums.generated.ts`).

## Decisão (escolha + alternativas descartadas)

**Refator de assinatura primeiro (Z), depois A → B → C; D/E em paralelo APÓS Z.** Z é o pré-requisito estrutural compartilhado: hoje `runPipelineV2`/`BaseAgent`/`ImageGeneratorAgent` recebem `GeminiAPIConfig` nu e as factories leem `process.env`. A (OpenAI real), B (override por workspace) e D (templates no request) **todas** dependem de propagar uma **AiConfig efetiva** rica até a factory — fazê-las em paralelo sem Z garante conflito na mesma assinatura. KISS: a menor mudança por aceite, reusando padrões já aceitos.

### Z — propagar a AiConfig efetiva
`jobs.ts` resolve a AiConfig **por job** (mesclando `aiOverride` do request sobre `loadAiConfig()`) e a passa a `runPipelineV2`, que a repassa a `BaseAgent`/`ImageGeneratorAgent`, que a passam às factories. As factories deixam de ler `process.env` (continua sendo só a origem de `loadAiConfig`). Sem override → comportamento byte-equivalente.
- *Alternativa descartada — manter factories lendo `process.env`:* impossível num processo único multi-workspace; a chave/modelo do workspace nunca chegaria ao provider (furo verificado em `textProvider.ts:64-77`). Rejeitada.

### A — OpenAI real atrás das interfaces existentes
Implementar `OpenAiTextProvider.completeJSON/complete` e `OpenAiImageProvider.generate` com o SDK oficial, **sem tocar** nas interfaces. Default via **`defaultModelFor(provider, modality)`** (criado em `config.ts`) — um único literal por (provider × modalidade), overridável por env.
- *Alternativa descartada — "AdapterPipeline" por provider:* reescreveria os agentes; as interfaces existem para isolar isto (KISS). Rejeitada.
- *Alternativa descartada — cravar `gpt-4o`/id fixo:* o default fica em ponto único e overridável, evitando id de modelo disperso pelo código.

### B — chave/modelo por workspace + como ela chega ao agents
**Persistência:** `GET/POST /api/settings/ai` + `POST /api/settings/ai/test` num novo `Features/Settings/AiConfigController.cs`, espelhando `MetaAppConfigController` (Admin-only, cifra `{provider,textModel,imageModel,apiKey}` em `Secret{Kind=AiProviderKey}`, GET sem chave).
**Como a chave chega ao agents:** a API **injeta no request** `aiOverride?: { provider, textModel?, imageModel?, apiKey }`. `ContentController` decifra o `Secret` do workspace e injeta; `jobs.ts` mescla `req.aiOverride` na **AiConfig efetiva** (Z) que percorre **todo** o caminho até a factory (não só `geminiConfig()`). Override do workspace vence o `.env`; ausência → `.env`. Segurança: override só aceito porque `/generate` exige `x-internal-token` — chave só trafega na rede interna Docker, nunca ao browser; o agents **não loga** `apiKey` (teste). Concorrência: B7 — provider/cliente por job, sem singleton keyado só por `apiKey`.
- *Alternativa descartada — agents lê o Postgres e decifra sozinho:* daria ao agents acesso ao banco e à `Secrets:EncryptionKey`, ampliando a superfície de um serviço stateless. Rejeitada (segurança + acoplamento).
- *Alternativa descartada — env por workspace:* impossível num processo agents multi-workspace. Rejeitada.

### C — `SpendEntry.BrandId` + agregação + painel
Expand: `BrandId` nullable. `GenerateResult` ganha `usage` (tokens/imagens) propagado do client. **A API**, no poll de `done`, grava `SpendEntry{Reason, BrandId, AmountUsd}` no escopo workspace+brand do `Content` (o agents não tem DB). `GET /api/usage` agrega por período/marca/motivo no escopo do workspace. UI: novo painel sob Configurações.
- *Alternativa descartada — telemetria de custo só no agents:* o agents é efêmero e sem DB; o custo se perderia. O .NET é o lar natural. Rejeitada.

### D — templates em dados
Tabela `Template` (seed = os 4 atuais, mesmo `Key`/estrutura `CarouselTemplate` em `SpecJson`) + `BrandTemplate(Enabled)` para curadoria + `Pauta.ForcedTemplateId`. A API envia ao agents os templates ativos da marca (e o forçado) no request; o agents **valida o shape (D5)** e os usa no lugar do registry; template inválido ou ausência → registry built-in (degradado).
- *Alternativa descartada — manter hardcoded e só togglar por flag:* não satisfaz D1/D2 (listar/curar por marca). Rejeitada.
- *Alternativa descartada — editor visual de templates:* fora de escopo (YAGNI).

### E — biblioteca de refs por marca
Tabela `BrandLibraryItem(BrandId, Kind, Value, Label?)` com CRUD por marca; mapeada no `brandContext` para campos **já existentes** (`copyExamples`, `referenceContext`) + novo `brandContext.hashtags`.
- *Alternativa descartada — 3 tabelas separadas:* mesma forma, mais migrations/CRUD. Uma tabela com discriminador `Kind` é KISS.

## Modelo de dados / Contrato / UI

**Domínio (`libs/SocialAi.Core/Domain/Entities.cs`):**
- `SpendEntry.BrandId : Guid?` (FK Brand, nullable).
- `Template : TenantEntity { string Key; string Name; string? Description; string SpecJson; bool BuiltIn; }` (SpecJson = `CarouselTemplate` serializado).
- `BrandTemplate : TenantEntity { Guid BrandId; Guid TemplateId; bool Enabled; }`.
- `Pauta.ForcedTemplateId : Guid?`.
- `BrandLibraryItem : TenantEntity { Guid BrandId; LibraryItemKind Kind; string Value; string? Label; }`.
- Enum novo `LibraryItemKind { Example=0, Hashtag=1, Reference=2 }` → **sincronizar TS via `scripts/gen-enums.mjs`** + `enums.contract.test.ts` (invariante: enums .NET↔TS sempre sincronizados).

**Contrato api⇄agents (`types.ts` + `AgentsClient.cs`, camelCase no fio):**
- `GenerateRequest.aiOverride?: { provider, textModel?, imageModel?, apiKey }` (apiKey nunca logado).
- `GenerateRequest.templates?: CarouselTemplate[]`, `GenerateRequest.forcedTemplateId?: string`.
- `BrandContext.hashtags?: string[]` (`referenceContext`/`copyExamples` já existem).
- `GenerateResult.usage?: { textInputTokens: number; textOutputTokens: number; imageCount: number }`.

**API:** `Features/Settings/AiConfigController.cs` (`GET/POST /api/settings/ai`, `POST /api/settings/ai/test`); `Features/Usage/UsageController.cs` (`GET /api/usage`); `Features/Templates/TemplatesController.cs` (`GET /api/templates`, `GET/PUT /api/brands/{id}/templates`); refs em `Features/Brands` (`/api/brands/{id}/references`).

**UI (`apps/web`):** `lib/settings.ts`, `lib/usage.ts`, `lib/templates.ts`, `lib/library.ts`; tela de Configurações de IA (provider/modelo/chave + "Testar conexão"); painel de Uso/Custo (rótulo "estimado"); curadoria de templates na marca; biblioteca de refs na marca; seletor de template forçado no agendamento da pauta.

## Estratégia de migração (expand → migrate → contract)

Uma migration `AddAiConfigUsageAndTemplates` (`libs/SocialAi.Core/Migrations`):
- **Expand:** add coluna `SpendEntry.BrandId` (nullable); add tabelas `Template`, `BrandTemplate`, `BrandLibraryItem`; add coluna `Pauta.ForcedTemplateId` (nullable). Seed dos 4 templates built-in.
- **Migrate (data):** backfill `SpendEntry.BrandId` quando inferível; histórico não-atribuído fica null (aceitável).
- **Contract:** nenhuma coluna vira NOT NULL nesta fase (`BrandId`/`ForcedTemplateId` permanecem nullable — null é estado válido).
- `Down()` reversível (drop colunas/tabelas). Provar contra Postgres real (up→down→up). Backup antes.

## Plano de teste (aceite → teste)

- **Z1–Z2:** não-regressão — sem override, geração byte-equivalente (mesmo caminho Gemini); teste de que as factories selecionam provider/chave a partir da AiConfig efetiva, não de `process.env`.
- **A1–A4:** Vitest em `src/text` e `/image` — integração marcada (pula sem `OPENAI_TEST_KEY`); unit: stub sem chave lança erro contendo `openai`; **grep prova zero ids OpenAI fora de `defaultModelFor`** + snapshot de `defaultModelFor`.
- **B1–B7:** `tests/SocialAi.Tests` — salva/lê config (chave nunca volta), Admin-only (403 p/ Member), `test` cobrindo os 4 casos do B3; `BuildAgentRequest` injeta `aiOverride` quando há Secret e omite quando não há; B4-bis (factory usa a chave do override); **B7 teste de concorrência (2 jobs paralelos, chaves/modelos distintos, sem colisão de cliente)**; asserção de que `apiKey` não aparece em log do agents.
- **Contrato:** round-trip `AgentsGenerateRequest`(.NET)→JSON→`GenerateRequest`(TS) cobrindo `aiOverride`/`templates`/`forcedTemplateId`/`hashtags`/`usage` em camelCase.
- **C1–C4:** teste de migration (up/down/up); propagação de `usage` em `toGenerateResult`; agregação `/api/usage` por marca/motivo respeitando `WorkspaceId`; isolamento cross-brand; custo=0 em mock.
- **D1–D5:** seed presente; `selectBestTemplate` não roda quando `forcedTemplateId` setado; agents usa templates do request; template inválido → fallback ao registry (sem crash).
- **E1–E2:** CRUD isolado por brand+workspace; itens chegam ao `brandContext`.
- **Enums:** rodar `scripts/gen-enums.mjs` + `enums.contract.test.ts` após adicionar `LibraryItemKind`.

## Riscos e mitigação

- **Override não chega ao provider** (Z/B) → refator de assinatura (Z) faz a AiConfig efetiva percorrer todo o caminho; factories param de ler `process.env`; teste B4-bis prova a chave do override em uso.
- **Corrupção cross-workspace por singleton** (B) → B7: cliente/provider por job ou cache por tupla `provider|apiKey|model`; teste de concorrência. Nunca keyar só por `apiKey`.
- **Vazamento da chave de IA** (B) → trafega só na rede interna com `x-internal-token`; nunca no GET; agents não loga `apiKey` (teste); cifrada em repouso (AES-GCM).
- **Custo sem fonte de dados** (C) → `GenerateResult.usage` propagado do client; sem usage → estimativa por imagens, rotulada como *estimada*; preço por modelo em config trocável.
- **Drift de modelo OpenAI** (A) → default num ponto único `defaultModelFor`, overridável por env.
- **Conflito de merge na assinatura** (A/B/D paralelos) → Z é pré-requisito único; A/B/D só começam após Z.
- **Template com shape inválido** (D) → D5: validação na borda do agents + fallback ao registry, sem crash.
- **Quebra do contrato enums** (E) → `gen-enums.mjs` + teste de contrato no CI antes do merge.
- **Migration em prod** → expand-only nullable + `Down()` provado + backup; sem NOT NULL nesta fase.

## Fora de escopo

- Editor visual/criação livre de templates (só dados + seed + curadoria liga/desliga + forçar).
- 3º+ provider além de Gemini/OpenAI (Imagen segue stub).
- CRUD de Campanha (adiado).
- Promoção de `IdeaCandidate` / UI do loop autônomo.
- Override de prompts por workspace (ADR próprio, futuro).
- Cobrança/billing real; aqui é só medição/estimativa de custo.