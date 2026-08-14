---
adr: 0011
titulo: Prompts configuráveis (com rede) — arquivos versionados = verdade; override por workspace atrás de flag, com validação + fallback
status: aceito
data: 2026-06-15
---

# ADR-0011 — Prompts configuráveis (com rede)

> Hoje os system prompts dos 5 agentes de LLM estão **embutidos como template literals** dentro de cada
> `*.ts` (`services/agents/src/agents/{brand-strategist,story-architect,copywriter,visual-compositor,
> quality-validator}.ts`, no getter `get systemPrompt()`). Mudar o comportamento de um agente exige editar
> TypeScript e rebuildar. Este ADR extrai os prompts para **arquivos versionados** (git é a verdade) e
> adiciona **override por workspace** atrás de feature-flag DESLIGADA por padrão, com validação de schema
> de saída e **fallback ao base** que prova não quebrar o pipeline. Princípio: prompt é asset versionado;
> override em runtime é poder perigoso → só com rede e opt-in.

## Critério de aceite (binário — no topo)

> 8/8 aceites `[x]`. Build + typecheck + gen-enums + export-templates verdes. Detalhe de implementação:
> `parseOutput` NÃO estava no caminho de execução — `completeJSON` devolve o objeto já parseado; este ADR
> o ATIVA só no caminho-override para tornar a falha observável, sem mudar o base.

- [x] **Extração:** os 5 prompts de sistema dos agentes de LLM moram em arquivos versionados
      sob `services/agents/src/prompts/<agentKey>.md` (`brand-strategist`, `story-architect`,
      `copywriter`, `visual-compositor`, `quality-validator`). O getter `systemPrompt` de cada agente
      passa a **ler do arquivo** (via um loader único) e a retornar o **prompt-base resolvido**, não um
      literal embutido. **Comportamento idêntico:** o conteúdo do arquivo é byte-a-byte o prompt atual
      (interpolações dinâmicas — ex. `TEMPLATE_LIST` no brand-strategist — permanecem em código via
      placeholder; ver §Decisão). Teste de snapshot prova que o prompt resolvido é o mesmo de antes da
      extração. **Para o brand-strategist o snapshot captura o resultado COM `{{TEMPLATES}}` já
      substituído**, e a substituição reproduz o whitespace exato do `TEMPLATE_LIST.map(...).join('\n')`
      atual (`brand-strategist.ts:42-48`) — o snapshot é o guarda contra drift de whitespace.
- [x] **Editar arquivo muda comportamento:** alterar `prompts/copywriter.md` muda o
      `systemPrompt` resolvido do copywriter sem recompilar o agente. **Semântica:** a mudança vive no PR
      e tem efeito por **rebuild/restart** do processo (o loader é cacheado uma vez por processo — ver
      §D1; não é hot-reload). Teste lê o arquivo (com reset de cache exposto **apenas para teste**),
      injeta um marcador e verifica que o `systemPrompt` o reflete.
- [x] **Build:** `npm run build` **copia `prompts/*.md` para `dist/prompts/`** (passo de cópia
      encadeado no script de build, pois `tsc`/`tsc-alias` não copiam `.md`). Teste de build carrega
      `loadBasePrompt` a partir de `dist/` e prova que os 5 arquivos resolvem — sem isto `node dist/server.js`
      quebra em runtime.
- [x] **Flag OFF por padrão:** sem a flag, o sistema usa **sempre** o prompt-base do arquivo,
      ignorando qualquer override. Flag global de env `PROMPT_OVERRIDES_ENABLED` (default `false`).
      Teste: com override presente no payload + flag OFF → prompt resolvido == base.
- [x] **Override por workspace (quando flag ON):** com a flag ON e um override válido **injetado
      no payload do lado agents** (`brandContext.promptOverrides[agentKey]`, campo TS opcional), o prompt
      efetivamente usado pelo `execute` daquele agente é o override. Teste prova a substituição. **Nota de
      fronteira:** a EMISSÃO desse campo pela API .NET (adicionar a propriedade ao record
      `AgentsBrandContext` + montá-la em `BuildAgentRequestAsync`) é **fora de escopo** (ver §Fora de
      escopo); a verificação deste ADR é feita injetando o override no payload com provider de texto
      mockado.
