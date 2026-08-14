---
adr: 0012
titulo: Design Compiler — Brand Design Spec canônico (compilador de identidade determinístico)
status: aceito
data: 2026-06-15
---

# ADR-0012 — Design Compiler: Brand Design Spec canônico como fonte única de render, imagem, copy e UX

> **Origem:** responde ao requisito de produto: "marca × design system × template têm que conversar
> para a geração ser inteligente; talvez um DESIGN.md compiler". A resposta arquitetural está abaixo.

## Critério de aceite (binário — cada item vira teste)

- [ ] **AC1.** `npx vitest run` permanece **inteiramente verde após CADA PR**; novos testes somam, nenhum quebra (não-regressão).
- [ ] **AC2.** `compileBrandDesignSpec(brandConfigA)` chamado 2× com o mesmo input retorna specs `deepEqual` (determinismo — snapshot byte-a-byte, padrão `enums.contract.test.ts`).
- [ ] **AC3.** `compileBrandDesignSpec(brandConfig vazio/parcial)` **NÃO lança** e retorna spec com defaults APEX (fail-safe).
- [ ] **AC4.** `render(visual)` **SEM** `designSpec` produz HTML/CSS **byte-idêntico** ao baseline atual (snapshot de cover/body/last sem spec == output pré-mudança).
- [ ] **AC5.** `render(visual & { designSpec: specComAccent('#FF0000') })` produz CSS com `--bd-accent:#FF0000` no `:root` E `.pagination-number{color:var(--bd-accent,#FFD44A)}` resolve para vermelho (assert por substring).
- [ ] **AC6.** Para todo `var(--bd-X, FALLBACK)` usado no template, existe `--bd-X` emitido por `generateGlobalCSS` quando há spec (teste que cruza nomes — pega typo de token).
- [ ] **AC7.** `spec.palette.onImage.hex` é `#FFFFFF` quando `relativeLuminance(background) < 0.5` e quase-preto caso contrário (teste com bg claro e escuro).
- [ ] **AC8.** `spec.imageAesthetics.gradientFallback` === o literal `iris-grad` vendorizado (fonte única do fallback iridescente).
- [ ] **AC9.** Image-generator com spec: o prompt passado a `provider.generate` contém ≥1 cor de `spec.imageAesthetics.palette` (assert por substring no mock do provider).
- [ ] **AC10.** `<img>` de body com `style.objectPosition='50% 30%'` emite `object-position:50% 30%`; ausência emite `center center` (Caminho A).
- [ ] **AC11.** Cover com `role:'background'` + `style.focalPoint={x:0.5,y:0.2}` emite `background-position:50% 20%` no `::before` (Caminho B).
- [ ] **AC12.** `ElementStyle` com campos de composição ausentes → render **byte-idêntico** ao atual para o mesmo elemento (não-regressão da composição).
- [ ] **AC13.** Após PR3, `visual.tokens.colors` passado ao render == derivado de `spec.palette` (não os defaults `#1A1A1A`/`#C9B298` do `parseOutput`) — assert no pipeline.
- [ ] **AC14.** `getTemplateCSS('id-inexistente')(spec)` retorna `''` (fallback ao built-in/legacy — degradado honesto do registry, plugue do registry de templates do ADR-0008).
- [ ] **AC15.** `npm run build` (tsc + tsc-alias) do agents passa **SEM import cross-package** de `packages/design-tokens` (grep por `design-tokens` em `src/` = 0) — confirma a correção do blocker de build Docker.
- [ ] **AC16.** Nenhum `.svg` por path `/assets/patterns/*` permanece no HTML após PR5 (todos data-URI inline).

## Contexto (estado real verificado)

- `render(visual)` (`render-engine.ts:932`) já recebe `visual.tokens` e popula `--color-*`/`--font-*` no
  `:root` (`generateGlobalCSS:827`), **MAS** `getTemplateCSS` (`:29`) emite hex literais Figma
  (`#FFD44A` em :294/:642, `#000000` bg em :503/:571, `'Inter'` em ~13 regras, etc.) que **nunca leem
  essas vars** → toda marca sai idêntica (preto+amarelo Figma).
