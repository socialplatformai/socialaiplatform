---
adr: 0015
titulo: Engine de templates slot-based — da anatomia "Templates atômicos em camadas" aos blueprints físicos
status: proposto
data: 2026-06-21
---

# ADR-0015 — Materializar a anatomia de templates: de 3 renders fixos para blueprints slot-based agnósticos

> **Origem:** o operador prototipou a *spec de anatomia* `Templates atômicos em camadas`
> (`anatomia-templates.html` + `templates-canvas-v2.html`). NÃO são telas — é a **especificação do
> sistema de templates de slide**. Esta ADR é o **plano de materialização** (pedido explícito do
> operador: "só o plano/ADR primeiro"). Não escreve código; define o alvo, o gap real verificado, e a
> ordem de fatias verticais.

## Resumo de uma linha

O *planejamento* de templates já fala 10 layouts (`SlideLayout` + `archetypes-v2.ts`), mas o *render*
só conhece 3 físicos (`branding-os-{cover,body,last}-v1`) — todo `slide.layout` colapsa em 3 caixas. A
spec do operador (`templates-canvas-v2.html`, **24 templates atômicos em 3 famílias**) descreve a ponte
que falta: render **slot-based** (4 camadas-z + atributos de contrato) onde cada layout vira um blueprint
geométrico real, **agnóstico de marca** (mesma anatomia, skin injetada). Materializamos por fatia
vertical, **sem big-bang**, **sem regredir os snapshots atuais**.

### As 3 famílias de template (decompostas do catálogo — 24 atômicos)

> Os HTMLs são EXEMPLOS de uma lógica, não o alvo a copiar. A lógica decomposta:

- **Tipográficos (8) — texto protagonista, imagem opcional:** `cover-editorial · stat-highlight ·
  big-question · testimonial-quote · definition-term · manifesto-lead · index-toc · numbered-list`.
- **Imagem estrutural (10) — o slot de imagem é camada de 1ª classe:** `full-bleed-hero · image-top ·
  split-vertical · boxed-frame · quote-on-image · portrait-feature · device-mockup · image-grid-2×2 ·
  before-after · caption-magazine`.
- **Estruturados (6) — dado/diagrama/contraste:** `comparison-vs · step-process · annotated-callout ·
  stat-trio · cta-close · split-stat-image`.

**Coerência auditada 🟢** (nos `data-*` dos 24): todo template tem `data-layer="background"`; os slots de
imagem sempre carregam `data-slot`+`data-fit`+`data-frame` juntos (16/16/16 — nenhum meio-preenchido); os
`data-role` são **exatamente** os campos de `SlideCopy` que o pipeline já produz (headline/body/stat/
statContext/quote/attribution/bullets/cta/caption). **2 deltas declarados (L5):** (a) `data-fx`
(duotone/scrim/grain) está na taxonomia mas é usado 0× no catálogo — contrato sem uso; (b) 2 roles novos
(`eyebrow`, `annotation`) ainda não existem em `SlideCopy`.

## Estado real verificado (grau de confiança por claim)

🟢 = confirmado lendo o código · 🟡 = inferido de evidência forte · 🟠 = a verificar no PR

- 🟢 **O render tem só 3 templates.** `render-engine.ts:80` `TEMPLATE_CSS` = `{branding-os-cover-v1,
  branding-os-body-v1, branding-os-last-v1}`; `renderTemplateSlide:621` faz `if layoutId === ...` triplo
  e cai em `branding-os-body-v1` como default (`:623`). "Figma exact match" (`:74`).
- 🟢 **O `layoutId` é cravado no prompt, não escolhido.** `visual-compositor.ts:153-155` instrui o LLM a
  usar literalmente cover/body/last por posição (primeiro/último/resto). O `SlideLayout` rico **nunca**
  vira `layoutId`.
