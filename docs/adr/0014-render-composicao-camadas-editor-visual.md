# ADR-0014 — Render por composição de camadas + editor visual (SOTA 2026)

**Status:** Proposto (aguardando aprovação)
**Data:** 2026-06-18
**Contexto de origem:** produto já entregue ao cliente; o fluxo de geração "quase funciona" mas
a imagem não aparece, não há preview fiel e não há edição visual. Decisão de direção tomada com o
operador: **Visão B — composição por camadas** (a imagem da IA é o *fundo*; copy/CTA/logo/stats são
camadas reais editáveis sobre ela, com tokens da marca). É o que a arquitetura do pipeline já promete.

---

## 1. Diagnóstico (com evidência, não suposição)

A imagem **é gerada de verdade** (JPEG real assinado C2PA pela Google, QualityScore 95 no job testado).
O que está quebrado é a **fiação** entre os serviços. Três bugs + dois gaps, todos confirmados em código:

| # | Problema | Evidência (arquivo:linha) | Efeito |
|---|----------|---------------------------|--------|
| **B1** | A imagem gerada vai para `element.content`, mas o extrator do contrato lê só de `slide.background.value`. Nunca se encontram. | `image-generator.ts:149` grava em `element.content`; `jobs.ts:98-102` lê só `background.value` | `imageUrl` sai `undefined` → banco `ImageUrl` vazio → **preview cinza** |
| **B2** | O `renderHtml` (com a imagem embutida em base64, ~1 MB) é persistido mas **o frontend nunca o usa** (zero ocorrências de `renderHtml`/`dangerouslySetInnerHTML` para slides). | `jobs.ts:107` envia `renderHtml`; web: grep zero | 1 MB trafegado/guardado à toa → **lentidão** |
| **B3** | Só 2 dos 6 slides recebem imagem (otimização cover+last). | `image-generator.ts:62-67` | Slides 2-5 visualmente vazios → **carrossel quebrado** |
| **G4** | Existe editor de **texto** (copy/caption/cta), mas **nenhum** preview visual nem edição de imagem/layout/posição. | editor: `content/[id]/page.tsx:64-117`; preview: `slide-preview.tsx:18` (só `imageUrl`) | sensação "idade das pedras" |
| **G5** | A página de aprovações não mostra o post visualmente. | `approvals/page.tsx:87-126` (só texto) | aprovação às cegas |

### A descoberta que torna a Visão B viável
O contrato do pipeline **já modela composição por camadas** (`types/pipeline.ts`):
- `VisualElement` (l.241): `role`, `content`, **`style`** (fonte/cor/peso/alinhamento), **`position`** (x,y,w,h)
- `ElementStyle` (l.215): `objectFit`, `objectPosition`, **`focalPoint`**, `scale`, `overlay` — crop/foco já modelado (ADR-0012 PR4)
- `SlideBackground` (l.249) separado das camadas; `VisualSpecification.tokens` (l.269) = marca

**Tudo isso é achatado e descartado** no `jobs.ts`: extrai só `copy` (texto concatenado) + `imageUrl`
(de campo errado) + `renderHtml` (que ninguém lê). A riqueza estrutural morre no contrato agents→api.
**A Visão B não é "construir do zero" — é parar de jogar fora a estrutura que já existe e conectá-la.**

---

## 2. Invariantes que NÃO podem quebrar

1. **Multi-tenancy 3 camadas** — `ContentSlide` é `TenantEntity`; qualquer campo/tabela novo carrega `WorkspaceId` e respeita filtro/interceptor.
2. **Publicação consome `ImageUrls`** (`Publishers.cs:9` — lista de URLs JPEG públicas no MinIO). O contrato de camadas **deve continuar produzindo um `ImageUrl` final rasterizado por slide**, senão o publish quebra.
3. **Enums .NET↔TS** (`Enums.cs` ↔ web) sem contrato compartilhado — mudança num lado exige o outro.
4. **Idempotência de publish** (`IdempotencyKey`) intacta.
5. **Modo degradado** continua válido (sem chave de IA, CRUD/UI funcionam).

---

## 3. Plano por fases (cada fase entrega valor e é testável no localhost)

### Fase 0 — Destravar a imagem (corrige B1, B2)
**Objetivo:** a imagem que já é gerada aparece no preview e na página de conteúdo.
- `jobs.ts` `toGenerateResult`: extrair `imageUrl` de `element.content` (role image/background) **e** `background.value`, com precedência clara. Helper `extractSlideImage(visualSlide)`.
- Parar de embutir base64 de 1 MB no `renderHtml` (ou parar de persistir `renderHtml` — ver Fase 1).
- **Teste:** gerar conteúdo → preview e `/content/[id]` mostram a imagem do cover e do last. Banco: `ImageUrl` não-vazio.
- **Risco:** baixo. Mudança localizada no extrator. Cobrir com teste de `toGenerateResult`.

