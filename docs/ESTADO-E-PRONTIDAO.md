# Estado & Prontidão — mapa para produção real (SOTA)

> **Público:** devs sênior assumindo esta codebase fria (handoff a software house).
> **Pergunta que este doc responde:** *onde estamos, o que já está pronto, o que falta para "cliente
> usando de verdade, impecável, sem bugs, SOTA" — e em que ordem fazer.*
>
> **Método:** auditoria em 6 dimensões (publicação real · loop/aprendizado · pipeline/qualidade ·
> segurança/multi-tenancy · UX/a11y · escala/operação), cada achado **verificado no código a vivo**
> e adversarialmente refutado (a lição do ciclo de hardening: *código que compila e passa nos testes pode não
> funcionar a vivo* — o curl mente, o pixel não). Toda afirmação aqui carrega `arquivo:linha`.
> **Re-verifique antes de confiar** — este doc envelhece; rode `git log` e os gates.

---

> ## 🆕 Atualização de autonomia (2026-07-04) — elos de integração FECHADOS
> Sobre a entrega de 2026-07-01 (abaixo), os 4 elos de integração que faltavam foram **cabeados** (código +
> testes):
> - **O robô DISPARA a geração de arte REAL** (task 2.3): `PostingScheduleJob` virou 2 fases — Fase A
>   (é hora + gates soberanos) chama o novo `AgentsStartClient` (worker→agents, mesma pipeline do wizard) →
>   `Content{Generating,JobId}`; o `GeneratingReaperJob` já-existente reconcilia; **Fase B** colhe a arte
>   pronta, aplica o gate e agenda. Sem chave de IA → não gera (degradado honesto). +reclaim de pauta órfã.
> - **Fio robô→analyzer ponderado** (3.4): `WeightedScore`/`PickBestFormat` movidos p/ `Core`
>   (`Domain/MetricScoring.cs`) + `Learning/WorkspaceLearning.PreferredFormatAsync` — o robô prioriza o
>   formato que pontua alto sob a régua do operador.
> - **Score ponderado no learning summary** (3.3): `WorkspaceLearning.SummaryAsync` (ponto único API+robô)
>   embute a preferência ponderada no summary que **chega aos agentes** — fecha o E2E de aprendizado no braço
>   textual, nos dois fluxos (wizard e robô).
> - **UI da esteira** (2.7): `apps/web/app/(app)/calendar/EsteiraPanel.tsx` (lookahead/editar/lote).
>
> **Resta na Frente 1 (ver ② abaixo):** o braço TIPADO `BuildBestFormatAsync` enviesando o `brand-strategist`
> na geração do WIZARD (o robô já usa o formato ponderado; o wizard segue com o `bestFormat` atual); e o
> `IdeaCandidate` chamar o LLM (segue stub). Loop OFF por padrão.
> **Gates desta sessão: agents 288 · .NET 285 · web typecheck limpo + 164.** Commit `068c31c`.

> ## 🆕 Atualização de autonomia (2026-07-01) — Fases 1–4 do plano `entrega-cliente/tasks.md`
> Sobre a base descrita abaixo, foram **implementadas as 4 fases de autonomia governável**: criativo de
> qualidade (contexto da pauta no prompt de imagem + eixo de qualidade visual com retry), **o robô**
> (`apps/worker/Jobs/PostingScheduleJob.cs` — gera→gate→auto-aprova→agenda, com kill-switch + budget +
> rate-limit soberanos), a régua configurável de "bom post" (`MetricWeightConfig` + `WeightedScore`), e o
> endurecimento (rate-limit, ADR de adaptador de rede, plano .NET LTS). **Detalhe honesto por task e o que
> falta de teste em `docs/entrega-cliente/testers.md`.** _(Fronteira "o robô não dispara a geração real" e
> "fio ponderado pendente" citadas aqui foram **fechadas em 2026-07-04** — ver o bloco acima.)_

## ⓪ Veredito (uma linha)

