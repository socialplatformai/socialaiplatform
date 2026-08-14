# Tasks — Arquitetura de Autonomia Governável

> ## 📌 Status de execução (2026-07-03 — elos de integração fechados)
> **Fases 0–4 implementadas E os 4 elos de integração pendentes fechados.** Todas as tasks (0.1 → 4.6)
> executadas; nesta iteração foram cabeados os fios que faltavam (ver §consolidado no fim). Detalhamento
> por task em **[`testers.md`](./testers.md)**.
>
> **Verificado por teste automatizado que RODOU (2026-07-03):** agents **288** · .NET **285** (+9 novos:
> harvest do robô + reclaim de pauta órfã + scoring/summary ponderado em Core) · web typecheck limpo + **164** testes.
> **Fechado nesta iteração (código + testes):** (1) robô **dispara a geração de arte REAL** (elo
> worker→agents via `AgentsStartClient`; o `GeneratingReaperJob` reconcilia; a Fase B do robô colhe,
> gateia e agenda); (2) **fio robô→analyzer ponderado** — `WeightedScore`/`PickBestFormat` movidos p/
> `Core` (`MetricScoring`) + `WorkspaceLearning` (o worker consulta o formato preferido); (3) **score
> ponderado injetado no learning summary** (`WorkspaceLearning.SummaryAsync`, ponto único que API e robô
> usam); (4) **UI da esteira** (editar/lote/lookahead — `calendar/EsteiraPanel.tsx`).
> **Dívida declarada restante:** smoke-test de UI no navegador (as telas passam typecheck/build/testes,
> mas não foram clicadas); E2E real de geração exige chave de IA (rede mockada nos testes). Loop
> entregue **OFF por padrão** (`Loop:Enabled=false`) — autonomia é opt-in.
>
> Commits: `7cb4eee` (Fase 1 · 1.3+1.4) · `d6f69ee` (Fases 2·3·4) · `1f07281` (2.7 + testers.md) ·
> _(iteração final: elos worker→agents, scoring em Core, learning summary ponderado, UI da esteira)_.

> Derivado de `Auditoria-Autonomia-Social-AI-Platform.pdf` (base: commit `705594b`).
> Tese da auditoria: **o motor de autonomia já existe (~60% da base)**; o trabalho é
> *completar e governar*, por extensão — não reescrever. Ordem obrigatória:
> **qualidade antes de autonomia, autonomia antes de aprendizado em escala.**
>
> Legenda de veredito (da auditoria): 🟢 Aproveita como está · 🟡 Estende · 🔴 Constrói.
> Âncoras `arquivo:linha` foram **verificadas contra o código atual** ao montar este plano;
> onde a linha divergiu do PDF, anotei. Estimativas são as do documento (1 dev familiarizado, reaproveitando a base).

---

## Mapa de dependências (por que a ordem é essa)

```
FASE 0  Input criativo (referências, fundo, subtítulo/CTA)
   │      └─ é a matéria-prima que Pilar I e o robô consomem
   ▼
FASE 1  PILAR I — Criativo de qualidade real
   │      └─ "o que se posta sozinho precisa já ser bom"
   ▼
FASE 2  PILAR II — Autonomia governável (painel + robô)
   │      └─ depende do criativo bom + do input
   ▼
FASE 3  PILAR III — Aprendizado configurável + dedup
   │      └─ fecha o ciclo: medir certo antes de ensinar o robô a escolher
   ▼
FASE 4  Endurecimento (escala/perf/manutenção) — pode correr em paralelo
```

Automatizar criativo fraco multiplica o problema; ensinar o robô a escolher antes de medir
certo o ensina errado. Daí a sequência.

---

## FASE 0 — Fundação de input criativo  ·  ~1 semana  ·  🔴/🟡  ·  ✅ FEITA (2026-06-30)

Liga a matéria-prima que os pilares vão usar. Resolve os pendentes da lista inicial de 8 pontos.
O **logo já está pronto** (estampagem + toggle por geração).

> **Status:** entregue na branch `feat/fase-0-input-criativo` (sobre `feat/logo-nos-criativos`).
> Escopo decidido com o operador: entrada **por URL** (referência/fundo por link; upload de arquivo
> fica para o Pilar I) + fundo **como direção ao pipeline** (a IA compõe, on-brand). Um único campo
> `creativeInput` (referenceUrl, backgroundUrl, cta, subtitle) opcional ponta a ponta — tudo ausente =
> payload byte-equivalente ao atual. Verificado: agents 255✓, .NET 252✓, web typecheck✓.

- [x] **0.1 — Referências de imagem no pipeline (por URL)** 🔴 ✅
  - **Entregue:** `creativeInput.referenceUrl` no wizard (seção "Direção criativa") → `CreativeInputDto` (`ContentController`) → `AgentsCreativeInput` (`AgentsClient`, omitido quando vazio) → `creativeInput` (`types.ts`/`jobs.ts`) → o `input-adapter` injeta a URL no `referenceContext` (mesmo canal dos anexos de pauta, que já existia).
  - **Decisão:** entrada **por URL** (link), não upload de arquivo — upload arrasta MinIO + é evolução do Pilar I (1.2/1.3). A referência é textual (url+rótulo), consumida pelos agentes que a usam.
  - **Aceite:** ✅ teste `input-adapter.test.ts` (referência+fundo entram no referenceContext; combina com anexos da pauta).

- [x] **0.2 — Fundo customizado como entrada (por URL, como direção)** 🔴 ✅
  - **Entregue:** `creativeInput.backgroundUrl` → entra **duas vias**: no `referenceContext` (url+rótulo) E no `additionalNotes` como direção visual ("use como direção visual, mantendo a identidade da marca").
  - **Decisão:** fundo **como direção ao pipeline** (a IA compõe on-brand), não sobrescrita fixa — escolha do operador. Não toca o render core; o gradiente iridescente segue como fallback honesto.
  - **Aceite:** ✅ teste `input-adapter.test.ts` (backgroundUrl em additionalNotes + referenceContext).