- [x] **Validação de schema de saída + teste + fallback (o aceite central):** com a flag ON e
      um override **inválido** (induz uma saída que o `parseOutput` daquele agente rejeita), a geração
      **cai no prompt-base** e o pipeline **completa** — NÃO quebra. Teste: força um override
      inválido, verifica que (i) houve fallback ao base, (ii) o `PipelineResult.success === true`,
      (iii) o evento de fallback foi registrado (não silencioso).
- [x] **Reset:** remover o override de um agente (campo ausente/null no payload) volta ao base
      sem resíduo. Teste cobre.
- [x] **Plumbing declarado (assinatura):** o override **não** entra pelo getter `systemPrompt` (que é
      parameterless e retorna o base). O override viaja em `brandContext` → `PipelineInput` → `execute`,
      e é aplicado por um caminho de execução-com-fallback em `BaseAgent` (ver §D3). Teste prova que o
      getter `systemPrompt`, chamado isoladamente, retorna **sempre o base** (nunca o override).
- [x] **Isolamento intacto:** override é **por workspace** — viaja no `brandContext` que a API serializa
      por workspace; o job store in-memory dos agents continua sem persistir override entre runs. Nenhum
      override vaza entre workspaces. Sem nova tabela tenant neste ADR (ver §Modelo de dados).
      `WorkspaceId`, filtro global e `TenantSaveInterceptor` **não mudam**.
- [x] **Degradado honesto:** sem chave de IA o pipeline já falha com erro claro (invariante); a extração
      e a flag **não** introduzem caminho degradado novo. Override é só de TEXTO (prompt) — não toca
      `image-generator`/`render-engine` (determinísticos; ver §Contexto).

> **Depende de chave de IA (parcial):** a extração e os aceites de flag OFF/reset são testáveis **sem
> chave** (são resolução de string + flag, com o provider de texto **mockado** — padrão já usado em
> `textProvider.test.ts`). A validação de saída também roda contra provider mockado (o teste injeta uma
> resposta que falha o `parseOutput`). Só a operação real do override em produção consome IA.

## Contexto (estado real hoje)

- **`BaseAgent`** (`services/agents/src/agents/base.ts`) define `abstract get systemPrompt(): string`
  (getter **sem argumentos** — não tem acesso ao contexto do run), `buildUserPrompt(input)` e
  `parseOutput(response): TOutput`. `execute(input)` chama `provider.completeJSON(systemPrompt,
  userPrompt, genParams)` (o provider já faz `JSON.parse`/repair e devolve `TOutput`) e o `catch`
  **re-lança** a exceção. Os agentes são instanciados **uma vez** no construtor do `PipelineV2`
  (`pipeline-v2.ts:70-75`) só com `config` — o `brandContext`/override chega depois, por run, em
  `execute(input)`. **Consequência de design:** o override não pode ser aplicado pelo getter; precisa de
  um caminho próprio em `execute` (ver §D3).
- **`parseOutput` é o ponto de validação por agente** (ex.: `brand-strategist.parseOutput` faz
  `JSON.parse` + valida `TEMPLATES[templateId]` e o `emotionalArc`, lançando em entrada inválida).
- **Os 5 agentes de LLM** retornam o prompt como **template literal embutido** no getter
  (`brand-strategist.ts:28`, `story-architect.ts:30`, `copywriter.ts:33`, `visual-compositor.ts:34`,
  `quality-validator.ts:259`). O brand-strategist **interpola** `TEMPLATE_LIST` (de `@/templates`) via
  `.map(...).join('\n')` (`brand-strategist.ts:41-48`) — parte do prompt é dinâmica, vinda de código.
- **`image-generator` e `render-engine` são determinísticos** (sem LLM). O `image-generator` herda
  `BaseAgent` e tem `get systemPrompt()` mas **retorna string vazia** (`image-generator.ts:38`, não vai a
  modelo); o `render-engine` nem estende `BaseAgent`. Ambos ficam **fora** deste ADR (invariante).
- **Precedente arquitetural — `config.ts`** (`services/agents/src/config.ts`, ADR-0004): a fase invisível
  já estabeleceu "uma fonte única da verdade, lida do ambiente **uma vez**, defaults == comportamento
  atual, sem mudar comportamento". **Este ADR aplica o mesmo padrão a prompts** (arquivo = fonte; leitura
  cacheada uma vez por processo; default == prompt atual).
