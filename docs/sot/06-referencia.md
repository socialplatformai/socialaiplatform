# 06 — Referência

> **Quadrante Diátaxis: Referência.**
> Tabelas factuais e exaustivas para consulta: variáveis de ambiente, endpoints da API, enums,
> tarefas do worker e migrations. Não explica o "porquê" (isso está em
> [02 — Arquitetura](02-arquitetura.md) e [03 — Fluxos](03-fluxos.md)); aqui só o "o quê". Termos
> linkam para o [glossário](08-glossario.md).

---

## 1. Variáveis de ambiente

Fonte cruzada: `docker-compose.yml`, `.env.example` e o código que lê cada chave. A coluna **Chave
no código** mostra a chave de configuração equivalente (`A:B` em .NET = `A__B` no ambiente).

### 1.1 Infraestrutura e deploy

| Variável (`.env`) | Chave no código | Serviços | Default | Propósito |
|-------------------|-----------------|----------|---------|-----------|
| `DEPLOY_MODE` | `DeployMode` | api | `single` | `single` (1 workspace) ou `multi` (N). Aparece no `/health`. |
| `ASPNETCORE_ENVIRONMENT` | (ASP.NET) | api | `Development` | `Production` ativa o endurecimento (ver §1.6). |
| `DOTNET_ENVIRONMENT` | (.NET) | worker | `Development` | Equivalente do worker. |
| `NODE_ENV` | (Node) | agents, web | `development` | Ambiente do Node. |
| `API_PORT` | (porta host) | docker | `5080` | Porta da API no host. |
| `WEB_PORT` | (porta host) | docker | `3000` | Porta da web no host. |
| `PORT` | `process.env.PORT` | agents | `4000` | Porta interna dos agentes. |

### 1.2 PostgreSQL

| Variável | Chave no código | Serviços | Default | Propósito |
|----------|-----------------|----------|---------|-----------|
| `POSTGRES_USER` | `ConnectionStrings:Postgres` | postgres, api, worker | `social` | Usuário do banco. |
| `POSTGRES_PASSWORD` | `ConnectionStrings:Postgres` | postgres, api, worker | (no `.env`) | Senha do banco. |
| `POSTGRES_DB` | `ConnectionStrings:Postgres` | postgres, api, worker | `social_ai` | Nome do banco. |
| `POSTGRES_PORT` | (porta host) | postgres | `5432` | Porta do PostgreSQL no host. |

A string de conexão é montada a partir destas variáveis no `docker-compose.yml`.

### 1.3 MinIO (mídia)

| Variável | Chave no código | Serviços | Default | Propósito |
|----------|-----------------|----------|---------|-----------|
| `MINIO_ROOT_USER` | `Minio:AccessKey` | minio, worker | `minioadmin` | Chave de acesso S3. |
| `MINIO_ROOT_PASSWORD` | `Minio:SecretKey` | minio, worker | (no `.env`) | Chave secreta S3. |
| `MINIO_PORT` | (porta host) | minio | `9000` | Porta da API S3. |
| `MINIO_CONSOLE_PORT` | (porta host) | minio | `9001` | Porta do console web. |
| `MINIO_PUBLIC_BASE_URL` | `Minio:PublicBaseUrl` | worker | (vazio) | URL pública alcançável pela internet; **obrigatória** em `PUBLISHER_MODE=graph`. O worker recusa subir em modo graph com host interno. |
| — | `Minio:Bucket` | worker | `media` | Nome do bucket. Lido no código (`apps/worker/Publishing/MediaService.cs`); **não consta no `.env.example`** (ver §1.7). |

### 1.4 Autenticação e segredos

