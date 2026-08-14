# testers.md — O que foi feito e o que precisa ser testado

> **Iteração de 2026-07-01.** Executadas em sequência as tasks 1.3 → 4.6 do plano `tasks.md` (Fases 1–4).
> Este documento diz, POR TASK: **o que foi entregue**, **como foi verificado** (com evidência real de
> execução), e **o que ainda precisa de teste manual/E2E** que não pôde ser exercido nesta iteração.
>
> Legenda: ✅ verificado por teste automatizado que RODOU · 🧪 precisa teste manual/E2E · ⚠️ fronteira/dívida declarada.

---

## Resumo de verificação (o que rodou de verdade)

| Camada | Comando | Resultado |
|--------|---------|-----------|
| Agents (TS) | `cd services/agents && npm test` | **288 passed + 2 skipped** (baseline era 277) |
| Agents typecheck | `npm run typecheck` | limpo, exceto **2 erros PRÉ-EXISTENTES** em `story-architect.single-post.test.ts:57,68` (não introduzidos aqui) |
| .NET (api+worker+core) | `dotnet test tests/SocialAi.Tests` | **285 passed** (era 276; +9 nesta iteração de 2026-07-03: harvest do robô + reclaim de pauta órfã + scoring/summary ponderado em Core) |
| Web typecheck | `cd apps/web && npm run typecheck` | limpo (0 erros) |
| Web testes | `cd apps/web && npm test` | **164 passed** (1 arquivo — `enums.contract.test.ts` — falha ao ser rodado ISOLADO por peculiaridade de ambiente node; ver ⚠️ abaixo) |
| Migrations EF | `dotnet ef migrations add` (×3) | geram e compilam |

**Sessão de 2026-07-03 — elos de integração fechados (código + testes):** o robô passa a **disparar a
geração de arte REAL** (worker→agents, `AgentsStartClient` + Fase B de colheita no `PostingScheduleJob`);
`WeightedScore`/`PickBestFormat` movidos p/ `Core` (`MetricScoring`) + `WorkspaceLearning` (fio robô→analyzer
3.4 e summary ponderado 3.3, ponto único API+robô); **UI da esteira** (`calendar/EsteiraPanel.tsx`).

**Commits (sessão anterior):** `7cb4eee` (Fase 1 · 1.3+1.4) · `d6f69ee` (Fases 2·3·4) — branch `feat/fase-0-input-criativo`.

**Ambiente:** .NET SDK 10.0.102 (compila `net8.0`), `dotnet ef` 10.0.9 (via `~/.dotnet/tools` no PATH). **Nenhuma
chave real de IA/Meta foi usada** — tudo com rede/provider mockado. O E2E real de geração/publicação exige chaves.

---

## FASE 1 — Criativo de qualidade real

### 1.3 — Contexto da pauta → prompt de imagem ✅
- **Feito:** função pura `buildImagePrompt(basePrompt, context)` em `services/agents/src/agents/image-generator.ts`
  concatena o ASSUNTO da pauta (`productName` → `productDescription` → 1º `keyBenefits`) ao prompt que vai
  ao provider de imagem, nos DOIS pontos (background + elemento). Caminho B (determinístico) do plano.
- **Verificado ✅:** 3 testes em `image-generator.test.ts` — (a) com contexto o prompt contém produto+benefício;
  (b) sem contexto o prompt é **byte-equivalente** ao base (não-regressão); (c) campos vazios → base intocado.
- **🧪 Precisa teste manual:** gerar um conteúdo REAL com chave de imagem (Flux/Gemini) e confirmar visualmente
  que a foto reflete o produto da pauta (o teste prova o *texto do prompt*, não o pixel resultante).

### 1.4 — Eixo de qualidade visual + retry de estratégia ✅
- **Feito:** `QualityValidatorAgent.runVisualChecks()` detecta imagem em **fallback de gradiente** (sem LLM);
  `alternativeStrategy()` re-roteia estratégia; o `pipeline-v2.ts` re-gera a imagem **1× (teto anti-loop)** se
  um slide-foto reprova, e `mergeVisualIntoQuality()` derruba `passed` se persistir. Paralelismo image-gen ‖
  validator preservado (eixo visual é passo separado pós-imagem).
