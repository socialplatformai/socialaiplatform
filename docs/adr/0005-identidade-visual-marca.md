---
adr: 0005
titulo: Identidade visual & Design System da marca — campos de marca (visual + texto) → engine
status: aceito
data: 2026-06-15
---

# ADR-0005 — Identidade visual & Design System da marca

> Faz a geração refletir a marca em vez de sair genérica: hoje o `input-adapter` injeta cores
> `#1B1F2E`/`Satoshi` fixos e ignora os campos visuais — dois clientes geram o mesmo visual. Junto,
> coordena com o ADR-0003 o **bloco único de campos de marca** (visual + texto: `targetAudience`,
> `copyExamples`) para **uma só migration**, como o ADR-0003 pediu. Depende da entidade Marca (ADR-0002,
> aceito).

## Critério de aceite (binário — no topo)

- [x] **Identidade visual:** `BrandKit` ganha identidade visual — paleta (cores nomeadas), tipografia (heading/body) e
      `logoUrl` — **+ os campos de texto de marca** (`targetAudience`, `copyExamples`) e o `preset`
      (design system). Migration aplica e reverte (`Down()`); salvar e reler cada campo retorna o gravado.
- [x] **Payload reflete a marca:** o JSON enviado ao agents (`brandConfig.visualIdentity`) contém os **hex/fontes da
      marca**, não os defaults `#1B1F2E`/`Satoshi`, quando a marca os tem. Teste do `input-adapter` compara
      entrada→saída; default só permanece como fallback explícito (`?? preset`) quando o campo está vazio.
- [x] **Presets de design tokens:** existe um catálogo de **presets de design tokens** (APEX default, Minimal, Bold);
      escolher o preset X → `brandConfig.visualIdentity` enviado carrega os tokens de X (verificável no
      payload). Campos pontuais preenchidos na marca **sobrescrevem** o preset (override por campo).
- [x] **Isolamento intacto:** os novos campos pendem de `BrandKit` (já `TenantEntity`, 1:1 com a marca);
      filtro global por `WorkspaceId` e `TenantSaveInterceptor` **não mudam**. Teste de não-regressão verde.
- [x] **Cardinalidade fina finalizada** (a NOTA do `AppDbContext.cs` linhas 55–57): `BrandKit` 1:1 `Brand`
      (unique index em `BrandId`); `InstagramAccount` 1:N `Brand` (sem unique). Migration aplica.
- [x] **Rastreabilidade:** os campos novos aparecem na
      lista do `traceability.test.ts` com destino ✅ (ou identidade), sem virar órfão silencioso.
- [x] **Marca sem `BrandKit`** (marcas criadas pelo CRUD de marca nascem sem kit): a serialização e o
      `input-adapter` caem 100% no preset/fallback **sem erro** (degradado honesto). Teste cobre.
- [x] **Validação de entrada:** hex inválido é rejeitado pela API (400, mensagem clara); `preset`
      desconhecido cai no APEX (fail-safe, não 500); **`LogoUrl` só http(s)** (anti XSS/SSRF). Teste cobre os três.

> **Preview "assim seus posts vão parecer"** depende do payload refletir a marca e é entrega de UI sem IA — **fora do
> escopo deste ADR** (vai para um incremento de UI próprio; ver §Fora de escopo). Mantém "uma decisão por ADR".

> **Estado: backend implementado em 2026-06-15.** Migration `AddBrandVisualIdentity` (reversibilidade +
> idempotência provadas contra Postgres real: Up→Down→Up + no-op). Testes: .NET 28/28, agents 54/54.
> Contrato API↔agents validado campo-a-campo; correções aplicadas (preset case-insensitive; `LogoUrl`
> validado). **Pendente: UI** dos campos visuais (color pickers na tela Marca) + preview — incrementos de
> UI próprios sobre este backend pronto.

## Contexto (estado real hoje)

