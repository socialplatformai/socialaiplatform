# 05 — Operação

> Receitas para tarefas operacionais pontuais: preparar para produção, conectar o Instagram, virar
> de publicação simulada para real, gerenciar segredos, fazer backup e ler logs. Cada seção é
> independente. Para subir do zero, ver [04 — Instalação](04-instalacao.md). Termos linkam para o
> [glossário](08-glossario.md).

---

## Índice de receitas

1. [Preparar para entrega real (produção)](#1-preparar-para-entrega-real-produção)
2. [Adicionar a chave de IA (ligar a geração)](#2-adicionar-a-chave-de-ia-ligar-a-geração)
3. [Conectar uma conta do Instagram](#3-conectar-uma-conta-do-instagram)
4. [Virar de publicação simulada para real (mock → graph)](#4-virar-de-publicação-simulada-para-real-mock--graph)
5. [Ligar o loop autônomo](#5-ligar-o-loop-autônomo)
6. [Trocar / rotacionar segredos](#6-trocar--rotacionar-segredos)
7. [Backup e restauração](#7-backup-e-restauração)
8. [Ver logs e diagnosticar publicações](#8-ver-logs-e-diagnosticar-publicações)
9. [Mudar a URL da API do front-end](#9-mudar-a-url-da-api-do-front-end)
10. [Rodar os testes e o smoke E2E (verificação rápida)](#10-rodar-os-testes-e-o-smoke-e2e-verificação-rápida)
11. [Aplicar migrations de banco com segurança (runbook)](#11-aplicar-migrations-de-banco-com-segurança-runbook)

---

## 1. Preparar para entrega real (produção)

Por padrão a plataforma sobe em modo de **desenvolvimento**. Para entregar a um cliente:

1. No `.env`, defina **as duas** variáveis de ambiente de produção:
   ```bash
   ASPNETCORE_ENVIRONMENT=Production   # afeta a API
   DOTNET_ENVIRONMENT=Production       # afeta o worker
   ```
2. Gere segredos fortes (≥ 32 bytes) **antes do primeiro deploy**:
   ```bash
   openssl rand -base64 48   # use a saída em JWT_SECRET
   openssl rand -base64 48   # use a saída em SECRETS_ENCRYPTION_KEY
   openssl rand -base64 32   # use a saída em AGENTS_INTERNAL_TOKEN
   ```
3. Suba: `docker compose up --build -d`.

**O que muda em produção** (`apps/api/Program.cs`):
- [Fail-fast de segredos](08-glossario.md#fail-fast-de-segredos): a API **recusa subir** se
  `JWT_SECRET` ou `SECRETS_ENCRYPTION_KEY` estiverem ausentes, com o valor default, ou com menos de
  32 bytes.
- Respostas de erro **não vazam stack trace** (resposta neutra no padrão RFC 7807).
- O **Swagger é desativado**.

> **Defina `SECRETS_ENCRYPTION_KEY` antes do 1º deploy.** Trocá-la depois **invalida todos os
> [segredos](08-glossario.md#segredo-secret) já cifrados** (token do Instagram, chaves de IA) — eles
> teriam de ser reconfigurados.

## 2. Adicionar a chave de IA (ligar a geração)

A [geração](03-fluxos.md#2-geração-de-conteúdo-assíncrona) depende do provedor de IA (Gemini por
padrão).

1. Obtenha uma chave: Gemini → https://aistudio.google.com/apikey.
2. No `.env`:
   ```bash
   AI_PROVIDER=gemini
   AI_PROVIDER_KEY=<sua-chave>
   IMAGE_PROVIDER=gemini
   IMAGE_PROVIDER_KEY=<sua-chave>   # pode reusar a mesma chave
   ```
3. Recrie o serviço de agentes (que lê estas variáveis):
   ```bash
   docker compose up -d --build agents
   ```

> Sem a chave, o pipeline falha com mensagem clara — **não** há um caminho degradado dentro do
> pipeline (decisão de projeto; ver [03 — Fluxos](03-fluxos.md#3-o-pipeline-dos-6-agentes-por-dentro)).
> Hoje apenas o provedor **Gemini** está implementado de fato
> (`services/agents/src/image/imageProvider.ts`).

## 3. Conectar uma conta do Instagram

Pré-requisito: um app criado em https://developers.facebook.com/apps com o produto **Instagram**,
usando **Instagram Login** (`graph.instagram.com`), **não** Facebook Login.

1. No `.env`, configure as credenciais do app e o callback:
   ```bash
   META_APP_ID=<app-id>
   META_APP_SECRET=<app-secret>
   META_REDIRECT_URI=https://api.seu-dominio.com/api/instagram/callback
   ```
   *(As credenciais do app Meta também podem ser cadastradas pela interface, por um `Admin`, em
   Configurações → Conexão Instagram; nesse caso ficam [cifradas](08-glossario.md#aes-gcm) no banco e
   o `.env` é só fallback.)*
2. Recrie a API: `docker compose up -d --build api`.
3. Na interface, como `Admin`: **Configurações → Conexão Instagram → Conectar conta** — fluxo
   [OAuth](08-glossario.md#oauth) em um clique (ver
   [03 — Fluxos](03-fluxos.md#6-conexão-com-o-instagram-oauth)).

O [token](08-glossario.md#token-de-acesso-do-instagram) de longa duração (60 dias) é guardado
cifrado e **renovado automaticamente** pelo worker (`IgTokenRefreshJob`, tick diário, janela de 50
dias antes do vencimento). Se a renovação falhar, a conta é marcada como desconectada e a interface
pede reconexão — sem falha silenciosa.

## 4. Virar de publicação simulada para real (mock → graph)

A passagem de [mock](08-glossario.md#mock-modo-mock) para
[graph](08-glossario.md#graph-modo-graph) é **só configuração**.

**Pré-requisitos (os três):**
1. **[App Review](08-glossario.md#app-review-meta) da Meta aprovado** (leva semanas) — necessário
   para publicar em contas que não as de teste.
2. Uma **conta do Instagram conectada** (receita 3) com token válido.
3. **`MINIO_PUBLIC_BASE_URL`** apontando para um host alcançável pela internet (a
   [Graph API](08-glossario.md#graph-api) baixa a imagem de lá).

**Passos:**
```bash
# no .env
PUBLISHER_MODE=graph
MINIO_PUBLIC_BASE_URL=https://midia.seu-dominio.com   # NÃO use minio:9000 nem localhost
```
```bash
docker compose up -d --build worker
```

> **O worker recusa subir** em `PUBLISHER_MODE=graph` se `MINIO_PUBLIC_BASE_URL` estiver vazio ou
> apontar para `minio:9000`/`localhost`/`127.0.0.1` (`apps/worker/Program.cs`) — porque a Graph API
> não conseguiria baixar a imagem de um host interno. É melhor não subir do que falhar na publicação.

**Como confirmar:** agende um conteúdo aprovado e observe o
[PublishLog](08-glossario.md#publishlog-registro-de-publicação) (receita 8). Em modo graph, um
sucesso registra o `RemoteId` (id da mídia no Instagram).

Para reverter, basta `PUBLISHER_MODE=mock` e recriar o worker — sem mudança de código.

## 5. Ligar o loop autônomo

O [loop autônomo](08-glossario.md#loop-autônomo) vem **desligado por padrão** e tem travas em
camadas. Para ligá-lo:

1. **Chave geral** (global): defina `Loop__Enabled=true` no ambiente do worker.
2. **Por workspace:** ative `Budget.AutonomousLoopEnabled` e defina um teto de gasto mensal
   `Budget.MonthlyCapUsd` (o `Budget` é criado no registro do workspace).

O loop só cria [IdeaCandidates](08-glossario.md#ideacandidate-candidato-a-ideia) quando a fila de
[pautas](08-glossario.md#pauta) está vazia e o gasto do mês está abaixo do teto (ver as quatro travas
em [03 — Fluxos](03-fluxos.md#7-loop-autônomo)).

Os [IdeaCandidates](08-glossario.md#ideacandidate-candidato-a-ideia) gerados aparecem na tela
**Ideias** (`/ideas`), onde um humano os **promove** a pauta (`POST /api/ideas/{id}/promote`). Ideias
nunca são publicadas sem essa promoção — a aprovação humana é uma trava de moderação.

> **Parcial declarado (honesto):** a *geração* de ideias do loop é hoje um rascunho de texto fixo —
> ainda não chama o modelo de IA nem lê o histórico de performance. O fluxo de promoção (interface +
> endpoint) está completo; o que evolui é a qualidade da ideia gerada. Ver
> [09 — Roadmap](09-roadmap.md).

## 6. Trocar / rotacionar segredos

| Segredo | Efeito de trocar | Procedimento |
|---------|------------------|--------------|
| `SECRETS_ENCRYPTION_KEY` | **Invalida todos os segredos cifrados** (token IG, chaves). | Evite após o 1º deploy. Se inevitável: reconfigurar o Instagram e as chaves de IA depois da troca. |
| `JWT_SECRET` | Invalida todas as sessões ativas (tokens existentes deixam de validar). | Troque e recrie API + worker; os usuários refazem login. |
| `AGENTS_INTERNAL_TOKEN` | API e agents param de se entender até ambos terem o mesmo valor. | Atualize o `.env` e recrie **api e agents** juntos. |
| `AI_PROVIDER_KEY` / chaves do app Meta | Afeta geração / publicação. | Atualize o `.env` (ou, no caso do Meta, pela interface) e recrie o serviço que a usa. |

Os [segredos](08-glossario.md#segredo-secret) guardados por workspace (token IG, chaves de IA,
segredo do app Meta) ficam [cifrados](08-glossario.md#aes-gcm) na tabela `Secret` e **nunca são
devolvidos** por nenhuma consulta de leitura.

## 7. Backup e restauração

O estado persistente está em **dois volumes** do Docker: o do PostgreSQL (dados) e o do MinIO
(mídia).

**Backup do banco (PostgreSQL):**
```bash
docker compose exec postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup-$(date +%F).sql
```

**Restauração do banco:**
```bash
cat backup-AAAA-MM-DD.sql | docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

**Mídia (MinIO):** copie o conteúdo do bucket de mídia (via console em :9001 ou cliente S3/`mc`), ou
inclua o volume `minio-data` no seu backup de volumes do Docker.

> **Cuidado com o `SECRETS_ENCRYPTION_KEY`:** um backup do banco só é útil se você também guardar
> (em local seguro e separado) a chave de cifra — sem ela os segredos cifrados no dump não podem ser
> decifrados.

## 8. Ver logs e diagnosticar publicações

**Logs de um serviço:**
```bash
docker compose logs -f worker   # tarefas de segundo plano (publicação, métricas, loop)
docker compose logs -f api      # requisições, boot, migrations
docker compose logs -f agents   # pipeline de geração
```

**Estado de uma publicação** está na tabela
[PublishLog](08-glossario.md#publishlog-registro-de-publicação), que registra resultado
(`Pending`/`Success`/`Error`/`Skipped`), a resposta da Graph API, o erro (se houver), o `RemoteId` e
um identificador de correlação para rastrear ponta a ponta. Consulta exemplo:

```bash
docker compose exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c 'SELECT "Id","Result","Attempts","Error","CreatedAt" FROM "PublishLogs" ORDER BY "CreatedAt" DESC LIMIT 20;'
```

**Sinais úteis:**
- Conteúdo preso em `Generating` por mais de 10 min é marcado como `Failed` pelo
  [reaper](08-glossario.md#reaper-ceifador).
- Métricas hoje são **simuladas** mesmo com token real (o parse dos insights reais ainda não está
  implementado) — ver [09 — Roadmap](09-roadmap.md).

## 9. Mudar a URL da API do front-end

`NEXT_PUBLIC_API_URL` é **build-time**: o Next.js a embute no bundle no momento do build, não na
subida do container. Por isso ela é um *build arg* no `docker-compose.yml`.

```bash
# no .env
NEXT_PUBLIC_API_URL=https://api.seu-dominio.com
```
```bash
docker compose build web && docker compose up -d web   # rebuild obrigatório
```

> Trocar a variável e só reiniciar o container **não** tem efeito — é preciso **rebuildar** o web.

## 10. Rodar os testes e o smoke E2E (verificação rápida)

A malha de testes (Fundação de QA, [ADR-0001](../adr/0001-fundacao-qa.md)) cobre três frentes; rode
as três antes de mergear uma mudança ou após um deploy.

**Testes automatizados** (não precisam da stack no ar):
```bash
dotnet test tests/SocialAi.Tests/SocialAi.Tests.csproj   # invariantes multi-tenant/segurança (10)
cd services/agents && npm test                            # input-adapter (coleta↔engine)
cd apps/web        && npm test                            # componentes de UI + contrato de enums
```

> **Contrato de enums .NET↔TS:** `apps/web/lib/enums.contract.test.ts` fica **vermelho** se um valor
> de `libs/SocialAi.Core/Domain/Enums.cs` divergir do espelho TS da UI (`lib/pautas.ts`,
> `lib/content.ts`). Ao mudar um enum, regenere o espelho e rode o teste:
> ```bash
> node scripts/gen-enums.mjs        # regenera apps/web/lib/_enums.generated.ts (commitar o diff)
> cd apps/web && npm test           # confirma os dois lados em sincronia
> ```

**Smoke E2E** (precisa da API no ar — verificação rápida **pós-deploy**):
```bash
node scripts/smoke-e2e.mjs                          # contra http://localhost:5080
API_URL=https://api.seu-dominio.com node scripts/smoke-e2e.mjs
```
Roda o fluxo de usuário ponta-a-ponta — registrar → marca → pauta → listar → gerar → checar 401 — e
sai com código **0** (tudo verde) ou **1** (qualquer falha). Em modo degradado (sem chave de IA), o
passo de geração **deve falhar com erro claro** — sucesso silencioso ali seria regressão (o
[modo degradado](08-glossario.md#modo-degradado) é estado de primeira classe, não bug).

## 11. Aplicar migrations de banco com segurança (runbook)

Migrations que mexem em schema **com dados existentes** (ex.: a introdução da Marca, padrão
**expand → migrate → contract**) seguem este runbook. Regra de ouro: **backup antes; reversível sempre**.

**Antes de aplicar (sempre):**
```bash
# 1) BACKUP do banco (não pule — é a rede de segurança)
docker compose exec postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup-pre-migration-$(date +%F-%H%M).sql
# (nativo/sem docker: pg_dump -h localhost -U social social_ai > backup-....sql)
```

**Aplicar:**
```bash
dotnet ef database update --project libs/SocialAi.Core --startup-project apps/api
# (no Docker, a API aplica as migrations no boot — ver §1)
```

**Verificar:** rode uma consulta de sanidade. Para a Marca: toda `Pauta`/`Content`/`BrandKit` tem
`BrandId` **não-nulo** e apontando para uma marca **do mesmo workspace** (zero cross-tenant).

**Reverter (se algo der errado):**
```bash
# volta para a migration anterior pelo nome (Down())
dotnet ef database update <NomeDaMigrationAnterior> --project libs/SocialAi.Core --startup-project apps/api
# se necessário, restaure o backup:
cat backup-pre-migration-AAAA-MM-DD-HHMM.sql | docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

> **expand → migrate → contract** (sem big-bang): a fase **expand** adiciona o novo (colunas
> *nullable*, backfill **idempotente**) sem remover nada; a fase **contract** só endurece (NOT NULL,
> relações finais) **depois** que o backfill foi verificado. Cada migration tem `Down()` testado. A
> migração da Marca foi validada com round-trip Up→Down→Up contra dados reais; o backfill é
> idempotente (rodar 2× não duplica).

---

*Procedimentos conferidos contra `docker-compose.yml`, `apps/api/Program.cs`,
`apps/worker/Program.cs` e `apps/worker/Publishing/`. Para a referência factual completa, ver
[06 — Referência](06-referencia.md).*