- **Verificado ✅:** 8 testes em `quality-validator.visual.test.ts` (imagem real passa; background/elemento em
  fallback reprovam; graphic-composition não exige foto; sem-direção passa; `alternativeStrategy` 3 casos).
- **⚠️ Fronteira:** como o image-gen já LANÇA em fallback persistente (política "não publicar degradado"), o
  caminho de retry é 2ª linha de defesa — alcançável sobretudo em estratégia deferida (stock/gráfico sem provider).
- **🧪 Precisa teste manual:** forçar uma geração onde a estratégia ideal seja stock/gráfico (deferida) e observar
  o log de retry (`Retry visual (1/1): mudando estratégia...`) num job real.

---

## FASE 2 — Autonomia governável (o robô)

### 2.1 — Flags de automação + migration ✅
- **Feito:** `Workspace` ganhou `AutoPostEnabled`, `PostingScheduleDays/Times` (CSV), `CreativeStrategy`
  (enum novo `CreativeStrategyMode`), `AutoApprovalThreshold`. Enum `OperationMode` também adicionado. Migration
  `AddWorkspaceAutomationFlags` (threshold default **70** no banco, não 0). Enums sincronizados .NET↔TS
  (`gen-enums.mjs` regenerou o espelho; contrato atualizado de 12→14 enums).
- **Verificado ✅:** `dotnet test` (multi-tenancy não regride) + contrato de enums web + typecheck web.
- **🧪 Precisa teste manual:** aplicar a migration num banco real (`dotnet ef database update`) e confirmar que
  workspaces existentes herdam threshold 70 e robô OFF.

### 2.2 — Painel Configurações › Automação ✅ (typecheck) / 🧪 (interação)
- **Feito:** tela `/settings/automation` (Admin-only): liga/desliga robô, dias (chips) + horários, estratégia,
  threshold; **kill-switch global sempre visível como "sempre ativo"** (não desligável pela UI). Cartão
  "Automação" no `settings-hub`. Cliente `lib/workspace.ts` estendido; `MetricWeightsSection` (3.2) na mesma tela.
- **Verificado ✅:** `npm run typecheck` limpo + `field-audit` (placeholders/hints) passa + `next build` compila
  a rota (validado na suíte web).
- **🧪 Precisa teste manual (não feito):** abrir a tela no navegador, ligar o robô, marcar Seg/Qua/Sex + 09:00,
  salvar, recarregar e confirmar persistência. **Não houve smoke-test de UI real nesta iteração.**

### 2.3 — PostingScheduleJob (o robô) ✅ (lógica) / 🧪 (cadeia real)
- **Feito:** `apps/worker/Jobs/PostingScheduleJob.cs` — gates soberanos (kill-switch `Loop:Enabled` default false
  → `AutoPostEnabled` → budget cap → rate-limit `MaxPostsPerDay`) → é hora? → escolhe tema → gate qualidade/
  auto-aprova → agenda slot livre → **audita cada passo** (`AuditEntry` com actions `robot.*`). Registrado no
  `Program.cs` do worker.
- **Verificado ✅:** 16 testes em `PostingScheduleRobotTests.cs` cobrindo as peças puras (agenda, tema, gate).
- **⚠️ Fronteira honesta (declarada no código):** o robô do MVP **NÃO dispara a geração de arte real** (pipeline
  api→agents exige chave e é assíncrono 60–120s). Ele monta a cadeia de DECISÃO auditável e cria o `Content`
  agendado a partir da pauta (caption = contexto da pauta). Sem `QualityScore` (sem geração), o gate é
  conservador → o conteúdo fica em `PendingApproval` (revisão humana), NÃO auto-publica. A integração
  worker→geração-real é a evolução seguinte.
- **🧪 Precisa teste manual:** subir o worker com `Loop:Enabled=true`, um workspace com `AutoPostEnabled` + pautas
  + agenda batendo o horário, e observar no log/auditoria a cadeia rodando (sem publicar de verdade em mock).