- A imagem é fixa em `object-fit:cover;object-position:center center` (`<img>` body/last :462-463) e
  `background-size:cover;background-position:center` (`::before` cover :511-515) — zero controle de foco/crop/escala.
- O prompt de imagem usa `style` cravado (`'cinematic…'/'photorealistic…'`, `image-generator.ts:92/125`)
  sem a paleta da marca; o fallback iridescente (`:103`) é string literal idêntica a `apexTokens.gradient['iris-grad']`.
- **Cobertura zero do render:** grep retornou **zero** referência a `render-engine`/`getTemplateCSS`/
  `VisualSpecification.tokens` em `src/agents/*.test.ts` — daí a segurança do fallback byte-idêntico.
- **Gap das duas representações do APEX:** design system rico em `packages/design-tokens/` (18 cores +
  spacing/radius/shadow/gradientes) vs `VisualPreset` pobre em `brand/presets.ts` (5 cores + 2 fontes).
  O `input-adapter.ts::buildBrandConfig` já faz o **merge 3-níveis** (`campo-da-marca ?? preset ?? default-APEX`).

## Decisão

Criar um **COMPILADOR DE IDENTIDADE determinístico** (sem LLM, sem I/O): função pura
`compileBrandDesignSpec(brandConfig, presetId?, template?) → BrandDesignSpec` em **novo arquivo**
`services/agents/src/brand/design-spec.ts`. É a **camada ACIMA** do merge 3-níveis (adapter = HTTP→pipeline;
compiler = pipeline→spec rico). Dele derivam TODOS os consumidores por campos nomeados: **render-engine**
(cores/fontes via CSS vars `--bd-*`), **prompt de imagem** (paleta/mood/estética), **copywriter** (voz),
**UX futura** (edita os inputs, preview chamando a mesma função). Um lugar, tudo deriva.

A mecânica no render é a de **menor risco possível**: substituir cada literal por `var(--bd-X, FIGMA_LITERAL)`
com fallback **byte-idêntico**. Sem spec injetado, o `:root` não traz `--bd-*` → resolve no fallback Figma →
render byte-idêntico a hoje → suíte verde. Com spec, a marca aparece. O nome da var **é** o binding.

### Vendorização (correção de blocker de build)
As 3 propostas trataram o import de `apexTokens` de `packages/design-tokens` como "dívida de path". É mais
grave: o Dockerfile do agents faz `COPY . .` **só** de `services/agents`; `tsconfig.json` tem `rootDir:"src"`/
`include:["src/**/*.ts"]`; o `package.json` não declara a dependência → o import **quebraria o build Docker e
o tsc**. **Decisão corrigida:** NÃO importar cross-package. **Vendorizar** a fatia estrutural
(spacing/radius/shadow/gradient) como `const APEX_STRUCTURE` congelada **dentro** de `design-spec.ts`,
copiada byte-a-byte com comentário de origem. Mais KISS, sem coupling, single-source dentro do agents.
`gradientFallback = APEX_STRUCTURE.gradient['iris-grad']` (mata a duplicação do fallback iridescente).

## Artefato canônico — `BrandDesignSpec`

Vive como **TYPE TS + função pura efêmera por geração** — **NÃO** como DESIGN.md/JSON lido do disco (I/O
reintroduziria o anti-pattern do path absoluto, quebraria determinismo e multi-tenancy). O "DESIGN.md/JSON"
do requisito é **projeção read-only futura** via `JSON.stringify(spec)` quando a UX pedir, nunca fonte.