| Variável | Chave no código | Serviços | Default | Propósito |
|----------|-----------------|----------|---------|-----------|
| `JWT_SECRET` | `Jwt:Secret` | api, worker | dev-default (só em Development) | Assina e valida o [JWT](08-glossario.md#jwt-json-web-token). **Em Production, ≥32 bytes e ≠ default** (senão [fail-fast](08-glossario.md#fail-fast-de-segredos)). |
| `JWT_ISSUER` | `Jwt:Issuer` | api | `social-ai-platform` | Emissor e audiência validados do token. |
| `SECRETS_ENCRYPTION_KEY` | `Secrets:EncryptionKey` | api, worker | (vazio) | Chave da cifra [AES-GCM](08-glossario.md#aes-gcm) dos segredos em repouso. **Obrigatória em Production**; definir antes do 1º deploy. |

### 1.5 Provedor de IA e serviço de agentes

| Variável | Chave no código | Serviços | Default | Propósito |
|----------|-----------------|----------|---------|-----------|
| `TEXT_PROVIDER` / `AI_PROVIDER` | `process.env.TEXT_PROVIDER` (fallback `AI_PROVIDER`) | agents | `gemini` | Provedor de texto: `gemini`, `openai`, `grok` ou `anthropic` (ver [10-multi-provider](10-multi-provider.md)). |
| `AI_PROVIDER_KEY` | `process.env.AI_PROVIDER_KEY` | agents | (vazio) | Chave do provedor de texto. Sem ela, a geração falha (modo degradado). |
| `IMAGE_PROVIDER` | `process.env.IMAGE_PROVIDER` | agents | `gemini` | Provedor de imagem: `gemini` ou `openai`. |
| `IMAGE_PROVIDER_KEY` | `process.env.IMAGE_PROVIDER_KEY` | agents | (vazio) | Chave do provedor de imagem. |
| `AGENTS_INTERNAL_TOKEN` | `Agents:InternalToken` / `process.env` | api, agents | (vazio) | Segredo compartilhado (`x-internal-token`). Vazio em dev = agents aceita com aviso; definido = exige correspondência. |
| `PROMPT_OVERRIDES_ENABLED` | `process.env.PROMPT_OVERRIDES_ENABLED` | agents | `false` | Liga o override de system-prompt por workspace ([ADR-0011](../adr/0011-prompts-configuraveis-com-rede.md)/[0013](../adr/0013-emissao-net-override-de-prompt.md)). Opt-in (poder perigoso). `false` = o pipeline usa sempre o prompt-base, ignorando overrides no payload. |
| — | `Agents:BaseUrl` | api | `http://localhost:4000` (código) / `http://agents:4000` (compose) | URL do serviço de agentes vista pela API. |

> Nota de compatibilidade: o serviço de agentes também aceita `GEMINI_API_KEY` como alternativa a
> `AI_PROVIDER_KEY` (`services/agents/src/jobs.ts`).

### 1.6 Meta / Instagram e publicação

| Variável | Chave no código | Serviços | Default | Propósito |
|----------|-----------------|----------|---------|-----------|
| `META_APP_ID` | `Meta:AppId` | api | (vazio) | ID do app Meta para [OAuth](08-glossario.md#oauth). Fallback do `.env`; pode vir cifrado do banco. |
| `META_APP_SECRET` | `Meta:AppSecret` | api | (vazio) | Segredo do app Meta. |
| `META_REDIRECT_URI` | `Meta:RedirectUri` | api | `http://localhost:5080/api/instagram/callback` | URI de callback do OAuth. |
| `PUBLISHER_MODE` | `Publisher:Mode` | worker | `mock` | [`mock`](08-glossario.md#mock-modo-mock) (simulado) ou [`graph`](08-glossario.md#graph-modo-graph) (real). |

### 1.7 Origens e front-end

| Variável | Chave no código | Serviços | Default | Propósito |
|----------|-----------------|----------|---------|-----------|
| `WEB_ORIGIN` | `Cors:WebOrigin` | api | `http://localhost:3000` | Origem liberada no [CORS](08-glossario.md#cors-cross-origin-resource-sharing). |
| `NEXT_PUBLIC_API_URL` | (build arg do Next) | web | `http://localhost:5080` | URL da API no bundle do front. **Build-time** — trocar exige rebuild da web. |

### 1.8 Variáveis obrigatórias para subir em Production (fail-fast)

| Variável | Verificação no boot |
|----------|---------------------|
| `JWT_SECRET` | Presente, ≠ default de dev e ≥ 32 bytes (`apps/api/Program.cs`). |
| `SECRETS_ENCRYPTION_KEY` | Presente, ≠ default e ≥ 32 bytes (`apps/api/Program.cs`). |
| `MINIO_PUBLIC_BASE_URL` | Em `PUBLISHER_MODE=graph`: não vazio e não interno (`minio:9000`/`localhost`/`127.0.0.1`) (`apps/worker/Program.cs`). |

### 1.9 Discrepâncias de configuração

- **`Minio:Bucket`** é lida no código (default `media`) mas **não aparece no `.env.example`** —
  sugerimos documentá-la lá (a confirmar com o time se deve virar variável de ambiente explícita).
- Nenhuma variável do `.env.example` ficou órfã: todas são consumidas por algum serviço.

---

## 2. Endpoints da API

Convenção de prefixo: `api/<área>`. Todos exigem [JWT](08-glossario.md#jwt-json-web-token)
(`Authorization: Bearer`) salvo onde indicado **(anônimo)** ou **(Admin)**. Fonte:
`apps/api/Features/*`.

### 2.1 Saúde

| Verbo | Rota | Acesso | Propósito |
|-------|------|--------|-----------|
| `GET` | `/health` | anônimo | Liveness; retorna `{status, service, deployMode, timestamp}`. |

### 2.2 Autenticação — `api/auth` (limite de 10 req/min por IP)

| Verbo | Rota | Acesso | Propósito |
|-------|------|--------|-----------|
| `POST` | `/api/auth/register` | anônimo | Cria usuário + workspace (1º usuário = Admin). |
| `POST` | `/api/auth/login` | anônimo | Emite JWT + refresh token. |
| `POST` | `/api/auth/refresh` | anônimo | Rotaciona o refresh token e renova o acesso. |

### 2.3 Marca — `api/brand`

| Verbo | Rota | Propósito |
|-------|------|-----------|
| `GET` | `/api/brand/kit` | Lê o kit de marca do workspace. |
| `PUT` | `/api/brand/kit` | Cria/atualiza o kit de marca. |
| `GET` | `/api/brand/competitors` | Lista concorrentes. |
| `POST` | `/api/brand/competitors` | Adiciona concorrente. |
| `DELETE` | `/api/brand/competitors/{id}` | Remove concorrente. |
| `GET` | `/api/brand/visual-references` | Lista referências visuais. |
| `POST` | `/api/brand/visual-references` | Adiciona referência. |
| `DELETE` | `/api/brand/visual-references/{id}` | Remove referência. |
| `GET` | `/api/brand/context` | Serializa o contexto da marca para os agentes. |

### 2.4 Conteúdo — `api/content`

| Verbo | Rota | Propósito |
|-------|------|-----------|
| `GET` | `/api/content` | Lista conteúdos (mais recentes primeiro). |
| `POST` | `/api/content/generate/async` | Inicia [geração assíncrona](03-fluxos.md#2-geração-de-conteúdo-assíncrona); retorna `{contentId, jobId}`. |
| `GET` | `/api/content/jobs/{jobId}` | Consulta o progresso do [job](08-glossario.md#job-trabalho) (e persiste ao concluir). |
| `GET` | `/api/content/{id}` | Lê um conteúdo com seus slides. |

### 2.5 Pautas — `api/pautas`

| Verbo | Rota | Propósito |
|-------|------|-----------|
| `GET` | `/api/pautas` | Lista [pautas](08-glossario.md#pauta) (filtros por status/prioridade). |
| `GET` | `/api/pautas/queue` | Fila ordenada (prioridade desc, data asc). |
| `GET` | `/api/pautas/{id}` | Lê uma pauta com anexos. |
| `POST` | `/api/pautas` | Cria pauta. |
| `PUT` | `/api/pautas/{id}` | Atualiza pauta. |
| `PATCH` | `/api/pautas/{id}/status` | Altera só o status. |
| `DELETE` | `/api/pautas/{id}` | Remove pauta. |

### 2.6 Aprovação — `api/approval` (alterações de modo: **Admin**)

| Verbo | Rota | Acesso | Propósito |
|-------|------|--------|-----------|
| `GET` | `/api/approval/pending` | autenticado | Conteúdos em `Draft`/`PendingApproval` com o modo efetivo. |
| `POST` | `/api/approval/content/{id}/decide` | Admin | Aprova/rejeita (só em `Draft` ou `PendingApproval`). |
| `PUT` | `/api/approval/mode/workspace` | Admin | Define o [modo de aprovação](08-glossario.md#modo-de-aprovação-approvalmode) do workspace. |
| `PUT` | `/api/approval/mode/campaign/{id}` | Admin | Sobrepõe o modo na campanha. |
| `PUT` | `/api/approval/mode/content/{id}` | Admin | Sobrepõe o modo no conteúdo. |
| `GET` | `/api/approval/content/{id}/mode` | autenticado | Resolve o modo efetivo (diagnóstico). |

### 2.7 Agendamento — `api/schedule`

| Verbo | Rota | Propósito |
|-------|------|-----------|
| `POST` | `/api/schedule` | Agenda um conteúdo `Approved` (ou em modo `Automatic`). |
| `GET` | `/api/schedule/calendar` | Posts em um intervalo de datas. |
| `DELETE` | `/api/schedule/{id}` | Desagenda (se ainda não despachado). |

### 2.8 Instagram — `api/instagram`

| Verbo | Rota | Acesso | Propósito |
|-------|------|--------|-----------|
| `GET` | `/api/instagram/connect-url` | Admin | Gera a URL de autorização [OAuth](08-glossario.md#oauth) (com `state`). |
| `GET` | `/api/instagram/callback` | anônimo | Callback do OAuth; consome o `state` e troca o token. |
| `GET` | `/api/instagram/status` | autenticado | Estado da conexão (conectado, usuário, expiração). |
| `POST` | `/api/instagram/disconnect` | autenticado | Revoga a conexão. |
| `GET` | `/api/instagram/app-config` | Admin | Lê a config do app Meta (só o AppId; o segredo nunca). |
| `POST` | `/api/instagram/app-config` | Admin | Salva AppId + segredo (cifrado). |
| `DELETE` | `/api/instagram/app-config` | Admin | Remove a config do app. |

> Esta tabela reflete as rotas mapeadas em `apps/api/Features/*`. Para a forma exata de cada
> payload, consulte o Swagger em `Development` (`/swagger`) ou os DTOs em cada feature-folder.

---

## 3. Enums (contrato .NET ↔ TypeScript)

Definidos em `libs/SocialAi.Core/Domain/Enums.cs`. **Os inteiros são contrato** entre a API e o
front-end (`apps/web/lib/content.ts`, `apps/web/lib/pautas.ts`): mudar um lado obriga a mudar o
outro.

| Enum | Valores (inteiro = nome) |
|------|--------------------------|
| `Priority` | 0=Low, 1=Medium, 2=High |
| `ContentType` | 0=Post, 1=Carousel, 2=Story |
| `ApprovalMode` | 0=Manual, 1=Automatic |
| `ContentStatus` | 0=Draft, 1=Generating, 2=PendingApproval, 3=Approved, 4=Rejected, 5=Scheduled, 6=Published, 7=EphemeralPublished, 8=Failed |
| `PautaStatus` | 0=Backlog, 1=Queued, 2=InProgress, 3=Done, 4=Archived |
| `PublishResult` | 0=Pending, 1=Success, 2=Error, 3=Skipped |
| `PublisherKind` | 0=Mock, 1=InstagramGraph |
| `UserRole` | 0=Member, 1=Admin |
| `SecretKind` | 0=InstagramToken, 1=AiProviderKey, 2=ImageProviderKey, 3=MetaAppSecret |
| `LibraryItemKind` | 0=Example, 1=Hashtag, 2=Reference |
| `MetricSource` | 0=Mock (simulado), 1=Real (parseado da Graph API) |
| `Frequency` | 0=None, 1=Daily, 2=Weekly, 3=Monthly |

Rótulos exibidos na interface (referência cruzada):
- `ContentStatus` → `CONTENT_STATUS_LABEL` em `apps/web/lib/content.ts` (ex.: 0="Rascunho",
  6="Publicado", 7="Publicado (efêmero)").
- `PautaStatus` → `STATUS_LABEL` em `apps/web/lib/pautas.ts`.

---

## 4. Tarefas do worker (jobs)

Todas são `BackgroundService` com temporizador periódico. Fonte: `apps/worker/Jobs/*`. (Há ainda um
`HeartbeatService` usado só pelo healthcheck do container.)

| Job | Intervalo | O que faz | Lê | Escreve |
|-----|-----------|-----------|----|---------|
| `PublishSchedulerJob` | 60 s | Acha `ScheduledPost` vencido e não despachado; marca despachado e enfileira. | `ScheduledPost` | `PublishLog` (`Pending`) |
| `PublishJob` | 30 s | Consome `PublishLog` `Pending`, publica (mock/graph), grava resultado com retry/backoff. | `PublishLog`, `Content`, `InstagramAccount` | `PublishLog` (`Success`/`Error`/`Skipped`) |
| `MetricsCollectorJob` | 5 min | Coleta métricas dos publicados; **simuladas** quando não há token (e hoje também quando há — ver nota). | `Content`, `PerformanceMetric`, `InstagramAccount` | `PerformanceMetric` |
| `AutonomousLoopJob` | 10 min | Cria [IdeaCandidate](08-glossario.md#ideacandidate-candidato-a-ideia) quando a fila de pautas está vazia e há orçamento (4 travas). | `Budget`, `Pauta`, `SpendEntry` | `IdeaCandidate` (`Promoted=false`), `SpendEntry` |
| `GeneratingReaperJob` | 1 min | Marca como `Failed` conteúdos presos em `Generating` há mais de 10 min. | `Content` | `Content` (`Failed`) |
| `IgTokenRefreshJob` | 24 h | Renova o token do Instagram (60 dias) dentro da janela de 50 dias antes do vencimento. | `InstagramAccount` | `InstagramAccount` (token recifrado) |

**Parâmetros de publicação** (`apps/worker/Publishing/`):
- [Graph API](08-glossario.md#graph-api) versão **v22.0**.
- [URL pré-assinada](08-glossario.md#url-pré-assinada-presigned-url) do MinIO: validade **1 hora**.
- Conversão de imagem: PNG/[data URL](08-glossario.md#data-url) → JPEG.
- Retry: backoff exponencial `2^tentativas` minutos, teto de 30 min, até ~5 tentativas.
- Antes de publicar de fato, checa `content_publishing_limit` na Graph API.

> **Nota de honestidade (métricas reais):** o `MetricsCollectorJob` chama o endpoint de insights da
> Graph API, mas **o parse da resposta ainda não está implementado** — o método de coleta real
> retorna `null` e o sistema cai em métricas **simuladas determinísticas**, mesmo com token válido.
> Marcado no código (`apps/worker/Jobs/MetricsCollectorJob.cs`). Ver
> [09 — Roadmap](09-roadmap.md).

---

## 5. Migrations

Vinte e três [migrations](08-glossario.md#migration) em `libs/SocialAi.Core/Migrations/`, aplicadas
automaticamente no boot da API. Em ordem cronológica:

| # | Migration | O que introduziu |
|---|-----------|------------------|
| 1 | `InitialCreate` | Esquema inicial (workspaces, usuários, marca, pautas, conteúdo, agendamento, publicação). |
| 2 | `AddCampaignAndApprovalModes` | Campanha e modos de aprovação. |
| 3 | `AddUserRole` | Papel do usuário (`Member`/`Admin`). |
| 4 | `AddGlobalUniqueEmail` | E-mail único global. |
| 5 | `AddOAuthState` | Tabela `OAuthState` para o `state` anti-[CSRF](08-glossario.md#csrf-cross-site-request-forgery). |
| 6 | `AddJobIdQualityAndPublishRetry` | `jobId`, [nota de qualidade](08-glossario.md#quality-score-nota-de-qualidade) e campos de retry de publicação. |
| 7 | `AddContentSlideUniqueIndex` | Índice único de slide por conteúdo. |
| 8–9 | `AddBrandExpand` · `AddBrandContract` | Entidade `Brand` por workspace (padrão expand/contract: adiciona colunas, faz backfill, depois contrai). |
| 10 | `AddBrandVisualIdentity` | Identidade visual da marca (cores, fontes, logo, preset). |
| 11 | `AddPautaMarketingObjective` | Objetivo de marketing e contexto de coleta na pauta. |
| 12 | `AddIdeaCandidateBrand` | Vínculo de marca no candidato a ideia do loop autônomo. |
| 13 | `AddSpendEntryBrand` | Atribuição de gasto por marca. |
| 14 | `AddAiConfigUsageAndTemplates` | Configuração de IA por workspace, registro de uso/custo e templates curados. |
| 15 | `AddSpendContentAndSample` | Vínculo de gasto a conteúdo e marcação de amostra. |
| 16 | `AddAccountsAccessHistory` | Contas Instagram múltiplas, acesso por convite, histórico e auditoria. |
| 17 | `AddPromptOverride` | Override de system-prompt por workspace (atrás de flag). |
| 18 | `AddFrequencyEnum` | Recorrência de publicação (`Frequency`). |
| 19 | `AddSlideLayers` | Camadas de composição do slide (`LayersJson` substitui `RenderHtml`). |
| 20 | `AddPublishLogDedupIndex` | Índice único de deduplicação no `PublishLog` (anti-dupla-publicação). |
| 21 | `AddSpendTelemetry` | Telemetria de gasto/uso (`AmountUsd`, `ImageCount`). |
| 22 | `AddContentTemplateName` | Nome do template no conteúdo (`TemplateName`). |
| 23 | `AddContentReasoningJson` | JSON de raciocínio do conteúdo (`ReasoningJson`). |

> **Nota:** a migration 16 é nomeada `AddFase8AccountsAccessHistory` no código (o prefixo é apenas
> rótulo interno da época em que foi criada). O nome de uma migration aplicada não é renomeado para
> não quebrar o controle de versão de esquema do EF Core.

> Para gerar/aplicar migrations em desenvolvimento, o DbContext vive na `Core`:
> ```bash
> dotnet ef migrations add <Nome> --project libs/SocialAi.Core --startup-project apps/api
> dotnet ef database update      --project libs/SocialAi.Core --startup-project apps/api
> ```

---

*Quadrante: Referência. Tabelas conferidas contra o código citado em cada seção.*
