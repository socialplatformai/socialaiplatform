---
adr: 0003
titulo: Coleta ↔ engine — alinhar o que a UI coleta com o que o pipeline consome
status: aceito (implementado 2026-06-15)
data: 2026-06-14
---

# ADR-0003 — Coleta ↔ engine

> O maior ganho de **qualidade da geração**: hoje o `input-adapter` descarta dados reais e usa
> defaults genéricos. Depende dos campos novos da entidade Marca.

## Critério de aceite (binário)

- [x] `context.targetAudience` no payload ao agents = público-alvo da marca (campo novo), não
      o literal `'Audiência da marca'`. Teste do adapter confirma.
- [x] Pauta com objetivo de marketing X → `goal.objective` reflete X no payload (não fixo
      `'awareness'`). Teste confirma.
- [x] Adicionar 1 exemplo de copy na marca → aparece em `brandConfig.voice.copyExamples`
      (deixa de ser `[]`). Teste confirma.
- [x] Anexo da pauta aparece em `referenceContext` no payload. Teste confirma.
- [x] `Pauta.Category` aparece em `content.additionalNotes` **e** filtra a lista de
      pautas na UI.
- [x] Os campos de `Pauta`/`Brand` têm destino verificável no `input-adapter`, com testes
      cobrindo os mapeamentos (sem campo coletado caindo silenciosamente como órfão).
- [x] Nenhum default genérico hardcoded permanece onde há dado real disponível (só
      `goal.angle: 'transformation'` permanece fixo — não há campo de dado real p/ ele; aceitável).

> **Estado: implementado em 2026-06-15.** Camada agents (input-adapter), .NET (`Pauta.MarketingObjective` +
> migration reversível provada contra Postgres real + serialização) e UI (campo de objetivo + filtro de
> categoria). Os campos de público-alvo e exemplos de copy entram via os campos de marca (ADR-0005).
> Rastreabilidade: os campos coletados têm destino na engine. As referências visuais e os anexos da
> pauta já são enviados ao pipeline (`ContentController`); o uso de uma referência **como imagem** na
> geração é roadmap.

## Contexto (o que o código faz hoje)

`services/agents/src/agents/input-adapter.ts` (`adaptHttpToPipelineInput`) hardcoda:
`targetAudience: 'Audiência da marca'`; `goal.objective: 'awareness'`; `goal.angle: 'transformation'`;
`brandConfig.visualIdentity` 100% default (cores/fontes APEX); `voice.copyExamples: []`. Campos
coletados mas ainda sem destino na engine no momento desta decisão: `Pauta.Category` e
`Pauta.Attachments`. (Ambos foram ligados na implementação: hoje a API inclui e envia os anexos da
pauta — `ContentController`, `Include(p => p.Attachments)` + envio ao agents.) A identidade visual
(cores/tipo/logo) vem do **ADR-0005**, não deste — aqui tratamos texto/semântica.

## Decisão

**Alinhar o contrato HTTP (`BrandContext`/`Pauta` em `services/agents/src/types.ts`) e o
`input-adapter` para propagar dados reais; quando um dado existir, ele substitui o default.** Os
defaults só permanecem como **fallback explícito** quando o dado está ausente (degradado honesto).

### Campos novos necessários (mínimos)
- **Marca:** `targetAudience` (string), `copyExamples` (JSON array de string). *(Coordenado: estes campos
  entram pelo **ADR-0005**, num bloco único de migration de marca — não há migration separada aqui.
  Ficam na entidade `BrandKit` (config 1:1 da marca já serializada à engine),
  NÃO em `Brand` (agrupador leve do seletor) — ver ADR-0005 §Decisão, alternativa A descartada.)*
- **Pauta:** `marketingObjective` (enum/texto curto: awareness | consideration | conversion | …) e,
  opcionalmente, `angle`. `Category` e `Attachments` **já existem** — só precisam ser propagados.

### Mudanças no contrato e no adapter
1. **API** (`ContentController.BuildAgentRequestAsync`): incluir no payload ao agents — público-alvo e
   exemplos da marca; `Category`; `Attachments` (como `referenceContext: [{url, label}]`);
   `marketingObjective` da pauta.
2. **agents `types.ts`:** estender `BrandContext` (targetAudience, copyExamples) e `Pauta`
   (marketingObjective, category, referenceContext).
3. **`input-adapter.ts`:** mapear cada um; default só se `?? fallback`. Remover os literais fixos.

## Plano de teste (fecha o aceite)

- `input-adapter.test.ts` (Vitest): para cada campo, entrada conhecida →
  asserção de que o valor real aparece no `PipelineInput` (e o default aparece só quando ausente).
- **Teste de rastreabilidade:** um teste lista os campos de `Pauta`/`Brand` (fonte: os tipos
  TS) e falha se algum não for referenciado no `input-adapter` — guarda anti-órfão permanente.

## Riscos e mitigação
- **Inflar o briefing com ruído** → escopo realista: anexos como referência textual (URL+rótulo),
  não análise de imagem; objetivo como enum curto, não texto livre verboso.
- **Acoplamento com os campos de marca** → coordenar a migration de campos de marca num bloco só;
  este ADR assume que os campos existem.
- **Modo degradado:** sem dado, cai no default com log claro — nunca briefing vazio.

## Fora de escopo
- Identidade **visual** (cores/tipo/logo) no payload → **ADR-0005**.
- Refs visuais como imagem de referência para o `image-generator` → futuro (hoje, referência textual).
- Transparência do briefing na UI (mostrar o que vai pra IA) → futuro.