A refinaria **gera → revisa → agenda → publica (mock)** com qualidade de agência e UX SOTA. Para o
"100% impecável, cliente usando de verdade", falta: **(1)** o loop **aprende só pela metade**, **(2)**
um punhado de **bugs de confiança** (baixo esforço, alto retorno), **(3)** **persistência/backup** de
produção documentada, **(4)** **exercer o publish real** contra a Meta (gated por App Review).
Estimativa honesta: **~80–85%** vs o alvo (o % é grosseiro — o *core path* está ~95%; o que puxa
para baixo é o braço de aprendizado e o endurecimento de operação).

**Gates:** `.NET 246` · `web 177 (+4 axe E2E)` · `agents 237 (+2 skip)` — todos verdes.

> **Status do hardening de entrega:** as Frentes de diagnóstico abaixo foram, em sua maioria,
> **FECHADAS**. O texto das Frentes 1–3 permanece como registro do diagnóstico; o que mudou:
> - **Frente 2 (bugs de confiança) — ✅ FECHADA:** fallback de imagem de elemento agora é o gradiente
>   APEX (data-URI SVG), não `placehold.co`; publish honesto (graph+sem token → Failed, não Published
>   falso); a11y ≥44px + contraste AA; código morto removido; **axe roda 0 violações sérias** (fecha V3).
> - **Frente 3 (persistência/backup) — ✅ FECHADA:** `scripts/backup.sh` + `scripts/restore.sh` +
>   `DEPLOYMENT.md §7b`; **dry-run de restore provado** (28 tabelas recuperadas em banco descartável).
> - **Frente 1 (loop que aprende) — ◑ PARCIAL → muito avançada em 2026-07-04:** a **régua de "bom post" é
>   configurável** (`MetricWeightConfig` + `MetricScoring.WeightedScore`, Fase 3); **o robô** fecha a cadeia
>   gera→gate→agenda **e agora DISPARA a geração de arte real** (worker→agents, task 2.3); o **score ponderado
>   já é injetado no learning summary** que chega aos agentes (3.3), e o robô **prioriza pelo formato ponderado**
>   (3.4). **Resta:** o braço tipado `BuildBestFormatAsync` enviesar o `brand-strategist` na geração do WIZARD,
>   e `IdeaCandidate` chamar o LLM (segue stub). Loop OFF por padrão.
> - **Frentes 4 (publish real) e 5 (escala): inalteradas** — gated por Meta App Review / só sob carga.

---

## ① O que JÁ está SOTA (não reabrir sem causa)

| Área | Estado | Evidência |
|------|--------|-----------|
| **Core path** briefing→gerar→revisar→aprovar→agendar, <5min | ✅ provado E2E | `apps/web/app/(app)/create/page.tsx`; image-gen ‖ quality-validator (`pipeline-v2.ts`) tira ~11s do caminho crítico |
| **Integração Graph API** (container→poll→publish, carrossel/single/story) | ✅ código completo¹ | `apps/worker/Publishing/Publishers.cs:60-172` |
| **Circuit breaker de rate-limit** (fail-closed, anti-ban) | ✅ SOTA | `Publishers.cs:184-215` |
| **Token IG refresh proativo** (janela 24h..50d) | ✅ SOTA | `apps/worker/Jobs/IgTokenRefreshJob.cs` |
| **OAuth Instagram** (state anti-CSRF, consumido atômico, multi-conta/marca) | ✅ SOTA | `apps/api/Features/Instagram/InstagramAuthController.cs` |
| **Multi-tenancy 3 camadas** (leitura/request/escrita) | ✅ testado | `AppDbContext.cs`, `TenantSaveInterceptor.cs`, `TenantFilter.cs` |
| **Secrets AES-GCM** + fail-fast em Production | ✅ SOTA | `SecretProtector.cs`; `apps/api/Program.cs` (boot guard) |
| **Idempotência de publicação** (nunca 2 Success/post → nunca duplica no IG) | ✅ SOTA | índice único filtrado `PublishLog(ScheduledPostId)`; dedup em `PublishJob.cs` |
| **Degraded-mode honesto** (modo simulado sinalizado, insights nunca fabricados) | ✅ SOTA | `PerformanceAnalyzer.cs` (threshold amostra <3); UI rotula "(simulado)" |
| **Imagem de slide via URL/MinIO** (era base64 10,56MB → ~5KB) | ✅ provado no pixel | `MinioImageStore.cs` + proxy `ContentSlideImageController.cs` |
| **Design Spec Compiler** (1 fonte de cor/estética; fallback de fundo = gradiente APEX) | ✅ SOTA | `services/agents/src/brand/design-spec.ts` |

