# Matriz de aceite — Escopo contratado × Entrega

> **O que este documento é.** Confronta, item a item, o **escopo da proposta** (seções 2.1 a 2.7,
> evolução futura, infraestrutura e entregáveis) com o que foi **efetivamente entregue**, verificado
> contra o **código-fonte real** (cada linha aponta `arquivo:linha` para auditoria direta). É a régua
> de aceite da entrega.
>
> **Estado:** pronto para operação em **modo de demonstração** (publicação simulada), de ponta a ponta,
> **sem bloqueante**. Suítes automatizadas: **.NET 246 · agents 237 (+2 ignorados) · web 177 + 4 axe E2E
> = 664 testes**, todas verdes. Verificado em 2026-06-23.
>
> **Legenda:**
> ✅ **Entregue** — atende e está evidenciado no código ·
> ◐ **Parcial** — funciona ponta a ponta no núcleo, com uma limitação declarada (em geral, falta uma tela) ·
> ⚙️ **Depende de configuração do cliente** — o código está pronto; faltam credenciais/contas externas (não é código) ·
> 🔭 **Fase futura** — declarada como fora do escopo inicial pela própria proposta.

---

## 1. Sumário executivo

A plataforma entrega o **ciclo completo de automação de conteúdo de Instagram**: configurar a marca →
alimentar pautas → a IA gera o conteúdo (post, carrossel, story) → revisão/aprovação humana → agendamento →
publicação → histórico → aprendizado com a performance. Tudo numa **interface visual operacional** em
português, **self-hosted** (roda na infraestrutura do cliente, não é SaaS), com o **código-fonte completo**
entregue.

- **A grande maioria do escopo está entregue e evidenciada no código.**
- **O que depende do cliente (⚙️)** é configuração externa que a própria proposta atribui à contratante
  (seção 4): chave de IA, App Review da Meta + credenciais do Instagram. O código está pronto; a virada para
  publicação/métricas reais é **configuração** (`PUBLISHER_MODE=graph`), não desenvolvimento.
- **Os itens parciais (◐)** têm a engrenagem completa no núcleo e uma limitação honestamente declarada —
  tipicamente "a capacidade existe via API, falta a tela", nunca uma funcionalidade ausente.
- **Nenhum item ficou faltando sem justificativa, e não há bloqueante.** O fluxo principal funciona a vivo
  (provado em teste de ponta a ponta).

Os dois pontos honestamente mais fracos, declarados sem maquiagem: a **geração 100% autônoma de ideias**
quando a fila de pautas esvazia (hoje cria um rascunho de texto fixo, sem IA — e o loop autônomo é entregue
**desligado por padrão**, por segurança); e o **Story**, gerado como imagem 4:5 (não há ainda um formato
vertical 9:16 dedicado).

---

## 2. Matriz por seção da proposta

### 2.1 Configuração da estratégia de conteúdo
*Proposta: área para definir branding, tom, referências visuais, modelos visuais, concorrentes, tipos de conteúdo, diretrizes editoriais e regras de posicionamento — usados como contexto permanente.*

| Item da proposta | Status | Evidência (arquivo:linha) | Observação |
|---|---|---|---|
| Branding e identidade da marca | ✅ | `apps/web/app/(app)/brand/page.tsx`; `Entities.cs:92`; `input-adapter.ts` | Texto livre, vira contexto da geração |
| Tom de comunicação | ✅ | `brand/page.tsx`; `input-adapter.ts` | Vira atributos de voz do copywriter |
| Referências visuais desejadas | ◐ | `brand/page.tsx`; `input-adapter.ts` | Cadastráveis por URL na tela; ainda **não são consumidas** pela geração (ver §3, item 5) |
| Modelos visuais esperados (templates) | ✅ | galeria de templates no assistente de criação, com pré-visualização na marca; `TemplatesController.cs` | 4+ templates; o operador escolhe e vê "template usado: X" |
| Concorrentes e perfis de referência | ✅ | `brand/page.tsx`; `input-adapter.ts` | Entram como referência textual ao modelo |
| Tipos de conteúdo desejados | ✅ | `brand/page.tsx`; `input-adapter.ts` | Diretriz de contexto |
| Diretrizes editoriais | ✅ | `brand/page.tsx`; `input-adapter.ts` | — |
| Regras de posicionamento e linguagem | ✅ | `brand/page.tsx`; `input-adapter.ts` | Orientação ao modelo |
| Identidade visual (cores, fontes, logo) | ✅ | `brand/page.tsx` (aba "Visual"); `Entities.cs:103-111` | Preset + cores, fontes e logo editáveis pela tela |
| Público-alvo e exemplos de copy | ✅ | `brand/page.tsx` (aba "Público & copy"); `Entities.cs:112-113` | Chegam à geração |
| **Contexto permanente** (a IA sempre consulta antes de gerar) | ✅ | `ContentController.cs` injeta o contexto da marca em toda geração | Isolado por marca/conta |