- [x] **0.3 — Subtítulo / CTA como entrada explícita** 🟡 ✅
  - **Entregue:** `creativeInput.cta` e `creativeInput.subtitle` → `additionalNotes` como direção de copy ("CTA desejado pelo operador (use-o como chamada-para-ação)"; "Subtítulo/linha de apoio desejada pelo operador"). O copywriter os respeita em vez de inventar.
  - **Invariante mantido:** "todo slide precisa de headline ou o run falha" — intocado (só adicionamos direção em additionalNotes; não removemos a obrigação de headline).
  - **Aceite:** ✅ teste `input-adapter.test.ts` (cta/subtitle em additionalNotes) + serialização .NET (`AgentsRequestCreativeInputSerializationTests`).

> **Próximo passo do input criativo (Pilar I, não Fase 0):** upload de arquivo de referência/fundo
> (MinIO + endpoint) e o **consumo da imagem de referência pelo image-generator** no prompt — hoje a
> referência é textual (url). Isso é 1.2/1.3.

> **Nota de escopo:** os 8 pontos da lista inicial (logo ✔, referências, fundo, CTA/subtítulo,
> editar/lote/anti-colisão de agenda, dedup, lookahead) estão absorvidos aqui (0.x) e nas Fases 2–3.

---

## FASE 1 — PILAR I · Criativo de qualidade real  ·  ~2–3 semanas  ·  🔴/🟡

> **A dor central do cliente: "nada de imagem genérica".** Maior salto de valor percebido.
> Todo o pilar é **extensão dos agentes** — sem tocar no render core.

> ### 🔖 Ponto de retomada
> **Feito:** 1.1 (Creative Director) + 1.2 (providers Flux/Pexels) — commit `58be97c` em
> `origin/feat/fase-0-input-criativo` (rribeiro-30). **Próxima: 1.3** (contexto da pauta → prompt de
> imagem) — ver o bloco detalhado abaixo (tem o estado real do código já verificado + as 2 opções de design).
> **Ambiente antes de codar:** `cd services/agents && npm test` deve dar **277✓** (baseline). O
> `npm run typecheck` do agents falha em 2 linhas PRÉ-EXISTENTES (`story-architect.single-post.test.ts:57,68`)
> — não é regressão; ignorar ou corrigir como manutenção (não é 1.3).
> **Pendências que NÃO bloqueiam 1.3:** (a) chaves reais de Replicate/Pexels para E2E de imagem — o
> operador precisa cadastrar `IMAGE_PROVIDER_KEY` (=`REPLICATE_API_TOKEN`/`PEXELS_API_KEY`); (b) 2º remote
> somente `origin` recebeu push.

- [x] **1.1 — Creative Director Agent (decide a estratégia)** 🔴 ✅ (2026-06-30, branch `feat/fase-0-input-criativo`)
  - **O quê:** novo passo de roteamento entre `story-architect` e `visual-compositor` que decide, por pauta: **foto generativa** / **banco de imagens** / **composição gráfica**.
  - **Entregue:** `services/agents/src/agents/creative-director.ts` — função PURA `decideCreativeDirection(story, strategy)`. Inserida no `pipeline-v2.ts` como passo `creative-director` (30→32%, determinístico, não toca o client). Tipos `ImageStrategy`/`CreativeDirection`/`SlideCreativeDirection` em `types/pipeline.ts`; output em `PipelineResult.creativeDirection`.
  - **Decisão de design:** roteamento **DETERMINÍSTICO (sem LLM)** — a regra é a tabela da auditoria sobre tipo+beat (lookup, não julgamento). Mais rápido, grátis, testável, sem 429. *Alternativa descartada:* agente LLM que "raciocina" a estratégia — fica para quando o roteamento precisar de julgamento que a tabela não captura (ex.: ler a imagem de referência, 1.4).
  - **Roteamento implementado:** comparison/stats → `graphic-composition` · trust/social-proof → `stock-photo` · resto (cover, benefits, offer…) → `generative-photo`. Precedência: dados > confiança > default.
  - **Fronteira honesta (escopo "agente + roteamento mapeado" — decisão do operador):** só `generative-photo` tem provider real hoje. Stock/gráfico são **roteados e auditáveis** mas EXECUTAM via foto generativa (`deferred=true`, `effectiveStrategy`) até 1.2/1.3 — nunca mascarado. `PROVIDERS_DISPONIVEIS` em creative-director.ts é o ponto único: 1.2 move a estratégia para lá quando o provider entrar.
  - **`image-generator` respeita a estratégia:** recebe `creativeDirection`, loga a rota por slide (estratégia + se deferida).
  - **Auditável no output do job:** `reasoning.creativeStrategy` (jobs.ts) → `AgentsReasoning.CreativeStrategy` (.NET — **sync manual TS↔.NET**, senão a decisão se perde no round-trip tipado do envelope).
  - **Aceite:** ✅ 8 testes `creative-director.test.ts` (3 regras + agregação + fail-safe). Suites: agents **263✓**+3skip · .NET **252✓** · build api+worker✓. Typecheck agents: só os 2 erros PRÉ-EXISTENTES de `story-architect.single-post.test.ts` (zero novos).

