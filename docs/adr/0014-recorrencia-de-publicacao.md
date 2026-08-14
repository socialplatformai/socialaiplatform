---
adr: 0014
titulo: Recorrência de publicação (Frequency) — enum tipado + reagendamento no worker por clone de conteúdo
status: aceito
data: 2026-06-15
---

# ADR-0014 — Recorrência de publicação (`Frequency`)

> Hoje o campo `Frequency` (`ScheduledPost`) é **persistido ponta a ponta mas nunca lido** — um post
> "semanal" sai **uma vez**. A UI **oculta** a opção e a doc declara honestamente o gap (`09-roadmap.md`
> §2.4; `// ROADMAP — recorrência não implementada (S-26)` em `lib/workflow.ts`). Este ADR entrega a
> recorrência de verdade: `Frequency` vira **enum tipado** (sincronizado .NET↔TS) e o
> **`PublishSchedulerJob`** passa a **reagendar a próxima ocorrência** ao despachar uma recorrente.

## Critério de aceite (binário — no topo)

- [ ] **A. Enum tipado + sincronia.** `Frequency { None=0, Daily=1, Weekly=2, Monthly=3 }` em `Enums.cs`;
      `gen-enums --check` OK (12 enums); espelho manual na UI + `enums.contract.test.ts` atualizado
      (12 enums, `Frequency` incluído). `ScheduledPost.Frequency` deixa de ser `string?` e vira
      `Frequency` (default `None` = comportamento atual de 1×).
- [ ] **B. Reagendamento no worker.** Ao despachar um `ScheduledPost` com `Frequency != None`, o
      `PublishSchedulerJob` cria a **próxima ocorrência**: um **clone do `Content`** (cópia de
      slides/caption/cta/hashtags, status `Approved`, `IsSample=false`) + um **novo `ScheduledPost`**
      em `ScheduledFor + intervalo`, com `Frequency` **propagado** e `IdempotencyKey` **novo**.
- [ ] **C. Invariantes preservados.** O `Content↔ScheduledPost` continua **1:1** (clonamos o Content —
      não apontamos 2 posts ao mesmo Content). O dedup do `PublishJob` (por `ScheduledPostId`+Success)
      continua válido (cada ocorrência tem id próprio). Isolamento por `WorkspaceId` mantido (o job é
      sistêmico; o clone herda `WorkspaceId`/`BrandId` do original — predicado explícito).
- [ ] **D. Fuso correto.** A próxima ocorrência é derivada em UTC a partir do `ScheduledFor` (UTC) +
      intervalo de calendário (Daily=+1d, Weekly=+7d, Monthly=+1 mês) — sem dupla conversão de fuso
      (ADR-0010: `ScheduledFor` é sempre UTC; o worker não reconverte).
- [ ] **E. UI reexposta.** O agendamento volta a oferecer "repetir" (Não repetir / Diário / Semanal /
      Mensal) em PT-BR leigo, sem jargão; `scheduleApi.schedule` envia `frequency`.
- [ ] **F. Migration provada.** `Frequency text → integer` (default 0). `up→down→up` contra Postgres
      real; snapshot commitado; api+worker rebuildam.
- [ ] **G. Teste do reagendamento.** Teste do `PublishSchedulerJob`: post `Weekly` despachado → existe
      uma nova ocorrência 7 dias depois, com `Content` clonado distinto e `IdempotencyKey` distinto;
      post `None` → nenhuma nova ocorrência. (Hoje o job é **sem teste** — fecha essa lacuna.)

## Contexto (estado antes desta decisão)

> Este contexto descreve o ponto de partida. A implementação (ver **Decisão**, abaixo) o substituiu:
> `Frequency` virou enum tipado e o worker passou a reagendar.

- `ScheduledPost.Frequency` era `string?`; persistido em `ScheduleController`, devolvido em
  `ScheduledPostDto`, mas **nunca lido** no worker.
- `PublishSchedulerJob.DispatchDuePosts` marcava `Dispatched=true` + criava `PublishLog{Pending}`;
  **não reagendava**.
