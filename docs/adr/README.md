# ADRs — Architecture Decision Records

> Decisões de arquitetura por feature, no formato **MADR enxuto**. Cada ADR transforma uma feature
> num desenho executável (modelo de dados + contrato + UI + migração + teste), com o **critério de
> aceite binário no topo**. Nenhum código começa sem o ADR da sua feature aprovado.

## Índice

| ADR | Título | Status |
|-----|--------|--------|
| [0001](0001-fundacao-qa.md) | Fundação de QA (Vitest + contrato de enums + smoke E2E) | **aceito** |
| [0002](0002-entidade-marca.md) | Entidade Marca (Workspace → N Marcas → N Contas IG) | **aceito** (backend + UI) |
| [0003](0003-coleta-engine.md) | Coleta↔engine (alinhar `input-adapter` ao dado real) | **aceito** (implementado) |
| [0004](0004-fundacao-invisivel.md) | Fundação invisível (`ITextProvider` + config tipada de IA + rastreabilidade campo→engine) | **aceito** |
| [0005](0005-identidade-visual-marca.md) | Identidade visual & Design System da marca (visual+texto → engine; presets como tokens) | **aceito** |
| [0006](0006-paridade-ui-iterar-output.md) | Paridade UI + iterar sobre o output (editar/detalhar pauta, modo por conteúdo, regenerar, editar texto, exportar, promover ideia) | **aceito** (implementado) |
| [0007](0007-ux-guiada-transversal.md) | UX guiada transversal (placeholder/hint/a11y/validação, busca, onboarding, transparência do briefing) | **aceito** (implementado) |
| [0008](0008-ia-configuravel-ui-provider-modelo-custo.md) | IA configurável + UI (OpenAI real, chave por workspace, custo, templates em dados) | **aceito** |
| [0009](0009-conteudo-avancado-uso-diario.md) | Conteúdo avançado + uso diário (variações com teto, feedback, re-tentar, lote, learning visível) | **aceito** |
| [0010](0010-contas-operacao-acesso-historico-metricas.md) | Contas, operação, acesso, histórico, métricas reais | **aceito** |
| [0011](0011-prompts-configuraveis-com-rede.md) | Prompts configuráveis (arquivos versionados + override por workspace com rede) | **aceito** |
| [0012](0012-design-compiler-brand-design-spec.md) | Design Compiler — Brand Design Spec canônico (render brand-aware + composição de imagem + fonte única) | **aceito** |
| [0013](0013-emissao-net-override-de-prompt.md) | Emissão .NET do override de prompt ponta-a-ponta (tabela `PromptOverride` + montagem no briefing + UI Admin) | **aceito** (implementado) |
| [0014](0014-recorrencia-de-publicacao.md) | Recorrência de publicação (`Frequency` enum + reagendamento no worker por clone de conteúdo) | **aceito** (implementado) |

> **ADR-0012 (Design Compiler)** responde ao pedido de "marca × design system × template conversando"
> com um compilador de identidade determinístico (spec efêmero, não DESIGN.md em disco). Implementação
> em PR1→PR5, cada um verde nos 93 testes do agents.

## Status possíveis
`proposto` → `aceito` → `implementado` · ou `substituído por NNNN` · ou `recusado`.

## Template (copiar para `NNNN-titulo-curto.md`)

```markdown
---
adr: NNNN
titulo: ...
status: proposto
data: AAAA-MM-DD
---

# ADR-NNNN — Título

## Critério de aceite (binário — no topo)
- [ ] ... (passa/não-passa, verificável; vira teste)

## Contexto
(o estado real hoje, com caminhos de arquivo citados)

## Decisão
(a escolha; KISS; alternativas descartadas e por quê)

## Modelo de dados / Contrato de API / UI
(o que muda, concreto)

## Estratégia de migração (se mexe em schema)
(expand → migrate → contract; Down() reversível; backup antes)

## Plano de teste
(como o aceite vira teste)

## Riscos e mitigação

## Fora de escopo
```

## Princípios
- **Aceite binário no topo** — sem isso o ADR não está pronto.
- **KISS** — a menor mudança que satisfaz o aceite; uma decisão por ADR.
- **Brownfield** — expand→migrate→contract; isolamento multi-tenant por `WorkspaceId` permanece
  intacto; migration reversível + backup.
- **Auto-contido** — define seus termos; cada ADR deve fazer sentido sozinho.