- [x] **1.2 — Providers de imagem reais (Flux/Replicate + banco)** 🔴 ✅ (2026-06-30, branch `feat/fase-0-input-criativo`)
  - **Entregue:** `FluxImageProvider` (Replicate, foto generativa de alto padrão) + `StockImageProvider` (Pexels, banco) em `services/agents/src/image/imageProvider.ts`. REST puro via fetch (sem SDK), mesmo estilo do `OpenAiImageProvider`. `resolveImageProvider` ganhou os `case flux/stock`.
  - **Tipo separado:** criado `ImageProviderKind` (`gemini|openai|imagen|flux|stock`) **distinto** do `ProviderKind` de texto — `TEXT_PROVIDER=flux` é **não-representável** por construção. `config.ts`: `AiConfig.imageProvider: ImageProviderKind`, `normImageProvider`, `defaultModelFor` com flux (`black-forest-labs/flux-1.1-pro`) / stock. Override de workspace usa `normOverrideImageProvider` (grok/anthropic no override não viram provider de imagem).
  - **FLUX:** endpoint model-specific (`/v1/models/{owner}/{name}/predictions`), `Prefer: wait` (síncrono) + poll curto de fallback (50s) em `urls.get`; output→data-URL. **Brand-locking:** `options.style` (paleta da marca, vinda do design-spec via image-generator) dobrado no prompt → foto na cor da marca.
  - **Pexels (sobre Unsplash):** licença permissiva (sem atribuição obrigatória — Unsplash exige por ToS), chave simples (header `Authorization` SEM `Bearer`), rate-limit melhor no free (200/h vs 50/h). Busca top-1 → data-URL; `aspectRatio`→`orientation`.
  - **Falha diagnosticável** em ambos (provider+status no texto), nunca imagem ruim silenciosa (mantém `bug-imagem-fallback-publicada`).
  - **Creative Director destravado (honesto):** `strategyServedBy(imageProvider)` → stock serve `stock-photo`, flux/gemini/openai servem `generative-photo`. `decideCreativeDirection(..., served)` marca `deferred` conforme o provider REAL do job. **Limite declarado:** provider é **global por job** (um `IMAGE_PROVIDER`) — não há seleção por slide ainda; estratégia não-servida fica deferida. (Doc em `10-multi-provider.md`.)
  - **Config único:** slugs em `defaultModelFor` (`config.ts`); documentado em `docs/sot/10-multi-provider.md` + `.env.example`. Chaves via env (`IMAGE_PROVIDER_KEY` = `REPLICATE_API_TOKEN`/`PEXELS_API_KEY`).
  - **Aceite:** ✅ testes de param-compat com fetch mockado (sem-chave / sucesso / HTTP-erro / status failed / sem-resultado) — 13 novos. Suites: agents **276✓**+3skip · build agents✓ · typecheck só os 2 erros PRÉ-EXISTENTES.
  - **⚠️ Fronteira (chaves):** não há como "criar" contas Replicate/Pexels pelo código — testei com **rede mockada**. O E2E real roda quando o operador cadastrar as chaves (ver "O que o operador precisa fazer" abaixo). Código pronto; rede não exercida com chave real ainda.

- [x] **1.3 — Contexto da pauta → prompt de imagem** 🟡 ✅ (2026-07-01, caminho B — injeção determinística)
  - **Entregue:** função pura `buildImagePrompt(basePrompt, context)` em `image-generator.ts` concatena o ASSUNTO real da pauta (`context.productName` → `productDescription` → 1º `keyBenefits`) ao prompt que vai ao provider, análogo a como `options.style` já ancora a estética. Usada nos DOIS pontos de geração (background + elemento). Passa `pipelineInput.context` de `execute` → `processSlide`.
  - **Não-regressão provada:** sem contexto (ou todos os campos vazios) → prompt **byte-equivalente** ao base. Teste assevera igualdade literal.
  - **Aceite:** ✅ 3 testes em `image-generator.test.ts` (contexto no prompt · sem-contexto byte-equivalente · campos-vazios byte-equivalente). Suíte agents **280✓**+2skip (era 277 baseline).
  - **O quê (histórico):** garantir que o **conteúdo real** da pauta (tema, produto, mensagem) chegue ao prompt de imagem de forma **determinística/verificável** — antes chegava só INDIRETAMENTE (via copy), não garantido.
  - **📍 Estado real verificado (reconferir no código antes de editar):**
    - O prompt de imagem é gerado pelo **LLM do `visual-compositor`**, não montado no image-generator. Ver `services/agents/src/agents/visual-compositor.ts:164-167` (o prompt-base manda: *"Generate a background image element for EVERY slide … with a highly detailed, slide-specific prompt derived from that slide's copy/purpose"*). O prompt-base versionado está em `services/agents/src/prompts/visual-compositor.md` (ADR-0011/E10.1 — git é a verdade).
    - O `image-generator` (`image-generator.ts:206+` `processSlide`) apenas **consome** esse prompt: lê `slide.background.value` / `element.content` como o texto do prompt e injeta a **estética** (`designSpec.imageAesthetics`: paleta+mood+style) via `options.style`. Ou seja: **estilo/cor já entram** (1.2 brand-locking); falta o **assunto** entrar de forma garantida.
    - O contexto da pauta JÁ existe no `PipelineInput`: `context.productName`, `context.productDescription`, `context.targetAudience`, `context.keyBenefits`, `content.mainMessage` (ver `types/pipeline.ts` `PipelineInput`). O input-adapter já o preenche a partir do briefing/pauta.
  - **Decisão de design (2 caminhos):**
    - **(A) Reforçar no prompt-base do visual-compositor** (`visual-compositor.md`): instruir a ancorar o `productName`/`mainMessage` no prompt de cada imagem. Simples, mas **não-determinístico** (depende do LLM obedecer) — difícil de asseverar em teste.
    - **(B) Injeção determinística no image-generator** (recomendado p/ o aceite "verificável"): ao montar o prompt final que vai ao provider, **prefixar/concatenar** o tema/produto da pauta (vindo de `input.pipelineInput.context`) — análogo a como o `options.style` já é concatenado. Garante presença literal → testável com fetch mockado (assert de `sent.input.prompt`/prompt do provider contém o produto). Requer passar o `context` ao image-generator (hoje ele recebe `pipelineInput` mas não usa `.context` no prompt).
    - ⚠️ Cuidar da **não-regressão**: sem tema/produto (mock/degradado) o prompt deve ficar byte-equivalente ao atual.
  - **Onde:** `services/agents/src/agents/image-generator.ts` (montagem do prompt final — caminho B) e/ou `services/agents/src/prompts/visual-compositor.md` (caminho A). `design-spec.ts` **já entrega a estética** — o que falta é o **conteúdo**, não a estética.
  - **Aceite:** o prompt enviado ao provider contém o tema/produto da pauta (verificável em **teste** com fetch/provider mockado, não só log). Não-regressão provada (sem contexto → prompt atual).
  - **Ganho:** faz o brand-locking do Flux (1.2) ter *assunto* certo, não só *cor* certa — fecha o "nada de imagem genérica".