¹ **"Código completo" ≠ "exercido a vivo".** O caminho Graph nunca rodou contra a Meta real (só
MockPublisher). Ver `④ Frente 4`.

---

## ② O que FALTA para o 100% — priorizado por alavancagem no goal

> Goal (a régua): *do briefing ao asset publicável em <5min, qualidade de agência, consistência de
> máquina — uma **refinaria que aprende**, não um gerador de imagem.*
> Classes: 🔴 bloqueante · 🟠 gap-real (cliente sente) · ❓ não-exercido (risco desconhecido).

### Frente 1 — Fechar o loop que APRENDE (cumpre a promessa central) · esforço médio · 🟠 → ◑ muito avançada (2026-07-04)

O loop **fecha na maior parte, hoje** (era "pela metade" antes de 2026-07-04):

- ✅ O braço **textual** funciona **e agora carrega a régua ponderada**: `BuildLearningSummaryAsync`
  (delega a `WorkspaceLearning.SummaryAsync`, Core) → `brandContext.learningSummary` → **chega aos
  agentes** (`services/agents/src/agents/input-adapter.ts:179`). O summary passou a **embutir o formato
  preferido sob a régua do operador** (`MetricWeightConfig`) quando difere do engajamento bruto (task 3.3).
  A UI `/create` pré-seleciona o formato recomendado (A7/A8).
- ✅ O braço autônomo (**o robô**) fecha o loop de ponta a ponta: **prioriza o formato ponderado**
  (`WorkspaceLearning.PreferredFormatAsync` → `ThemeSelection`, task 3.4) e **dispara a geração de arte
  real** (task 2.3). O E2E de aprendizado no braço do robô está fechado.
- ❌ O braço **tipado no WIZARD** segue parcial: `PerformanceAnalyzer.BuildBestFormatAsync`
  (`apps/api/Features/Learning/PerformanceAnalyzer.cs`) é enviado como `bestFormat` ao agents pelo
  `ContentController`, mas **não enviesa estruturalmente** o `brand-strategist` (que fixa o pool e deixa
  o LLM escolher: `services/agents/src/agents/brand-strategist.ts`). O robô já usa o formato ponderado; o
  wizard, não.
- ❌ O **IdeaCandidate** (invenção de pauta quando a fila esvazia) gera **texto fixo** e o `Rationale`
  **afirma usar dados que não usa** (`apps/worker/Jobs/AutonomousLoopJob.cs:104-105`) — desonesto (fere
  L4/L5). Promover essa ideia cria pauta com Objective/Context vazios. **Não confundir com o robô
  (`PostingScheduleJob`)**, que consome pautas reais e agora gera arte real — este item é só do
  `AutonomousLoopJob`.

**Pronto quando:** (a) `BuildBestFormatAsync` enviesa o `brand-strategist` na geração do WIZARD (o robô já
enviesa); (b) IdeaCandidate chama o LLM + `BuildLearningSummaryAsync`, com Rationale honesto. **É conectar,
não construir.**
**Nota:** o loop autônomo é entregue **OFF por design** (`Loop:Enabled=false`, decisão de segurança —
ver `⑤`); isto corrige o *conteúdo* do loop, não muda o default.

### Frente 2 — Bugs de confiança (impecável no dia-1) · ✅ FECHADA (hardening de entrega)

> **Status: FECHADA.** Os 4 bugs abaixo foram corrigidos no hardening de entrega (commit `fix: bugs de
> confiança`), com testes e axe a vivo. O texto fica como registro do diagnóstico; cada item agora traz o fix aplicado.

1. ~~**Fallback de imagem externo e feio**~~ → **FECHADO:** falha de elemento de imagem agora cai no
   **gradiente APEX** (data-URI SVG via `gradientCssToSvgDataUri`), não mais numa URL de placeholder de
   terceiros. Mesmo fallback do background; renderiza no HTML e no rasterizer. `image-generator.ts` · +1 teste.