- 🟢 **`SlideLayout` (12 valores) só viaja como TEXTO.** `pipeline.ts:31` define 10 layouts
  (`centered-headline, headline-subheadline, stat-highlight, bullet-points, icon-grid, testimonial,
  split-image-text, offer-box, cta-focused, comparison-columns`); `story-architect.ts:72` injeta
  `slide.layout` só no prompt. **Não há mapa `SlideLayout → layoutId`.** → todos colapsam em 3 renders.
- 🟢 **A camada de planejamento JÁ materializou a spec.** `templates/archetypes-v2.ts` (5 templates:
  listicle, comparison, myth-busting, step-by-step, storytelling) foi destilado de "Templates atômicos em
  camadas" e usa o vocabulário tipado. Comentário `:9`: *"zero render novo"* — pararam de propósito antes
  do pixel. **Esta ADR é a continuação dessa onda, na camada que faltou (o render).**
- 🟢 **O render já honra os ROLES da spec.** `render-engine.ts:713-719` lê `stat, statContext, quote,
  attribution, bullets, cta, caption`; o `body-v1` já tem blocos condicionais stat-highlight (`:299`),
  testimonial (`:324`), bullets (`:267`), CTA. `SlideCopy` (`pipeline.ts:171`) carrega todos esses
  campos. → o vocabulário de conteúdo **já existe**; falta a **geometria** por arquétipo.
- 🟢 **O .NET não sabe de templates.** `grep layoutId|SlideLayout|branding-os|data-role` em `libs/ apps/api
  apps/worker` = **0 hits**. → **ZERO risco de sync .NET↔TS** nesta obra. É 100% interno a `services/agents`.
- 🟢 **Snapshot trava o render.** `__snapshots__/render-engine.test.ts.snap` (610 linhas) congela o HTML/CSS
  dos 3 templates. Mudança nos 3 atuais = quebra de snapshot intencional (ou byte-idêntico).
- 🟡 **A spec é mapeável 1:1.** A taxonomia do `anatomia-templates.html` (`data-layer`, `data-role`,
  `data-slot`, `data-fit`, `data-frame`, `data-fx`) cobre os campos que `VisualElement`/`ElementStyle`
  (`pipeline.ts:215,241`) já têm em embrião (role, objectFit, objectPosition, focalPoint). O delta é:
  `data-layer` (camada-z) e `data-frame/data-fx` (forma do recorte / tratamento) ainda não existem tipados.
- 🟠 **Os `SlideLayout` extras da spec.** A spec nomeia arquétipos que `SlideLayout` ainda **não** tem:
  `cover-editorial, stat-hero, big-question, full-bleed-hero, image-top, boxed-frame, portrait-circle,
  image-grid-2×2`. Decidir no PR1 se renomeamos/estendemos o enum ou mapeamos os existentes (ver Decisão).

## Decisão

**Construir um render slot-based incremental, com um REGISTRY de blueprints**, plugando-o no ponto onde o
render já é extensível (`TEMPLATE_CSS` é um `Record<string, fn>` — `:80`), **sem remover os 3 atuais**.

1. **Camada-z explícita.** Adotar `data-layer` (background · image · structure · content) como modelo
   mental do render. Os 3 templates atuais já são, de fato, essas camadas implícitas — formalizamos.
2. **Blueprint = geometria + slots tipados, sem marca.** Cada `SlideLayout` ganha um blueprint (zonas
   posicionadas + restrição por slot). A marca (cor/fonte) entra por `var(--bd-*)` (já existe via
   ADR-0012 Design Compiler) — **agnosticismo herdado de graça**, não reinventado.
3. **Mapa `SlideLayout → blueprintId`.** Um único ponto de tradução (novo) liga o planejamento (que já
   escolhe layout rico) ao render. Layout sem blueprint → fallback honesto a `body-v1` (degradado, não erro).
4. **Wire do compositor.** `visual-compositor.ts` para de cravar 3 layouts e passa a propagar o
   `slide.layout` escolhido pelo planejamento como `layoutId` (via o mapa do item 3).