- **Transporte API↔agents:** `POST /generate` recebe `{ brandContext, pauta, format }`
  (`server.ts:57`); `brandContext` é montado por workspace pela API. `jobs.ts:94` chama
  `adaptHttpToPipelineInput(req.brandContext, req.pauta, req.format)` e depois `runPipelineV2`. O job
  store é **in-memory, não sobrevive a restart** (invariante). O tipo TS `BrandContext` (`types.ts:23`)
  tem index signature `[key: string]: unknown`, então aceita um campo extra sem mudança de tipo de
  fronteira. O record .NET `AgentsBrandContext` (`AgentsClient.cs:7`) é posicional e **não** tem o campo
  (a emissão pela API é fora de escopo).
- **Decisão de produto:** arquivo versionado é a verdade; override por workspace atrás de
  feature-flag DESLIGADO por padrão, só com validação de schema de saída + teste + fallback ao base.

## Decisão (KISS)

### D1 — Prompts em arquivos `.md`, lidos por um loader único e cacheado; interpolação dinâmica em código

Cada prompt-base vai para `src/prompts/<agentKey>.md`. Um módulo `src/prompts/loader.ts` expõe
`loadBasePrompt(agentKey)` (lê o arquivo, **cacheado em memória** — `Map`, leitura única por processo,
igual ao espírito de `config.ts`) e expõe `__resetPromptCacheForTests()` (reset **só para teste**; em
produção a mudança de um `.md` exige rebuild/restart — não há hot-reload). **As interpolações dinâmicas
permanecem em código:** onde hoje o brand-strategist injeta `TEMPLATE_LIST`, o arquivo `.md` carrega um
**placeholder** (`{{TEMPLATES}}`) que o agente substitui após carregar — o arquivo é a prosa editável; os
dados estruturados (lista de templates) seguem vindo de `@/templates` (fonte única deles). A substituição
do placeholder reproduz o output exato (incl. whitespace) do `.map().join('\n')` atual.

> **Alternativa A — prompts em JSON/YAML com metadados.** Mais "estruturado", mas o conteúdo de um prompt
> é prosa multilinha; JSON/YAML obriga escaping e degrada a editabilidade e o diff de PR (que é o ponto
> da extração). **Descartada** — `.md` é a unidade natural, diffa limpo, KISS.
>
> **Alternativa B — extrair também as interpolações para o arquivo (template engine completo).** Exigiria
> um motor de template e duplicaria a fonte de `TEMPLATE_LIST` (que já vive em `@/templates`). Viola "uma
> fonte por dado". **Descartada** — placeholder mínimo (`{{TEMPLATES}}`) resolve sem motor.

### D2 — Override viaja no `brandContext` (por workspace), sem tabela nova e sem emissão pela API neste ADR

O override entra como `brandContext.promptOverrides?: Partial<Record<agentKey, string>>` no payload do
`/generate` (opcional; aceito pelo index signature do tipo TS `BrandContext` sem mudança de fronteira).
**A emissão desse campo pela API .NET** — adicionar a propriedade ao record `AgentsBrandContext` e
montá-la por workspace em `BuildAgentRequestAsync`, além da fonte de persistência (`Secret`/coluna em
`BrandKit`/tabela própria) — é decisão de **persistência/UI, fora do escopo deste ADR** (ver §Fora de
escopo). Este ADR entrega o **mecanismo no pipeline** (extração, flag, resolução com rede, fallback) e o
**campo de transporte** do lado agents; o isolamento por workspace é herdado de graça (o `brandContext`
já é por workspace). Os testes exercitam o override injetando-o no payload do lado agents com provider
mockado.

> **Alternativa — tabela `PromptOverride` (TenantEntity) + endpoint dedicado agora.** É o destino
> provável, mas acoplaria este ADR (sobre o **mecanismo no pipeline**) a uma migration + CRUD + UI. KISS e
> "uma decisão por ADR": o aceite binário é provável só com o campo no payload + provider mockado.
> **Adiada** para o incremento de persistência/UI.

### D3 — Resolvedor com rede: flag → validação → fallback, no caminho de `execute`

Como o getter `systemPrompt` é parameterless e os agentes nascem só com `config`, **o override NÃO entra
pelo getter**. O getter passa a retornar o **base resolvido** (`loadBasePrompt` + placeholders de D1). O
override é aplicado por um caminho próprio de execução em `BaseAgent`:

1. **Base sempre disponível** via o getter `systemPrompt` (de `prompts/<agentKey>.md`, placeholders
   aplicados).
2. `execute(input, ctx)` recebe o `ctx` do run (que carrega `promptOverrides`). Se
   `PROMPT_OVERRIDES_ENABLED !== 'true'` → usa o **base** (flag OFF é o default).
