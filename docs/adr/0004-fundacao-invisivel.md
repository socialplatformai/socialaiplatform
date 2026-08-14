---
adr: 0004
titulo: Fundação invisível — ITextProvider + config tipada de IA (corrige drift) + rastreabilidade campo→engine
status: aceito
data: 2026-06-15
---

# ADR-0004 — Fundação invisível

> Decisão de arquitetura (MADR enxuto). **Fundação invisível** — três mudanças
> internas no `services/agents` (+ doc/teste de rastreabilidade) que **não tocam a UI**. Preparam o
> terreno para IA configurável e para a fronteira coleta↔engine.

## Critério de aceite (binário)

- [x] **E5.1** Existe `ITextProvider` (espelhando `IImageProvider`) e o `BaseAgent` usa **a interface**,
      não o `GeminiAPIClient` concreto. Trocar o provider de texto por `TEXT_PROVIDER`/`AI_PROVIDER`
      seleciona outra implementação **sem editar código**; o pipeline roda com `gemini` (default).
      Provider não-implementado (ex.: `openai`) falha **diagnosticável** (stub explícito, como no image).
- [x] **E5.2** Nome do modelo e params (temperature/maxTokens) vêm de **uma config tipada única**
      (`src/config.ts`), lida de env. Definir `AI_TEXT_MODEL=<x>` muda o modelo usado **sem editar
      código** (teste prova). **O drift acaba**: não há mais 3 literais de modelo divergentes no código.
- [x] **E3.6** Há uma **tabela de rastreabilidade** versionada (campo de `Pauta`/`BrandContext` →
      destino no `input-adapter`) e um **teste** que enumera os campos desses tipos e **falha (vermelho)**
      se algum campo não tiver destino no `adaptHttpToPipelineInput` (rastreabilidade verde = 0 órfãos).
- [x] **Gate da fase:** `npm run build` + `npm test` (agents) verdes; `dotnet test` 10/10 e `npm test`
      (web) intactos. **Nenhum arquivo de UI tocado** (`git diff` não altera `apps/web/` exceto, no
      limite, nada — esta fase é invisível).

> **Implementado em 2026-06-15.** Todos atendidos:
> **E5.1** ✓ `ITextProvider` + `GeminiTextProvider`/`OpenAiTextProvider` (stub) + `resolveTextProvider`;
> `BaseAgent` usa a interface. **E5.2** ✓ `src/config.ts` é fonte única; `AI_TEXT_MODEL` troca o modelo
> (teste prova); drift morto (literais só em `config.ts`); campo fantasma `GeminiAPIConfig.model`
> removido. **E3.6** ✓ `traceability.test.ts` (15 testes; pega
> campo novo não-classificado — provado; 3 órfãos declarados travados). **Gate** ✓ agents **42/42**,
> web **14/14**, dotnet **10/10**, build prod-only (sem `.test.js`), **zero `apps/web/` tocado**.
> **Comportamento preservado**: teto efetivo `maxTokens=16384` mantido (default), `quality-validator`
> 8192/0.3 idênticos.

## Contexto (estado real hoje — verificado, com caminhos)

**Provider de texto não tem abstração.** Só a **imagem** é trocável por env (`IMAGE_PROVIDER` →
`src/image/imageProvider.ts`, com `IImageProvider` + stubs `imagen`/`openai`). O texto é acoplado: o
`BaseAgent` (`src/agents/base.ts:18-19`) instancia o `GeminiAPIClient` concreto via
`getGeminiClient(config)` e chama `completeJSON()` direto (`base.ts:31`). Os 5 agentes de LLM
(brand-strategist, story-architect, copywriter, visual-compositor, quality-validator) herdam disso;
`image-generator`/`render-engine` são determinísticos (não chamam LLM de texto).

**Drift de modelo/params (real e enganoso):** o modelo de texto **efetivo** é
`GEMINI_MODELS.text = 'models/gemini-flash-latest'` (`src/gemini/client.ts:67`). Mas:
- `src/types/agent.ts:341,347` define `GeminiAPIConfig.model = 'models/gemini-2.5-pro'` — **campo nunca
  lido** por `complete()` (`client.ts:106` usa `GEMINI_MODELS[options?.model ?? 'text']`, ignorando
  `config.model`). É um **campo fantasma de config**.
- Comentários de cabeçalho em `client.ts:7`, `base.ts:7-8`, `types/agent.ts:335` afirmam
  `gemini-3-pro-preview`/`gemini-2.5-pro` — **três nomes diferentes**, nenhum é o que roda.
- `temperature`/`maxTokens` aparecem hardcoded e **divergentes**: `base.ts:35-36` (0.7 / **16384**),
  `jobs.ts:35-36` (0.7 / 8192), `types/agent.ts:348-349` (0.7 / 8192), `client.ts:197`
  (completeJSON força 8192), `quality-validator.ts` (override 0.3).

**Chave de API:** `process.env.AI_PROVIDER_KEY || process.env.GEMINI_API_KEY` (`jobs.ts:32`).

**Coleta↔engine:** a fronteira é `src/agents/input-adapter.ts` (`adaptHttpToPipelineInput`), já com
teste (E0.1). Os tipos de entrada são `BrandContext` e `Pauta` (`src/types.ts`). Hoje **não há
garantia automática** de que todo campo coletado tenha destino na engine (risco de campo órfão — B7).

## Decisão

Três mudanças coesas, todas **internas ao agents** (+ doc), KISS, espelhando padrões já aceitos.

### E5.1 — `ITextProvider` (wrapper fino sobre o client; espelha `IImageProvider`)
Criar `src/text/textProvider.ts` com:
- `interface ITextProvider { name; complete(system,user,opts); completeJSON<T>(system,user,opts) }`.
- `GeminiTextProvider` que **delega** ao `GeminiAPIClient` já existente (reusa retry + JSON-repair —
  não reescrever o coração do pipeline).