- [x] **1.4 — Nota de qualidade visual no validador + retry de estratégia** 🟡 ✅ (2026-07-01)
  - **Entregue:** eixo visual DETERMINÍSTICO (sem LLM) — `QualityValidatorAgent.runVisualChecks(visual, direction)` detecta imagem em **fallback de gradiente** (background `type:'gradient'` ou elemento com data-URI SVG de gradiente APEX) em slides cuja estratégia pedia FOTO. Nova `category:'visual'` no `QualityCheck`.
  - **Retry de estratégia (teto rígido = 1):** no `pipeline-v2.ts`, após image-gen, roda o eixo visual; se um slide-foto reprova, re-roteia SÓ os reprovados via `alternativeStrategy` (generative↔stock; gráfico→generative) e RE-GERA a imagem **uma vez** (anti-loop §4.5). `mergeVisualIntoQuality` funde os checks e derruba `passed` se persistir erro visual.
  - **Decisão de arquitetura:** o eixo visual roda como passo SEPARADO no orquestrador (visual pós-imagem), **preservando** o paralelismo image-gen ‖ quality-validator (o `execute` do validador segue avaliando a spec PRÉ-imagem). Não regride a otimização de latência existente.
  - **Fronteira honesta:** como o image-gen já LANÇA em fallback persistente (política "não publicar degradado"), o retry é 2ª linha de defesa — alcançável sobretudo em estratégia deferida. Documentado no código.
  - **Aceite:** ✅ 8 testes em `quality-validator.visual.test.ts` (imagem real passa · background/elemento fallback reprovam · gráfico não exige foto · sem-direção passa · `alternativeStrategy` 3 casos). Suíte agents **288✓**+2skip. Typecheck limpo (só os 2 erros pré-existentes de `story-architect.single-post.test.ts`).

> **Resultado do Pilar I:** estratégia visual certa por tema, cara da marca travada (cor, logo, fonte),
> nota de qualidade que barra peça fraca. Tudo por extensão — render core intocado.

---

## FASE 2 — PILAR II · Autonomia governável (painel + robô)  ·  ~2–3 semanas  ·  🔴/🟡  ·  ✅ IMPLEMENTADA (2026-07-01)

> **"Você no volante."** Tela de governança + job que executa sozinho. Depende de Fase 0/1
> (o que se posta sozinho precisa já ser bom).
>
> **Status:** 2.1–2.7 implementadas e verificadas nas camadas testáveis (ver `testers.md`). Fronteira
> honesta declarada: o robô (`PostingScheduleJob`) monta a cadeia de decisão + agenda, mas não dispara
> a geração de arte real ainda (exige chave + integração worker→agents). Entregue **OFF por padrão**.

- [x] **2.1 — Entidades + migration das flags de automação** 🟡 ✅ FEITO — flags no `Workspace` (`AutoPostEnabled`, `PostingScheduleDays/Times`, `CreativeStrategy`, `AutoApprovalThreshold`) + enums `CreativeStrategyMode`/`OperationMode` (sync .NET↔TS) + migration `AddWorkspaceAutomationFlags`. Verificado por `dotnet test`.
  - **Onde:** `libs/SocialAi.Core/Domain/Entities.cs` — `Workspace` (já tem `PublishWindowStart/End:33-34`, `DefaultApprovalMode:27`) e `Budget` (já tem `MonthlyCapUsd`, `AutonomousLoopEnabled`).
  - **Novas flags (auditoria):**
    | Flag | Tipo | Para quê |
    |------|------|----------|
    | `AutoPostEnabled` | bool | liga/desliga o robô por workspace |
    | `PostingScheduleDays/Times` | JSON | "Seg/Qua/Sex às 09:00 e 18:00" |
    | `CreativeStrategy` | texto/enum | híbrido / sempre-foto / sempre-gráfico |
    | `AutoApprovalThreshold` | int | nota mínima para auto-aprovar |
  - **Como:** migration em `libs/SocialAi.Core/Migrations` (`dotnet ef migrations add ...`). **`PublishWindowStart/End` hoje é aviso suave** → virar regra dura no robô. **Sincronizar enum** se `CreativeStrategy` virar enum (.NET ↔ TS — invariante do projeto).
  - **Aceite:** migration aplica; teste de multi-tenancy não regride; novos campos GET/PUT pelo controller.

- [x] **2.2 — Painel "Configurações › Automação"** 🔴 🟡 FEITO (falta smoke-test de UI) — tela `/settings/automation` (modo, dias+horas, estratégia, threshold; kill-switch sempre visível) + cartão no settings-hub. Verificado por typecheck + build + field-audit; **NÃO clicado no navegador**.
  - **O quê:** tela nova `/settings/automation` (o volante): modo de operação (Manual/Assistido/Automático), horários, estratégia de criativo, threshold de auto-aprovação, teto de gasto.
  - **Onde:** `apps/web` (App Router, route group `(app)`). Reaproveita `BudgetController` e o controller de settings do workspace (GET/PUT já existem).
  - **Como:** React Query (`lib/*.ts`), APEX tokens, PT-BR. Mock de UI no PDF (§5) é a referência visual.
  - **Aceite:** alterar flags persiste e reflete no comportamento do robô; kill-switch global sempre visível como "sempre ativo".