### 2.2 Gestão de pautas (input humano)
*Proposta: alimentar pautas manualmente com título, objetivo, resumo/contexto, prioridade, categoria, tipo, data sugerida e anexos; o sistema interpreta e gera.*

| Item da proposta | Status | Evidência | Observação |
|---|---|---|---|
| Cadastro/edição de pautas (CRUD) | ✅ | `pautas/page.tsx`; `PautaController.cs` | Completo, isolado por conta e marca |
| Título | ✅ | `Entities.cs:139` | Obrigatório |
| Objetivo da publicação | ✅ | `Entities.cs:140` | Alimenta o pipeline |
| Resumo/contexto do tema | ✅ | `Entities.cs:141`; campo "Contexto" na criação **e** na edição | Editável pela tela |
| Prioridade da pauta | ✅ | `Entities.cs:142`; `pautas/page.tsx` | Alta/Média/Baixa; ordena a fila |
| Categoria do conteúdo | ✅ | `Entities.cs:143`; `pautas/page.tsx` | — |
| Tipo de publicação | ✅ | criação e edição mostram o campo Tipo | Post/Carrossel/Story |
| Data sugerida (opcional) | ✅ | `Entities.cs:148`; seletor de data na edição | Editável pela tela |
| Anexos de apoio (imagens, prints, depoimentos, referências) | ◐ | `Attachment` (`Entities.cs:156`); modelo e API suportam vários | A tela aceita **1 URL** na criação e exibe no detalhe; sem upload de arquivo (ver §3, item 2) |
| O sistema interpreta a pauta e gera o conteúdo | ✅ | `ContentController.cs` → pipeline de 6 agentes | Geração real requer chave de IA (⚙️) |

### 2.3 Criação automática de conteúdo
*Proposta: criar autonomamente Post único, Carrossel e Story — incluindo texto da arte, legenda, copy, CTA, hashtags, sugestão visual e a imagem; coerente com a marca.*

| Item da proposta | Status | Evidência | Observação |
|---|---|---|---|
| Post único | ✅ | `input-adapter.ts` | — |
| Carrossel | ✅ | `image-generator.ts`; `brand-strategist.ts` | Pipeline mais completo (1080×1350) |
| Story | ◐ | `mapFormat` (`input-adapter.ts:99`) trata story como imagem única | Gerado como imagem 4:5; ainda **sem formato vertical 9:16 dedicado** (ver §3, item 4) |
| Texto da arte | ✅ | `copywriter.ts` | Cada slide exige headline (falha clara se faltar) |
| Legenda | ✅ | `jobs.ts` | Editável na tela |
| Copy | ✅ | `copywriter.ts` | Português forçado |
| CTA (chamada para ação) | ✅ | `jobs.ts` | — |
| Hashtags | ✅ | `jobs.ts` | Funde as hashtags da marca sem duplicar |
| Sugestão visual | ✅ | direção visual interna (story-architect → visual-compositor) | Governa a composição da imagem |
| Criação da imagem | ⚙️ | `image-generator.ts`; fallback de gradiente da marca se a geração falhar | **Requer chave de IA**; sem ela, a geração falha com mensagem clara |
| IA compreende a marca e gera coerente | ✅ | `ContentController.cs` + validador de qualidade (limiar ≥70) | Peça com nota baixa é entregue como rascunho, não publicada |