- `Brand` (`libs/SocialAi.Core/Domain/Entities.cs:49`) só tem `Name` — é o agrupador/seletor leve.
- `BrandKit` (`Entities.cs:78`) é a **config estratégica 1:1 da marca**: `Branding`, `Tone`,
  `EditorialGuidelines`, `PositioningRules`, `DesiredContentTypes`, `VisualReferences[]`. **Já é serializado
  como `BrandContext` p/ a engine** (`ContentController.BuildAgentRequestAsync` → `agents/src/types.ts`).
- `input-adapter.ts` (`services/agents/src/agents/input-adapter.ts:29`) **hardcoda** `visualIdentity`
  inteiro (cores APEX, Satoshi) e `voice.copyExamples: []`; `targetAudience: 'Audiência da marca'`.
- Cardinalidade de marca está **propositalmente frouxa** (`AppDbContext.cs:55-57`): `WithMany()` sem unique
  index, aguardando este ADR para finalizar (evitar over-constraint que E2 reorganizaria).
- `packages/design-tokens` já existe (APEX → Tailwind/CSS vars) — base para os presets (padrão W3C).

## Decisão (KISS)

**Os campos de identidade da marca (visual + texto) moram em `BrandKit`, não em `Brand`.**

> **Alternativa A — campos em `Brand`.** O ADR-0003 fala em "campos novos em `Brand`". Mas `Brand` é o
> agrupador leve do seletor (lista no topbar); inchá-lo com paleta/tipografia/exemplos mistura o
> identificador com a config. **Descartada.**
> **Alternativa B (escolhida) — campos em `BrandKit`.** `BrandKit` já É a config 1:1 da marca e já flui
> `BrandKit → BrandContext → input-adapter`. Reusa o pipeline existente (zero contrato novo de transporte
> entre API e agents além dos campos), mantém `Brand` enxuto. Mais coeso, menos superfície.

**Presets = coleções de design tokens versionadas, não temas hardcoded.** Um `preset` (string:
`apex`|`minimal`|`bold`) na `BrandKit` seleciona um conjunto de tokens; campos visuais preenchidos na marca
**sobrescrevem** o preset campo-a-campo. O `input-adapter` resolve `campo-da-marca ?? token-do-preset ??
default-APEX`. Os presets vivem em código no serviço agents (`src/brand/presets.ts`) — determinístico,
testável, sem IA.

> **Nota de design — override parcial.** O preset é a **unidade coerente**; preencher só 1 cor mistura-a
> com as demais do preset (intencional — é o recurso de override, não uma armadilha). O preview
> sem-IA é justamente onde o usuário vê o resultado do merge antes de gerar. Sem validação de
> harmonia cromática automática (fora de escopo; decisão estética é do usuário).

**Cardinalidade:** finaliza `BrandKit` 1:1 `Brand` (unique index em `BrandId`) e mantém `InstagramAccount`
1:N. `WorkspaceId` permanece a chave de isolamento em tudo (não muda o mecanismo — ADR-0002).

## Modelo de dados / Contrato / UI

### `BrandKit` — campos novos (todos nullable; default vem do preset/fallback)
```
VisualPreset       string?   // "apex" (default) | "minimal" | "bold"
PrimaryColorHex    string?   // ex. "#1B1F2E"   (+ Secondary/Accent/Background/Text)
SecondaryColorHex  string?
AccentColorHex     string?
BackgroundColorHex string?
TextColorHex       string?
HeadingFont        string?   // ex. "Satoshi"
BodyFont           string?
LogoUrl            string?   // MinIO/URL
TargetAudience     string?   // público-alvo (texto curto)
CopyExamples       string?   // exemplos de copy: JSON array de string (["...","..."])
```
> **`CopyExamples` é JSON array** (não split por `\n`). Decisão revisada: uma copy de exemplo pode ter
> parágrafos (quebras internas) — split por `\n` corromperia. JSON array preserva o exemplo inteiro e é
> consistente com o padrão do projeto (`Content.Hashtags` já é "CSV/JSON"). Sem tabela 1:N (KISS); o
> adapter desserializa para `voice.copyExamples: string[]` (array vazio se nulo/JSON inválido — fail-safe).
> Cores como hex string nomeada espelham o shape que a engine já consome (`{ hex, name }`); o `name` é
> derivado (ex.: "Primária") no adapter, não persistido.