```ts
// services/agents/src/brand/design-spec.ts
export type ColorToken = { hex: string; name: string; role: string }

export interface BrandDesignSpec {
  version: '1.0'
  palette: {
    primary: ColorToken; secondary: ColorToken; accent: ColorToken
    background: ColorToken; text: ColorToken
    ink: ColorToken      // = text (alias para texto sobre superfície clara)
    muted: ColorToken    // DERIVADO: mix(text, background) p/ legendas/subtítulos
    onImage: ColorToken  // DERIVADO: branco ou quase-preto por luminância do background
  }
  typography: {
    heading: { family: string; weights: number[]; scale?: Record<string,number>; tracking?: string }
    body:    { family: string; weights: number[]; scale?: Record<string,number>; tracking?: string }
  }
  structure: { spacing: Record<string,string>; radius: Record<string,string>; shadow: Record<string,string> }
  imageAesthetics: {
    palette: string[]; mood: string; style: string; gradientFallback: string
  }
  voice: { attributes: string[]; toneGuidelines: string[]; copyExamples: Array<{ text: string; isGood: boolean; context: string }> }
  templateBinding: { templateId: string; slotColors: Record<string,string> }
}

export function compileBrandDesignSpec(
  brandConfig: BrandConfigForPipeline, presetId?: PresetId, template?: CarouselTemplate
): BrandDesignSpec
```

**Derivação das 2 cores funcionais (escopo travado, sem motor de cor):** `muted` = mix sRGB 60/40 entre
`text` e `background` (`mixHex(a,b,t)`, ~8 linhas); `onImage` = `relativeLuminance(background) < 0.5 ?
'#FFFFFF' : '#0A0A0A'` (fórmula WCAG simples, ~6 linhas). Resto é passthrough. **NÃO** OKLCH/APCA completo.

## Contrato/tipos (tudo ADITIVO e OPCIONAL — nada quebra)

Sem mudança no contrato HTTP api⇄agents (o spec é interno, derivado do `brandConfig` que já trafega) nem
nos enums .NET↔TS. Sem `.NET`/migration.
1. `ElementStyle` (`pipeline.ts:212`) ganha campos opcionais de composição: `objectFit?`, `objectPosition?`,
   `focalPoint?:{x,y}`, `scale?`, `overlay?:{color,opacity}` — defaults = comportamento atual.
2. `render(visual: VisualSpecification & { signature?; designSpec? })` — campo opcional.
3. `ImageGeneratorInput` ganha `designSpec?` (aditivo).
4. `BrandDesignSpec` vive em `brand/design-spec.ts` (isola o contrato de IDENTIDADE do contrato inter-agentes).

## Composição de imagem (2 caminhos físicos)

- **Caminho A — `<img>` body/last:** o `<img>` emite `style` inline derivado de `imageElement.style`
  (`object-fit:${fit??'cover'};object-position:${posFrom(style)};transform:scale(${scale??1})`); o CSS do
  template remove o object-position fixo (mantém o frame Figma). `posFrom = objectPosition ?? (focalPoint ?
  '${x*100}% ${y*100}%' : 'center center')`. Sem campos → byte-idêntico.
- **Caminho B — `::before` cover:** lê do elemento `role:'background'`; `background-position:${posFrom}`,
  `background-size` de `objectFit`. `scale` via `transform:scale()` dentro do `overflow:hidden` (já existe).
- **`overlay?`** latente (camada de contraste sobre foto, derivável de `palette.onImage`) — não usado no 1º corte.

## Templates blueprint

1. **Brand-aware via CSS vars com fallback Figma:** `generateGlobalCSS(tokens, spec?)` emite `--bd-*`
   (palette/typography/structure) quando há spec; cada literal de cor/fonte em `getTemplateCSS` vira
   `var(--bd-TOKEN, FIGMA_LITERAL)`. **Geometria fica literal** (Figma-exact, não-marca).
2. **Registry (enxerto platform-scale, destrava o registry de templates do ADR-0008):** `getTemplateCSS`
   (if-chain de 3 IDs) → `const TEMPLATE_CSS: Record<layoutId,(spec?)=>string>`; id desconhecido → `''`/legacy
   (degradado honesto = ponto de queda do template-em-dados).
3. **Variantes HOJE:** por TOKENS (mesma geometria, paletas distintas) — N marcas visualmente diferentes sem
   template novo. **DEPOIS (Incremento D):** variantes de GEOMETRIA como novas entradas do registry via
   `Template.SpecJson`. **Não prometer geometria nova antes do D.**
