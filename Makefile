# Comandos unificados para o monorepo (.NET + Node).
# Um só vocabulário para as duas linguagens. Rode `make` ou `make help` para a lista.
#
# Requer: Docker + Docker Compose (caminho canônico). Para os alvos nativos
# (build/test/typecheck sem Docker): .NET SDK 8 e Node 20.

.DEFAULT_GOAL := help
.PHONY: help up down logs ps build test typecheck lint clean migrate

help: ## Lista os comandos disponíveis
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

## --- Stack (Docker Compose) ------------------------------------------------

up: ## Sobe os 6 serviços (web, api, worker, agents, postgres, minio)
	docker compose up --build -d

down: ## Derruba a stack (preserva os volumes)
	docker compose down

logs: ## Acompanha os logs de todos os serviços
	docker compose logs -f

ps: ## Mostra o estado dos serviços
	docker compose ps

## --- Build / verificação (nativo, sem Docker) -----------------------------

build: ## Compila tudo (.NET + agents + web)
	dotnet build
	cd services/agents && npm run build
	cd apps/web && npm run build

test: ## Roda as três suítes de teste (.NET 165 · agents 164 · web 75)
	dotnet test tests/SocialAi.Tests/SocialAi.Tests.csproj
	cd services/agents && npm test
	cd apps/web && npm test

typecheck: ## Checagem de tipos (agents + web)
	cd services/agents && npm run typecheck
	cd apps/web && npm run typecheck

lint: ## Lint do web (Next.js)
	cd apps/web && npm run lint

migrate: ## Aplica as migrations do banco (1ª subida nativa)
	dotnet ef database update --project libs/SocialAi.Core --startup-project apps/api

clean: ## Remove artefatos de build (bin/obj, .next, dist)
	dotnet clean
	rm -rf apps/web/.next services/agents/dist