3. Se flag ON **e** `ctx.promptOverrides?.[agentKey]` presente → candidato = override.
4. **Validação de schema de saída (a rede), sem custo dobrado no caminho feliz:** introduz-se
   `executeWithPrompt(input, systemPromptCandidate)` que **separa explicitamente a chamada do parse** —
   chama `provider.complete(...)` e em seguida `this.parseOutput(...)` (em vez de delegar o parse opaco a
   `completeJSON`). Assim a falha de `parseOutput` é **observável** no `execute`. O fluxo: tenta o
   candidato (override) **uma vez**; se `parseOutput` lançar, faz **um único retry com o prompt-base** e
   chama `onPromptFallback(agentKey, reason)`. A própria chamada de produção É a validação; o fallback é
   o catch. Resultado: **1 chamada** no caminho feliz, **no máximo 2** quando o override falha.

> **Por que a validação é "executar + parseOutput", não um JSON-Schema estático do prompt.** O que pode
> "quebrar o pipeline" não é o texto do prompt — é a **saída** que ele induz o LLM a produzir (estrutura
> que o próximo agente consome, `src/types/pipeline.ts`). O `parseOutput` de cada agente já é o contrato
> de saída. Validar o prompt por forma seria teatro; validar a saída é o que o pipeline exige.
> **Alternativa descartada:** linter estático de prompt (regex por "OUTPUT FORMAT") — frágil e não prova
> nada sobre a saída real.
>
> **Nota de plumbing (declarada):** este ADR muda a assinatura efetiva de execução (`execute` passa a
> receber/usar o `ctx` do run e introduz `executeWithPrompt`) e torna o parse explícito dentro do
> `execute`, em vez de embutido em `completeJSON`. É a menor mudança que torna o fallback verificável.

### D4 — Fallback é não-silencioso (nunca degradar em silêncio)

`onPromptFallback` emite log estruturado e é propagável aos callbacks do pipeline
(`PipelineV2Callbacks`, `pipeline-v2.ts:40`), para que a UI/observabilidade saiba que um override foi
rejeitado. Alinhado ao princípio "mock/degradado nunca silencioso" do projeto.

## Modelo de dados / Contrato / UI

### Arquivos
```
services/agents/src/prompts/
  brand-strategist.md      # contém placeholder {{TEMPLATES}}
  story-architect.md
  copywriter.md
  visual-compositor.md
  quality-validator.md
  loader.ts                # loadBasePrompt(key) cacheado; __resetPromptCacheForTests()
```
Build: o script `build` ganha um passo de cópia (`copy:prompts`) que leva `src/prompts/*.md` para
`dist/prompts/`; o loader resolve o caminho relativo ao módulo compilado.

### Contrato de transporte — `src/types.ts` / `brandContext`
```ts
// opcional; aceito pelo index signature de BrandContext; só lido quando
// PROMPT_OVERRIDES_ENABLED === 'true'. Emissão pela API .NET = fora de escopo.
promptOverrides?: Partial<Record<
  'brand-strategist'|'story-architect'|'copywriter'|'visual-compositor'|'quality-validator',
  string  // texto do prompt de sistema de override
>>
```

### Flag
`PROMPT_OVERRIDES_ENABLED` (env, default `false`) — lida via `config.ts` (mesma fonte única),
documentada **no próprio `config.ts`** (`AiConfig.promptOverridesEnabled`) como "poder perigoso, opt-in".
Linha sugerida em `.env.example`:
`PROMPT_OVERRIDES_ENABLED=false   # (opt-in, poder perigoso) liga override de prompt por workspace`.

### Sem migration neste ADR
A persistência do override (lado .NET) e a UI de edição são **incremento próprio** (ver §Fora de escopo).
Este ADR não altera schema Postgres — `WorkspaceId`/interceptor/filtro intactos por construção.

## Estratégia de migração (não-big-bang, reversível)

Sem mudança de schema Postgres (nada a migrar/reverter no banco). A extração é reversível por
construção: passo 1 — criar `prompts/*.md` byte-a-byte iguais aos literais e o `loader`; passo 2 — trocar
cada getter para `loadBasePrompt` + placeholder, com o snapshot (teste 1) provando equivalência antes de
remover o literal. Reverter = restaurar o getter literal (git revert). O override entra atrás da
flag OFF default — ligar/desligar é config, sem deploy de código. Nada é big-bang: a extração (5 agentes,
um por vez, guardados por snapshot) precede o override (flag + fallback).