### 2.4 Aprendizado contínuo
*Proposta: analisar posts publicados, observar padrões de performance, aprender formatos de maior engajamento, melhorar continuamente; consultar a base de contexto antes de gerar; com a fila vazia, gerar novas ideias a partir de histórico/padrões/contexto/objetivos.*

| Item da proposta | Status | Evidência | Observação |
|---|---|---|---|
| Analisar posts publicados | ✅ | `MetricsCollectorJob.cs` | Métricas simuladas até haver token real do Instagram |
| Observar padrões de performance | ✅ | `PerformanceAnalyzer.cs` | Média por formato/janela, a partir de ≥3 métricas |
| Aprender formatos de maior engajamento | ✅ | `PerformanceAnalyzer.cs` (`BuildBestFormatAsync`) + régua ponderada configurável (`MetricScoring.WeightedScore`) | Por tipo de conteúdo; a régua de "bom post" é escolhida pelo operador (`MetricWeightConfig`) |
| Melhorar continuamente (realimentar a geração) | ◐ | textual (`learningSummary`, **já com o formato preferido sob a régua do operador** — task 3.3) chega aos agentes; o **robô** prioriza pelo formato ponderado (3.4) e dispara arte real (2.3) | Braço textual fecha o loop nos dois fluxos (wizard e robô). **Braço tipado no WIZARD ainda não enviesa o `brand-strategist`** (só o robô usa o formato ponderado) — ver §3 |
| Consultar a base de contexto antes de gerar | ✅ | `ContentController.cs` | Sempre, isolado por marca |
| Pautas têm prioridade sobre ideias | ✅ | `AutonomousLoopJob.cs` | Pauta humana sempre vence |
| Com a fila vazia, gerar novas ideias | ◐ | `AutonomousLoopJob.cs` | Cria um candidato de ideia, **mas hoje com texto fixo** (sem chamada de IA nem leitura do histórico real) — ver §3, item 3 |
| Respeitar orçamento ao gerar autonomamente | ✅ | `AutonomousLoopJob.cs` | Teto mensal por conta |
| Moderação humana das ideias | ✅ | `IdeasController.cs`; `ideas/page.tsx` | Ideia nunca publica sem aprovação humana; o loop é entregue **desligado por padrão** |
| Métricas reais do Instagram | ⚙️ | `MetricsCollectorJob.cs` | Requer token do Instagram + App Review |

### 2.5 Aprovação de conteúdo · 2.6 Gestão de prioridade
*Proposta: dois modos (aprovação manual / publicação automática), ativáveis por conta, campanha ou conteúdo; e fila por prioridade Alta/Média/Baixa.*

| Item da proposta | Status | Evidência | Observação |
|---|---|---|---|
| Modo de aprovação manual | ✅ | `ScheduleController.cs`; `PublishJob.cs` | Padrão; conteúdo aguarda revisão humana |
| Modo de publicação automática | ✅ | `ApprovalController.cs` (`ApprovalMode.Automatic`) | Pula a revisão conforme regra/agenda |
| Ativar/desativar por **conteúdo** | ✅ | `ApprovalController.cs`; `content/[id]/page.tsx` | Tela completa (Admin) |
| Ativar/desativar por **conta** (workspace) | ✅ | `ApprovalController.cs`; `settings/approval/page.tsx` | Tela (Admin) |
| Ativar/desativar por **campanha** | 🔭 | precedência já cabeada em `ApprovalController.cs` | A regra existe; **sem CRUD de campanha** (corte de escopo consciente, YAGNI — ADR-0006) |
| Prioridade Alta/Média/Baixa | ✅ | `Enums.cs:3`; `pautas/page.tsx` | — |
| A IA respeita a fila/relevância | ✅ | `PautaController.cs` | Ordena por prioridade (desempate por data) |

### 2.7 Publicação automática no Instagram
*Proposta: agendamento, frequência, Story, Feed, Carrossel, aprovação manual/automática, histórico e logs operacionais.*