5. **Não-regressão é AC binário.** Os 3 templates atuais permanecem byte-idênticos enquanto não forem
   alvo de uma fatia; cada blueprint novo é aditivo.

### Alternativas consideradas (ARCHITECT — ≥2 com trade-off)

- **A) Reescrita big-bang para Satori + 12 blueprints** (o que a spec literalmente desenha, render Satori).
  *Prós:* fidelidade máxima, modelo de camadas puro. *Contras:* troca o motor de render (string→Satori),
  risco alto de regressão nos 3 atuais + no pipeline de imagem, multi-sessão antes de QUALQUER pixel novo.
  **Recusada agora:** viola "1 fatia vertical por vez" e "andaime ≤ produto". Satori fica como evolução
  futura possível, não pré-requisito.
- **B) Só refinar os 3 atuais com a anatomia** (safe-zones, escala, restrições). *Prós:* risco mínimo.
  *Contras:* não entrega o que a spec É (variedade de arquétipos); o operador continua com 3 caixas.
  **Recusada como alvo final**, mas a fatia PR1 a inclui de graça (formalizar camadas nos 3).
- **C) Registry incremental (ESCOLHIDA).** Aditivo, cada blueprint é uma fatia fechável E2E, os 3 atuais
  intactos, agnosticismo reaproveitado do ADR-0012. **Sacrifício nomeado:** não é Satori, não é o
  modelo-z purista da spec no dia 1 — é o pragmático que entrega pixel novo já na 1ª fatia.

## Critério de aceite (binário — cada item vira teste)

- [ ] **AC1.** `npx vitest run` (agents) **inteiramente verde após CADA PR**; testes novos somam, nenhum quebra.
- [ ] **AC2.** Snapshot dos 3 templates atuais (`render-engine.test.ts.snap`) **byte-idêntico** enquanto não
      forem alvo explícito de uma fatia (não-regressão).
- [ ] **AC3.** Existe um mapa puro `slideLayoutToBlueprint(layout: SlideLayout): string` determinístico;
      layout sem blueprint → `'branding-os-body-v1'` (fallback honesto, testado).
- [ ] **AC4.** `getTemplateCSS('blueprint-novo')(spec)` lê `var(--bd-accent/--bd-background/--bd-font-*)` e
      **nenhum hex de marca literal** (grep no CSS do blueprint = 0 hex fora de neutros funcionais) — prova
      de agnosticismo (mesmo critério do ADR-0012 AC5/AC6).
