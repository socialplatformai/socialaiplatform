# 10 — Multi-Provider de IA

> Referência dos provedores de LLM suportados pelo serviço `agents`: identificadores de modelo
> verificados na documentação oficial dos provedores (jun/2026), parâmetros de API, endpoints e os
> gatilhos de **HTTP 400** por provedor (a principal causa de falha em produção).
>
> **Princípio de design:** cada provedor é um wrapper fino. O identificador de modelo fica em um
> **ponto único** (`defaultModelFor()` em `services/agents/src/config.ts`), sempre sobrescrevível
> por variável de ambiente e pela UI. A fonte definitiva por chave é sempre o endpoint de listagem
> (`GET …/models`) — os identificadores aqui são o ponto de partida.

## Visão geral — 2 shapes de wire, 4 provedores

São **dois formatos de requisição**, não quatro. Esta é a única abstração que importa:

| Família de shape | Provedores | Endpoint | Auth | `system` | Saída |
|---|---|---|---|---|---|
| **OpenAI Chat Completions** (drop-in) | OpenAI, **xAI/Grok** | `/v1/chat/completions` | `Authorization: Bearer` | role `system` em `messages` | `choices[0].message.content` |
| **Gemini generateContent** | Google Gemini | `:generateContent` | `x-goog-api-key` | `systemInstruction` top-level | `candidates[0].content.parts[]` |
| **Anthropic Messages** | Anthropic/Claude | `/v1/messages` | `x-api-key` + `anthropic-version` | `system` **top-level** | `content[]` (filtrar `type==='text'`) |

**Implicação direta:** Grok **reusa** o `OpenAiTextProvider` (troca só baseURL + chave + modelo +
dialeto). Gemini e Claude têm wrappers próprios. São **3 wrappers de texto** no total
(`services/agents/src/text/textProvider.ts`), não 4.

## Defaults cravados (GA, verificados)

`defaultModelFor(provider, modality)` — ponto único. Env vars sobrescrevem; a UI por workspace
também (ver §UI).

| Provedor | Texto (frontier, default) | Texto fast/cheap | Imagem (default) | Gera imagem? |
|---|---|---|---|---|
| **Gemini** | `models/gemini-3.5-flash` ✅ GA | `models/gemini-3.1-flash-lite` | `models/gemini-3.1-flash-image` ✅ GA | sim (inline) |
| **OpenAI** | `gpt-5.5` ✅ GA | `gpt-5.4-mini` | `gpt-image-2` ✅ GA | sim (endpoint próprio) |
| **xAI/Grok** | `grok-4.3` ✅ GA | `grok-4.20-0309-non-reasoning` | — (endpoint próprio, **não cablado**) | não (neste serviço) |
| **Anthropic** | `claude-opus-4-8` ✅ GA | `claude-haiku-4-5` | — | **não** (só vision como input) |

### Imagem — tipo SEPARADO de provider (task 1.2)

`IMAGE_PROVIDER` usa um tipo **só-imagem** (`ImageProviderKind` em `config.ts`), distinto do
`ProviderKind` de texto — `TEXT_PROVIDER=flux` é **não-representável** por construção. Valores aceitos:

| `IMAGE_PROVIDER` | Fonte | Modelo/slug default (`defaultModelFor`) | Chave | Tipo |
|---|---|---|---|---|
| `gemini` *(default)* | Gemini inline | `models/gemini-3.1-flash-image` | `AI_PROVIDER_KEY` | foto generativa |
| `openai` | OpenAI Images | `gpt-image-2` | `AI_PROVIDER_KEY`/`IMAGE_PROVIDER_KEY` | foto generativa |
| `flux` | **Replicate** (Black Forest Labs) | `black-forest-labs/flux-1.1-pro` | `IMAGE_PROVIDER_KEY` (= `REPLICATE_API_TOKEN`) | foto generativa de alto padrão |
| `stock` | **Pexels** (busca) | `pexels-search` (rótulo; não há modelo) | `IMAGE_PROVIDER_KEY` (= `PEXELS_API_KEY`) | banco de imagens curado |

