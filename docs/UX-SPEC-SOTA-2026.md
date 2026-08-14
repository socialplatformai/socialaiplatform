<!-- Forjado por workflow ux-spec-sota-2026 (18 agentes, jornada+fricções+spec por tela, revisão adversarial). Fatos verificados no código (nota de método L1 no topo). Este é o CONTRATO DE DESIGN. -->

# Especificação de Experiência Final — SOTA-2026 (Apple-grade)
**Plataforma operadora · Geração → Aprovação → Agendamento → Publicação · 6 agentes**
*Contrato de design. O operador aprova ISTO antes de virar código. PT-BR em toda string de usuário.*

> **Nota de método.** Os "must-fix" das revisões foram verificados no código antes de entrar aqui. Confirmado: `PendingContent` (lib/workflow.ts:24-33) **não tem** thumb/title/brand/createdAt; `LearningInsights` (PerformanceAnalyzer.cs:116-125) são **7 escalares** sem array de posts, sem distribuições, sem série, com `BestWindow` em bucket grosso (manhã/tarde/noite); o interceptor 401 (api.ts:194) **sequestra** o erro de login; `Brand` é **agrupador dentro do workspace, não nível de tenancy** (Entities.cs:53-62) → IA/Budget/Equipe são **por workspace**; `promote` (IdeasController.cs:47) **materializa uma Pauta** (retorna PautaDto); `MetricsCollectorJob` (linha 58) **acumula** uma linha de métrica por ciclo → **a sparkline por post tem dado real**. Cada afirmação de "isto exige backend novo" abaixo é fato verificado, não suposição.

---

## 1. PRINCÍPIOS DE EXPERIÊNCIA (transversais)

Sete leis que fazem a coisa **parecer intencional, não template**. Cada uma é detectável (proxy no §6).

1. **App-frame, não document-frame (largura é propriedade do conteúdo).** Nenhuma tela operacional usa `max-w-2xl/3xl` centrado. Fila → master-detail full-width; leitura de briefing → coluna de ~640px por *line-length*; tabela de métricas → full-bleed. *Lente: R0 "largura por tipo de conteúdo"; Vignelli (a grade serve o conteúdo).* O pecado document-frame é o tell #1 de "SaaS genérico".

2. **Modo degradado é estado de 1ª classe legível (Norman: feedback antes da falha).** Sem chave de IA, a geração está off — e isso aparece **inline** no dashboard, no settings-hub e antes do botão Gerar, **nunca** como surpresa em runtime. É a diferença entre "o produto é honesto" e "o produto me traiu".

3. **Tesler — o sistema encadeia a próxima ação, o humano não re-navega.** Toda tela termina na próxima-ação óbvia: aprovar revela agendar; gerar termina em aprovar+agendar; insight deep-linka /create pré-preenchido; promover ideia cria pauta no topo. Zero beco-sem-saída, zero toast morto.

4. **Progressive disclosure por persona (Hick/Miller).** Marina (poder, teclado-first, multi-marca) e Léo (solo, guia, 1º acesso) usam **a mesma tela sem bifurcar**. Cada um vê só os campos/controles do seu momento: forgot só no login, confirmar-senha só em registro, bullets do pitch só em registro/convite, atalhos escondidos até o operador procurar (overlay `?`).

5. **Fonte única para lógica que diverge se duplicada (L3 — DRY com propósito, não abstração prematura).** Um `<ScheduleForm/>` (mata 3 cópias de fuso), um `<PautaForm/>` (mata 2 cópias), um `STEPS[]` no wizard, um eixo de tenancy por sinal. Não é elegância — é "um bug de fuso se corrige em 1 lugar".

6. **Honestidade sobre simulação e amostra (L4/L5).** Badge `Simulado`/`Parcialmente simulado` (`Source=Mock`) nunca some. `n<3` não mostra gráfico vazio — mostra completeness-meter. Onde o backend é stub (IdeaCandidate), a UI diz "sugestão básica", não vende inteligência inexistente.

7. **Motion comunica, não decora (Val Head / Disney-12 via tokens).** O QueueRow que sai com `height→0 + translate-x` **diz** "este item saiu, o próximo já está focado". Toda duração vem de token de motion (R1), nunca número mágico; `prefers-reduced-motion` respeitado como gate.

**Calma por restrição.** Quase-mono, **zero gradiente-roxo-no-branco**, 1 accent reservado, `pill` só no CTA primário, cor só para sinalizar (Few). APCA ≥60 corpo / ≥75 texto pequeno em light **e** dark.

---

## 2. JORNADA TEMPORAL (signup → mês 3)