### Fase 1 — Contrato de camadas (corrige B3, base de B/G4)
**Objetivo:** carregar a estrutura de camadas ponta a ponta, sem achatar.
- **agents:** `GenerateResultSlide` ganha `background: {type,value}` + `elements: VisualElement[]` (já existem no pipeline; só repassar em `jobs.ts`).
- **api:** `AgentsSlide` + `OutcomeSlide` + `ContentSlide` ganham campo `LayersJson` (JSON estruturado: background + elements + tokens). **Migração EF** (`AddSlideLayers`). `ImageUrl` permanece (fundo rasterizado p/ publish). `RenderHtml` deprecado/removido.
- **web:** `ContentSlideDto` + `lib/content.ts` ganham `layers`.
- Garantir os **6 slides com fundo** (gerar os 4 do meio OU aplicar gradiente de marca consistente — decisão de custo/tempo; default: gradiente de marca nos intermediários, opção de gerar sob demanda).
- **Teste:** GET content devolve `layers` por slide; 6 slides com fundo.
- **Risco:** médio. Migração + contrato em 3 serviços. Enum/contrato sob teste.

#### Decisão de design F1 (2026-06-18): `LayersJson` é **JSON opaco**, não records tipados em .NET

**Contexto.** O shape das camadas (`SlideVisualSpec.background` + `VisualElement[]` + `tokens`) já é a fonte
única da verdade em `services/agents/src/types/pipeline.ts`. `VisualElement.type`/`role` são **strings livres**
(não há enum). Há DOIS candidatos para representar isso na fronteira agents→api→web:

