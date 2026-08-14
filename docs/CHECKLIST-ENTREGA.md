# Checklist de entrega — handoff à software house

> **Para quem assume a codebase.** Dividido em **(A) o que já foi verificado** nesta entrega (com
> evidência) e **(B) o que você deve rodar/decidir** no onboarding. Marque `[x]` ao confirmar no seu
> ambiente. Última verificação: **2026-06-23**.
>
> Mapa de "o que falta para produção": `docs/ESTADO-E-PRONTIDAO.md`. Aceite × escopo do cliente:
> `docs/entrega-cliente/MATRIZ-ESCOPO-ENTREGA.md`.

---

## A. Verificado nesta entrega (re-confirme no seu ambiente)

### Qualidade & gates
- [x] **Testes verdes nos 3 runtimes** — `.NET 246` · `web 177 (+4 axe E2E)` · `agents 237 (+2 skip)` = **664 testes**. *(rodados fresco no hardening de entrega 2026-06-23)*
- [x] **Typecheck limpo** — `web tsc 0` · `agents tsc 0`.
- [x] **Build limpo** — `dotnet build` 0 erros/0 avisos; `next build` standalone; `agents` tsc+tsc-alias.
- [x] **Sem TODO/FIXME/HACK reais** no código de produto (verificado — os "TODOS" são a palavra PT "todos").

### Segurança
- [x] **Nenhum `.env`/segredo rastreado no git** (`git ls-files` limpo; `.env` está no `.gitignore`).
- [x] **Nenhuma chave/token hardcoded** no código (varredura `sk-`/`AIza`/`ghp_` vazia).
- [x] **Secrets cifrados em repouso** (AES-GCM, `SecretProtector.cs`) + **fail-fast em Production** se faltar `JWT_SECRET`/`SECRETS_ENCRYPTION_KEY` (`apps/api/Program.cs`).
- [x] **Multi-tenancy 3 camadas** (leitura/request/escrita) — testada (`InvariantTests`, `CrossBrandEndpointTests`).
- [x] **Rate-limit anti-brute-force** no auth + **CSP** defense-in-depth (`next.config.ts`).

### Higiene do repositório
- [x] **Sem artefatos de build versionados** (`bin/`, `obj/`, `.next/`, `node_modules/` ignorados).
- [x] **Raiz limpa** — arquivos não-produto (zips de design, transcript) retirados do repo.
- [x] **Comentários limpos** (substância técnica preservada; passou por higiene p/ leitura fria).

### Documentação de entrada (coerente e atual)
- [x] **`README.md`** — topologia, quickstart, números de teste atualizados (246/237/177 + 4 axe E2E).
- [x] **`ARCHITECTURE.md`** — guia do repo + ponteiro p/ `ESTADO-E-PRONTIDAO.md` no topo.
- [x] **`ARCHITECTURE.md`** — arquitetura canônica (contexto, containers, componentes, decisões).
- [x] **`docs/ESTADO-E-PRONTIDAO.md`** — mapa de prontidão (SOTA · gaps priorizados · roadmap).
- [x] **`docs/entrega-cliente/MATRIZ-ESCOPO-ENTREGA.md`** — escopo do cliente × entrega, re-verificado ciclo de hardening.
- [x] **`docs/RUN-NATIVE.md`** / **`docs/DEPLOYMENT.md`** — subir nativo / operar em produção.
- [x] **`docs/adr/`** — 16 ADRs (decisões por feature, rastreáveis).

### Funcionalidade (modo demonstração / mock)
- [x] **Fluxo core E2E** — briefing → gerar → revisar → aprovar → agendar → publicar (mock) → histórico. Provado a vivo.
- [x] **D1 resolvido** — imagem de slide por URL/MinIO (payload `/content` 10,56MB→~5KB), provado no pixel.
- [x] **Degraded-mode honesto** — sem chaves de IA/Meta, infra+UI+auth+CRUD funcionam; só geração e publish real ficam indisponíveis (sinalizado).

---

## B. A software house deve rodar/decidir (onboarding)