| Estágio | Fricção-chave (hoje) | Como o redesign mata |
|---|---|---|
| **1. Descobre + login** | Cartão genérico, não comunica valor; "Nome da conta" críptico; sem recuperação; invite às cegas; **401 sequestrado pelo refresh** | Split-screen com pitch do pipeline; microcopy do workspace; **cliente de auth fora do interceptor 401**; invite-context buscado antes do submit (backend novo, declarado parcial) |
| **2. Workspace vazio** | Modo degradado invisível; KPIs mortos; 5 queries sem prioridade | Cockpit/onboarding por modo; **completeness-meter de 2 eixos** (conta vs marca); faixa degradada inline; queries priorizadas |
| **3. Configura marca** | Sem preview; troca de aba perde edição; re-colar chave p/ trocar modelo; 10 abas sem hub | Preview ao vivo; autosave/aviso; editar modelo sem re-chave; **settings-hub com health-meter por eixo correto** |
| **4. Primeira pauta** | Form fixo 360px; 2 cópias de campos; anexos só na criação; sem rastro de produção | `<PautaForm/>` único; criar **inline no detalhe** (não drawer); editar anexos; badge "N gerados" |
| **5. Geração (6 agentes)** | 6 passos sempre; refresh perde run; agendar é 3ª cópia; sem rationale auditável | Expresso = subset do mesmo `STEPS[]`; rehidrata de `GET /jobs/{id}`; `<ScheduleForm/>`; **linha de intenção = reasoning REAL que o agente já produz** |
| **6. Aprovação + agenda** | **N+1 (30 itens = 30+ req)**; atalhos invisíveis; palette só navega; fuso duplicado | `pending` devolve thumb inline; overlay `?` + kbd-hints; Cmd+K executa; `<ScheduleForm/>` |
| **7. Publicação (mock)** | Falha dividida em publishing/ e history/; tradução por regex; history morto | Fundir em `/history?filter=falhas`; **backend grava msg PT-BR classificada**; cada linha vira ação; badge "modo simulação" |
| **8. Semana 1** | Calendário cego; baixa workspace inteiro p/ dropdown; "Gerar mais assim" cru | Endpoint "agendáveis"; células com mini-thumb + drag-reagendar; insight deep-linka pré-preenchido |
| **9. Mês 1 (multi-marca)** | Sem reforço de marca ativa; insights = 2 KPIs; ideias = fachada; risco espalhado | Chip de marca ativa nas telas densas; **dashboard de desempenho real (backend novo)**; ideias com evidência ou rótulo honesto; painel de governança único |
| **10. Mês 3 (power-user)** | N+1 escala p/ 100+; sem virtualização; 2 editores no mesmo campo; compare sem confirmação; audit sem filtro | Virtualização; editor único 2-painéis com diff; compare navegável + confirmação; audit com filtros + CSV; users com convites/papéis |

---

## 3. SPEC POR SUPERFÍCIE (must-fix incorporados)

### 3.1 Login + Signup *(precisa-ajuste → resolvido)*

**Intenção.** Primeiro contato que comunica o que o produto faz e converte sem fricção. Um único form-card que troca de papel (entrar/criar/recuperar/aceitar) sem trocar de tela.

**MUST-FIX bloqueante #1 (BUG REAL).** O login **deve** usar um cliente HTTP que **não** passa pelo branch de refresh do api.ts:194. Hoje: usuário com refreshToken velho digita senha errada → 401 → tenta refresh → falha → `window.location.assign('/login?expired=1')` → a página **recarrega com "sessão expirou"** em vez de "Credenciais inválidas" inline. **Correção:** path-allowlist `/auth/login` e `/auth/register` fora do branch 194, OU usar `quickLogin`/`quickRegister` que falam direto com fetch. Sem isso, "erro inline por status" é ficção e o fluxo #1 (Marina) tem bug latente.

**MUST-FIX #2 (validação de e-mail).** `canSubmit` exige formato de e-mail válido em **todos** os modos (regex simples + erro inline `emailInvalid`). Sem isso, `'marina@'` faz round-trip garantido — contradiz o próprio L1 que a spec invoca para a senha.

**MUST-FIX #3 (forgot + invite-context — decisão L3).** `POST /api/auth/forgot-password` e `GET /api/auth/invite-context` **não existem** no AuthController. **Decisão:** entregar a UI cabeada **e** os dois endpoints no mesmo épico (E-AUTH-BE), OU cortar os dois modos até o backend existir. **Proibido o limbo**: nada de botão "Enviar link" que mente. Enquanto o backend não vier, o link "Esqueci a senha" **não renderiza** e accept-invite degrada para o genérico atual ("defina sua senha") sem cabeçalho rico.

**Hierarquia.** P = form-card direito + CTA único re-rotulado (`Entrar`·`Criar conta`·`Enviar link`·`Criar minha conta`), pill, autofocus no e-mail. S = painel esquerdo de marca. T = toggles, forgot, microcopy.

