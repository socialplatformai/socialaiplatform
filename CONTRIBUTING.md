# Contribuindo

Guia rápido para trabalhar neste repositório. Para a arquitetura, ver
[`ARCHITECTURE.md`](ARCHITECTURE.md); para subir e operar, ver [`README.md`](README.md).

## Pré-requisitos

| Ferramenta | Para quê |
|------------|----------|
| Docker + Docker Compose | Caminho canônico — sobe os 6 serviços |
| .NET SDK 8 | Rodar/testar `api`, `worker`, `libs/SocialAi.Core` sem Docker |
| Node 20 | Rodar/testar `agents` e `web` sem Docker (`nvm use` lê o `.nvmrc`) |

## Subir e verificar

Há um `Makefile` com um vocabulário único para as duas linguagens:

```bash
make up         # sobe a stack (docker compose up --build -d)
make test       # roda as três suítes (.NET 165 · agents 164 · web 75)
make typecheck  # checagem de tipos (agents + web)
make build      # compila tudo
make help       # lista todos os comandos
```

Sem `make`, os comandos equivalentes estão no [`README.md`](README.md) e no
[`docs/sot/04-instalacao.md`](docs/sot/04-instalacao.md).

> Sem chaves de IA/Meta, a stack sobe em **modo degradado** (infra + UI + auth + CRUD
> funcionam; geração e publicação real ficam indisponíveis). É um estado de primeira
> classe, não um erro.

## Estrutura

| Caminho | Runtime | Papel |
|---------|---------|-------|
| `apps/web` | Next.js 15 | Interface do operador |
| `apps/api` | .NET 8 Web API | Autenticação, multi-tenancy, orquestração |
| `apps/worker` | .NET 8 | Tarefas periódicas 24/7 |
| `services/agents` | Node 20 + TS | Pipeline de geração (6 agentes) |
| `libs/SocialAi.Core` | .NET 8 | Domínio + dados + segredos, compartilhado por `api` e `worker` |

A API segue **feature-folder** (`apps/api/Features/<Área>/`: controller + DTOs + serviços
juntos). O front separa os clientes de API por domínio (`apps/web/lib/{brand,content,pautas,…}.ts`).

## Banco de dados (migrations)

O `DbContext` vive em `libs/SocialAi.Core` — uma migration afeta **api e worker**. As
migrations são aplicadas automaticamente no boot da API; em desenvolvimento nativo:

```bash
# criar uma migration
dotnet ef migrations add <Nome> --project libs/SocialAi.Core --startup-project apps/api

# aplicar
make migrate    # ou: dotnet ef database update --project libs/SocialAi.Core --startup-project apps/api
```

Mudança de esquema deve ser reversível (`Down()`) e seguir expand → migrate → contract
quando tocar dados existentes.

## Invariantes que não podem quebrar

Cobertos por testes — quebrá-los falha a suíte:

- **Isolamento multi-tenant (3 camadas):** toda entidade nova com dono herda `TenantEntity`
  e entra no filtro de leitura; ver [`ARCHITECTURE.md`](ARCHITECTURE.md) §4.1.
- **Sincronia de enums .NET ↔ TypeScript:** os inteiros em `libs/SocialAi.Core/Domain/Enums.cs`
  são contrato com o front; mudar um lado exige mudar o outro
  (`node scripts/gen-enums.mjs --check`).
- **Aprovação humana antes de publicar** e **idempotência de publicação**.
- **Fail-fast de segredos em Production.**

## Convenções

- **Idioma:** interface, documentação e mensagens de commit em **português do Brasil**.
  Identificadores de código e chaves de configuração permanecem no original.
- **Formatação:** o `.editorconfig` define o padrão (UTF-8, LF, 4 espaços em C#, 2 em
  TS/JS). No .NET, `dotnet format` o respeita.
- **Commits:** descreva *o quê* e *por quê*, de forma concisa.
- **Antes de abrir um PR:** `make test` e `make typecheck` verdes.

## Onde a lógica não-óbvia vive

A tabela de referência (qual arquivo cuida de quê) está em [`ARCHITECTURE.md`](ARCHITECTURE.md) e em
[`docs/sot/06-referencia.md`](docs/sot/06-referencia.md). As decisões de arquitetura por
feature estão em [`docs/adr/`](docs/adr/).