**Provedor de imagem efetivo do pipeline:** `gemini` (default), `openai`, `flux` ou `stock`.
Grok-imagem tem endpoint próprio (`/v1/images`) e não está integrado; Claude não gera imagem — não
são selecionáveis como `IMAGE_PROVIDER` (o tipo já os exclui).

#### FLUX via Replicate (foto generativa)
- Endpoint **model-specific**: `POST https://api.replicate.com/v1/models/{owner}/{name}/predictions`
  (roda a versão corrente do modelo nomeado, sem pinar hash). Header `Prefer: wait` → modo **síncrono**;
  se expirar com `processing`, faz **poll curto** em `urls.get` até `succeeded`/timeout (50s).
- Auth: `Authorization: Bearer $REPLICATE_API_TOKEN`. Body: `{ input: { prompt, aspect_ratio } }`.
- Output em `output` (string ou array de urls) → baixado e convertido p/ **data-URL**.
- **Brand-locking:** `options.style` (a paleta da marca, injetada pelo image-generator a partir do
  design-spec) é dobrado no prompt — a foto nasce na cor da marca.
- Falha (`failed`/`canceled`/HTTP) → erro **diagnosticável** com `flux` + status; nunca imagem ruim silenciosa.

#### Pexels (banco de imagens)
- Endpoint: `GET https://api.pexels.com/v1/search?query=…&per_page=1&orientation=…`.
- Auth: header `Authorization: <PEXELS_API_KEY>` **SEM `Bearer`** (exigência do ToS Pexels).
- `generate(prompt)` = buscar a foto mais relevante (primeiros ~8 termos do briefing) e baixá-la como
  data-URL. `aspect_ratio` do layout → `orientation` (portrait/landscape/square).
- **Escolhido sobre Unsplash** por: licença permissiva (sem atribuição obrigatória — o Unsplash exige
  por ToS), chave simples (sem OAuth), rate-limit melhor no free (200/h vs. 50/h demo).
- `options.style` (paleta) **não** entra na query (banco não compõe por cor de marca; isso é da foto
  generativa) — limite declarado, não mascarado.
- Sem resultado / HTTP de erro → erro **diagnosticável** com `stock` + query/status.

> **Limite declarado (task 1.2):** o provider de imagem é **global por job** (um `IMAGE_PROVIDER`). O
> Creative Director roteia estratégia **por slide**, mas um job não mistura flux (capa) + stock
> (depoimento): a estratégia que o provider do job não atende fica `deferred` (executa via o provider
> do job). Seleção de provider **por slide** é evolução futura (mover a resolução p/ dentro do loop do
> image-generator). Hoje: escolha `IMAGE_PROVIDER` conforme a peça predominante.

## Param-compat — os gatilhos de HTTP 400 (o que mais arrisca a entrega)

A maioria dos bugs "bobos" de multi-provider é mandar o parâmetro errado e tomar 400. Modelamos
isso como **dialeto** por provedor, explicitamente.

| Provedor | Limite de saída | `temperature` | JSON mode | Gera 400 se… |
|---|---|---|---|---|
| **Gemini** | `maxOutputTokens` (em `generationConfig`) | OK em 2.5; **manter 1.0 em 3.x** (`<1.0` degrada/loopa) | `responseMimeType:'application/json'` (+ `responseSchema`) | `responseSchema` em slug de **imagem**; `thinking_level`+`thinking_budget` juntos; `candidateCount>1` |
| **OpenAI (GPT-5)** | **`max_completion_tokens`** (NÃO `max_tokens`) | **NÃO enviar** (rejeita `≠1`) | `response_format:{type:'json_object'}` (ou `json_schema`) | enviar `max_tokens`; enviar `temperature≠1` |
| **xAI/Grok** | `max_tokens` | **OK** (sem restrição) | `response_format:{type:'json_object'}` | — (aceita o dialeto OpenAI clássico) |
| **Anthropic** | `max_tokens` (**obrigatório**, snake_case top-level) | **NÃO enviar** em Opus 4.7+ (rejeita `≠default`) | Structured Outputs (`output_config`) ou instrução no `system` | omitir `max_tokens`; `{role:'system'}` em `messages`; usar prefill (removido); `Authorization: Bearer` em vez de `x-api-key` |