2. ~~**a11y mobile**~~ → **FECHADO:** alvos de toque ≥44px (hit-area via pseudo-elemento `before:` em
   `calendar`/`approvals`) + contraste de texto secundário subido ao mínimo AA (`text-ink/{45..60}`→`/65`,
   cálculo WCAG real). **axe roda 0 violações sérias** no percurso dashboard→create→approvals→calendar
   (`apps/web/e2e/a11y.spec.ts` — fecha `③ V3`).
3. ~~**Falha silenciosa de publicação**~~ → **FECHADO:** em modo graph, cair no `MockPublisher` (conta
   desconectada) agora marca `Failed` honesto com motivo claro — não `Published` falso. Regra pura
   `IsUnintendedMockFallback` (`PublishJob.cs`) · +5 testes (`PublishHonestyTests`); badge "demonstração"
   no histórico só para mock legítimo.
4. ~~**Código morto**~~ → **FECHADO:** `parseOutput()` em `image-generator.ts` agora lança erro
   explicativo ("não suportado por design, agente determinístico"), não mais `Method not implemented`.

### Frente 3 — Persistência/backup de produção · esforço baixo · 🔴 (único bloqueante não-config)

`docker-compose.yml` declara volumes nomeados (`postgres-data`, `minio-data`) — funciona em dev, mas
**não há playbook de backup/recovery** nem mapeamento explícito para disco host persistente em
`docs/DEPLOYMENT.md`. Crash de máquina antes de o cliente configurar backup = **perda total**
(posts, histórico, tokens IG cifrados) **irrecuperável**. **Pronto quando:** volumes mapeados para
disco host documentados + script de backup/restore Postgres+MinIO + nota no boot/DEPLOYMENT.

### Frente 4 — Exercer o publish real · config-cliente + 1 sessão a vivo · ❓ não-exercido

O código Graph é completo (ver `①`). O que falta é **rodar de verdade**: Meta App Review (semanas,
config-cliente) + flip `PUBLISHER_MODE=graph` (config, nunca código — `Publishers.cs`) + **1 smoke
test real** (single post, carrossel ≥2, rate-limit real). Endurecer parsing otimista ao exercer
(`GetProperty("id")!` → defensivo). Sair de "não-exercido" é a única forma de fechar o risco residual
de edge-cases da Graph viva.

### Frente 5 — Escala multi-instância · esforço alto · 🟡 (só morde sob carga — adiável)

Só relevante com carga real / múltiplas réplicas — o cliente V1 (1 deploy, 1 worker, 1 operador)
**não sente**. Mitigado hoje pelo índice único (nunca 2 Success) e commit-por-item. Itens:
- Worker sem **leader-election/lock distribuído**: N réplicas rodam os mesmos jobs; janela de corrida
  onde 2 workers fazem 2 `CreateContainer` para o mesmo post antes do índice barrar.
- Sem **dead-letter** para `Pending` acumulado se a Meta cair 24h+ (fila cresce no banco).
- **Throughput dos agents:** 1 container, pipeline 60-120s, sem horizontal scaling → 3+ gerações
  simultâneas serializam (cap ~1 job/2min) → meta <5min violada sob concorrência.
- **Job store in-memory** dos agents (`services/agents/src/jobs.ts`) perde órfãos no restart — o
  `GeneratingReaperJob` cobre (vira `Failed` após 10min), mas há janela.

---

## ③ Verificações que NUNCA foram exercidas (risco desconhecido, não "não-testado")

| Cód | O quê | Por quê importa | Onde |
|-----|-------|-----------------|------|
| **V1** | Publish REAL no Instagram | só MockPublisher rodou; a Graph viva pode ter edge-cases | Frente 4 |
| **V2** | Loop autônomo LIGADO | `Loop:Enabled=false` default; só os gates foram testados | `AutonomousLoopJob.cs` |
| **V3** | a11y E2E (axe/leitor de tela/zoom 200%/reduced-motion) | nunca rodou; alvos corrigidos por medição manual, não por axe | Frente 2.2 |
| **V4** | Escala/carga/concorrência | sem teste de stress | Frente 5 |

---

## ④ Dívida-aceita (cortes conscientes — não são "falta", não reabrir sem causa)

- **Loop autônomo OFF por padrão** (`Loop:Enabled=false`) — decisão de **segurança** (kill-switch +
  budget cap + moderação humana). O *estado OFF* é correto; o *conteúdo* do loop é a Frente 1.
