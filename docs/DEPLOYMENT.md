# Implantação — Social AI Platform

Guia de implantação na infraestrutura do cliente (§5). Self-hosted via Docker Compose.

> **Stack:** .NET 8 (API + Worker) · Node 20 (agents) · Next.js 15 (web) · Postgres 16 · MinIO
> **Modos de deploy:** single-tenant (1 cliente) ou multi-tenant (um só deploy hospeda N workspaces) — mesma imagem, flag `DEPLOY_MODE`.

---

## 1. Arquitetura

```
[web Next.js] ──REST/JWT──▶ [api .NET] ──▶ [postgres]
                              │
                              ├── /generate (async) ──▶ [agents Node, rede interna, x-internal-token]
                              │                              └──▶ provider IA (Gemini/OpenAI)
                              └── [worker .NET] ──▶ [minio presigned URL] (PNG→JPEG) ──Graph API──▶ [Instagram]
                                          ├── PublishSchedulerJob (despacha posts due; fila = PublishLog/Postgres)
                                          ├── PublishJob (publica via Mock/Graph + log)
                                          ├── MetricsCollectorJob (coleta insights)
                                          └── AutonomousLoopJob (gera ideias quando fila vazia + budget cap; Loop:Enabled=false por padrão)
```

| Serviço | Porta interna | Responsabilidade |
|---------|---------------|------------------|
| web | 3000 | UI operacional (brand, pautas, geração, aprovação, calendário, conexão IG) |
| api | 5080 | REST, auth JWT, multi-tenant, orquestra geração, OAuth Instagram |
| worker | — | Jobs 24/7: scheduler, publish, métricas, loop autônomo (BackgroundService + PeriodicTimer) |
| agents | 4000 (interna) | Pipeline dos 6 agentes — **sem porta publicada no host**; autenticado por `x-internal-token` |
| postgres | 5432 | Persistência + fila de publicação (`PublishLog`) |
| minio | 9000/9001 | Mídia — bucket privado; worker gera **URL presigned** (TTL curto) p/ Graph API |

## 2. Setup local

```bash
git clone <repo> && cd social-ai-platform
cp .env.example .env          # preencher (ver §3)
docker compose up --build -d  # sobe os 6 serviços (web, api, worker, agents, postgres, minio)
docker compose ps             # esperar healthchecks (postgres/minio/api/agents)
```

As **migrations são aplicadas automaticamente** no boot da API (migrate-on-boot, com retry
enquanto o Postgres sobe) — não há passo manual no deploy. Para gerar/aplicar migrations em
desenvolvimento (o DbContext vive em `libs/SocialAi.Core`):
```bash
dotnet ef migrations add <Nome> --project libs/SocialAi.Core --startup-project apps/api
dotnet ef database update      --project libs/SocialAi.Core --startup-project apps/api
```

| URL | O quê |
|-----|-------|
| http://localhost:3000 | UI |
| http://localhost:5080/swagger | API (dev) |
| http://localhost:9001 | Console MinIO |

## 2b. Deploy no Render (Blueprint)

O repositório traz **dois blueprints** do Render (Infraestrutura como Código). O código é **agnóstico** —
lê tudo de variáveis de ambiente (padrão 12-factor); estes arquivos apenas mapeiam env→Render. Para
outra plataforma (Fly, AWS ECS, Kubernetes, VM com Docker), use o `docker-compose.yml` ou replique as
mesmas variáveis.

| Arquivo | Para quê | Serviços | Plano |
|---------|----------|----------|-------|
| `render.yaml` | **Produção completa** | web · api · agents (private) · **worker** · Postgres | `starter` (pago) |
| `render.demo.yaml` | **Demonstração gratuita** (só geração; sem worker) | web · api · agents · Postgres | `free` |