### O dialeto no código

`services/agents/src/text/textProvider.ts` modela a única divergência real entre OpenAI e Grok:

```ts
export const OPENAI_DIALECT = { maxTokensKey: 'max_completion_tokens', sendTemperature: false } // GPT-5
export const GROK_DIALECT   = { maxTokensKey: 'max_tokens',            sendTemperature: true  } // Grok
```

O mesmo `OpenAiTextProvider` serve os dois — Grok só injeta `{ name:'grok',
baseUrl:'https://api.x.ai/v1', dialect: GROK_DIALECT }`. Claude tem wrapper próprio
(`ClaudeTextProvider`): `x-api-key`, `anthropic-version: 2023-06-01`, `system` top-level,
`max_tokens` obrigatório, sem `temperature`, extrai `content[].filter(type==='text')`.

### Imagem OpenAI — o bug do `response_format`

`gpt-image-2` (e a família GPT image) **não suporta `response_format`** → enviar causa 400
"unknown parameter". Ele retorna base64 por default; o formato do binário é controlado por
`output_format` (ex.: `'jpeg'`). `imageProvider.ts` foi corrigido para **não enviar
`response_format`** e pedir `output_format:'jpeg'`.

## Configuração (env + UI)

Trocar provedor/modelo/chave é **config, nunca código**. Dois caminhos:

1. **`.env`** (default do deploy) — `AI_PROVIDER`/`TEXT_PROVIDER`, `IMAGE_PROVIDER`,
   `AI_TEXT_MODEL`, `AI_IMAGE_MODEL`, `AI_PROVIDER_KEY`, `AI_TEMPERATURE`, `AI_MAX_TOKENS`.
   Lido uma vez por `loadAiConfig()` (`config.ts`).
2. **UI por workspace** (ADR-0008, Increment B) — **Configurações → Inteligência artificial**
   (`apps/web/app/(app)/settings/ai/page.tsx`). Admin-only. Salva `{provider, textModel,
   imageModel, apiKey}` **cifrado** (AES-GCM, `Secret{Kind=AiProviderKey}`). A chave é write-only
   (nunca volta no GET). "Testar conexão" valida a chave contra o provedor sem exibi-la
   (`AiConfigController` + `AiKeyTester` — branches para gemini/openai/grok/anthropic). O override
   do workspace viaja ao agents no request (`aiOverride`) e **vence o `.env`**; ausência → `.env`.

Os 4 provedores aparecem no seletor da UI; o campo de modelo de imagem é desabilitado para
grok/anthropic (não geram imagem). Os placeholders mostram os identificadores recomendados.

## Riscos / o que NÃO usar

Slugs e parâmetros que **não** devem ser usados — sem fonte oficial confiável ou com prazo de descontinuação:

- **Gemini `gemini-2.5-flash-image`**: GA, mas com **shutdown agendado 02/out/2026**. Não usar como
  default — daí o pin em `gemini-3.1-flash-image`.
- **Gemini `gemini-flash-latest`**: alias **flutuante** (troca de versão com ~2 semanas de aviso);
  não aparece em `models.list`. Pinar slug versionado.
- **Gemini 3.x + `temperature<1.0`**: regressão de qualidade (looping). O default subiu p/ `1.0` e o
  `quality-validator` passou a seguir a temperature da config (não mais `0.3` cravado).