**Painel esquerdo — delta concreto (MUST-FIX #4, "recuar" era vocabulário, agora é spec):**
- **Modo login:** Logo + h1 + frase de valor a **opacity 70%**, **sem bullets**. Peso baixo, recua de fato.
- **Modo register/invite:** frase a **100%** + **3 bullets** (Gera → Aprova → Publica) + (invite) cabeçalho de contexto. Peso pitch.

**Grid.** Split 2 colunas em ≥1024px: esquerda ~45vw (superfície APEX distinta do canvas, padding 48), direita ~55vw com card travado em **~440px** (não o velho max-w-sm/384 — sobe por line-length de form de capa). Stack de fields gap-16; inputs radius-12, card radius-16. Alvos ≥44px (Fitts).

**Mobile (MUST-FIX #5).** `<lg`: register/invite **mantém os 3 bullets ACIMA do card** (não vira faixa de 1 linha). Léo abre o convite no celular — é o vetor mais provável (link copiado, UsersController:61); perder o pitch ali sacrifica exatamente a persona que mais precisa.

**Ação primária.** CTA único no fim do stack, full-width, disabled até `canSubmit`, busy="Aguarde…". Encadeia: login→`/dashboard`; register→`/dashboard` (com onboarding aguardando); invite→`/dashboard` logado; forgot→confirmação neutra inline ("Se houver conta, enviamos um link").

**Estados.** Erros por status: 401→"Credenciais inválidas." · 409→"E-mail já cadastrado. Faça login." (+toggle) · 400→ProblemDetails · **429→"Muitas tentativas. Aguarde um minuto." (NOVO, alinhado ao rate-limiter 'auth' 10/min/IP)** · status 0→"Verifique a conexão." Invite COM token sem contexto: skeleton só na faixa de contexto, resto interativo. Invite-context GET falha → degrada para genérico (L5).

**Teclado/a11y.** Autofocus no e-mail; Tab na ordem visual; Enter submete o modo atual; foco-visível em tudo (WCAG 2.4.7); toggle e forgot são `<button>/<Link>` reais; banners `role=status`/`role=alert`.

---

### 3.2 Onboarding + Início *(precisa-ajuste → resolvido)*

**Intenção.** Em 1 olhada: "o que precisa de mim agora e qual minha próxima ação" — e no 1º acesso, "o que falta para gerar meu primeiro post" — com modo degradado legível.

**MUST-FIX #1 (dois eixos de tenancy).** O completeness-meter **não pode somar** workspace-scope (chave de IA) com brand-scope (kit/IG/pautas). **Separar:** **gate de conta** (IA presente — `/api/settings/ai`, uma por workspace) acima de um **anel de prontidão da MARCA ATIVA** (kit + IG vinculado + ≥1 pauta — varia por marca). O banner "N de M marcas prontas" conta **só itens por-marca**.

**MUST-FIX #2 (contrato da mini-fila — pré-requisito do épico).** `PendingContent` hoje **não tem** thumb/title/brandName/createdAt (verificado, workflow.ts:24-33). O elemento PRIMÁRIO do cockpit depende deles. **Pré-requisito:** DTO de `/api/approval/pending` ganha `thumbUrl, brandName, createdAt, title`. **v1 honesto** = fallback textual (linha sem thumb), declarado como estado v1, não nota de rodapé.

**MUST-FIX #3 (timeline 7 dias).** `scheduleApi.calendar` retorna `ScheduledPost[]` **sem thumb** (verificado). **Decisão:** ou calendar DTO ganha `thumbUrl`, ou **timeline v1 usa slots cheios/vazios coloridos sem imagem** — o pré-atentivo de cadência (gap de dia vazio salta) funciona igual. Escolha v1 = slots coloridos (não bloqueia o épico no DTO).

**MUST-FIX #4 (gatilho de modo).** ONBOARDING vs COCKPIT dispara por **"workspace nunca cruzou o piso"**, não por "marca ativa <100%". Senão Marina, ao criar a 2ª marca vazia, cai no onboarding-protagonista que a spec jurou não mostrar.

**MUST-FIX #5 (header subordinado ao estado).** Botão do header **não** é fixo "Gerar conteúdo". Regra: `fila>0` → primário "Revisar (N)", "Gerar" vira ghost; `fila=0 & pronto` → "Gerar conteúdo"; `degradado` → "Configurar IA". Resolve a contradição Tesler/Hick.

**MUST-FIX #6 (invalidação).** Voltar de `/brand` **deve** re-buscar o meter. Cada deep-link de gap registra `invalidateQueries` no retorno. Sem isso o gap fica stale.

**MUST-FIX #7 (cockpit virgem).** 4/4, zero fila, zero agenda (estado de 100% dos usuários no segundo após onboarding) tem desenho próprio: empurra **"Gerar primeiro conteúdo"** com peso, não cai em "linha calma + Gerar" de veterano ocioso.

**MUST-FIX #8 (afirmações → mecanismo).** "Diferir secundárias <400ms" = `enabled`-gates encadeados (meter/pending primeiro, contagens depois), não prosa. Cmd+K "ensina atalho" = capacidade nova da palette (§4), não assumida.

**Hierarquia.** Onboarding: P = completeness-meter (anel + checklist com deep-link no gap). Cockpit: P = mini-fila "Aguardando você" (thumbs + deep-link `?focus={id}`). S = faixa degradada / timeline 7 dias + tira de sinais. T = status do canal, Cmd+K, header.

**Grid.** PageShell `width='full'`. Onboarding: coluna central ~720px (meter+checklist) com faixa degradada full acima. Cockpit: split 8/4 — esquerda mini-fila sobre timeline; direita pilha de sinais (falhas re-tentáveis → `/history?filter=falhas`, órfãos do reaper, token IG ≤7d). Header: eyebrow `Painel · {marca}`.

**Estados.** Vazio = onboarding em si (não EmptyState). Mini-fila vazia = "Nada aguardando você" + Gerar. Erro por widget (não tela inteira), padrão `KpiValue`. Faixa degradada em erro assume o pior legível (L5).

**Teclado.** `G A`→aprovações, `G C`→calendário, `C`→criar. Linhas da mini-fila focáveis (Enter = abrir em `?focus`), espelhando J/K da inbox.

---

### 3.3 Conteúdo: Pautas / Ideias / Gerar *(precisa-ajuste → resolvido)*

**Intenção.** Ideia → carrossel pronto, mínimo de cliques no caminho-quente, processo dos 6 agentes auditável. Produção como fila, não formulário.

**MUST-FIX #1 (FLAGSHIP — linha de intenção, o pior buraco).** A "linha de intenção por agente" é o diferencial. Verificado: durante `running`, o job carrega **só step+progress**; `reasoning` (`whyThisTemplate`/`whyThisAngle`, pipeline.ts:128) só existe no **resultado terminal**. **Decisão obrigatória:** a linha de intenção mostra o **reasoning REAL que o agente já produz** (`whyThisTemplate`) — e a frase-exemplo "porque o último marcou 82" é **aspiracional e sai da spec** (o brand-strategist não lê PerformanceMetric por post; só recebe summary textual pré-geração). Para o reasoning aparecer **incrementalmente**, é mudança de **contrato de streaming** (`jobs.ts`/`pipeline-v2.ts` escrevem `reasoning` parcial por step) — **escopar como backend**, não como edição de componente React. v1 aceitável: reasoning aparece **ao concluir cada agente** (não streaming token-a-token).

**MUST-FIX #2 (expresso = subset, não 2ª máquina).** `/create/[step]` com `STEPS=[Origem,Formato,Template,Revisar,Gerar,Resultado]` como **fonte única**. Expresso **não é outra rota** — é o mesmo `STEPS[]` com passos marcados `skippable` quando a pauta carrega a decisão (`desiredType`/`marketingObjective`). O step-indicator mostra os passos skipados como **pulados/colapsados**, não some. "Expandir para completo" = reabrir os skippable sem trocar URL nem perder estado. Deep-link rehidrata no mesmo estado.

**MUST-FIX #3 (job órfão/reaper — estado ausente).** Rehidratar de `GET /jobs/{id}` no refresh **falha** se o agents reiniciou (job in-memory evaporou) enquanto o conteúdo segue `Generating` no banco por até 10min (até o `GeneratingReaperJob`). **UX desse limbo:** "Esta geração foi interrompida (o serviço reiniciou). O conteúdo pode ainda estar processando — verifique em Aprovações em alguns minutos." + link. Não fingir run vivo.

**MUST-FIX #4 (guarda de marca = anti-erro, não maquiagem).** Chip calmo no header só **rotula** — não previne. **Correção:** no caminho-quente expresso (1 clique → gera) **quando o operador tem 2+ marcas**, confirmação leve de marca ("Gerar para **{marca}**?"). O chip é clicável = troca contextual de marca (vira o switcher no contexto). "Legível" ≠ "anti-erro".

**MUST-FIX #5 (badge "N gerados" — fonte declarada).** Conta `Content WHERE PautaId = pauta.Id AND Status >= Generating` (inclui em-andamento e publicados, exclui rejeitados/arquivados). Vem de **novo campo no DTO de pauta** (agregação server-side, +.NET) — não client-side. `0 gerados` → **badge não renderiza** (Few: cor só sinaliza; badge vazio em toda pauta nova é ruído).

**MUST-FIX #6 (dois "Gerar" = redundância, não Fitts).** Gerar inline aparece **on-hover/on-focus** da linha (o atalho `G` cobre o caso rápido por teclado); o **sticky no detalhe é o primário canônico**. Um accent por viewport.

**MUST-FIX #7 (criar inline, não drawer — L3).** Eliminar o drawer. "Nova pauta" é o **estado 'nova' do painel-detalhe** (master-detail puro), usando o **mesmo `<PautaForm/>`** do modo edição. Criar e editar ficam consistentes (Norman: mesmo signifier). Mata a inconsistência "criar=modal vs editar=inline" e a ambiguidade de largura drawer-480 vs form-640.

**MUST-FIX #8 (grid do wizard — reconhecer que /create NÃO é master-detail).** O wizard é **fluxo focado**, não master-detail (não há mestre — a fila de pautas some). Larguras por função: Revisar = ~640px (leitura de briefing); Gerar = AgentProgress full; Resultado = carrossel + metadados 2 colunas. Isso é coerente **porque /create não está sob a tese de grid master-detail** — assumir, não forçar.

**Hierarquia.** P = "Gerar" (inline on-hover na linha + sticky no detalhe) / no wizard, CTA único re-rotulado pela **fase real do job** ("Estrategista de marca…"→"Gerando slides…"→"Concluído"). S = lista do mestre + preview/AgentProgress. T = filtros, sub-nav, chip de marca, "N gerados", FieldSeed.

**Grid.** Master-detail full-width: mestre 380px (fluido até 420), detalhe 1fr. Sidebar ~240px dimmer. Roundness em tiers (input 8 · card 16 · painel 24 · pill só CTA).

**Estados.** Pautas vazias = onboarding guiado + completeness-meter (pré-requisito real: chave IA? marca?). Ideias vazias = honesto sobre dependência do loop. Geração falha = `friendlyGenError()` distinguindo chave-ausente (nada gerado, deep-link) de erro-só-de-imagem (texto salvo, fundo provisório) — **não regredir** (agent-progress:151). Job >75s = escape "Cancelar e voltar".

**Fluxo (encadeamento verificado).** Promover ideia **cria pauta** (IdeasController:47 retorna PautaDto) → empurra para `/pautas` com a pauta no topo. O elo **não está quebrado** (confirmado). Caminho-quente: Pauta → "Gerar" (`?pauta=id`) → wizard expresso → Resultado → "Aprovar+Agendar" inline → `/approvals` ou "Gerar outro".

**Teclado.** J/K na fila; Enter abre detalhe; `G` gera a focada; `N` cria (estado 'nova' do detalhe); `/` busca; Esc cancela. Wizard: Enter avança, Esc volta. Cmd+K executor.

---

### 3.4 Revisão + Agenda *(precisa-ajuste → resolvido)*

**Intenção.** Triar a fila e levar cada item de 'gerado' a 'agendado' sem aprovar às cegas nem sair da tela.

**MUST-FIX #1 (N+1 — verificado, com invariante preservado).** `ApprovalThumb`+`DetailPane` chamam `contentApi.get` por item (30 = 30+ req). **Correção:** `/api/approval/pending` devolve `thumbUrl` (slide[0]) inline → **1 request para a fila**. **Sub-decisão (invariante preview==raster):** a thumb da **fila** é URL pré-renderizada (abre mão do raster client-side **só na thumb**, ok e declarado); o **DetailPane** continua rasterizando slides via `SlideCanvas` para preservar o invariante no preview grande. **Prefetch especificado:** ao focar item (J/K), React Query prefetch da queryKey `['content', id]` do **focado + 1 vizinho em cada direção**; senão o N+1 só migra do thumb para o detalhe.

**MUST-FIX #2 (feature fantasma — sugestão de horário).** Verificado: `BestWindow` é bucket grosso (manhã/tarde/noite, PerformanceAnalyzer:105-110); **não existe** dia-da-semana nem hora concreta. "ter 19h" é **impossível** do dado atual. **Decisão (rebaixar à verdade do dado):** chip = "Melhor janela: **noite**" e, ao clicar, preenche uma hora-regra explícita do slot (ex.: noite→20h do próximo dia útil). A spec diz isso. Subir para "ter 19h" exige agregar por `DayOfWeek+hora` (novo endpoint) — **fora do escopo deste épico**, marcado como T3.

**MUST-FIX #3 (timezone — nomear o fuso canônico).** Extrair `<ScheduleForm/>` centraliza mas não resolve o bug se o fuso não for nomeado. `InlineSchedule` usa hora-de-parede do **browser**; o backend converte por `scheduledForLocal` usando o **fuso do workspace** (confirmado em workflow.ts:91-93). **Verdade canônica = fuso do workspace.** O `<ScheduleForm/>` envia `scheduledForLocal` cru e **não** aplica offset do browser; o `min` do campo também deriva do fuso do workspace (precisa do fuso no payload — **verificar/orçar**: `PendingContent`/contexto não carrega fuso hoje). Marina em fuso diferente da marca não quebra.

**MUST-FIX #4 (micro-motion vs optimistic — caminhos opostos).** Verificado: `decide.mutate` **não remove** o item ao aprovar — entra em `justApproved` e **permanece** para agendar inline. Logo "aprovar → QueueRow sai com height→0 + foco salta J" **colide** com "aprovar revela ScheduleForm no mesmo item". **Resolução:** aprovar **mantém foco no item** (revela ScheduleForm); o micro-motion de saída + salto-de-foco aplica-se **só a Rejeitar e Lote** (que de fato invalidam). Dois caminhos, duas regras, diferenciados.

**MUST-FIX #5 (cadeia de teclado em dois contextos de foco).** `onKey` global faz early-return em INPUT/SELECT/TEXTAREA — onde o ScheduleForm vive. Então: `J/K/A/R/X/E` são **globais** (contexto lista). "Enter confirma a agenda" é handler **local** do `<ScheduleForm/>` (contexto form). `A` é bloqueado por `justApproved` (correto). A cadeia real: foco(J) → julgar(carrossel) → A → **foco salta para o input do ScheduleForm** → Enter confirma → próximo item focado(J). Mapeado para os dois contextos.

**MUST-FIX #6 (honestidade da sugestão + estados).** `insufficientData` (n<3) → chip **some** (não desabilitado-mentiroso), Enter sem sugestão não faz nada. `MockSampleCount>0` → sugestão rotulada **"Simulado"** (insights já faz isso); nunca "+30% no último mês" como se fosse real (L4/L5).

**MUST-FIX #7 (guarda de marca — decidir peso).** Hoje **não há nenhum** indicador de marca-ativa nesta página (PageHeader só tem eyebrow/title/kbd-hints) → "reforço" é **adicionar do zero**, escopo > "refino". Decisão: o risco de aprovar no tenant errado é **real** (mês 9+, 3 marcas) → merece **peso S, não T**: eyebrow `Aprovações · {marca}` + na barra de lote, "Aprovar N em **{marca}**".

**Hierarquia.** P = preview grande (carrossel navegável) + Aprovar/Rejeitar. S = fila + ScheduleForm inline com chip de sugestão + reforço de marca. T = badges (qualidade<70, modo), kbd-hints, barra de lote (só com seleção).

**Grid.** `lg:grid-cols-[minmax(280px,360px)_1fr]`, detalhe `lg:sticky top-20`; sub-grid `[300px_1fr]`. `<lg` colapsa drill-down (T3 honesto). **Virtualização** na fila em 100+ itens.

**Estados.** Vazio = "Nada aguardando" + Gerar (já existe). Loading = skeleton que espelha o grid. **Erro de `pending`** (MUST-FIX): hoje só trata `isLoading` — adicionar erro PT-BR + "Tentar de novo", nunca status cru.

**Teclado.** J/K/A/R/X/E (globais) + `?` overlay + Enter (local no form) + Cmd+K executor (aprovar/agendar/promover de dentro, ensinando o atalho).

---

### 3.5 Desempenho *(precisa-ajuste → resolvido)*

**Intenção.** Ler "o que funciona para esta marca agora" (formato × janela × post) e agir no insight sem sair da tela.

**MUST-FIX #1 (DADO INEXISTENTE — pecado capital, pré-requisito absoluto).** Verificado: `GET /api/learning/insights` retorna **7 escalares**; `byFormat`/`byHour` são calculados e **descartados** (só o vencedor sai); **não há** array de posts nem série temporal. O PRIMÁRIO (tabela) e os 3 small-multiples têm **fonte zero**. **A spec é irrealizável sem endpoint novo.** Pré-requisito do épico: **`GET /api/learning/dashboard`** retornando `posts[] (id, type, publishedAt, reach, engagement, likes, saves, qualityScore, series[]) + byFormat[] + byWindow[] + trend[] + sampleSize + mockSampleCount + insufficientData`. Descrever pixels só depois desse contrato.

**MUST-FIX #2 (qualityScore exige join).** `QualityScore` é campo de `Content`, não de `PerformanceMetric` (verificado). O endpoint novo **deve** fazer `Content ← PerformanceMetric` join. Declarado como dependência da coluna, não trivialidade.

**MUST-FIX #3 (sparkline — cardinalidade VERIFICADA, e é real).** Conferi `MetricsCollectorJob:58`: ele faz **`Add`** de uma nova `PerformanceMetric` por ciclo (condição: "sem métrica na última hora"), **acumulando** linhas por post ao longo do tempo. **Logo a sparkline por post tem dado real** (a preocupação da revisão era infundada). `series[]` = engajamento por `CollectedAt`. (Caveat honesto: posts muito recentes têm 1 ponto → render como "•" sem linha até ≥2 coletas.)

**MUST-FIX #4 (EmptyState não estende — componente novo).** Verificado (ui.tsx:352-360): aceita `title`, `description` truncado, **UM** `action`. O empty descrito (completeness-meter + barra N/3 + **múltiplos** deep-links + bloco degradado) **não cabe**. É **componente novo** (`<LearningEmptyState/>`), declarado como tal — não "extensão".

**MUST-FIX #5 (resolver hierarquia: auditoria-com-ação vs launcher).** Tensão entre "tabela é o centro" (densidade contemplativa) e "a tela existe para virar leitura em geração" (trampolim). **Decisão:** **auditoria-com-ação** — a tabela densa é o centro (P), "Gerar mais assim" é a ação que **encadeia** dela (não a domina). Peso visual: tabela ganha; o botão por linha é estável mas subordinado.

**MUST-FIX #6 (anatomia da linha em 44px).** Linha sobrecarregada (thumb+tipo+data+4 métricas+qualidade+sparkline+2 botões+clicável) é impossível em 44px. **Resolução:** **uma** ação visível por linha — "Gerar mais assim" (primária, borda direita, sempre na mesma coluna). "Virar pauta" entra no **drawer de detalhe** (não na linha). A linha-toda-clicável abre o drawer; o botão "Gerar" tem stop-propagation. Sem dois botões competindo.

**MUST-FIX #7 (fluxo na volta — verificar o receptor).** "Gerar mais assim → /create?type=&window=&from=insight" só fecha o loop se o wizard **ler** esses params e o expresso existir. **Dependência explícita:** o épico do wizard (§3.3) deve aceitar `?type`/`?window` pré-preenchendo Formato; senão o deep-link cai em wizard branco = o mesmo beco que a spec acusa. Marcado como **acoplamento entre épicos** (Desempenho não entrega valor sem o lado receptor).

**Hierarquia.** P = tabela de posts (Reach·Engaj·Likes·Saves·qualityScore·sparkline + "Gerar mais assim"). S = 2-3 small-multiples (eng. por formato / por janela / tendência). T = camada de evidência recolhível (n=, %mock, "base de cálculo") + badge Simulado.

**Grid.** Full-width 12 col. Linha 1: small-multiples `grid-cols-3` (min 280, h~180). Linha 2: tabela full-bleed, row-height 44, `tabular-nums`, divisores `border-ink/8` (não zebra). Drawer de detalhe ~420px overlay (master-detail leve — leitura, não triagem).

**Estados.** `n<3` → `<LearningEmptyState/>` (completeness "Amostra {n}/3" + deep-links Aprovar/Agendar + degradado se IA ausente). Loading = skeleton estrutural (3 painéis 180 + 6-8 linhas 44), `keepPreviousData` ao trocar período. Erro por seção (tabela carrega mesmo se um small-multiple falhar).

**Teclado.** J/K entre linhas; Enter abre drawer; `G` gera a focada; sort por coluna acessível (`aria-sort`, header = button). Cmd+K: "Gerar mais como {melhor formato}".

---

### 3.6 Marca + Ajustes (Settings-hub) *(precisa-ajuste → resolvido)*

**Intenção.** Numa tela, dizer O QUE está ligado, tornar o modo degradado legível, e dar deep-link por gap — em vez de caçar 10 abas planas.

**MUST-FIX #1 (DEFEITO RAIZ — dois eixos de tenancy).** Verificado: `Brand` é **agrupador dentro do workspace, não nível de tenancy** (Entities.cs:53-62); IA, Budget/loop/cap, Equipe, Aprovação(default) são **por workspace**; só Kit/Pautas/Content e cardinalidade fina de IG são **por marca**. **Consequência do erro original:** um meter "desta marca" calcularia 3/4 itens de estado de workspace → anel **idêntico** para todas as marcas; "N de M marcas prontas" **matematicamente impossível** para esses itens; o switcher "guarda contra configurar a marca errada" é **teatro** (trocar X-Brand-Id não muda a chave de IA nem o cap). **Correção:**
- **Health-meter de WORKSPACE** no topo (IA, cap, loop, equipe) — **imutável ao trocar de marca**. Cabeçalho dessas seções = **`Ajustes · {Workspace}`**.
- **Sub-meter de MARCA** abaixo (kit voz/visual, IG conectado, pautas) — varia por marca. Cabeçalho = `Marca · {marca}`.

**MUST-FIX #2 ("N de M marcas prontas" redefinido).** Conta **só itens por-marca** (kit completo + IG vinculado àquela marca), ou vira "Workspace pronto · X de Y marcas com kit completo". Fórmula auditável (cada item declara seu eixo como dado).

**MUST-FIX #3 (nav esquerda vs cartões = um controle primário).** Dois "5 grupos navegáveis" que abrem o mesmo form = redundância + tab-order confuso (cartões antes da nav). **Decisão:** **nav esquerda é o índice persistente de seção** (controle de navegação); **cartões são display + deep-link-para-o-gap específico** (não navegação geral). Não coextensivos.

**MUST-FIX #4 (estados concretos faltando).**
- (a) **Zero marcas** no workspace (BrandSelector retorna null) — o painel inteiro depende de marca ativa: estado dedicado "Crie sua primeira marca →".
- (b) **Múltiplas marcas parcialmente prontas** (Marina): matriz parcial, não "0% ou Gerar".
- (c) **Não-admin** (maioria das seções é Admin-only): meter **consciente de papel** — gaps que o membro não pode fechar viram **"Pedir ao admin"**, não deep-link para 403.
- (d) **Salvando/recalculando**: o anel anima 33→66 ao salvar a chave; recálculo depende de re-fetch de `AiConfig.configured` (optimistic não-trivial → usar invalidate + skeleton no anel durante o refetch, não optimistic falso).

**MUST-FIX #5 (encadeamento sem girar em falso).** Workspace-gates resolvidos **uma vez**; marca-gates por marca. A chave de IA **não reaparece** como gap ao criar a 2ª marca (já está resolvida no workspace). Senão o "motor da jornada" faz Marina reconfigurar IA que já existe.

**MUST-FIX #6 (Cmd+K — honestidade do que é executável).** "Conectar Instagram" é **OAuth de redirect** — a palette só **navega**, não executa. "Convidar membro" inline = mini-form novo (admin-gated, escopo declarado). Rebaixar para o honesto: **trocar de marca** (executa), **navegar para gap** (navega). Não vender "executor" para navegação disfarçada.

**MUST-FIX #7 (barra de token = limiar, não gradiente).** Validade do token IG: **nada quando saudável**, sinal vermelho + ação **só quando ≤7d** (a fonte instagram:182 alerta nesse limiar). Barra contínua 0-60d é decoração — o operador não age em "expira em 40 dias".

**MUST-FIX #8 (confirmação dupla de governança — escopo do contador).** "X conteúdos pulariam revisão" precisa de query de conteúdos em estado revisável; o escopo (workspace? campanha? — `ApprovalMode` é override de campanha) muda o número. **Definir:** contador = conteúdos `Draft/Generated` **no workspace** que cairiam em auto-aprovação. Sem escopo definido, "impacto" é placeholder.

**MUST-FIX #9 (provar que não é o 11º destino cosmético).** O ganho do hub sobre a sidebar atual (que já agrupa os 10) é **só** meter + linha degradada + cartões-de-estado. **Cada badge DEVE consumir sinal real existente:** IA←`AiConfig.configured`; Equipe←contagem de membros; Canais←validade de token + contagem de contas; Governança←estado do `Budget`. Listar a fonte de cada badge na spec (como já feito p/ IA). Badge estático = maquiagem por definição.

**Hierarquia.** P = health-meter de WORKSPACE + linha degradada vermelha ("Geração desligada — sem chave de IA"). S = sub-meter de MARCA + 5 cartões-resumo (Marca · Canais · IA · Equipe · Governança) com badge de sinal real. T = switcher (reforço de contexto), "Avançado" colapsado (Prompts, Auditoria, Fuso).

**Grid.** Split full-width: nav de seção ~220px (dimmer) + painel fluido. Painel-resumo: faixa de contexto full + cartões `grid-cols-2 minmax(320px,1fr)`. Seção selecionada → form `width='form'` ~640px. As 10 rotas físicas **continuam bookmarkáveis** (`ROUTE_REDIRECTS` vazio) — o hub é porta nova, não única.

**Estados.** Vazio (marca recém-criada) = o hub É o onboarding (cada cartão é passo guiado). Zero marcas = estado dedicado. Loading = nav sólida + cartões skeleton + anel pulsando; **priorizar query de IA/degradação** no 1º paint. Erro **por-cartão** (getAi falha → só cartão IA mostra retry). Não-admin = "Requer admin" (não 403 cru).

**Teclado.** ↑/↓ na nav de seção; Enter abre; `aria-current` na ativa; foco-visível. Cmd+K: trocar de marca (executa), ir para gap (navega).

---

## 4. SISTEMA DE INTERAÇÃO TRANSVERSAL

**Command palette (launcher → executor).** Verificado que hoje só faz `router.push`. Evoluir: além de navegar, **executa** ações contextuais (aprovar/rejeitar/agendar/promover/trocar-marca) e **ensina o atalho de cada uma** (kbd hint ao lado de cada comando). Honestidade: ações que são redirect OAuth (Conectar IG) **navegam**, não executam. É a "superfície de ação da IA que ensina o atalho" (U4).

**Teclado (convenções Linear/Superhuman, Jakob).** Globais de navegação: `G A`/`G C`/`C`. Inbox: `J/K/A/R/X/E`. Wizard: Enter/Esc. Formulários: handler **local** (Enter confirma), nunca a tecla global (que faz early-return em campos). Overlay `?` ensina tudo (hoje `hidden lg:flex` = descoberta zero). Foco-visível em **todo** alvo é **gate** (WCAG 2.4.7), não enfeite. Navegação 100% por teclado (2.1.1).

**Motion com propósito (tokens, não números mágicos — R1/Val Head).** QueueRow sai com `height→0 + opacity→0 + translate-x` (~200ms ease-out) **só em rejeitar/lote** (aprovar mantém o item para agendar — MUST-FIX 3.4#4). Anel do meter anima `stroke-dashoffset` (transition-500). Agente ativo "respira" (`apex-breathe`), fala em `apex-stream-in`. `prefers-reduced-motion` desliga tudo (gate a11y). Motion **comunica estado**, nunca decora.

**Próxima-ação / encadeamento (Tesler — gate universal).** Toda tela termina na próxima-ação óbvia: aprovar→agendar inline; gerar→aprovar+agendar; insight→/create pré-preenchido; promover ideia→pauta no topo; gap do meter→área que o fecha→meter recalcula→próximo gap. **Zero toast morto, zero beco.** Quando uma ação chega num backend inexistente (forgot, invite-context, sugestão fina de horário), a UI **não inventa** — degrada honesto ou o item não renderiza.

**Feedback <100ms (Doherty).** Disable imediato do CTA no submit (<400ms percebido). Skeletons que **espelham o grid final** (sem reflow): thumb-shaped reserva altura. `keepPreviousData` ao trocar filtros (sem flash). Prioridade de query no 1º paint via `enabled`-gates, secundárias diferidas.

**Estados (1ª classe, não afterthought).** Cada superfície define **vazio/loading/erro** explícitos. Vazio = onboarding guiado, não "sem dados". Erro = **por widget/seção**, PT-BR, com retry — **nunca** status HTTP cru (lib/api centraliza). Degradado = legível inline. Parcial/simulado = rotulado (L5).

---

## 5. ORDEM DE IMPLEMENTAÇÃO (por impacto na percepção)

**Já implementado** (não refazer): ✅ tokens APEX · ✅ sidebar dimmer 1ª classe · ✅ régua de espaço · ✅ aprovações master-detail (base teclado-first, barra de lote, agenda inline) · ✅ viz de agentes reescrita (fala/respira/streaming/role=status) · ✅ Cmd+K (como launcher).

**Falta — ordenado por impacto:**

1. **Componentes de fonte única (destrava tudo, mata bugs por divergência):** `<ScheduleForm/>` (3 telas, fuso do workspace canônico) · `<PautaForm/>` (criar inline + editar) · `STEPS[]` do wizard URL-addressable. *Impacto: estrutural; pré-requisito de 3.3/3.4/3.8.*
2. **Modo degradado legível inline** (dashboard + settings-hub + pré-Gerar). *Maior salto de confiança por menor esforço; invariante violado hoje.*
3. **N+1 da fila → `thumbUrl` inline em `pending`** + prefetch focado + virtualização. *Performance que quebra exatamente no power-user.*
4. **Login: cliente fora do interceptor 401 + validação de e-mail + 429.** *Bug latente no fluxo #1.*
5. **Settings-hub com health-meter de 2 eixos** (workspace vs marca) + cartões com sinal real. *Mata o "11º destino"; corrige o defeito-raiz de tenancy.*
6. **Editor único de conteúdo** (2 painéis, abas, autosave com diff) — mata os 2 editores no mesmo campo. *Perda de dado real, diária.*
7. **Backend: `GET /api/learning/dashboard`** (posts[]+byFormat+byWindow+trend) → tela de Desempenho real. *Sem isso a tela é vácuo.*
8. **Backend: classificação PT-BR de erro de publicação** (transitório vs permanente) + **fundir publishing/ em /history?filter=falhas** com re-tentar inline/lote.
9. **Linha de intenção do agente** (reasoning real ao concluir cada agente; streaming incremental = contrato novo, fase 2).
10. **Calendário com thumb + drag-reagendar + endpoint "agendáveis"** + insight→/create pré-preenchido.
11. **Cmd+K executor** + overlay `?` + kbd-hints nos botões.
12. **Backend: forgot-password + invite-context** (ou cortar os modos até existirem).
13. **Ideias reais** (performance+marca) ou rótulo "sugestão básica" honesto.
14. **Painel de governança único** + audit com filtros/CSV + users com convites/papéis + compare navegável com confirmação.

---

## 6. GATE DE DESIGN POR TELA (prova mensurável, não sensação)

| Tela | Proxy de "ficou SOTA" (binário/medível) |
|---|---|
| **Login** | Senha errada com refreshToken velho mostra "Credenciais inválidas" **inline** (não recarrega). `'x@'` bloqueia submit. 429 mapeado. Em `<lg` register, os 3 bullets aparecem acima do card. |
| **Início** | 1º paint: meter/pending resolvem antes das contagens (Network: secundárias diferidas). Modo degradado visível **sem** clicar em nada quando IA ausente. Header re-rotula por estado (fila>0 → "Revisar (N)"). Mini-fila = **1 request** (não N). |
| **Conteúdo** | Refresh no meio do run rehidrata de `/jobs/{id}` OU mostra o estado-limbo honesto (nunca run falso). Expresso = mesmo `STEPS[]` (deep-link rehidrata igual). "N gerados" só aparece quando >0. 1 accent por viewport. |
| **Aprovações** | 100 itens = **1 request** para a fila (DevTools). J→A→Enter→J sem mouse, sem perder foco. Micro-motion só em rejeitar/lote. Sugestão de horário rotula "noite/Simulado" (nunca "ter 19h" inventado). |
| **Desempenho** | A tabela renderiza de `/api/learning/dashboard` (não dos 7 escalares). `n<3` → completeness-meter, **zero gráfico vazio**. Sparkline tem ≥2 pontos ou vira "•". "Gerar mais assim" cai em /create **pré-preenchido** (não branco). |
| **Settings-hub** | Trocar de marca **não muda** o anel de workspace (IA/cap). Cada badge consome sinal real (não estático). Não-admin vê "Pedir ao admin" (não 403). Token IG: nada se saudável, vermelho só ≤7d. |
| **Transversal** | `prefers-reduced-motion` desliga todo motion. Foco-visível em 100% dos alvos (tab-walk). Nenhum status HTTP cru vaza para o usuário. Nenhum CTA leva a backend inexistente sem degradação honesta. |

**Gate global de aceite:** nenhuma tela usa `max-w-2xl/3xl` document-frame; nenhuma lógica de fuso/pauta/step existe em 2+ lugares; todo estado vazio é onboarding guiado; todo "Simulado/parcial" está rotulado. Se algum desses falha, **não é SOTA — é sensação**.

---

**Arquivos load-bearing citados (todos absolutos):**
`apps/web/lib/workflow.ts` (PendingContent/ScheduleApi sem thumb/fuso) · `apps/api/Features/Learning/PerformanceAnalyzer.cs` (7 escalares, bucket grosso) · `apps/web/lib/api.ts:194` (interceptor 401) · `libs/SocialAi.Core/Domain/Entities.cs:53-62` (Brand não é tenancy) · `apps/api/Features/Ideas/IdeasController.cs:47` (promote→PautaDto) · `apps/worker/Jobs/MetricsCollectorJob.cs:58` (métrica acumulada → sparkline real) · `apps/web/components/ui.tsx:352` (EmptyState 1-action) · `apps/web/lib/navigation.ts:133` (ROUTE_REDIRECTS vazio).