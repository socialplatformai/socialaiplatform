# Plano de migração .NET 8 → LTS (task 4.6)

> Fase 4 / task 4.6 · Data: 2026-07-01 · Status: **plano (migração não urgente)**

## Situação

Os serviços .NET (`apps/api`, `apps/worker`, `libs/SocialAi.Core`) rodam em **.NET 8** (LTS).
O SDK instalado na máquina de build é **10.0.x** (compila 8.0 sem problema — o `TargetFramework`
dos csproj é `net8.0`). O EF tool usado para migrations é o 10.0.9 (compatível com o provider 8.x).

## Ciclo de vida (fato)

- **.NET 8**: LTS, suporte até **novembro de 2026**.
- **.NET 10**: LTS mais recente, já disponível no SDK local.
- A janela de migração deve fechar **antes de nov/2026** para não rodar em runtime sem suporte.

## Plano (quando migrar)

1. **Bump do TargetFramework**: `net8.0` → `net10.0` nos 3 csproj (api, worker, Core) + o de testes.
2. **Pacotes**: subir `Microsoft.EntityFrameworkCore.*`, `Npgsql.EntityFrameworkCore.PostgreSQL` e
   demais deps para as versões 10.x. Verificar breaking changes do EF (query filters, interceptors —
   invariantes de multi-tenancy do projeto dependem deles).
3. **Imagens Docker**: trocar as tags base `mcr.microsoft.com/dotnet/{aspnet,runtime,sdk}:8.0` → `:10.0`.
   O worker usa a imagem `runtime` menor; a api usa `aspnet`.
4. **Migrations**: rodar a suíte `dotnet test` (273 testes hoje) — as migrations e o snapshot são
   gerados pelo EF; um bump de versão pode reescrever o `AppDbContextModelSnapshot`. Conferir diff.
5. **Verificação**: `dotnet build` + `dotnet test` + subir `docker compose up --build` e validar o
   boot fail-fast de secrets (Production) e o fluxo de publicação mock end-to-end.

## Risco / mitigação

- **Baixo risco** de código de app (o projeto não usa APIs à beira de remoção). O risco concentra-se
  em EF/Npgsql (as 3 camadas de tenancy) — daí a suíte de invariantes ser o gate de aceite da migração.
- **Não bloqueia** as Fases 1-3: é higiene de runtime, independente das features de autonomia.