## Plano de teste (fecha o aceite — provider de texto mockado, padrão `textProvider.test.ts`)

1. **Snapshot de extração:** para cada um dos 5 agentes, `systemPrompt` resolvido == snapshot
   do prompt pré-extração (com `{{TEMPLATES}}` resolvido para o brand-strategist, whitespace exato).
   Prova "comportamento idêntico".
2. **Editar arquivo muda comportamento:** escreve marcador em `prompts/copywriter.md` (tmp /
   fs mock), chama `__resetPromptCacheForTests()`, lê `systemPrompt` → contém o marcador.
3. **Build copia `.md`:** após `npm run build`, `loadBasePrompt` resolvido a partir de `dist/`
   retorna os 5 prompts.
4. **Flag OFF:** override presente no `brandContext`, `PROMPT_OVERRIDES_ENABLED` ausente →
   `execute` usa o base.
5. **Getter não aplica override (plumbing):** com flag ON e override presente, o getter `systemPrompt`
   chamado isoladamente retorna o **base** (só `execute` aplica o override).
6. **Flag ON + override válido:** `execute` usa o override; pipeline (mock) completa.
7. **Flag ON + override inválido → fallback (central):** o mock do provider retorna, para o
   override, uma saída que faz `parseOutput` lançar; assert: (i) `onPromptFallback` chamado com a
   `agentKey`, (ii) segunda chamada usou o prompt-base, (iii) `PipelineResult.success === true`.
   Provado: remover o fallback faz o teste falhar com pipeline quebrado.
8. **Reset:** override ausente/null → base, sem resíduo entre dois runs (cache do loader não
   "gruda" override).
9. **Não-regressão:** suíte agents existente verde; o snapshot garante que a extração não mudou nenhum
   prompt.

## Riscos e mitigação

- **Override malicioso/abusivo (prompt injection no próprio prompt de sistema):** mitigado por (i) flag
  OFF default, (ii) escopo por workspace (um deploy por cliente — invariante de secrets), (iii) o override
  só altera o **comportamento de geração do próprio tenant**, nunca cruza workspace. A persistência/UI
  (fora de escopo) adicionará validação de tamanho/limites quando entrar.
- **Custo de IA dobrado por fallback:** caminho feliz = 1 chamada; só override inválido custa 2 (override
  + base). Mitiga-se com a flag OFF default; quem liga assume o custo do override quebrado uma vez por
  geração até consertar o texto.
- **Drift entre `.md` e código (placeholder dessincronizado / whitespace):** o snapshot de extração
  (teste 1) quebra se o arquivo divergir do prompt esperado — o drift morre no CI, mesmo espírito do
  contrato de enums.
- **Leitura de arquivo em runtime (build/`tsc-alias`):** os `.md` não são compilados por `tsc`; o passo
  `copy:prompts` no build os leva a `dist/prompts/` e o teste de build prova que `node dist/server.js`
  resolve — sem o passo, o serviço quebraria em produção.
- **Plumbing de `execute` (parse explícito):** tornar o parse visível no `execute` em vez de embutido em
  `completeJSON` muda o caminho de erro de todos os agentes; o snapshot + suíte de não-regressão (testes
  1 e 9) guardam contra mudança de comportamento.

## Fora de escopo (outros incrementos)

- **Persistência do override no lado .NET** (tabela `PromptOverride` TenantEntity, ou coluna em
  `BrandKit`) + endpoint CRUD + **adicionar `promptOverrides` ao record `AgentsBrandContext` e montá-lo em
  `BuildAgentRequestAsync`** → incremento de backend/persistência próprio (este ADR entrega o mecanismo no
  pipeline + o campo de transporte do lado agents).
- **UI de edição de prompts por workspace** (editor + botão "validar" + "resetar ao base" + aviso de
  poder perigoso) → incremento de UI próprio sobre o backend acima.
- **Versionar/diff de overrides, histórico, A/B de prompts** → futuro; este ADR cobre só base+override
  vigente.
- **Override dos agentes determinísticos** (`image-generator`, `render-engine`) → não se aplica
  (image-generator herda o getter mas retorna vazio; render-engine não estende `BaseAgent`); invariante.
- **`buildUserPrompt` configurável** → fora; só o `systemPrompt` (prosa estável) é o asset; o user prompt
  é dado dinâmico por run.