- [x] **2.3 — `PostingScheduleJob` (o robô)** 🔴 ⭐ ✅ FEITO (elo worker→agents fechado em 2026-07-03) — `apps/worker/Jobs/PostingScheduleJob.cs` agora é **2 fases**: **Fase A** (é hora + gates soberanos) DISPARA a geração de arte REAL via `AgentsStartClient` (POST /generate, mesma pipeline do wizard) → cria `Content{Generating,JobId}`; o `GeneratingReaperJob` reconcilia (slides + `QualityScore`). **Fase B** (todo tick) COLHE a arte pronta, aplica o gate/auto-aprova e agenda no slot livre. Sem chave de IA → não gera (degradado honesto, `robot.generation-skipped`). 19 testes (harvest nota-alta/baixa/null incluídos).
  - **O quê:** novo `BackgroundService` (tick ~1h) que, por workspace com `AutoPostEnabled`: confere horário configurado → escolhe tema → chama geração → aplica gate de qualidade → auto-aprova se passar → agenda no próximo slot livre → deixa o `PublishJob` publicar.
  - **Onde:** `apps/worker/Jobs/` (modela sobre os jobs existentes — mesma forma, mesmo acesso a banco, **nada de infra nova**). O `AutonomousLoopJob.cs` hoje **gera ideia e para na linha ~100-118** (verificado) — este job **fecha o circuito**.
  - **Salvaguardas (soberanas, não negociáveis):** teto de gasto por workspace + kill-switch global (`Loop:Enabled`, default `false`) continuam vigentes; **cada passo auditado** (`AuditService.LogAsync`).
  - **Rampa de confiança (recomendada):** primeiras N publicações ainda pedem olhar humano; depois libera 100%. Opção do painel, **não trava no código** — operador pode pular.
  - **Aceite:** com flags ligadas e horário batendo, uma publicação percorre toda a cadeia sem clique humano; com kill-switch ou budget estourado, não dispara; auditoria registra cada passo.

- [x] **2.4 — Escolha autônoma de tema/pauta** 🔴 ✅ FEITO — `ThemeSelection.Choose()`: prioridade + anti-repetição de tema (janela dedup 30d). 3 testes.
  - **O quê:** lógica de seleção (histórico, objetivos, anti-repetição) — hoje a ideia do loop é **texto genérico/stub** (IdeaCandidate generation é um stub fixo).
  - **Onde:** consumido pelo `PostingScheduleJob` (2.3); pode evoluir o `AutonomousLoopJob`.
  - **Dependência:** a priorização "fina" amadurece na Fase 3 (pesos de métrica). Aqui basta seleção sã + anti-repetição.
  - **Aceite:** o robô não repete tema recente; escolha derivada de dados, não fixa.

- [x] **2.5 — Auto-aprovação sob gate de qualidade** 🟡 ✅ FEITO — `DecideApproval()`: auto-aprova só se score ≥ threshold; sem nota → revisão humana. Cria `Approval{Mode=Automatic, Reviewer="robot"}`. 3 testes. Gate humano opt-in preservado.
  - **Onde:** `ApprovalController.Decide` já existe (mecanismo de aprovação) + `ApprovalMode` enum (`Manual=0, Automatic=1`, `Enums.cs:8`). Falta o **gatilho automático sob flag** quando `score ≥ AutoApprovalThreshold`.
  - **Aceite:** conteúdo com nota ≥ threshold e flag ligada é aprovado sem humano; abaixo, fica para revisão. **Invariante do produto:** gate de aprovação humana continua existindo para quem não optar pelo automático.

- [x] **2.6 — Auto-agendamento no slot livre + anti-colisão (servidor)** 🟡 ✅ FEITO — `PostingSchedule.NextFreeSlot()`: próximo slot da agenda pulando ocupados (anti-colisão). 10 testes cobrem parse/é-hora/slot.
  - **Onde:** `ScheduleController.Schedule` já existe; falta **escolher a hora pela janela** (`PublishWindowStart/End`) e **anti-colisão no servidor** (não dois posts no mesmo slot).
  - **Como:** idempotência já garantida por `IdempotencyKey` (índice único) — usar para não duplicar.
  - **Aceite:** dois agendamentos concorrentes não colidem no mesmo slot; agenda respeita a janela do workspace.

- [x] **2.7 — Esteira de agendamento robusta: editar / lote / lookahead** 🟡 ✅ FEITO (UI fechada em 2026-07-03) — 3 endpoints (`PUT /schedule/{id}`, `GET /schedule/lookahead`, `POST /schedule/batch`) + cliente web + 3 testes de integração + **a TELA**: `app/(app)/calendar/EsteiraPanel.tsx` (lookahead das próximas N; editar horário via modal; agendar em lote espaçado dia-a-dia). Typecheck web limpo. **Falta só o smoke-test no navegador.**
  - **O quê:** editar agendamento, operação em lote, "quantos posts à frente" (lookahead). (Pendentes da lista inicial.)
  - **Onde:** `apps/web` calendar/approvals + endpoints de schedule.
  - **Aceite:** operador edita/agenda em lote e vê o lookahead configurado.

---

## FASE 3 — PILAR III · Aprendizado configurável + dedup  ·  ~2 semanas  ·  🔴/🟡  ·  ✅ IMPLEMENTADA (2026-07-01)