- [ ] **AC5.** O blueprint da fatia renderiza com 2 specs de marca distintas (accent #FF0000 vs #00FF00) e
      o HTML difere SÓ nas `var(--bd-*)` resolvidas (snapshot 2-marcas, espelha a "Prova agnóstica" da spec).
- [ ] **AC6.** `visual-compositor` deixa de cravar layoutId fixo: dado um `story.slides[i].layout` =
      `'comparison-columns'`, o `layoutId` emitido para aquele slide é o blueprint correspondente (teste
      do wire) — e **não** `branding-os-body-v1`.
- [ ] **AC7.** Restrições de slot da spec viram validação real: headline auto-shrink/clamp no CSS do
      blueprint (não overflow), stat com escala dedicada — assert por substring de regra CSS.
- [ ] **AC8.** `npm run build` (tsc + tsc-alias) do agents passa; `npm run typecheck` 0 erros.
- [ ] **AC9.** Pixel dirigido: gerar 1 carrossel real que aciona o blueprint novo, capturar screenshot
      (puppeteer-core, §⑤ do handoff), comparar com o alvo do `anatomia-templates.html`. (Gate de pixel,
      não só verde de typecheck — regra-mãe do handoff.)

## Plano por fatias (cada uma fecha E2E: verde + snapshot + pixel → commit PT-BR)

> Ordem por valor/risco. **Uma fatia por vez.** Parar e reavaliar com o operador entre fatias.

- **PR1 — Andaime do registry (zero pixel novo, zero regressão).** Tipar `data-layer`; criar
  `slideLayoutToBlueprint` (mapeia os 10 layouts existentes; os ainda-sem-blueprint → `body-v1`); wire do
  compositor para propagar `layout→layoutId`. **AC2 garante os 3 atuais byte-idênticos.** Entrega: a
  infraestrutura, ainda renderizando os 3 (porque o mapa ainda aponta tudo pra eles). Valida o esqueleto.
- **PR2 — 1º blueprint novo: `comparison-columns`** (o `comparison-vs` da spec; o `comparisonTemplate` de
  `archetypes-v2.ts` JÁ o pede em 2 slides — valor imediato, hoje desperdiçado). Agnóstico (AC4/AC5),
  restrições de slot (AC7), pixel dirigido (AC9). **É a fatia que prova a arquitetura inteira.**
- **PR3 — `stat-highlight` como blueprint dedicado** (`stat-hero` da spec). Hoje é um bloco dentro do
  `body-v1`; promover a blueprint com a escala de stat da spec (≤6 glyphs, número protagonista).
- **PR4 — `cta-focused` + `bullet-points`** (cobre o fecho e a lista — os outros 2 layouts que
  `archetypes-v2` mais usa). Fecha a cobertura dos arquétipos v2 existentes.
- **PR5+ — blueprints de imagem** (`full-bleed-hero`, `split-image-text`, `image-top`): exigem
  `data-frame`/`data-fx` (recorte/tratamento). Maior — só depois que 2-4 provarem o padrão.

## ADVERSARIAL (o que quebra isto?)

- **"O snapshot vai quebrar sem querer."** → Mitigado por AC2: snapshot dos 3 atuais é gate; se mudar sem
  uma fatia alvo, o PR está errado. PR1 é desenhado pra ser byte-idêntico (mapa aponta tudo pra body).
- **"O LLM não escolhe layouts variados."** → O planejamento (`archetypes-v2`) JÁ escolhe layouts ricos
  por slide; o gargalo é só o wire (AC6). Não dependemos de novo comportamento de LLM — destravamos um
  dado que já existe e era jogado fora (mesmo padrão do G4 A/B barato, commit `9d4516b`).
- **"Vira over-engineering (12 blueprints)."** → Não entregamos 12. Entregamos o registry + 1 blueprint
  (PR2) e PARAMOS. Os demais são aditivos sob demanda. Andaime ≤ produto.
- **"E o image-generator / quality-validator?"** → Blueprints sem imagem (PR2-4) não os tocam. Blueprints
  de imagem (PR5+) entram só quando `data-slot` orientar o prompt de imagem — fora do escopo desta fatia.
- **"Os nomes da spec não batem com `SlideLayout`."** 🟠 → Decisão adiada para PR2: ou estendemos o enum,
  ou o mapa absorve o alias (`stat-hero`→`stat-highlight`). Não bloqueia PR1.

## GATE (o "pronto" desta ADR, em uma linha)

Esta ADR está pronta quando o operador aprova **(a) a decisão (registry incremental, não big-bang)** e
**(b) começar pela PR1 (andaime, zero regressão) seguida da PR2 (`comparison-columns`, o 1º pixel novo)**.
Sem esse aceite, nenhum código é escrito.

## Consequências

- **Positivas:** destrava o `archetypes-v2` (planejamento rico que hoje renderiza igual); agnosticismo de
  graça (ADR-0012); cada fatia é fechável e reversível; 0 risco .NET; a spec do operador vira código vivo.
- **Negativas/custo:** mais um eixo de variação no render (mais snapshots a manter); o mapa
  `layout→blueprint` é um ponto novo a sincronizar quando `SlideLayout` mudar; blueprints de imagem (PR5+)
  são trabalho real adiado, não resolvido aqui (parcial declarado — L5).
- **Não-objetivos:** trocar o motor de render por Satori; tela de seleção de template no `apps/web`
  (é outra obra, [UI]); qualquer mudança no `.NET`.