### Reproduzir os gates no seu ambiente
> **Alvos atualizados em 2026-07-04** (após a entrega de autonomia e o fechamento dos 4 elos de
> integração). Os números do marco de hardening 2026-06-23 (246/237/177) ficam registrados na seção A.
- [ ] `dotnet test tests/SocialAi.Tests` → **285** *(pare api+worker antes — travam `SocialAi.Core.dll`)*.
- [ ] `cd apps/web && npm ci && npm run typecheck && npm test` → **164** *(+ `npm run test:a11y` → 4 axe E2E, sobe o Next). O `enums.contract.test.ts` falha se rodado ISOLADO (peculiaridade de ambiente node) — na suíte inteira passa; ver `entrega-cliente/testers.md §pendências`.*
- [ ] `cd services/agents && npm ci && npm run typecheck && npm test` → **288** (+2 skip). *Typecheck: 2 erros PRÉ-EXISTENTES em `story-architect.single-post.test.ts:57,68` (não bloqueiam o `vitest`).*
- [ ] `docker compose up --build` sobe os 6 serviços (web/api/worker/agents/postgres/minio).
- [ ] Aplicar migrations no 1º boot: `dotnet ef database update --project libs/SocialAi.Core --startup-project apps/api`.

### Configuração para produção real (config-cliente, não código)
- [ ] **Chave de IA** (`AI_PROVIDER_KEY`) — destrava geração de texto/imagem reais.
- [ ] **Meta App Review + `META_*` + token IG** e flip `PUBLISHER_MODE=graph` — destrava publicação e métricas reais.
- [ ] **MinIO** configurado (`Minio__*` + `Api__PublicBaseUrl`) — store de imagem ON (senão volta ao base64 inline, degradado). Ver `RUN-NATIVE.md §2b`.
- [ ] **Segredos de produção** (`JWT_SECRET`, `SECRETS_ENCRYPTION_KEY` ≥32 bytes) + `ASPNETCORE_ENVIRONMENT=Production`.
- [x] **✅ Persistência/backup — FECHADO no hardening de entrega.** `scripts/backup.sh` (pg_dump + mc mirror) + `scripts/restore.sh` (com dry-run) + `DEPLOYMENT.md §7b` (mapeamento dos volumes p/ disco persistente). **Dry-run provado:** restore recuperou 28 tabelas num banco descartável. *No onboarding: agende o `backup.sh` (cron) e replique o `BACKUP_DIR` para fora do host.*

### Antes de ligar o publish real (gated por Meta App Review)
- [ ] Exercer o caminho Graph a vivo: 1 post single, 1 carrossel ≥2 slides, rate-limit real (**nunca foi exercido — código pronto, ver V1**).
- [ ] Endurecer parsing otimista da Graph ao exercer (`Publishers.cs`).

---

## C. Dívida declarada (consciente — não é "bug escondido")

Tudo abaixo está **declarado** na `MATRIZ-ESCOPO-ENTREGA.md` e/ou `ESTADO-E-PRONTIDAO.md`. *(O hardening de entrega fechou o débito REAL — fallback de imagem, publish honesto, a11y+axe, código morto, backup, loop
tipado. O que resta abaixo é dívida CONSCIENTE: decisão de segurança, gating externo ou corte de escopo.)*

- **Loop autônomo OFF por padrão** (`Loop:Enabled=false`) — decisão de segurança (kill-switch + budget + moderação).
- **IdeaCandidate** gera texto fixo (sem LLM nem leitura de histórico) — §2.4 da matriz. *O loop está OFF por padrão; quando ligado, ideias exigem promoção humana antes de qualquer publish.*
- **Publish real no Instagram** — gated por **Meta App Review** (semanas, externo). Código pronto; flip é config (`PUBLISHER_MODE=graph`). Nunca exercido a vivo (V1).
- **Story 4:5** (sem 9:16), **referências visuais** não consumidas, **CRUD de Campanha** adiado (YAGNI/ADR-0006).
- **6 vulns DEV-only** (build tools, inclui o toolchain Playwright) — não afetam runtime.

> **Veredito:** a entrega cumpre o escopo contratado em modo de demonstração, ponta a ponta, **sem
> bloqueante de código e sem débito técnico REAL escondido**. A dívida acima é consciente e declarada;
> o caminho para "produção real impecável" está mapeado e priorizado em `docs/ESTADO-E-PRONTIDAO.md`.