> **A régua de "bom post" é escolhida pelo operador, não fixada no código.** Fecha o ciclo:
> *gera melhor → mede pelo que importa → aprende → escolhe melhor o próximo.*

- [x] **3.1 — `MetricWeightConfig` (entidade nova, 1 por workspace)** 🔴 ✅ FEITO — entidade (índice único/workspace, defaults) + `MetricWeightsController` (GET/PUT, upsert, valida 0-10) + migration + query filter de tenant. `dotnet test`.
  - **O quê:** pesos configuráveis por sinal (saves, alcance, curtidas, comentários) que definem "sucesso".
  - **Onde:** nova entidade em `Entities.cs` ligada a `Workspace` (que já agrupa `Budget` e templates); migration.
  - **Aceite:** config persiste por workspace; default razoável (replicando o comportamento atual) para workspaces sem config.

- [x] **3.2 — Painel "o que é um bom post"** 🔴 🟡 FEITO (falta smoke-test de UI) — sliders 0-10 por sinal em `/settings/automation` + cliente `lib/weights.ts`. Verificado por typecheck; NÃO clicado no navegador.
  - **Onde:** dentro de `/settings/automation` (`apps/web`) — listbox de sinais + pesos (mock no PDF §6).
  - **Aceite:** seleção de pesos salva em `MetricWeightConfig` e reflete no cálculo.

- [x] **3.3 — Analisador passa a usar os pesos** 🟡 ✅ FEITO (E2E fechado em 2026-07-03) — `MetricScoring.WeightedScore()` (Σ sinal×peso, em Core) + `WorkspaceLearning.SummaryAsync` **injeta a preferência ponderada no learning summary** que vai aos agentes (só acrescenta a frase quando o vencedor ponderado difere do bruto → não-regressão de prompt). A API (`PerformanceAnalyzer.BuildLearningSummaryAsync`) e o robô usam o MESMO ponto. Testes: `WorkspaceLearningTests` (summary embute a régua quando difere do bruto).
  - **O quê:** hoje "bom post" é `Likes + Saves` em peso igual, **hardcoded** (`PerformanceAnalyzer.cs`).
    > ⚠️ **Divergência de âncora:** o PDF aponta `PerformanceAnalyzer.cs:167`; na base atual a linha 167 é
    > comentário de `BuildPostMetricsAsync`. O cálculo por peso fixo existe (média de saves em `:47`,
    > scoring de formato em `:90-104`), mas **localizar o ponto exato do score antes de editar** — não
    > confiar no número do PDF (zero suposição).
  - **Onde:** `apps/api/Features/Learning/PerformanceAnalyzer.cs` — o cálculo passa a **ler os pesos** de `MetricWeightConfig`.
  - **Aceite:** mudar pesos no painel muda a recomendação injetada na próxima geração (verificável end-to-end).

- [x] **3.4 — Robô prioriza pelo que pontua alto** 🟡 ✅ FEITO (fio fechado em 2026-07-03) — `ThemeSelection.Choose(preferredType)` prioriza o formato vencedor + o **fio**: `WeightedScore`/`PickBestFormat` movidos p/ `libs/SocialAi.Core` (`Domain/MetricScoring.cs`); `Learning/WorkspaceLearning.PreferredFormatAsync` deriva o `preferredType` do banco sob a régua ponderada; o `PostingScheduleJob` o consulta na escolha de tema. O `PerformanceAnalyzer` (API) delega ao mesmo ponto. Testes: `WorkspaceLearningTests.PreferredFormatAsync_*` + `MetricWeightsTests` (inalterado).
  - **Onde:** seleção de tema do `PostingScheduleJob` (2.4) passa a consultar o score ponderado.
  - **Aceite:** temas/formatos/horários que pontuam alto sob a régua do cliente são preferidos.

- [x] **3.5 — Dedup editorial + coletar comentários** 🟡 ✅ FEITO — dedup de tema no robô (2.4) + `PerformanceMetric.Comments` + coleta (mock + parse de `/insights` com métrica `comments`) + migration. `dotnet test`.
  - **O quê:** não repetir tema recente; estender a coleta de métricas para incluir **comentários** (hoje reach/likes/saves).
  - **Onde:** `MetricsCollectorJob.cs:35-122` (coleta) + lógica de dedup na seleção de tema.
  - **Aceite:** comentários aparecem nas métricas; tema recente não se repete.

---

## FASE 4 — Endurecimento: manutenção, escala, performance  ·  ~2 semanas  ·  🟡  ·  ✅ IMPLEMENTADA (2026-07-01)

> Pode correr em **paralelo** conforme a tração. Remove os 3 tetos antes que o crescimento os encontre.

- [x] **4.1 — R2 · Throttle de concorrência no gerador de imagem** 🔴 ✅ JÁ EXISTIA — `mapWithConcurrency` + `IMAGE_GEN_CONCURRENCY` (clamp [1,6], default 3) no `image-generator.ts` (ADR-0014). **Não reimplementado** (não-regressão); coberto por 2 testes existentes.
  - **Problema:** slides rasterizam em paralelo **sem teto**; com o robô gerando em escala → risco de memória.
  - **Onde:** `services/agents/src/agents/image-generator.ts` / render.
  - **Aceite:** limitador de concorrência (semaphore/pool) com teto configurável; teste de carga não estoura memória.

- [~] **4.2 — R1 · Resiliência da fila a reinício + polling** 🟡 ⚠️ DECISÃO DOCUMENTADA (não-código) — dívida-aceita: job store dos agents in-memory **by design**; `GeneratingReaperJob` já reconcilia órfãos. Medir o gargalo do polling antes de otimizar. O plano pedia DECIDIR, não necessariamente implementar.
  - **Problema:** job store dos agents é **in-memory** (`services/agents/src/jobs.ts`, não sobrevive a restart — by design); varredura de agenda a cada 60s vira gargalo com dezenas de milhares de posts.
  - **Mitigação existente:** `GeneratingReaperJob` (1-min) marca órfãos >10min como `Failed`.
  - **Aceite:** decidir nível de persistência aceitável (dívida-aceita documentada vs. persistir job store); medir o gargalo do polling antes de otimizar.

