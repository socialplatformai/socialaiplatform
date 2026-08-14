# Rodar o stack NATIVO (sem Docker) — este host (Windows + Git Bash)

> Quando o Docker não está disponível, dá para rodar os 5 processos nativamente.
> Este doc captura a configuração REAL deste host (descoberta em sessão) para não re-descobrir.
> Canônico continua sendo `docker compose up` (ver `README.md`); isto é o fallback nativo.

## Pré-requisitos deste host

| Ferramenta | Caminho / nota |
|------------|----------------|
| .NET SDK 8 | `C:\Users\Desktop\.dotnet\dotnet.exe` (instalado em user-dir, sem admin, via `dotnet-install.ps1 -Channel 8.0`). Exporte `DOTNET_ROOT=C:\Users\Desktop\.dotnet` para o `dotnet ef` achar o SDK. |
| Node 20+ | `npm` no PATH pode falhar; use `node "/c/Program Files/nodejs/node_modules/npm/bin/npm-cli.js"`. |
| Postgres | roda NATIVO na **porta 5433** (não 5432). DB `social_ai`, user `social`, pass `changeme`. |
| Chrome | `C:\Program Files\Google\Chrome\Application\chrome.exe` (p/ os instrumentos de screenshot em `apps/web/.shots`). |

## As portas (quem escuta onde)

| Serviço | Porta | Runtime |
|---------|-------|---------|
| web (Next) | 3001 | node |
| api (.NET) | 5080 | dotnet Api.dll |
| agents (Fastify) | 4000 | tsx/node |
| postgres | 5433 | nativo |
| worker (.NET) | — (sem HTTP) | dotnet Worker.dll |

## Ordem de subida + comandos exatos

> Variáveis sensíveis (chaves de IA, token interno) vivem no `.env` da raiz. O **agents** já
> carrega o `.env` sozinho (via `src/load-env.ts` + `dotenv`). A **api/worker** (.NET) leem env
> vars/appsettings — passe os overrides abaixo no shell que as inicia.

### 1. Agents (porta 4000) — carrega o `.env` sozinho
```bash
cd services/agents
node "/c/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" install   # 1ª vez
node "/c/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" run dev   # tsx watch; loga "injected env (N) from ../../.env"
```
Confirma: `curl http://localhost:4000/health` → `{"status":"healthy","aiProvider":"gemini"}`.

### 2. API (porta 5080) — overrides obrigatórios neste host
```bash
cd apps/api/bin/Debug/net8.0          # binário pré-buildado (ou: dotnet build ../../Api.csproj antes)
export DOTNET_ROOT="C:\\Users\\Desktop\\.dotnet"
export ConnectionStrings__Postgres="Host=localhost;Port=5433;Database=social_ai;Username=social;Password=changeme"
export Cors__WebOrigin="http://localhost:3001"   # ⚠️ default é :3000 — sem isto o browser toma CORS-block (tela /content em branco)
export Agents__BaseUrl="http://localhost:4000"
export ASPNETCORE_ENVIRONMENT="Development"
export ASPNETCORE_URLS="http://localhost:5080"
"C:\\Users\\Desktop\\.dotnet\\dotnet.exe" Api.dll
```
> ⚠️ **Token interno:** se o agents subiu COM `AGENTS_INTERNAL_TOKEN` (do `.env`), a api precisa
> mandar o mesmo header — passe `Agents__InternalToken=<valor>`. Alternativa em dev: suba o agents
> tokenless pré-setando `AGENTS_INTERNAL_TOKEN=""` no shell ANTES do `npm run dev` (o dotenv não
> sobrescreve var já existente). Em produção, SEMPRE com token.

### 2b. MinIO (porta 9000 API / 9001 console) — liga o store de imagem da API (gargalo nº1)