- **Publish real depende de Meta App Review** — fronteira config-cliente, não gap de código.
- **Story/Carousel fixo em 4:5** (1080×1350); sem 9:16 (Stories/Reels) nem vídeo. MVP = Feed estático.
- **Referências visuais da marca** coletadas pela API mas não consumidas no pipeline (`input-adapter.ts`).
- **JWT na query da URL de imagem** (`?access_token=`) — trade-off necessário (`<img>`/CSS não mandam
  header Authorization); mitigado por HTTPS + TTL curto + escopo só `/image`. 
- **Métricas via mock** sem token IG — loop treinaria de dado sintético rotulado `Source=Mock`.
- **6 vulns de dependência DEV-only** (vite/vitest/esbuild) — não afetam runtime.
- **Migrations no boot** com retry 10x→fatal se Postgres indisponível >30s (restart loop — correto:
  melhor não subir sem schema; exige playbook de recovery — Frente 3).

> Ledger canônico de escopo/dívida: `docs/entrega-cliente/MATRIZ-ESCOPO-ENTREGA.md`.

---

## ⑤ Roadmap para 100% (atualizado pós-hardening de entrega)

- ~~**Frente 3 — Persistência/backup**~~ → ✅ **FECHADA** (scripts + DEPLOYMENT §7b + dry-run provado).
- ~~**Frente 2 — Bugs de confiança**~~ → ✅ **FECHADA** (fallback branded, publish honesto, a11y+axe, código morto).
- **Frente 1 — Loop que aprende** → ◑ **PARCIAL:** sinal tipado cabeado (não é mais teatro); resta só
  `IdeaCandidate` chamar o LLM (declarado; loop OFF por padrão).
- **Frente 4 — Publish real** *(❓, config + 1 sessão)* — gated por Meta App Review. Exercer o path
  graph a vivo e endurecer parsing otimista. **Próximo passo natural** quando a Meta liberar.
- **Frente 5 — Escala** *(🟡, alto)* — adiável até o primeiro cliente multi-instância / carga real.
- **Hardening de 1º deploy** *(baixo, 1 sessão)* — fechado na revisão QA: fail-fast do
  `AGENTS_INTERNAL_TOKEN`, validação defensiva de input no pipeline, scripts de backup sem injeção,
  `web` espera API saudável. Resta: validação de hex/focalPoint no render-engine (defensivo, baixo).

> **Onde focar agora:** o produto está pronto para cliente/teste. Para **produção real** com credenciais
> de cliente, o caminho é Frente 4 (Meta App Review, externo) + o resíduo defensivo do render-engine.

---

## ⑥ Como verificar este doc (não confie — meça)

```bash
# Gates (devem dar .NET 246 · web 177 (+4 axe E2E) · agents 237+2skip)
dotnet test tests/SocialAi.Tests/SocialAi.Tests.csproj          # PARE api+worker antes (travam Core.dll)
cd apps/web && npm run typecheck && npm test                    # tsc 0 · vitest 177
cd apps/web && npm run test:a11y                                # 4 axe E2E (0 violações sérias) — sobe o Next
cd services/agents && npm run typecheck && npm test             # tsc 0 · vitest 237 (+2 skip)

# Confirmar os achados deste doc (cada um é grep de 1 linha):
grep -n "placehold.co"           services/agents/src/agents/image-generator.ts   # Frente 2.1 → :183
grep -n "Method not implemented" services/agents/src/agents/image-generator.ts   # Frente 2.4 → :191
grep -rn "BuildBestFormatAsync"  apps libs --include=*.cs                        # Frente 1: só a definição (órfão)
grep -n "Baseada em"             apps/worker/Jobs/AutonomousLoopJob.cs           # Frente 1: Rationale fixo → :105
grep -n "learningSummary"        services/agents/src/agents/input-adapter.ts     # braço textual fecha → :179
```

> **Como rodar o stack nativo neste host:** `docs/RUN-NATIVE.md` (inclui §2b: ligar o MinIO + o store
> de imagem, e a armadilha `PORT=3001`). **Operação/credenciais/modos:** `docs/DEPLOYMENT.md`.
> **Arquitetura canônica:** `ARCHITECTURE.md`.
