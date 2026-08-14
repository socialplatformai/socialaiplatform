# 09 — Roadmap

> **Quadrante Diátaxis: Explicação.**
> Separa, com rigor, o que está **entregue** do que opera em **modo degradado** e do que é
> **roadmap consciente** (planejado, ainda não construído). Esta separação é uma regra desta
> documentação: nada de roadmap é apresentado como entregue. Termos linkam para o
> [glossário](08-glossario.md).

---

## Como ler esta página

| Marcador | Significado |
|----------|-------------|
| ✅ **Entregue** | Implementado e funcional hoje. |
| ◐ **Parcial / degradado** | Existe, mas com uma limitação conhecida e documentada. |
| 📋 **Roadmap** | Decidido como evolução futura; **não** está no código hoje. |

## 1. Estado por capacidade

| Capacidade | Estado | Detalhe |
|------------|--------|---------|
| Cadastro / login / sessão / refresh | ✅ | [JWT](08-glossario.md#jwt-json-web-token) 2 h + [refresh](08-glossario.md#refresh-token) 30 d; limite de taxa; e-mail único global. |
| [Multi-tenancy](08-glossario.md#multi-tenant-multilocatário) (3 camadas) | ✅ | Coberto por testes. |
| Marca / pautas / CRUD | ✅ | Contexto de marca completo chega aos agentes. |
| [Geração](03-fluxos.md#2-geração-de-conteúdo-assíncrona) (6 agentes) | ✅ | Requer chave de IA; assíncrona + poll; [reaper](08-glossario.md#reaper-ceifador) de órfãos. |
| Aprovação / agendamento / calendário | ✅ | Modo efetivo (conteúdo > campanha > workspace); gate de moderação inviolável. |
| Publicação [mock](08-glossario.md#mock-modo-mock) | ✅ | Fluxo ponta a ponta sem Meta. |
| Publicação [graph](08-glossario.md#graph-modo-graph) | ✅ pronta | Depende só de configuração + [App Review](08-glossario.md#app-review-meta) da Meta. |
| [OAuth](08-glossario.md#oauth) do Instagram | ✅ | Anti-CSRF; token cifrado; renovação automática. |
| [Modo degradado](08-glossario.md#modo-degradado) | ✅ | Estado de primeira classe. |
| [Loop autônomo](08-glossario.md#loop-autônomo) | ✅ desligado | Entregue com [chave geral](08-glossario.md#kill-switch-chave-geral) `false` por padrão. |
| **Coleta de métricas reais** | ✅ | Parse real de insights implementado. Ver §2.1. |
| **Promoção de [IdeaCandidate](08-glossario.md#ideacandidate-candidato-a-ideia)** | ✅ | Endpoint + tela de promoção entregues. Ver §2.2. |
| **CRUD de Campanha** | 📋 | Adiado por YAGNI. Ver §2.3. |
| **Recorrência (`Frequency`)** | ✅ | Enum `Frequency` (None/Daily/Weekly/Monthly); o worker reagenda a próxima ocorrência clonando o conteúdo (ADR-0014). Ver §2.4. |
| **Override de prompt por workspace** | ✅ | Mecanismo no pipeline (ADR-0011) + emissão .NET, persistência (`PromptOverride`) e UI Admin (ADR-0013). Flag `PROMPT_OVERRIDES_ENABLED` OFF por padrão. Ver §2.5. |

## 2. Itens parciais e de roadmap (em detalhe)

### 2.1 ✅ Coleta de métricas reais do Instagram

**Estado:** **entregue.** O `MetricsCollectorJob` resolve o id da mídia publicada (por workspace e
conteúdo, sem contaminação cross-tenant), **chama** o endpoint de insights da
[Graph API](08-glossario.md#graph-api) e **faz o parse real** da resposta:
`ParseInsights`/`ExtractValue` (`apps/worker/Jobs/MetricsCollectorJob.cs:128-190`) leem
`data[].values[].value` (séries) **e** `total_value.value` (agregado v22+), gravando a métrica com
`Source = MetricSource.Real`. Em mock / sem token, cai em métricas simuladas determinísticas
(`Source = Mock`) — modo degradado honesto.

### 2.2 ✅ Promoção de IdeaCandidate pela interface

**Estado:** **entregue** (ADR-0010). O [loop autônomo](08-glossario.md#loop-autônomo) cria
[IdeaCandidates](08-glossario.md#ideacandidate-candidato-a-ideia) com `Promoted=false`; um humano os
promove a Pauta pela interface — `apps/web/app/(app)/ideas/page.tsx` (tela) consome
`POST /api/ideas/{id}/promote` (`apps/api/Features/Ideas/IdeasController.cs:46`). O invariante de
segurança permanece: uma ideia **nunca** é publicada sem promoção humana. O loop continua entregue
**desligado** por padrão (`Loop:Enabled=false`).

### 2.3 📋 CRUD de Campanha

A entidade **Campanha** existe no domínio e participa da resolução de
[modo de aprovação](08-glossario.md#modo-de-aprovação-approvalmode) (precedência conteúdo > campanha
> workspace). O **gerenciamento de campanhas pela interface** é roadmap; hoje a resolução de modo
funciona sem essa camada intermediária (degrada para workspace/conteúdo).

### 2.4 ✅ Recorrência de publicação (`Frequency`) — ADR-0014

**Entregue.** `Frequency` virou **enum tipado** (`None=0, Daily, Weekly, Monthly`, sincronizado
.NET↔TS via `gen-enums`) na entidade `ScheduledPost`. Ao despachar um post recorrente, o
`PublishSchedulerJob` **reagenda a próxima ocorrência** criando um **clone do conteúdo** (cópia rasa
dos campos publicáveis + slides, status `Approved`, `IsSample=false`) e um **novo `ScheduledPost`** em
`ScheduledFor + intervalo`, com `Frequency` propagado e `IdempotencyKey` novo
(`apps/worker/Jobs/PublishSchedulerJob.cs`, `CreateNextOccurrenceAsync`/`CloneContentForRecurrence`/
`NextOccurrence`).

**Por que clone (e não reuso):** o `Content↔ScheduledPost` é **1:1** e o `PublishJob` deduplica por
`ScheduledPostId`+Success — reusar a linha quebraria ambos. Clonar o conteúdo respeita os invariantes,
mantém o histórico honesto e dá um `IdempotencyKey` naturalmente distinto por ocorrência.

**Na interface:** o agendamento (Calendário e o fluxo gerar→aprovar→agendar) oferece "Repetir" (Não
repetir / Diário / Semanal / Mensal); posts recorrentes aparecem com o indicador ↻ no calendário.

**Escopo declarado:** a série é **aberta** (cria só a próxima ocorrência por tick; para ao desagendar);
data-fim / nº máximo de ocorrências e recorrências complexas (ex.: "toda 2ª e 4ª") são incrementos
futuros (ADR-0014 §Fora de escopo).

### 2.5 ✅ Override de prompt por workspace (ADR-0011 + ADR-0013)

**O que existe:** o **mecanismo no pipeline** (ADR-0011) — os 5 system prompts são assets
versionados (`services/agents/src/prompts/*.md`), com override por agente injetável por workspace atrás
da flag `PROMPT_OVERRIDES_ENABLED` (**default `false`, opt-in**), com **validação de saída + fallback ao
prompt-base** não-silencioso (`Job.promptFallbacks`). O caminho feliz é byte-equivalente ao anterior.

**Agora também entregue (ADR-0013):** a **emissão pela API .NET** (campo `PromptOverrides` no record
`AgentsBrandContext` + `BuildPromptOverridesAsync` em `ContentController`), a **persistência** (tabela
`PromptOverride : TenantEntity`, 1 linha por workspace+agente, isolada nas 3 camadas) e a **UI Admin**
(`Configurações › Instruções da IA`, com aviso de poder perigoso + nota de ativação pelo operador). A
emissão é **incondicional**; o gate da flag continua 100% no agents. A linha `PROMPT_OVERRIDES_ENABLED`
já está no `.env.example`. Sem override no workspace, o payload é byte-equivalente ao anterior (campo
omitido) — provado por teste de contrato.

## 3. Evoluções técnicas planejadas

Itens de evolução registrados (fonte: `docs/DEPLOYMENT.md` §8), sem promessa de prazo:

| Item | Situação |
|------|----------|
| OpenAI / Imagen como provedor de imagem | ✅ **Feito (parcial)**: `IMAGE_PROVIDER` troca o provider; Gemini (default) e OpenAI (`gpt-image-2`) implementados de fato; Imagen segue stub. |
| Provider de **texto** abstraído (`ITextProvider`) | ✅ **Feito**: `TEXT_PROVIDER` troca o provider; Gemini (default), OpenAI, xAI/Grok e Anthropic/Claude implementados de fato (ver [10-multi-provider](10-multi-provider.md)). |
| Config de IA **tipada** (modelo/params sem drift) | ✅ **Feito**: `src/config.ts` é fonte única; `AI_TEXT_MODEL`/`AI_MAX_TOKENS`/`AI_TEMPERATURE` por env, sem editar código. |
| Rastreabilidade campo→engine | ✅ **Feito**: teste-rede que mapeia cada campo do briefing ao ponto do pipeline que o consome; 3 órfãos declarados (`competitors`, `visualReferences`, `attachments`) ainda a ligar. |
| OpenAI **real** (texto+imagem) + IA por workspace + painel de custo | 📋 Roadmap. A abstração de provider já está pronta. |
| Vídeo / Reels (multimodal) | A Graph API suporta; o pipeline precisaria de um agente de vídeo. |
| Insights reais de performance | ✅ **Feito** — ver §2.1 (parse de `data[].values[]` + `total_value`). |
| Extrair `Domain`+`Data` para lib compartilhada | ✅ **Feito** (`libs/SocialAi.Core`); o worker não referencia mais a API. |
| Migrar de .NET 8 para .NET 10 LTS | Planejado antes/logo após a entrega (o .NET 8 chega ao fim de suporte em nov/2026). |
| Unificar os dois runtimes (agentes Node → .NET) | Considerado só se a manutenção de dois runtimes pesar. |
| Gerar os espelhos de enum da UI a partir de `_enums.generated.ts` | Hoje `lib/pautas.ts`/`content.ts` ainda mantêm cópias manuais; o teste de contrato de enums **pega** a divergência mas não a auto-corrige. Eliminar a cópia manual fecharia a porta de vez. |
| Rodar `node scripts/gen-enums.mjs --check` no CI antes do `vitest` | Sem isso, uma divergência futura em `Enums.cs` poderia passar via espelho gerado defasado (risco de orquestração, não de lógica). |
| Endurecer o gerador de enums além do regex KISS | `gen-enums.mjs` quebra se `Enums.cs` migrar para formato complexo (`[Flags]`, nested, valores não-literais); a fixture de teste cobre regressão, mas o parser é deliberadamente simples (decisão do ADR-0001). |
| Subir a stack no smoke E2E para o CI | `scripts/smoke-e2e.mjs` assume a API no ar (é smoke, não e2e de browser); um wrapper de CI precisaria subir postgres+api antes. |
| Rastreabilidade campo→engine via AST (não regex) | `traceability.test.ts` usa regex word-boundary + lista manual (KISS); migrar para AST/tree-sitter elimina a chance de casar em comentário. Dívida consciente do ADR-0004. |
| Remoção de marca com conteúdo (cascata / soft-delete) | A tela `Configurações→Marcas` remove marca direto (coerente com o padrão de pautas; backend só bloqueia a **última**). Marca agrupa pautas/conteúdos/aprovações — remover uma marca com conteúdo deveria ter cascata explícita ou soft-delete + confirmação. Decisão de produto p/ um ADR futuro, ao finalizar o modelo da marca (KISS). |
| Contrato implícito UI↔backend do 403 de marca | `INVALID_BRAND_TITLE` (`apps/web/lib/api.ts`) tem que casar com o `Title` do `BrandAccessExceptionFilter.cs` p/ a auto-recuperação do 403 funcionar. Hoje há **comentário-âncora** nos dois lados, mas nenhum teste cross-stack trava a sincronia (como o teste de contrato de enums faz). Candidato a um teste de contrato. |
| **Story + recorrência (guard de borda)** | O agendamento aceita `Frequency != None` para Story (que expira em 24h). Não é bug (cada ocorrência é um post IG válido, dedup/idempotência corretos), mas o ideal é um **aviso suave na UI** ("Stories expiram em 24h; cada ocorrência republica o mesmo conteúdo") ou rejeição na borda (`ScheduleController`). Polimento de UX-semântica. |
| **Mensagem de degradado quando agents está fora** | `AgentsClient.StartAsync` propaga `HttpRequestException` crua; em **Production o `UseExceptionHandler` já sanitiza** (ProblemDetails neutro, sem stack), mas em dev a mensagem é feia. Polimento: envolver em `AgentsGenerationException` com texto PT-BR ("Serviço de geração indisponível. Tente novamente."). Sem risco de segurança. |
| **`Pauta.Status` durante geração de variações** | Ao gerar N variações da mesma pauta (`/api/content/variations`), a 1ª que conclui marca a pauta como `Done` enquanto as outras ainda renderizam — o badge da lista fica "Concluída" cedo. Cosmético (zero impacto em dados/loop/wizard; o cenário "2 abas" já é bloqueado pelo 409). `Pauta.Status` é aproximado nesse fluxo. |
| Escopar conta IG por marca (`InstagramAuthController.Status`/`Disconnect`) | Hoje retornam a conta do **workspace** (1 conta/workspace). `InstagramAccount` já tem `BrandId`; quando o roadmap entregar N contas IG por marca, estes endpoints precisam filtrar por marca (decisão consciente — não vaza conteúdo cross-brand hoje). |

## 4. Dívida de documentação a tratar

> **`docs/entrega-cliente/`** (Manual do Cliente e Relatório de Auditoria, em PDF e HTML) foi
> **gerado a partir de um baseline anterior** e está **desatualizado**.
> **Não usar como fonte.** Deve ser **regenerado** a partir desta documentação SoT. Itens afetados:
> `manual-cliente.html`, `Manual-do-Cliente-Social-AI-Platform.pdf`, `relatorio-auditoria.html`,
> `Relatorio-Auditoria-Social-AI-Platform.pdf`.

Pontos de atenção (a confirmar com o time, fora do escopo de "só documentação"):

- A documentação anterior citava os enums em `apps/api/Domain/Enums.cs`, mas o arquivo real está em
  `libs/SocialAi.Core/Domain/Enums.cs` (movido com a extração da `Core`). Esta documentação usa o
  caminho real.
- A variável de configuração `Minio:Bucket` (default `media`) é lida pelo worker mas não consta no
  `.env.example` (ver [06 — Referência](06-referencia.md) §1.9).

---

*Quadrante: Explicação. O estado de cada item foi conferido contra o código; o que é roadmap está
explicitamente fora do código de hoje.*