Sem MinIO a API roda em **degraded-mode** (base64 inline no `/content`, ~10MB/peça). Para o estado
SOTA (DTO leve, imagem por URL de proxy), suba o MinIO e passe `Minio__*` para a API:
```bash
# binário neste host: C:/Users/Desktop/minio.exe
MINIO_ROOT_USER=minioadmin MINIO_ROOT_PASSWORD=minioadmin \
  "C:/Users/Desktop/minio.exe" server "C:/Users/Desktop/minio-data" \
  --address ":9000" --console-address ":9001" &
powershell -Command "(Test-NetConnection localhost -Port 9000 -WarningAction SilentlyContinue).TcpTestSucceeded"  # → True
```
Depois RELIGUE a API (passo 2) acrescentando estas vars ANTES do `dotnet Api.dll`:
```bash
export Minio__Endpoint="localhost:9000"
export Minio__AccessKey="minioadmin"
export Minio__SecretKey="minioadmin"
export Minio__Bucket="media"
# ⚠️ OBRIGATÓRIO no nativo: web (:3001) e API (:5080) são origins DIFERENTES. O <SlideCanvas> usa a
# URL do proxy CRUA no CSS (background-image:url(...)), sem prepender a base. Vazio → URL relativa
# resolve contra :3001 (origin errado) → imagem quebrada. Setar a base ABSOLUTA da API:
export Api__PublicBaseUrl="http://localhost:5080"
```
Confere a vivo: gere 1 peça e `curl -s .../api/content/{id} -H "Authorization: Bearer $TOKEN" | wc -c`
deve dar **~5KB** (não 10MB); o slide.imageUrl vira `http://localhost:5080/api/content/{id}/slides/{i}/image`
(302→presigned). Sem `Api__PublicBaseUrl` o JSON ainda cai p/ ~5KB, mas o web não acha a imagem.

### 3. Worker (sem porta) — publica no horário
```bash
cd apps/worker/bin/Debug/net8.0
export DOTNET_ROOT="C:\\Users\\Desktop\\.dotnet"
export ConnectionStrings__Postgres="Host=localhost;Port=5433;Database=social_ai;Username=social;Password=changeme"
export Publisher__Mode="mock"   # MockPublisher (IG desconectado); "graph" só com token válido
"C:\\Users\\Desktop\\.dotnet\\dotnet.exe" Worker.dll
```
Loga os 6 jobs ("PublishSchedulerJob iniciado", "PublishJob ... modo=mock", etc.).

### 4. Web (porta 3001)
```bash
cd apps/web
# ⚠️ O script `dev` é `next dev` PURO → default :3000. A CORS da API espera :3001 (passo 2).
# Force a porta com PORT=3001, senão o web sobe no :3000 e /content toma CORS-block (tela branca).
PORT=3001 node "/c/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" run dev
```

## Build + migration (precisa do SDK)

```bash
export DOTNET_ROOT="C:\\Users\\Desktop\\.dotnet"
DOTNET="C:\\Users\\Desktop\\.dotnet\\dotnet.exe"
# pare api/worker antes (eles travam SocialAi.Core.dll):
#   taskkill /F /IM Api.exe ; taskkill /F /PID <worker dotnet host>
"$DOTNET" build apps/api/Api.csproj
"$DOTNET" build apps/worker/Worker.csproj
"$DOTNET" build tests/SocialAi.Tests/SocialAi.Tests.csproj
# migration:
export ConnectionStrings__Postgres="Host=localhost;Port=5433;Database=social_ai;Username=social;Password=changeme"
"$DOTNET" ef database update --project libs/SocialAi.Core --startup-project apps/api --no-build
# testes:
"$DOTNET" test tests/SocialAi.Tests/SocialAi.Tests.csproj --no-build
```

## Armadilhas conhecidas (já mordidas — não repita)

- **Build trava com "arquivo bloqueado por Api/.NET Host"**: a api/worker rodando seguram
  `SocialAi.Core.dll`. Pare-os antes de buildar.
- **/content em branco no browser**: CORS. A api default aceita `:3000`; a web é `:3001`. Passe
  `Cors__WebOrigin=http://localhost:3001`.
- **Geração 500 "conexão recusada :4000"**: agents desligado. Suba o agents.
- **agents 401 unauthorized**: api e agents discordam do token interno. Alinhe (ambos com, ou ambos sem).
- **`dotnet ef` diz "No .NET SDKs found"**: faltou `DOTNET_ROOT` apontando p/ o SDK do user-dir.
- **payload de /content ~10MB** (RESOLVIDO — era config, não código): o store de imagem da API
  (`MinioImageStore` + proxy `ContentSlideImageController`) JÁ materializa base64 → MinIO → URL curta;
  só estava OFF nativamente por faltar `Minio__*`. Medido a vivo: com o store ligado o `/content/{id}`
  cai de **10,56MB → ~5KB** (imagem por URL de proxy 302→presigned, base64 zero). Ligue como abaixo.