- [x] **4.3 — Limite de taxa de geração por workspace** 🟡 ✅ FEITO — gate `Loop:MaxPostsPerDay` (default 1) no robô: conta agendados do dia e não excede o teto. Fecha porta a surpresa de fatura.
  - **Problema:** custo do robô — autonomia = sistema gastando IA sozinho. Teto **mensal** já protege; falta **rate de geração**.
  - **Aceite:** workspace não excede N gerações/período; fecha a porta a surpresa de fatura.

- [x] **4.4 — Observabilidade do robô (painel do que ele fez)** 🟡 ✅ FEITO (infra existente) — o robô grava `AuditEntry` (`robot.scheduled`/`robot.pending-review`/`robot.paused.budget`) que já aparece em `/settings/audit`. Sem código novo de UI.
  - **Onde:** consome `AuditService` (cada passo do `PostingScheduleJob` já auditado em 2.3).
  - **Aceite:** operador vê histórico de ações autônomas no painel.

- [x] **4.5 — R3 · Abstrair "adaptador de rede" (evolução futura)** 🟡 ✅ FEITO (ADR) — `docs/adr/0016-adaptador-de-rede-social.md`: decisão de NÃO abstrair até a 2ª rede entrar (YAGNI), com contrato futuro e gatilho de reabertura registrados.
  - **Problema:** fila, agenda e rate-limit assumem Instagram. Correto hoje; abstrair **antes** de abrir para outras redes evita reescrita.
  - **Aceite:** decisão de arquitetura registrada (ADR) — implementar só quando outra rede entrar no escopo.

- [x] **4.6 — Ciclo de vida do runtime (.NET 8 → LTS)** 🟡 ✅ FEITO (plano) — `docs/DOTNET-LTS-PLAN.md`: .NET 8 com suporte até nov/2026; plano de bump p/ .NET 10 com a suíte de invariantes de tenancy como gate.
  - **Aceite:** plano de migração antes do fim de suporte do .NET 8.

---

## Riscos e invariantes a NÃO quebrar (durante toda a execução)

- **Multi-tenancy 3 camadas** (read filter, TenantFilter, TenantSaveInterceptor) — qualquer entidade/migration nova é tenant-scoped.
- **Gate de aprovação humana** continua existindo; modo automático é **opt-in**.
- **Loop safety:** budget cap por workspace + kill-switch global (`Loop:Enabled` default `false`) **soberanos**.
- **Fallback honesto:** imagem que falha → gradiente iridescente **explícito**, nunca preto silencioso nem genérico mascarado (`bug-imagem-fallback-publicada`).
- **Texto na imagem:** rasterizar o texto da IA **na geração** (não só no preview — `bug-publica-imagem-sem-texto`).
- **Formato escolhido vence a recomendação** (post/story não vira carrossel — `bug-post-vira-carrossel`).
- **Enums .NET ↔ TS** sincronizados manualmente (sem contrato compartilhado).
- **PT-BR** em toda string de UI, comentário e commit.
- **Anti-loop de retry** (2.x/1.4): toda re-tentativa automática precisa de teto.

---

## ✅ O que ficou FEITO × ⏳ o que FALTA (consolidado — 2026-07-03)

**Feito e verificado por teste que RODOU** (agents 288 · .NET **285** · web typecheck + 164):
Fase 1 (1.3, 1.4) · Fase 2 (2.1, 2.3–2.7) · Fase 3 (3.1–3.5) · Fase 4 (4.1 já-existia, 4.3, 4.4, 4.5 ADR,
4.6 plano · 4.2 decisão-doc). **2.2 e 3.2 seguem sem smoke-UI** (passam typecheck/build/testes).

**✅ Elos de integração FECHADOS nesta iteração (2026-07-03) — com código + testes:**
1. **O robô dispara a geração de arte REAL** (2.3) — `AgentsStartClient` (worker) inicia a MESMA pipeline
   do wizard (POST /generate); o `GeneratingReaperJob` reconcilia (slides + `QualityScore`); a **Fase B**
   do `PostingScheduleJob` colhe a arte pronta, aplica o gate e agenda. Sem chave de IA → não gera
   (degradado honesto, auditado `robot.generation-skipped`). Testes: harvest nota-alta/baixa/null.
2. **Fio robô→analyzer ponderado** (3.4) — `WeightedScore`/`PickBestFormat` movidos p/ `Core`
   (`Domain/MetricScoring.cs`) + `Learning/WorkspaceLearning.PreferredFormatAsync`; o robô consulta o
   formato preferido sob a régua do operador. O `PerformanceAnalyzer` (API) delega ao mesmo ponto.
3. **Score ponderado no learning summary** (3.3) — `WorkspaceLearning.SummaryAsync` embute a preferência
   ponderada; usado tanto pela API (wizard) quanto pelo robô. Fecha o E2E de aprendizado nos dois braços.
4. **UI da esteira** (2.7) — `app/(app)/calendar/EsteiraPanel.tsx`: lookahead (próximas N), editar
   (reschedule) e agendar em lote, ligando os 3 endpoints que já existiam.

**⏳ O que ainda FALTA (dívida declarada, não-código ou externo):**
5. **Smoke-test de UI no navegador** — todas as telas (automação, pesos, esteira) passam
   typecheck/build/testes mas **não foram clicadas**. Abrir, preencher, salvar, recarregar.