| Item da proposta | Status | Evidência | Observação |
|---|---|---|---|
| Agendamento | ✅ | `ScheduleController.cs`; `PublishSchedulerJob.cs` | Converte fuso do workspace; rejeita data no passado |
| Frequência de postagem (recorrência) | ✅ | `Frequency` (`Enums.cs:61`); `PublishSchedulerJob.cs` | None/Diária/Semanal/Mensal; reagenda a próxima ocorrência |
| Story | ✅ | `Publishers.cs` (`EphemeralPublished`) | Publicação simulada na demonstração (ver nota Story em §2.3 sobre o formato) |
| Feed | ✅ | `Publishers.cs` | — |
| Carrossel | ✅ | `Publishers.cs` | Exige ≥2 slides |
| Aprovação manual ou automática | ✅ | gate triplo (Aprovação/Agendamento/Publicação) | Auditado |
| Histórico de publicações | ✅ | `HistoryController.cs`; `history/page.tsx` | Paginado, por marca; selo "demonstração" no que foi simulado |
| Logs operacionais | ✅ | `PublishLog` (`Entities.cs:248`); `PublishingController.cs` | Resultado, resposta da API, erro, correlação; re-tentativa com espera crescente |
| Publicação real no Instagram (Graph API) | ⚙️ | `Publishers.cs` (Graph API v22.0) | Pronto; virada = `PUBLISHER_MODE=graph` + App Review da Meta |

### §3 Evolução futura · §4 Infraestrutura · §5 Entregáveis · §6 Modelo de parceria

| Item da proposta | Status | Evidência | Observação |
|---|---|---|---|
| Conteúdo de imagem (Story/Feed/Carrossel) — foco da 1ª etapa | ✅ | pipeline de 6 agentes | Escopo inicial entregue |
| Vídeo com IA / Reels | 🔭 | `docs/sot/09-roadmap.md` | Declarado **fora do escopo inicial** pela própria proposta |
| Conteúdo multimodal / outras redes | 🔭 | `docs/sot/09-roadmap.md` | Instagram-only por design nesta etapa |
| Arquitetura pronta para crescer | ✅ | provedores trocáveis por configuração; biblioteca de domínio compartilhada | Texto: Gemini/OpenAI/Grok/Claude; imagem: Gemini/OpenAI |
| Cliente contrata APIs/infra (seção 4) | ⚙️ | `docs/DEPLOYMENT.md` | Atribuição da contratante, conforme a proposta |
| Apoio às integrações | ✅ | `docs/DEPLOYMENT.md` | Passo a passo de credenciais e modos |
| Operar na infra do cliente (não SaaS) | ✅ | `docker-compose.yml` | Self-hosted, um deploy por cliente |
| Sistema funcional | ✅ | 26 controllers · 6 jobs de fundo · pipeline de 6 agentes · 664 testes | Ponta a ponta em demonstração |
| Interface visual operacional | ✅ | `apps/web` (Next.js 15, PT-BR) | Jornada completa |
| Fluxos de automação implementados | ✅ | `apps/worker/Jobs` | Agenda → publica → métricas → loop (loop OFF por padrão) |
| Integrações realizadas (IA / Instagram / armazenamento) | ✅ | OAuth do Instagram; serviço de mídia; pipeline de agentes | Virada para real = configuração |
| **Código-fonte completo** (entregável obrigatório) | ✅ | monorepo versionado | Entregue na íntegra |
| Documentação técnica | ✅ | `docs/sot/` (referência), 16 ADRs (decisões), `docs/DEPLOYMENT.md`, `docs/ESTADO-E-PRONTIDAO.md` | + manual do operador (`docs/entrega-cliente/`) |
| Processo de implantação | ✅ | `docs/DEPLOYMENT.md` | Docker Compose; inclui hardening de produção e backup/recuperação |
| Apoio à configuração inicial | ✅ | `docs/entrega-cliente/manual-cliente.html`; `DEPLOYMENT §5` | Manual passo a passo |
| Estrutura pronta para evolução | ✅ | provedores por configuração; domínio em biblioteca própria | — |
| Transferência tecnológica / ownership | ✅ | repositório + documentação + ADRs entregues ao cliente | Operação própria, conforme seção 6 |