### 2.4 — Escolha autônoma de tema ✅
- **Feito:** `ThemeSelection.Choose()` — prioridade + anti-repetição de título (janela de dedup 30 dias) + (3.4)
  preferência de formato. Determinística.
- **Verificado ✅:** 3 testes (prefere tema novo de maior prioridade; cai em repetição sem travar; null sem candidatos).

### 2.5 — Auto-aprovação sob gate ✅
- **Feito:** `PostingScheduleJob.DecideApproval(score, threshold)` — auto-aprova só se `score ≥ threshold`; score
  null → revisão humana (conservador). Cria `Approval{Mode=Automatic, Reviewer="robot"}` quando aprova.
- **Verificado ✅:** 3 testes (null → humano; acima → aprova; abaixo → humano).
- **Invariante preservado:** o gate de aprovação humana continua para quem não optar pelo automático.

### 2.6 — Auto-agendamento anti-colisão ✅
- **Feito:** `PostingSchedule.NextFreeSlot()` — próximo slot da agenda que não colide com agendamento existente
  (varre horizonte 14 dias). `IsDuePostingTime()` com tolerância. Parse tolerante de CSV.
- **Verificado ✅:** 10 testes (parse dias/horas; é-hora com/sem tolerância; slot pula ocupado; null sem agenda).

### 2.7 — Esteira: editar / lote / lookahead ✅ (API) / 🧪 (UI)
- **Feito:** 3 endpoints em `ScheduleController` — `PUT /{id}` (reagendar não-despachado), `GET /lookahead?count`
  (próximos N), `POST /batch` (agendar vários; resultado por item, um ruim não derruba os bons). Cliente
  `scheduleApi.{lookahead,reschedule,scheduleBatch}` em `lib/workflow.ts`.
- **Verificado ✅:** 3 testes de integração em `ScheduleEsteiraTests.cs` (lookahead ordena+limita; batch
  parcial; reschedule move e recusa passado). **Correção aplicada:** lookahead materializa antes de filtrar
  (gotcha SQLite conhecido).
- **🧪 Precisa (não feito):** **UI de esteira** — os endpoints existem e estão testados, mas não há tela nova
  ligando editar/lote/lookahead ao operador (o calendário atual usa `calendar`/`schedule`/`unschedule`). Ligar
  os novos métodos do cliente a botões é trabalho de UI pendente.

---

## FASE 3 — Aprendizado configurável

### 3.1 — MetricWeightConfig ✅
- **Feito:** entidade `MetricWeightConfig` (1/workspace, índice único, defaults saves5/reach2/likes3/comments4),
  DbSet + query filter de tenant, migration `AddMetricWeightConfig`, controller `MetricWeightsController` (GET
  sempre devolve defaults se não há linha; PUT faz upsert, valida pesos 0-10).
- **Verificado ✅:** `dotnet test` (build + multi-tenancy).
- **🧪 Precisa teste manual:** aplicar migration + GET/PUT via API real.

### 3.2 — Painel "o que é um bom post" ✅ (typecheck) / 🧪 (interação)
- **Feito:** seção com sliders 0-10 por sinal (salvamentos/comentários/curtidas/alcance) em `/settings/automation`;
  cliente `lib/weights.ts`.
- **Verificado ✅:** typecheck web limpo.
- **🧪 Precisa teste manual:** mover os sliders, salvar, recarregar, confirmar persistência.

### 3.3 — PerformanceAnalyzer usa os pesos ✅
- **Feito:** `PerformanceAnalyzer.WeightedScore(reach,likes,saves,comments,weights)` (função pura) +
  `GetWeightsAsync` (com fallback default) + `BuildBestFormatWeightedAsync` (melhor formato pela régua ponderada).
- **Verificado ✅:** 3 testes em `MetricWeightsTests.cs` (soma sinais×pesos; peso zero zera; **a régua do operador
  inverte o "melhor"** — prova que os pesos mudam a recomendação).
- **⚠️ Nota:** o analyzer legado (`BuildLearningSummaryAsync`/`BuildBestFormatAsync`) continua por engajamento
  bruto (não removido — não-regressão). O caminho ponderado é adicional; ligá-lo ao summary injetado na geração
  é o passo de integração que fecha o E2E de aprendizado.