- **OpenAI `gpt-image-2` + `response_format`**: 400 garantido. Removido do body.
- **Grok — slugs RETIRADOS (redirecionam silenciosamente, NÃO fixar):** `grok-3`, `grok-4` (puro),
  `grok-code-fast-1`, `grok-imagine-image-pro`, `grok-3-mini` (não confirmado/provável alucinação).
  Usar `grok-4.3`. `grok-build-0.1` é **early access** — não usar em produção estável.
- **Grok JSON mode (`json_object`)**: plausível (OpenAI-compat) mas **não re-verificado na doc
  oficial xAI** — confiança média; confirmar antes de produção crítica.
- **Anthropic prefill** (forçar JSON com mensagem assistant `{`): **removido** em Opus 4.8/4.7/4.6 +
  Sonnet 4.6 → 400. Usar Structured Outputs ou instrução no `system` (o que o wrapper faz).

## Onde está cada coisa

| Concern | Arquivo |
|---|---|
| Slugs default por provedor (ponto único) | `services/agents/src/config.ts` (`defaultModelFor`, `AI_DEFAULTS`) |
| Wrappers de texto (Gemini/OpenAI/Grok/Claude) + dialeto | `services/agents/src/text/textProvider.ts` |
| Providers de imagem (Gemini/OpenAI/Flux/Stock) | `services/agents/src/image/imageProvider.ts` |
| Tipo só-imagem (`ImageProviderKind`) + `normImageProvider` | `services/agents/src/config.ts` |
| Roteamento de estratégia visual por slide (task 1.1) | `services/agents/src/agents/creative-director.ts` |
| Merge do override por workspace | `services/agents/src/jobs.ts` (`mergeAiOverride`, `normOverrideProvider`) |
| UI de configuração de IA (4 provedores, whitelist) | `apps/web/app/(app)/settings/ai/page.tsx`, `AiConfigController.cs` |
| Persistência cifrada + teste de chave (gemini/openai/grok/anthropic) | `apps/api/Features/Settings/{AiConfigController,AiKeyTester}.cs` |
| Estimativa de custo por modelo | `apps/api/Features/Usage/UsageCostEstimator.cs` |

## Limitações conhecidas (declaradas)

- **Granularidade semântica no contrato HTTP** — o `render-engine` renderiza os papéis ricos
  (stat/quote/bullets/attribution) corretamente no HTML, mas `jobs.ts:toGenerateResult()` concatena
  o texto num único campo `copy` por slide ao devolver o `GenerateResult` à API. A API/banco
  guardam o texto e o HTML renderizado (a peça publicada fica correta), mas **não** guardam os
  campos semânticos separados — re-edição granular pós-geração não distingue "depoimento" de
  "corpo". Estender `AgentsSlide`/`GenerateResultSlide` com campos opcionais é refinamento futuro
  (toca o contrato C#↔TS). Não afeta a publicação.
- **Temperature é global, não por-provedor** — `AI_TEMPERATURE` aplica a todos. O default `1.0` é
  seguro para Gemini 3.x (que degrada com `<1.0`). Se você baixar globalmente para usar um modelo
  que tolera (OpenAI 3.5/Grok), o Gemini 3.x pode degradar silenciosamente. Override por-provedor é
  refinamento futuro.
- **Imagem só Gemini/OpenAI** — Grok (endpoint próprio `/v1/images`) e Claude (não gera) não estão
  cablados para imagem; selecioná-los como `IMAGE_PROVIDER` lança erro claro.

## Garantias de saída (render)

Todo conteúdo textual vindo do LLM é **HTML-escapado** antes de entrar nos templates
(`escapeHtml` em `render-engine.ts`) — um `<`, `&` ou `"` literal numa headline/stat/quote/cta não
quebra a marcação do slide nem injeta markup. Coberto por teste de regressão
(`render-engine.test.ts`, bloco "escape de conteúdo do LLM").