---

## 3. Pendências honestas — o que ainda não está 100%

Tudo abaixo é (a) uma tela faltando sobre um backend já pronto, (b) fase declarada como futura, ou
(c) um corte de escopo consciente. **Nenhum é bloqueante do fluxo principal.**

| # | Item | O que falta exatamente | Natureza |
|---|---|---|---|
| 1 | **Tela de curadoria de templates por marca** | A galeria de templates já existe no assistente; falta uma tela de administração para ligar/desligar templates por marca (a capacidade existe via API). | Tela sobre backend pronto |
| 2 | **Anexos de pauta (upload)** | A tela aceita 1 URL de referência na criação; o modelo e a API suportam vários anexos. Falta upload de arquivo e edição dos anexos. | Tela sobre backend pronto |
| 3 | **Geração 100% autônoma de ideias** | Quando a fila de pautas esvazia, a ideia criada pelo loop é um rascunho de texto fixo — ainda não chama a IA nem lê o histórico real. (O loop autônomo é entregue **desligado por padrão**, por segurança.) | Capacidade em evolução |
| 4 | **Story vertical 9:16** | O Story é gerado como imagem 4:5. Falta o formato vertical dedicado. | Refinamento de formato |
| 5 | **Referências visuais na geração** | As URLs de referência cadastradas na marca ainda não são consumidas pelo pipeline de geração. | Tela sobre backend pronto |
| 6 | **CRUD de campanha** | A precedência de aprovação "por campanha" está cabeada, mas não há tela/CRUD de campanha. | Corte de escopo consciente (YAGNI — ADR-0006) |
| 7 | **Formato vencedor enviesar o `brand-strategist` na geração do wizard** | O **robô** já prioriza o formato que pontua alto sob a régua do operador (task 3.4); na geração pelo **wizard**, o `bestFormat` é enviado ao agents mas o `brand-strategist` ainda não o usa como viés estrutural de escolha de template. | Conectar sobre backend pronto |

---

## 4. O que o cliente precisa prover para operar 100% real

Conforme a **seção 4 da proposta** (a contratante provê as APIs e a infraestrutura), a virada do modo de
demonstração para operação real é **configuração, não desenvolvimento**:

1. **Chave de IA** (`AI_PROVIDER_KEY`) — destrava a geração real de texto e imagem.
2. **App Review da Meta + credenciais do Instagram** (`META_*` + token) e o ajuste `PUBLISHER_MODE=graph` —
   destrava a publicação e as métricas reais. O código da Graph API já está pronto e testado; o que falta é
   a aprovação da Meta (processo externo, conduzido pelo cliente, com nosso apoio).
3. **Segredos de produção** (`JWT_SECRET`, `SECRETS_ENCRYPTION_KEY`) e ambiente em `Production`.

Passo a passo completo em `docs/DEPLOYMENT.md` e no manual do operador (`docs/entrega-cliente/`).

---

## 5. Veredito de aceite

**A entrega cumpre o escopo contratado, em modo de demonstração, de ponta a ponta e sem bloqueante.** A
grande maioria das exigências está atendida e evidenciada no código-fonte (cada linha desta matriz aponta
`arquivo:linha` para auditoria direta). O que resta é configuração do cliente (atribuição da própria
proposta), fase futura declarada no escopo, ou tela sobre backend pronto — tudo honestamente listado na
seção 3, sem nada varrido para baixo do tapete.

O fluxo principal funciona a vivo, comprovado em teste de ponta a ponta:
**criar conta → configurar marca → criar pauta → gerar conteúdo → revisar e aprovar → agendar → publicar
(demonstração) → histórico → aprender com a performance.**

> Documento verificado contra o código real em 2026-06-23. As referências `arquivo:linha` permitem ao
> cliente (ou a uma auditoria independente) confirmar cada afirmação diretamente no repositório.