6. **E2E real de geração** — os testes usam rede mockada; o disparo real (Flux/Gemini) exige o operador
   cadastrar `AI_PROVIDER_KEY`/`IMAGE_PROVIDER_KEY`. O elo de código está pronto e testado com mock.
7. **4.2** — decidido como dívida-aceita (não é código); revisitar se o volume crescer.

> Detalhe completo por task, com evidência e checklist de teste, em **[`testers.md`](./testers.md)**.

---

## O que NÃO está neste plano (fora de escopo)

- App Review da Meta (trâmite externo para publicação real — flip é config `PUBLISHER_MODE=graph`, não código).
- Reescrita de núcleo — o documento é explícito: **extensão, não recomeço**.

---

## ⚠️ Problemas, riscos e dívidas observados

> Lista **factual** do que encontrei durante a Fase 0. Separa o que é **limite de escopo declarado**
> (esperado) do que é **dívida/erro real** (precisa de decisão). Nada aqui é suposição — cada item
> foi observado no código ou na execução dos testes.

### 🔴 Limite real da Fase 0 — a entrega é parcial por design (o ponto mais importante)
A referência e o fundo entram como **texto (URL) no briefing**, NÃO como imagem consumida pelo gerador.
- **O que isso significa na prática:** hoje o `image-generator` **não baixa nem "olha"** a imagem da URL;
  ela vai como uma linha de texto em `additionalNotes`/`referenceContext`. O efeito visual real depende
  de o LLM interpretar a URL — o que é **fraco/não-determinístico**. O CTA e o subtítulo (que são texto
  puro) funcionam de verdade; **referência e fundo só terão efeito visível no Pilar I** (1.2/1.3: providers
  reais + consumo da imagem de referência no prompt).
- **Por que está assim:** decisão acordada (entrada por URL agora; upload + consumo da imagem = Pilar I).
  Mas **não declarar como "fundo custom funciona"** sem essa ressalva — seria mascarar a fronteira.
- **Ação:** comunicar ao cliente que 0.1/0.2 são a *fundação do input*; o resultado visual vem na Fase 1.

### 🟠 Verificação incompleta da Fase 0 (o que ainda falta para ser 100% honesto)
- **`next build` do web: RODADO e PASSOU** ✅ — `/create` compila com as demais rotas (build standalone
  do Next, sem erro). Lacuna fechada após a entrega.
- **Não testei na UI real** (navegador) — a seção "Direção criativa" no wizard foi validada por
  typecheck + build, **não por interação humana**. Falta um smoke-test manual: abrir `/create`, preencher
  os 4 campos, gerar, e confirmar que o briefing recebe a direção (o endpoint `briefing/preview` da API
  expõe exatamente o payload — dá para conferir sem gastar IA).
- **Não há teste E2E** ligando wizard→API→agents para a Fase 0 — só testes unitários de cada camada.
  O contrato de serialização (.NET) e o roteamento (agents) estão cobertos; o "fio" inteiro, não.

### 🟠 Dívida PRÉ-EXISTENTE (não introduzida pela Fase 0, mas atrapalha)
- **Typecheck do agents quebrado:** `services/agents/src/agents/story-architect.single-post.test.ts`
  (linhas 57 e 68) — `error TS2345: '"completeJSON"' is not assignable to 'never'`. **Confirmado via
  `git stash`**: existe na base limpa, antes das minhas mudanças. O `vitest` passa (não usa o tsc do
  typecheck), mas `npm run typecheck` do agents **falha**. Isso mascara erros de tipo reais no CI se
  alguém confiar no typecheck do agents. **Ação:** corrigir o mock/tipo desse teste (fora do escopo da
  Fase 0, mas deveria entrar num "fix de manutenção").
- **`npm run lint` do web está deprecado** (`next lint` será removido no Next 16) e **abre um prompt
  interativo** de migração para ESLint CLI — trava qualquer automação/CI que rode lint. **Ação:** migrar
  para ESLint CLI (`npx @next/codemod next-lint-to-eslint-cli .`) ou fixar a config.

### 🟡 Divergências de âncora do PDF vs. código atual (o commit avançou)
- **`PerformanceAnalyzer.cs:167`** (citado no PDF como o peso `Likes+Saves` hardcoded) hoje é **comentário**
  de `BuildPostMetricsAsync`. O cálculo por peso fixo existe (média de saves em `:47`, scoring de formato
  em `:90-104`), mas **localizar o ponto exato antes de editar** na Fase 3 — não confiar no número do PDF.
- Demais âncoras do PDF foram conferidas e batem; as que citei nas tarefas estão verificadas.

### 🟡 Gotchas que vão reaparecer nas próximas fases
- **`JsonSerializerDefaults.Web` escapa não-ASCII como `\uXXXX`** — asserções literais de JSON com acentos
  (ç/ã) falham nos testes .NET. Usar valores ASCII nos testes de serialização de contrato (pego na Fase 0).
- **SQLite dos testes não traduz `DateTimeOffset`/`SUM(decimal)` sob filtro de tenant** — materializar e
  somar em memória (padrão já presente em `PerformanceAnalyzer`/`ContentController`). Vale para qualquer
  query nova das Fases 2–3.
- **Job store dos agents é in-memory** — não sobrevive a restart. O `PostingScheduleJob` (Fase 2) precisa
  tolerar isso (o reaper já cobre geração órfã; a cadeia autônoma precisa de reconciliação análoga).

### 🟢 O que está sólido (verificado por execução)
- Fase 0 ponta a ponta com não-regressão **provada por teste** (`creativeInput` ausente/vazio →
  briefing byte-equivalente ao atual). Suites: **agents 255✓+3skip · .NET 252✓ · web typecheck✓**.
- Os 2 commits da Fase 0 (`864bc8c` código, `c05eabd` docs) saíram num diff limpo, separados do WIP do
  logo (`21abcc2`) — sem misturar frentes.