> O worker 24/7 (publicação agendada, métricas, loop) **exige plano pago** — o Render não permite
> `worker`/`cron` no `free` (ver [blueprint-spec](https://render.com/docs/blueprint-spec)). Por isso a
> variante demo não o inclui.

**Passo a passo (produção, `render.yaml`):**
1. Render → **New** → **Blueprint** → conecte este repositório → selecione `render.yaml` → **Apply**.
   O Render cria web/api/agents/worker/Postgres e gera os segredos (`Jwt__Secret`, `Secrets__EncryptionKey`,
   `Agents__InternalToken`) automaticamente. Em planos pagos, web↔api↔agents/worker falam pela **rede
   privada** (hostname interno) — sem passos manuais de URL interna.
2. **Após o 1º deploy** (1x), preencha no painel as variáveis marcadas como *manual* (`sync: false`):
   - `social-ai-api` → `Cors__WebOrigin` = a URL pública do `social-ai-web` (com `https://`, sem barra final);
   - `social-ai-web` → `NEXT_PUBLIC_API_URL` = a URL pública do `social-ai-api` (dispara rebuild — é build-time).
3. Na UI: criar conta (1º usuário = Admin) → **Configurações › IA** → colar a chave do provider de IA.
4. **Publicação real** (opcional): provisione um armazenamento S3-compatível (MinIO/S3/R2/B2) e preencha
   `Minio__*` (API e worker) + as credenciais `Meta__*`; vire `Publisher__Mode=graph` após o App Review.

Detalhes e armadilhas de cada tier estão comentados dentro dos próprios `render.yaml` / `render.demo.yaml`.

## 3. Credenciais (responsabilidade do cliente — §4)

Editar `.env`. Sem as chaves de IA/Meta o sistema **sobe em modo degradado** (infra+UI funcionam,
geração/publicação ficam indisponíveis; publicação cai no MockPublisher).

| Variável | Onde obter | Necessária para |
|----------|-----------|-----------------|
| `AI_PROVIDER_KEY` | https://aistudio.google.com/apikey (Gemini) | Geração de texto/imagem |
| `IMAGE_PROVIDER_KEY` | idem (ou OpenAI) | Geração de imagem |
| `META_APP_ID` / `META_APP_SECRET` | https://developers.facebook.com/apps | Conexão + publicação Instagram |
| `META_REDIRECT_URI` | URL pública do callback | OAuth Instagram |
| `JWT_SECRET` | gerar (`openssl rand -base64 48`) | Auth |
| `SECRETS_ENCRYPTION_KEY` | gerar (`openssl rand -base64 48`) | Cifra AES-GCM de tokens IG/chaves no banco; em Production a API/worker recusam subir sem este valor |
| `AGENTS_INTERNAL_TOKEN` | gerar (`openssl rand -base64 32`) | Autenticação entre api→agents (`x-internal-token`); vazio em dev (agents aceita com aviso) |
| `MINIO_PUBLIC_BASE_URL` | URL pública do MinIO (ex.: `https://midia.cliente.com`) | Base para URL presigned que a Graph API baixa; obrigatória em `PUBLISHER_MODE=graph` |
| `NEXT_PUBLIC_API_URL` | URL pública da API (ex.: `https://api.cliente.com`) | UI → API (build-time, ver nota) |

**Segredos (decisão dia-2):** vivem no `.env` (gitignored), injetados via Docker Compose,
cifrados em repouso no host (AES-GCM via `SecretProtector`). 1 deploy por cliente.

> **OBRIGATÓRIO em entrega real:** definir no `.env` **`ASPNETCORE_ENVIRONMENT=Production`** e
> **`DOTNET_ENVIRONMENT=Production`** (o default é `Development`). Em Production a API: aplica
> fail-fast de segredos (recusa subir com `JWT_SECRET`/`SECRETS_ENCRYPTION_KEY` fracos), não vaza
> stack trace e **desativa o Swagger**. Sem isso, o deploy sobe em modo de desenvolvimento.

> **A1 — `NEXT_PUBLIC_API_URL` é build-time, não runtime.** O Next.js inlina as variáveis
> `NEXT_PUBLIC_*` no bundle JavaScript **no momento do build** (`docker compose build web`),
> não na subida do container. Por isso ela é passada como **build arg** no `docker-compose.yml`
> (não em `environment:`). **Consequência operacional:** mudar a URL da API do cliente exige
> **rebuildar o web** — `docker compose build web && docker compose up -d web`. Definir
> `NEXT_PUBLIC_API_URL` no `.env` **antes** do primeiro `docker compose up --build`.
>
> **`SECRETS_ENCRYPTION_KEY`** deve ser definida **antes do 1º deploy real**: trocá-la depois
> invalida todos os segredos já cifrados (tokens IG, chaves) — eles teriam de ser reconfigurados.
>
> **`MINIO_PUBLIC_BASE_URL`** deve apontar para o host alcançável pela internet (não `minio:9000`
> nem `localhost`) quando `PUBLISHER_MODE=graph` — o worker recusa subir nesse modo com host interno.

## 4. Conectar o Instagram

1. Criar um app em developers.facebook.com (produto **Instagram**, usar **Instagram Login**).
2. Configurar `META_*` no `.env` e o redirect URI no app.
3. Na UI: **Configurações → Conexão Instagram → Conectar conta Instagram** (OAuth em um clique).
4. O token long-lived (60d) é persistido cifrado. O worker (`IgTokenRefreshJob`, tick diário)
   tenta renová-lo na janela antes do vencimento; se a renovação falhar/expirar, marca a conta
   como desconectada e a UI mostra "expira em N dias" / pede reconexão (sem falha silenciosa).

**Publicação real** exige o **App Review da Meta** (semanas). Até lá, `PUBLISHER_MODE=mock`
cumpre o fluxo end-to-end. O flip mock→Graph é **config** (`PUBLISHER_MODE=graph` + conta conectada).

## 5. Configuração inicial (primeiro uso)

1. **Registrar** o operador (cria User + Workspace).
2. **Marca** (`/brand`): branding, tom, diretrizes, concorrentes, referências.
3. **Pautas** (`/pautas`): alimentar o backlog com prioridade.
4. **Gerar** (`/create`): selecionar pauta + formato → conteúdo.
5. **Aprovar** (`/approvals`): manual ou automático (config por workspace/campanha/conteúdo).
6. **Agendar** (`/calendar`): o worker publica no horário.

## 6. Modos de operação

| Config | Efeito |
|--------|--------|
| `DEPLOY_MODE=single\|multi` | 1 workspace vs N |
| `PUBLISHER_MODE=mock\|graph` | Publicação simulada vs real |
| `Loop__Enabled=true\|false` | **Kill-switch global** do loop autônomo (**default `false` — opt-in explícito**) |
| `Budget.AutonomousLoopEnabled` (por workspace) | Opt-in do loop por cliente |
| `Budget.MonthlyCapUsd` (por workspace) | **Teto de gasto** do loop; ao atingir, pausa |
| `PROMPT_OVERRIDES_ENABLED=true\|false` (serviço *agents*) | **Override de prompt por workspace** (ADR-0011 + ADR-0013). **Default `false` — opt-in, "poder perigoso".** OFF → os agentes usam sempre o prompt-base versionado. Com override inválido, cai no base (não quebra). A emissão pela API e a tela de edição (Admin) já existem; a flag liga o uso do override no pipeline. |

**Loop autônomo (§2.4):** quando a fila de pautas esvazia e o loop está habilitado e dentro
do budget, gera `IdeaCandidate`s. Pautas têm prioridade. Ideias **não publicam direto** —
passam por aprovação humana (gate de moderação / rampa de confiança). A promoção de
`IdeaCandidate` → Pauta tem **UI e endpoint** (`/ideas`, `POST /api/ideas/{id}/promote`). O loop
é entregue **desligado** por padrão (`Loop:Enabled=false`).

## 7. Operação e observabilidade

- **Logs de publicação:** `PublishLog` (resultado, resposta Graph, erro, correlationId).
- **Tracing:** correlation-id ponta-a-ponta nos jobs de publicação.
- **Métricas:** `PerformanceMetric` por post; alimentam o `learning summary` injetado na geração.
- **Circuit breaker:** o `InstagramGraphPublisher` consulta o rate-limit em runtime
  (`content_publishing_limit`) antes de publicar.

## 7b. Backup & recuperação (Postgres + MinIO)

> **Por que importa:** o estado vive em dois volumes Docker — `postgres-data` (banco) e
> `minio-data` (mídia dos slides). Sem um playbook de backup, um crash de disco = perda total.
> Esta seção fecha esse bloqueante com scripts testados e um procedimento de recuperação **provado**.

**Onde os dados moram (mapeie para disco persistente):**

| Volume Docker | Conteúdo | Container |
|---|---|---|
| `postgres-data` | Banco (usuários, marcas, conteúdo, logs de publicação, métricas) | `postgres:/var/lib/postgresql/data` |
| `minio-data` | Mídia publicável (PNG→JPEG dos slides) no bucket `media` | `minio:/data` |

Em produção, aponte esses volumes para um **disco host persistente** (ex.: um disco gerenciado
com snapshots do provedor). Troque os volumes nomeados por bind mounts no `docker-compose.yml`:

```yaml
volumes:
  postgres-data:
    driver_opts: { type: none, o: bind, device: /mnt/dados/postgres }
  minio-data:
    driver_opts: { type: none, o: bind, device: /mnt/dados/minio }
```

**Backup (rodar com o stack de pé):**

```bash
./scripts/backup.sh                       # grava em ./backups/<timestamp>/
BACKUP_DIR=/mnt/disco ./scripts/backup.sh # destino alternativo (disco persistente)
```

Gera `postgres.dump` (formato `pg_dump -Fc`, compactado) + `minio/` (espelho do bucket) +
`MANIFEST.txt`. Agende via `cron`/agendador do provedor (ex.: diário) e replique o `BACKUP_DIR`
para fora do host (object storage / snapshot).

**Recuperação:**

```bash
./scripts/restore.sh ./backups/<timestamp>            # restaura PRODUÇÃO (pede confirmação)
FORCE=1 ./scripts/restore.sh ./backups/<timestamp>    # sem prompt (automação)
```

**Dry-run (verificar o backup sem tocar produção) — recomendado periodicamente:**

```bash
RESTORE_DB=sap_restore_test ./scripts/restore.sh ./backups/<timestamp>
```

Restaura num **banco descartável** (criado e dropado ao fim), conta as tabelas recuperadas e
sai com erro se o backup estiver vazio/corrompido — provando que o backup é restaurável **sem
risco** ao banco de produção. É o teste que transforma "temos backup" em "sabemos que o backup
volta". Os scripts não exigem `psql`/`mc` no host (usam `docker compose exec` e um container
efêmero `minio/mc`).

## 8. Roadmap de evolução (pós-MVP)

- ~~OpenAI como provider de imagem~~ — **feito**: `IMAGE_PROVIDER=openai` (`gpt-image-2`); Imagen segue stub. Provider de texto também é multi (Gemini/OpenAI/Grok/Claude) — ver `docs/sot/10-multi-provider.md`.
- Vídeo / Reels / multimodal (a Graph API suporta; o pipeline precisa de um agente de vídeo).
- Insights reais de performance (estrutura pronta; ligar o media id do publish aos insights).
- ~~Extrair `Domain`+`Data` para uma lib compartilhada~~ — **feito**: `libs/SocialAi.Core`; o worker
  não referencia mais a API e roda na imagem `dotnet/runtime`.
- Migrar de .NET 8 (EOL nov/2026) para .NET 10 LTS antes/logo após a entrega (upgrade de baixo atrito).
- Port futuro dos agentes Node → 1 runtime (.NET), se a manutenção de dois runtimes pesar.

## 9. Notas de build (estado atual)

- Imagens Docker `.NET` (api/worker) dependem de `mcr.microsoft.com` — se o registry estiver
  indisponível, o build local (`dotnet build`) funciona; é só o empacotamento Docker.
- `next` fixado em 15.5.19 (CVE corrigido); `SixLabors.ImageSharp` em 3.1.12 (CVE corrigido).
- **Testes automatizados:** `tests/SocialAi.Tests` — rodar com `dotnet test` antes de deploys.
  Cobre invariantes de multi-tenancy e fail-fast de segredos. Sem banco externo necessário.
- **Production hardening:** `ASPNETCORE_ENVIRONMENT=Production` ativa fail-fast de segredos
  ausentes/fracos, remove stack traces das respostas de erro e desativa o Swagger.

---

*Social AI Platform — by AIdeasLab.*