### Contrato API → agents (`agents/src/types.ts`)
`BrandContext` ganha: `visualIdentity?` (`{ preset?, colors?, fonts?, logoUrl? }`), `targetAudience?`,
`copyExamples?: string[]`. A API (`BuildAgentRequestAsync`) serializa os campos da `BrandKit`.

### `input-adapter.ts`
`buildBrandConfig` resolve `visualIdentity` por **merge**: `preset(ctx.visualIdentity?.preset) ⊕ overrides
da marca`. `targetAudience`/`copyExamples` deixam de ser literal/`[]` → `?? fallback`.

### UI (tela Marca, `apps/web/app/(app)/brand`)
Campos de cor (color input), fontes, logo (URL), seletor de preset, público-alvo, exemplos de copy.
**Entrega de UI pode ser incremento separado** após o backend; o aceite binário deste ADR é provável por
HTTP + teste do adapter. A UI completa fecha junto do preview.

## Estratégia de migração (expand → migrate; sem contract destrutivo)

```
Migration (expand-only, aditiva):
  - ADD COLUMN (nullable) os campos acima em BrandKit
  - cria unique index BrandKit(BrandId)  [cardinalidade fina; 1:1 já é verdade nos dados (1 kit/marca)]
  - InstagramAccount: mantém índice não-único em BrandId (1:N)
  - SEM data step: campos vazios → o adapter cai no preset/fallback (degradado honesto)
Down(): DROP das colunas + DROP do unique index.
```
> Não há backfill: ausência de valor é estado válido (cai no preset). `WorkspaceId` intacto. Provar
> round-trip Up→Down→Up contra Postgres real (runbook `docs/sot/05-operacao.md` §11); backup antes em prod.

## Plano de teste (fecha o aceite)

1. **.NET (`tests/SocialAi.Tests`):** persistência — salvar `BrandKit` com cor/fonte/logo/preset/público/
   exemplos e reler retorna o gravado; unique index em `BrandKit(BrandId)` barra 2º kit na mesma
   marca (cardinalidade). Não-regressão de isolamento (cross-workspace/cross-brand) continua verde.
2. **agents (`input-adapter.test.ts`):** marca com hex/fontes reais → `brandConfig.visualIdentity` carrega
   os hex/fontes, **não** os defaults; marca sem campos → cai no preset escolhido; preset X →
   tokens de X; override de um campo sobrepõe só aquele (merge); `targetAudience`/`copyExamples` reais
   aparecem e default só quando ausente.
3. **rastreabilidade (`traceability.test.ts`):** campos novos classificados ✅ destino; contagem de
   órfãos atualizada (este ADR e o ADR-0003 reduzem os campos sem destino — coordenar a mudança nos dois lados, proposital).

## Riscos e mitigação
- **Migration dupla com o ADR-0003** → este ADR traz o bloco ÚNICO de campos de marca (visual **e** texto);
  o ADR-0003 não adiciona campos de marca, só liga os existentes + os daqui. Coordenação explícita.
- **Over-constraint de cardinalidade** → unique index só em `BrandKit(BrandId)` (1:1 real); `InstagramAccount`
  fica 1:N. Reversível no `Down()`.
- **Inflar o payload** → cores/fontes são poucos campos curtos; presets são determinísticos; sem análise de
  imagem (refs visuais como imagem seguem fora — futuro).
- **Modo degradado** → sem campos, cai no preset/fallback APEX com a geração funcionando; nunca payload
  visual vazio.

## Fora de escopo (outros ADRs/incrementos)
- **Preview "assim seus posts vão parecer"** (mock do slide sem IA) → incremento de UI próprio.
- **Refs visuais como imagem de referência** para o `image-generator` → futuro (hoje, só textual/tokens).
- **`competitors`/`attachments` → engine** (campos textuais não-visuais) → **ADR-0003** (este ADR só toca
  o campo visual `visualReferences` no que tange identidade; a ligação textual de competitors é do ADR-0003).
- **Custo por marca, multi-conta operacional** → futuro.