### 3.4 — Robô prioriza pelo score ponderado ✅ (função) / ⚠️ (fio)
- **Feito:** `ThemeSelection.Choose(preferredType)` — pautas do formato preferido ganham desempate.
- **Verificado ✅:** 2 testes (formato preferido vence prioridade; sem preferência mantém comportamento 2.4).
- **⚠️ Fronteira arquitetural declarada:** derivar o `preferredType` via `BuildBestFormatWeightedAsync` exige o
  robô (worker) chamar o `PerformanceAnalyzer` (api-side). Hoje o worker **não referencia** a API. O fio
  robô→analyzer precisa ou mover `WeightedScore` para `Core`, ou uma chamada worker→api. A **função** está pronta
  e testada; a **ligação** é o pendente.

### 3.5 — Dedup + comentários ✅
- **Feito:** dedup editorial no robô (`recentTitles`, já em 2.4); campo `PerformanceMetric.Comments` + migration
  `AddPerformanceMetricComments`; coleta de comentários no `MetricsCollectorJob` (mock + parse de `/insights`
  com métrica `comments`); `Comments` entra no `WeightedScore`.
- **Verificado ✅:** `dotnet test` + o teste de `WeightedScore` inclui comentários.
- **🧪 Precisa teste manual:** com token IG real, confirmar que `comments` é parseado dos insights (o parse tem
  fallback honesto ao mock se a métrica não vier).

---

## FASE 4 — Endurecimento

### 4.1 — Throttle de concorrência ✅ (já existia)
- **Achado:** JÁ IMPLEMENTADO antes desta iteração — `mapWithConcurrency` + `IMAGE_GEN_CONCURRENCY` (clamp [1,6],
  default 3) no `image-generator.ts` (ADR-0014). **Não reimplementado** (não-regressão). Coberto por 2 testes
  existentes ("respeita o teto de concorrência").

### 4.2 — Resiliência da fila ⚠️ (decisão documentada)
- **Decisão (o plano pede DECIDIR, não necessariamente implementar):** o job store dos agents é in-memory **by
  design** (não sobrevive a restart); o `GeneratingReaperJob` já reconcilia órfãos >10min. Para o robô, o mesmo
  reaper cobre geração órfã. **Dívida-aceita declarada:** persistir o job store dos agents não é necessário no
  volume atual; medir o gargalo do polling (varredura 60s) só quando houver dezenas de milhares de posts. Sem
  ação de código nesta iteração — é decisão consciente.

### 4.3 — Rate-limit de geração ✅
- **Feito:** gate `Loop:MaxPostsPerDay` (default 1) no robô — conta agendados do dia (local) e não excede o teto.
  Fecha a porta a surpresa de fatura com autonomia.
- **Verificado ✅:** coberto pela lógica do robô (o gate `scheduledToday >= maxPerDay`); o build .NET passa.
- **🧪 Precisa teste manual:** com o robô ligado e `MaxPostsPerDay=1`, confirmar que 2 ticks no mesmo dia não
  geram 2 posts.

### 4.4 — Observabilidade do robô ✅ (infra existente)
- **Feito:** o robô grava `AuditEntry` (`robot.scheduled`, `robot.pending-review`, `robot.paused.budget`) — que
  já aparecem na tela `/settings/audit` (infra de auditoria existente). Não foi preciso código novo de UI.
- **🧪 Precisa teste manual:** rodar o robô e confirmar as entradas `robot.*` na tela de auditoria.

### 4.5 — ADR adaptador de rede ✅ (doc)
- **Feito:** `docs/adr/0016-adaptador-de-rede-social.md` — decisão de NÃO abstrair até a 2ª rede entrar (YAGNI),
  com o contrato futuro e o gatilho de reabertura registrados.

### 4.6 — Plano .NET 8 → LTS ✅ (doc)
- **Feito:** `docs/DOTNET-LTS-PLAN.md` — .NET 8 tem suporte até nov/2026; plano de bump para .NET 10 (SDK já
  local), com a suíte de invariantes de tenancy como gate de aceite.