4. **Prompt de imagem:** concatena `spec.imageAesthetics` (paleta/mood/style); fallback iridescente lê
   `spec.imageAesthetics.gradientFallback` (fonte única).

## Plano incremental (cada PR verde nos 93)

1. **PR1 — EXPAND (aditivo, zero comportamento):** `brand/design-spec.ts` (tipo + `compileBrandDesignSpec` +
   `mixHex`/`relativeLuminance` + `APEX_STRUCTURE` vendorizado) + `design-spec.test.ts` (snapshot determinístico
   + contraste). Nenhum consumidor muda → 93 intactos.
2. **PR2 — MIGRATE-render:** `generateGlobalCSS` emite `--bd-*` quando há spec; `getTemplateCSS` → registry;
   literais → `var(--bd-X, FIGMA)` byte-idêntico; `render(...&{designSpec?})` repassa. Snapshot sem spec
   (== baseline) + com spec APEX (1ª rede do render).
3. **PR3 — MIGRATE-pipeline:** `compileBrandDesignSpec(...)` 1× em `pipeline-v2` (seam :240), injeta `designSpec`
   no visual e no image-generator; **OBRIGATÓRIO:** sobrescrever `visual.tokens` com `spec.palette` antes do
   render (fecha o gap das 2 fontes de cor — R3/AC13).
4. **PR4 — MIGRATE-imagem + composição:** `image-generator` usa `spec.imageAesthetics`; `ElementStyle` ganha
   composição (leitura no render, defaults atuais).
5. **PR5 — ASSETS (separado, obrigatório):** inline dos 3 SVGs como data-URI; `stroke→currentColor` herda `--bd-ink`.
6. **CONTRACT (futuro):** remover defaults `#1A1A1A`/`#C9B298` paralelos do `parseOutput`; variantes de
   geometria no Incremento D; projeção DESIGN.md via `JSON.stringify(spec)` quando a UX de E pedir.

## Alternativas descartadas

- **DESIGN.md/JSON lido do disco como fonte:** reintroduz I/O no render (quebra determinismo), recria o
  anti-pattern do path absoluto, complica multi-tenancy. Spec efêmero por geração é mais simples e stateless.
- **Importar `apexTokens` cross-package:** blocker de build Docker/tsc VERIFICADO → vendorização.
- **LLM emite o CSS final:** viola "render determinístico sem LLM".
- **Motor OKLCH/APCA + escala tipográfica + variantes de geometria agora:** escopo não pedido, superfície de
  bug sem cobertura; podado a 2 cores derivadas; geometria entra no Incremento D.
- **Fundir o compiler no `buildBrandConfig`:** mistura responsabilidades; mantê-los separados deixa cada um testável.
- **Persistir o spec no banco:** YAGNI; função pura em µs por job, agents stateless.

## Riscos e mitigação

- **R1 (ALTO→eliminado)** import cross-package quebra build → vendorização + AC15 (grep = 0).
- **R2 (MÉDIO)** fallback precisa ser byte-idêntico (render sem cobertura) → AC4 (snapshot == baseline) + diff cor-a-cor.
- **R3 (MÉDIO)** 2 fontes de cor (parseOutput injeta `#1A1A1A`/`#C9B298`) → PR3 sobrescreve `visual.tokens` (AC13, **obrigatório**).
- **R4-R7 (BAIXO)** typo de token (AC6) · scale vaza frame (overflow:hidden já existe, AC12) · contraste extremo
  (guard de luminância, AC7) · assets quebram até PR5 (AC16).

## Fora de escopo

Motor OKLCH/APCA completo · escala tipográfica modular · variantes de GEOMETRIA (→ Incremento D) ·
persistência do spec · DESIGN.md editável como fonte · mudança no contrato HTTP/enums · população por
LLM/template da composição (PR4 entrega só a leitura) · mexer no `compile.mjs` (dívida separada) ·
inline dos SVGs no mesmo PR do spec (é PR5).