- `OpenAiTextProvider` **stub explícito** (lança erro diagnosticável até E5.3, igual ao image stub).
- `resolveTextProvider(client)` factory por env (`TEXT_PROVIDER` com fallback a `AI_PROVIDER`; default
  `gemini`).

`BaseAgent` passa a receber/usar um `ITextProvider` em vez do `GeminiAPIClient` concreto.

> **Alternativa descartada:** refatorar o `GeminiAPIClient` inteiro para provider-agnóstico — toca o
> núcleo (retry/JSON-repair) numa fase cujo gate é "sem UI tocada, build+test verdes". Risco alto, sem
> ganho nesta fase. O wrapper fino satisfaz o aceite com risco mínimo (mesma escolha que o image fez).

### E5.2 — Config tipada única (`src/config.ts`) — mata o drift
Um módulo que lê env **uma vez** e exporta um objeto tipado:
```
aiConfig = {
  textProvider, imageProvider,          // de TEXT_PROVIDER/IMAGE_PROVIDER (default gemini)
  apiKey,                               // AI_PROVIDER_KEY || GEMINI_API_KEY
  model: { text, image },              // AI_TEXT_MODEL / AI_IMAGE_MODEL, com defaults
  temperature, maxTokens,             // AI_TEMPERATURE / AI_MAX_TOKENS, com defaults
}
```
- `GEMINI_MODELS` em `client.ts` passa a **derivar** de `aiConfig.model` (a config vence; env
  `AI_TEXT_MODEL` troca o modelo sem editar código → aceite E5.2).
- `base.ts`/`jobs.ts` passam a ler de `aiConfig` em vez de literais.
- **Limpeza de drift:** remover o literal morto/enganoso `GeminiAPIConfig.model` (campo fantasma) e
  alinhar comentários de cabeçalho à realidade — uma fonte da verdade só. `quality-validator` mantém
  seu override de temperature (0.3), agora explícito como override consciente.

> **Default de modelo:** mantém o que **hoje roda** (`gemini-flash-latest` para texto,
> `gemini-2.5-flash-image` para imagem) — esta fase **não muda comportamento de geração**, só remove o
> drift e torna configurável. (O default "mais capaz atual" por provider fica para um ADR futuro.)

### E3.6 — Rastreabilidade campo→engine (tabela + teste-rede)
- Tabela de rastreabilidade versionada: cada campo de `BrandContext`/`Pauta` → destino no
  `input-adapter`/`PipelineInput` (ou "intencionalmente não usado", justificado).
- Teste em `services/agents` (`src/agents/traceability.test.ts`): mantém a **lista esperada** de campos
  de `BrandContext` e `Pauta` e afirma que cada campo de dado é referenciado no `input-adapter.ts`
  (lê o fonte e/ou exercita o adapter). **Vermelho** se um campo novo entrar sem destino (órfão) — fecha
  o B7 com rede automática. KISS: começa com a checagem de referência textual + asserções no output do
  adapter (já temos o teste de E0.1 como base).

## Modelo de dados / Contrato
Nenhuma mudança de schema (.NET) nem de contrato HTTP `/generate`. Mudanças são **internas ao agents**:
novos módulos (`text/textProvider.ts`, `config.ts`), refactor de `base.ts`/`jobs.ts`/`client.ts`, e
doc+teste. O contrato `GenerateRequest` (`src/types.ts`) é **inalterado**.

## Estratégia de migração
Não mexe em banco. É refactor de código com rede de teste: **expand** (adiciona `ITextProvider`/config
ao lado do existente) → **migrate** (aponta `base.ts`/`jobs.ts` para a interface/config) → **contract**
(remove os literais de modelo mortos e o campo fantasma `GeminiAPIConfig.model`). Reversível por git.

## Plano de teste
- **E5.1:** `textProvider.test.ts` — `resolveTextProvider` devolve `gemini` por default; devolve o stub
  para `openai` e ele **lança** erro diagnosticável; `GeminiTextProvider` delega ao client (mock/spy).
- **E5.2:** `config.test.ts` — `AI_TEXT_MODEL=foo` ⇒ `aiConfig.model.text === 'foo'`; defaults aplicados
  quando env ausente; um único ponto de verdade (sem literais divergentes — teste afirma consistência).
- **E3.6:** `traceability.test.ts` — todos os campos de `BrandContext`/`Pauta` têm destino; adicionar um
  campo fictício sem destino tornaria o teste vermelho (provado no PR).
- **Não-regressão:** `npm test` agents (incl. E0.1) verde; `dotnet test` 10/10; web test intacto;
  `npm run build` (tsc + tsc-alias) verde.

## Riscos e mitigação
- **Tocar o `BaseAgent` afeta todos os agentes.** Mitigação: wrapper fino delega ao mesmo client; teste
  do pipeline (E0.1 + build) cobre; smoke E2E confirma que geração degradada segue falhando honestamente.
- **Derivar `GEMINI_MODELS` da config pode mudar o modelo efetivo sem querer.** Mitigação: default ==
  o literal que hoje roda (`gemini-flash-latest`); teste fixa o default.
- **Regex/leitura de fonte no teste de rastreabilidade é frágil.** Mitigação: lista esperada explícita
  (mantida à mão, revisável) + asserção no output real do adapter — não só varredura textual.

## Fora de escopo (KISS)
- Implementar OpenAI de verdade (texto/imagem) — trabalho futuro.
- Config de IA **por workspace** (Secret/AES-GCM) + testar conexão na UI — trabalho futuro.
- Painel de uso/custo — trabalho futuro.
- Qualquer mudança de UI — esta fase é **invisível** por contrato.