---

## ⚠️ Pendências e dívidas honestas (o que NÃO está 100%)

1. **Nenhum smoke-test de UI real** — todas as telas (automação, pesos, **esteira**) foram validadas por
   typecheck + build + testes, **não por interação no navegador**. Abrir cada tela, preencher, salvar e
   recarregar é o teste que falta.
2. ✅ **RESOLVIDO (2026-07-03) — Robô gera arte real** (2.3) — o `PostingScheduleJob` agora tem 2 fases:
   Fase A dispara a geração via `AgentsStartClient` (POST /generate → `Content{Generating,JobId}`); o
   `GeneratingReaperJob` reconcilia; Fase B colhe, gateia e agenda. Sem chave de IA → não gera (degradado
   honesto). Testado com **rede mockada**; o E2E com chave real segue como item 8 abaixo.
3. ✅ **RESOLVIDO (2026-07-03) — Fio robô→analyzer ponderado** (3.4) — `WeightedScore`/`PickBestFormat`
   em `Core` (`MetricScoring`); `WorkspaceLearning.PreferredFormatAsync` deriva o formato preferido do
   banco; o robô o consulta. `PerformanceAnalyzer` (API) delega ao mesmo ponto. Testado (`WorkspaceLearningTests`).
4. ✅ **RESOLVIDO (2026-07-03) — UI de esteira** (2.7) — `app/(app)/calendar/EsteiraPanel.tsx`: lookahead,
   editar (reschedule via modal) e agendar em lote. Typecheck web limpo. Falta só o smoke-test (item 1).
5. ✅ **RESOLVIDO (2026-07-03) — Analyzer ponderado injetado na geração** (3.3) —
   `WorkspaceLearning.SummaryAsync` embute a preferência ponderada no learning summary (API e robô). Testado.
6. **`enums.contract.test.ts` falha quando rodado ISOLADO** (`npm test -- lib/enums.contract.test.ts`) por
   peculiaridade do ambiente node do vitest — **confirmado PRÉ-EXISTENTE via git stash** (não é regressão desta
   sessão). Na suíte completa (`npm test`), os 164 testes passam. Vale corrigir como manutenção.
7. **Typecheck do agents** falha em 2 linhas pré-existentes (`story-architect.single-post.test.ts:57,68`) —
   dívida herdada, não introduzida aqui. `vitest` passa; só o `tsc` do typecheck reclama.
8. **Nenhuma chave real usada** — todo o E2E de geração/publicação (Flux/Pexels/Gemini/Graph API) roda com
   rede mockada. O teste com chaves reais é responsabilidade do operador (cadastrar `IMAGE_PROVIDER_KEY`,
   `AI_PROVIDER_KEY`, `META_*`).

---

## Como testar tudo de uma vez (checklist para o tester)

```bash
# 1. Testes automatizados (o que já passa)
cd services/agents && npm test          # 288 passed
cd apps/web && npm test                 # 164 passed (rodar a suíte inteira, não arquivos isolados)
cd apps/web && npm run typecheck        # limpo
dotnet test tests/SocialAi.Tests        # 285 passed

# 2. Migrations (banco real)
export PATH="$PATH:$HOME/.dotnet/tools"
dotnet ef database update --project libs/SocialAi.Core --startup-project apps/api

# 3. Smoke-test de UI (o que falta — fazer no navegador)
#    /settings/automation → ligar robô, dias+horas, threshold, salvar, recarregar
#    /settings/automation → mover sliders de pesos, salvar, recarregar
#    /calendar → esteira: ver lookahead (próximas N), editar horário de um agendado, agendar em lote
#    /settings/audit → após rodar o robô, ver entradas robot.* (generating/scheduled/pending-review/generation-skipped)

# 4. Robô em modo seguro (mock, sem publicar de verdade)
#    Loop:Enabled=true + workspace com AutoPostEnabled + pautas + agenda no horário + CHAVE de IA
#    → Fase A dispara a geração real (Content Generating); o reaper conclui; Fase B colhe/gateia/agenda
#    → observar log/auditoria da cadeia; sem chave → robot.generation-skipped (não inventa arte)
```