- **Alt. A — records tipados de ponta a ponta** (.NET ganha `AgentsBackground`/`AgentsElement`/`AgentsPosition`,
  Core ganha `LayerSpec` tipado, web ganha interfaces). *Contra:* cria um **4º ponto de sincronização sem
  contrato compartilhado** (TS↔C#↔Core↔web) — exatamente a dor conhecida dos enums .NET↔TS.
  A .NET passaria a desserializar/reserializar uma estrutura sobre a qual **não raciocina**.
- **Alt. B — JSON opaco (ESCOLHIDA).** A .NET é um **cano burro**: persiste o JSON das camadas verbatim em
  `ContentSlide.LayersJson` (coluna `text`), nunca lê seu interior, e o reemite como valor JSON cru
  (`JsonElement`) no `ContentSlideDto.layers`. Quem produz (agents) e quem consome (`<SlideCanvas>` em F2) são
  os únicos que entendem o shape; `pipeline.ts` continua sendo a fonte única.

**Por que B (C-KISS).** Adiciona o mínimo: zero records novos em .NET, zero sincronização de enum no backend,
validação onde pertence (no agents/F1b, não no backend). **Espelha um padrão já existente** no repo: a API já
trata o `Template.SpecJson` como `JsonNode.Parse(...)` "sem reserializar" (`ContentController.BuildTemplatePayloadAsync`)
e o `StoredAi` cifrado como JSON opaco. O contrato fica **aditivo e não-quebrante** (campo novo opcional).

**Shape do `layers` (por slide), emitido pelo agents e devolvido no GET:**
```jsonc
{
  "background": { "type": "solid|gradient|image", "value": "<hex|css-gradient|data:image|http url>" },
  "elements": [
    { "type": "text|icon|image|shape|divider", "role": "headline|body|stat|quote|bullets|cta|image|...",
      "content": "<texto ou url>", "style": { /* ElementStyle: cor/fonte/peso/objectFit/focalPoint/... */ },
      "position": { "x": 0..1080, "y": 0..1350, "width": number, "height": number|"auto" } }
  ],
  "canvas": { "width": 1080, "height": 1350 }
}
```
`tokens` (cores/fontes da marca) viajam **uma vez por conteúdo** (não por slide) — F2 os lê do brand kit já
disponível na UI, evitando repetir ~1 KB por slide. `ImageUrl` **permanece** (fundo rasterizado p/ publish —
invariante #2). `LayersJson` é **NULLABLE** (degradado honesto: slide manual/antigo → `layers: null`, a UI cai
no preview só-imagem atual).

**Fronteira exata (paths):** `agents` `GenerateResultSlide` (`types.ts`) ganha `layers?` → `jobs.ts toGenerateResult`
repassa `visual.slides[i]` (background+elements+canvas) → `AgentsSlide` (`AgentsClient.cs:88`) ganha
`Layers (JsonElement?)` → `ToOutcome` (`ContentController.cs:378`) → `OutcomeSlide` (`GenerationCompletionService.cs:8`)
ganha `LayersJson (string?)` (já serializado) → persiste em `ContentSlide.LayersJson` → `ToDto`
(`ContentController.cs:739`) reemite como `JsonElement?` → web `lib/content.ts ContentSlide.layers?`.

### Fase 2 — Renderer fiel por composição (resolve preview SOTA)
**Objetivo:** preview = o que publica (WYSIWYG).
- Componente `<SlideCanvas>` React: renderiza `background` + `elements[]` posicionados (x/y/w/h em % do canvas 1080×1350), tipografia/cor via tokens da marca, `focalPoint`/`objectPosition` da imagem.
- Substitui `slide-preview.tsx`; usado no wizard, em `/content/[id]` e em aprovações (corrige G5).
- **Teste:** o slide renderizado bate visualmente com a intenção; carrossel de 6 navegável.
- **Risco:** médio (fidelidade visual). Sem backend novo.

### Fase 3 — Editor visual (resolve G4, núcleo da Visão B)
**Objetivo:** editar texto inline, reposicionar camadas (drag), ajustar foco/crop da imagem, trocar/regerar imagem por slide, trocar layout, aplicar tokens.
- Sobre `<SlideCanvas>`: modo edição. Salva via endpoint estendido (`PUT /{id}/slides` passa a aceitar `layers`).
- **Rasterização:** ao salvar/aprovar, compor camadas → JPEG → `ImageUrl` (mantém publish íntegro). Decidir: rasterizar no worker (server-side, fiel) vs client (`html-to-image`). **Recomendação: server-side** para consistência com o que publica.
- **Teste:** editar copy/posição/imagem → salvar → reabrir mantém → aprovar gera JPEG correto.
- **Risco:** alto (maior superfície). Faseável internamente (texto inline → drag → imagem → layout).

### Fase 4 — Polish & e2e
- Estados (loading/erro/vazio) SOTA; aprovações com preview; testes e2e do fluxo; performance (sem 1 MB no fio).

---

## 4. Decisões tomadas (2026-06-18, com o operador)

1. **Slides intermediários (2-5): gerar imagem da IA para TODOS os 6 slides.**
   Remove a otimização cover+last em `image-generator.ts:62-67`. Visual rico de cara. Custo/tempo: a
   geração sobe de ~2min para ~4-10min e o custo de IA ~3×. Mitigação: paralelizar a geração das 6
   imagens (hoje é sequencial, l.71-75) respeitando rate-limit do provider; reportar progresso por
   slide no polling. O `imageCount` no `usage` (custo/SpendEntry) reflete 6.

2. **Rasterização: SERVER-SIDE, no worker, via SixLabors.ImageSharp (SOTA aplicável à stack).**
   Racional: o que o operador aprova precisa ser pixel-idêntico ao publicado (publish em nome da marca
   do cliente). Client-side (browser do operador) introduz variância (fontes/DPI/versão de browser) →
   inaceitável. O SOTA de "camadas→imagem" server-side é determinístico e headless (Satori/Vercel-OG,
   Remotion, Playwright). Como o worker é .NET enxuto (`dotnet/runtime`, sem Node/Chromium) e **já usa
   ImageSharp** (pinado por CVE), compomos `LayersJson` → fundo + texto + elementos → JPEG → MinIO com
   ImageSharp: sem browser, determinístico, reusa lib existente. **Fallback** para layouts complexos
   demais p/ ImageSharp: micro-render via **Satori** no serviço de agents (já é Node) → SVG → PNG.
   O preview React (`<SlideCanvas>`, Fase 2) e o rasterizador compartilham o MESMO `LayersJson` e as
   mesmas regras de posição (%) e tokens → preview fiel ao publicado.

3. **`RenderHtml`: REMOVER.** Deprecar o campo (agents para de emitir, API para de persistir, migração
   dropa a coluna). Export PDF/PNG futuro deriva das camadas via o mesmo rasterizador. Tira 1 MB do fio
   e do banco — resolve a lentidão (B2).

---

## 4b. Achados de auditoria de inteligência incorporados (escopo: Estrutural + UX core)

Auditoria crítica do fluxo (3 frentes) revelou burrices que vão ALÉM do bug da imagem. Escopo aprovado
com o operador: **estrutural + UX core** (o que faz o output ser bom e a UX deixar de parecer pedra).
Fluxo puro (SSE, optimistic lock, reaper agressivo) fica para fase posterior — listado em §4c.

**Incorporados às fases (confirmados em código):**

| Achado | Evidência | Entra na |
|--------|-----------|----------|
| **A1. Só 2/6 slides com imagem, sequencial** | `image-generator.ts:62-75` | Fase 1 (já decidido: 6 imgs, paralelo c/ rate-limit) |
| **A2. Riqueza visual achatada** (position/style/focalPoint/tokens descartados) | `jobs.ts:94-108` → `ContentController.cs:378-385` | Fase 1 (contrato de camadas `LayersJson`) |
| **A3. Compositor confia cego no LLM** — sem validação de bounds/overlap/contraste (grep: zero) | `visual-compositor.ts:134-143` | **Fase 1b (NOVA)** |
| **A4. Sem structured output** — JSON pedido em texto livre, parse frágil (grep `responseSchema`: zero) | todos os agentes | **Fase 1b (NOVA)** |
| **A5. Qualidade sem ação** — score<70 entrega mesmo assim, sem retry/veto | `quality-validator.ts:404-442` | **Fase 1b (NOVA)** |
| **A9. Editor textarea cego, sem preview** | `content/[id]/page.tsx:64-117` | Fase 2/3 |
| **A10. Aprovação às cegas** (só texto) | `approvals/page.tsx:87-126` | Fase 2 (SlideCanvas reusado) |
| **A11. Sem autosave/undo** | `content/[id]/page.tsx:71-78` | Fase 3 |
| **A12. Progresso de geração genérico** (% + checkmark, não "o que faz agora") | `create/page.tsx:233-291` | Fase 4 |

### Fase 1b (NOVA) — Inteligência do compositor (entra junto com a Fase 1)
**Por quê junto:** destravar camadas (Fase 1) sem inteligência no compositor = expor layouts que o LLM
posicionou mal (texto fora do canvas, sobreposto, sem contraste). As duas andam juntas.
- **Structured output (A4):** migrar os agentes que emitem JSON para `responseSchema`/`responseMimeType`
  nativo do Gemini (e equivalentes nos outros providers). Elimina parse frágil e retry cego.
- **Validação determinística pós-compositor (A3):** após o `visual-compositor`, rodar checagem:
  BBox dentro do canvas 1080×1350 (clamp automático se estourar), overlap entre elementos, contraste
  texto/fundo (WCAG/APCA). Constraints de zona (topo/meio/rodapé, máx N elementos) injetadas no prompt.
- **Qualidade acionável (A5):** falhas **críticas** (contraste reprovado, headline ausente) → veto +
  1 retry com feedback; demais → badge acionável na UI (não silencioso).
- **Teste:** gerar 50× e verificar 0 elementos fora do canvas; score<70 dispara retry; JSON sempre válido.

## 4c. Fora do escopo desta rodada (fase posterior — fluxo puro)
- **A6/A7. Polling 1.5s → SSE/WebSocket** (parcialmente mitigado ao remover `RenderHtml`).
- **A8. Optimistic lock** no `PUT /slides` (race em edição simultânea) — `ExecuteUpdateAsync` por `UpdatedAt`.
- **Reaper de geração órfã mais agressivo** + heartbeat de progresso (janela órfã 5-10min).
- **Enum .NET↔TS** com gerador em CI; tipagem de hashtags; QualityScore não-null.

## 4d. F1b — decisão de implementação (2026-06-18): o que entrou agora e o que foi adiado (com porquê)

A F1b previa 3 frentes (A4 structured output, A3 validação de bounds, A5 qualidade acionável). Ao
implementar, lendo o estado REAL do código, o escopo honesto se separou assim (KISS, sem teatro):

- **A4 — Structured output (Gemini): FEITO, atrás de flag.** `responseSchema` (forma flat clássica
  `responseMimeType`+`responseSchema`, portável a gemini-3.5-flash e slugs 2.x — fonte:
  ai.google.dev/gemini-api/docs/structured-output, jun/2026; a forma nova `responseFormat` é
  Gemini-3-only e traz combinação-com-tools que não precisamos). Wiring: `TextGenOptions.responseSchema`
  → `GeminiAPIClient` injeta no `generationConfig` SÓ quando `GEMINI_STRUCTURED_OUTPUT=true` (opt-in;
  o v1beta pode rejeitar JSON mode em alguns modelos/contas — cookbook#1028). Default OFF → caminho
  atual (prompt-enhancement + parse resiliente) intacto. Primeiro agente a definir schema:
  `visual-compositor` (JSON mais complexo). Provado por `client.structured.test.ts` (3 testes).

- **A5 — Qualidade acionável: JÁ ESTAVA WIRED (badge) + veto crítico existe; retry adiado p/ F4.**
  O badge "Qualidade baixa <70" já aparece em 5 telas (approvals, compare, content/[id], history,
  wizard) via `ContentDto.QualityScore` — requisito "não-silencioso" atendido. O veto de falha CRÍTICA
  (headline ausente → `passed:false, score:0`) já vive no quality-validator. O **retry-com-feedback**
  (regerar quando score<70) NÃO entra na F1b: (a) as gerações reais pontuam 95-96 — o retry quase nunca
  dispararia; (b) dobraria o tempo (~100s→200s, arrisca o gate <150s) por um caso que não ocorre;
  (c) o mecanismo de regeneração-com-instrução já existe (`regenerationInstruction`) e o plano escopa
  "regenerar-com-feedback" explicitamente na **F4 (C3)**. Construí-lo aqui seria duplicação prematura.

- **A3 — Validação de bounds: ADIADA para F2 (com razão verificada).** O render-engine usa posições CSS
  **absolutas hardcoded por template** (`position: absolute; top/left` fixos por role — verificado em
  `render-engine.ts`), NÃO o `element.position` do compositor. Hoje o compositor sequer emite `position`.
  Validar bbox/overlap de posições que nada consome seria **teatro** (cria ilusão de correção). A
  validação determinística de bounds passa a ter consumidor real quando o `<SlideCanvas>` (F2) renderiza
  POR posição — é lá que A3 entra, junto das posições que o compositor passará a emitir.

## 4e. F3 — decisão de implementação (2026-06-18): rasterização via Satori (SUPERSEDE ImageSharp da §4.2)

A decisão original (§4 item 2) era rasterizar com **ImageSharp no worker**. Ao implementar a F3, dois
fatos REAIS (verificados) inverteram a escolha — registro a mudança com causa (C-NONREG):

1. **O layout virou CSS-flexbox** (`<SlideCanvas>`, F2): role-based, sem coordenadas x/y. Reproduzir
   flexbox em primitivas de desenho do ImageSharp = manter DOIS motores de layout (browser vs ImageSharp)
   em paridade pixel — superfície enorme e fidelidade frágil, o oposto de "preview==raster".
2. **Ambas as opções exigem nova dependência** (o worker só tem `SixLabors.ImageSharp`, NÃO o
   `.Drawing` nem `SixLabors.Fonts`). Não há caminho "grátis".

**Decisão (operador, 2026-06-18): Satori no serviço `agents` (Node).** Satori (engine do `@vercel/og`)
converte JSX/flexbox→SVG via Yoga (o MESMO modelo de layout do `<SlideCanvas>`), e `@resvg/resvg-js`
faz SVG→PNG. Como preview (React) e rasterizador (Satori) compartilham as MESMAS regras de layout
role-based, `preview==raster` deixa de ser aspiração e vira consequência. Versões SOTA jun/2026:
`satori@0.26`, `@resvg/resvg-js@2.6`. Fontes:
[github.com/vercel/satori](https://github.com/vercel/satori) · [resvg-js](https://github.com/yisibl/resvg-js).

**GOTCHA de fonte (verificado):** Satori NÃO suporta **woff2** (só TTF/OTF/WOFF — limitação do
opentype.js). O repo só tem `satoshi-*.woff2` em `apps/web/public/fonts`. → a F3-raster precisa de
Satoshi em TTF/OTF/WOFF no agents (conversão ou arquivo). Enquanto não houver, o rasterizador cai numa
fonte fallback declarada (nunca falha em silêncio).

**Sequência F3:** (A) editor visual completo (texto inline + posição + imagem) sobre o `<SlideCanvas>`,
salvando `layers` via `PUT /{id}/slides` — independente de fonte; depois (B) rasterizador Satori
(camadas→PNG→JPEG→`ImageUrl`) no save/approve, mantendo o publish íntegro (invariante #2).

## 5. Como testamos (ambiente local já de pé)

Stack roda nativo: API :5080, agents :4000, web :3001, Postgres portátil :5433 (isolado do Nexus).
Cada fase: gerar conteúdo real no wizard → inspecionar banco (`ContentSlides`) → ver no preview/editor →
aprovar → confirmar JPEG. Testes automatizados por runtime conforme o invariante tocado.