- `Content↔ScheduledPost` é **1:1** (`AppDbContext.cs:104` `HasOne...WithOne`).
- `PublishJob` **deduplica por `ScheduledPostId`+Success** (`:87-96`) e só publica `Approved/Scheduled`
  (`:76`); após publicar, o `Content` vira `Published`/`EphemeralPublished` (`:155-157`).

## Decisão — reagendar por CLONE de conteúdo (não por reuso de linha)

**Alternativas avaliadas:**
- **(A) Clonar `Content` + novo `ScheduledPost` por ocorrência** ✅ **escolhida.** Respeita o 1:1, o
  dedup e a idempotência sem mudar invariante; cada ocorrência é uma unidade publicável e auditável
  independente; o post já publicado fica intacto no histórico.
- **(B) Reusar a mesma linha `ScheduledPost`** (resetar `Dispatched`, novo `ScheduledFor`): **morto pelo
  dedup** — o `PublishLog{Success}` antigo bloqueia para sempre a republicação daquele `ScheduledPostId`.
- **(C) Novo `ScheduledPost` apontando ao MESMO `Content`** (1:1→1:N): exige migration estrutural +
  oscilar o status do Content (Published→Approved→Published) — risco amplo de regressão, descartado para
  a 1ª entrega.

KISS dentro do invariante: o clone é uma cópia rasa de campos + slides; nada de cascata mágica.

## Modelo de dados / Contrato / UI

- `Enums.cs`: `enum Frequency { None=0, Daily=1, Weekly=2, Monthly=3 }` (sincronizado).
- `ScheduledPost.Frequency: Frequency` (era `string?`). `ScheduleRequest.Frequency: Frequency?`
  (default `None`); `ScheduledPostDto.Frequency: Frequency`.
- Worker: `PublishSchedulerJob` ganha `CreateNextOccurrence(post)` (clone do Content + novo post).
- UI: `lib/workflow.ts` espelha o enum (`Frequency`) + `FREQUENCY_LABEL` PT-BR; `schedule()` aceita
  `frequency`; a tela de agendamento mostra um seletor "Repetir".

## Estratégia de migração

`AddFrequencyEnum`: converte a coluna `Frequency` de `text` → `integer` com default `0` (None). Como a
feature **nunca foi exposta**, não há dado de recorrência em produção a preservar — a conversão é segura
(qualquer texto vira `None`). `Down()` volta a `text` nullable. `up→down→up` provado contra Postgres real.

## Plano de teste

- **Worker (.NET):** `PublishSchedulerJobTests` — `Weekly` → nova ocorrência +7d, Content clonado
  distinto, IdempotencyKey distinto, `Frequency` propagado; `None` → nenhuma nova ocorrência; o clone
  herda WorkspaceId/BrandId (sem vazamento).
- **Enum (TS):** `enums.contract.test.ts` cobre `Frequency` (12 enums); `gen-enums --check` OK.
- **Build/typecheck:** api+worker+web verdes.

## Riscos e mitigação

- **Crescimento sem fim** (recorrência infinita gera N Contents) → mitigação: cada tick cria **só a
  PRÓXIMA** ocorrência (não um horizonte); a série para se o operador desagendar a próxima. Sem limite
  de ocorrências nesta versão (declarado; um teto/data-fim é incremento futuro).
- **Drift de enum** → `gen-enums --check` + `enums.contract.test.ts` (12 enums) travam.
- **Fuso** → derivar em UTC puro (sem reconverter), alinhado à convenção UTC do `ScheduledFor` (ADR-0010).
- **Clone órfão** → o clone nasce `Approved` e agendado; se a publicação falhar, segue o mesmo fluxo de
  retry/erro do PublishJob (nada especial).

## Fora de escopo

- Data-fim / nº máximo de ocorrências da série (hoje é aberta; para com desagendar).
- Recorrências complexas (ex.: "toda 2ª e 4ª", cron arbitrário) — só Daily/Weekly/Monthly.
- Editar a recorrência de uma série já criada (cancelar + reagendar cobre o caso).
