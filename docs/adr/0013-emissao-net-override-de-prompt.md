---
adr: 0013
titulo: Emissão .NET do override de prompt ponta-a-ponta (persistência + montagem no briefing + UI Admin)
status: aceito
data: 2026-06-15
---

# ADR-0013 — Emissão .NET do override de prompt ponta-a-ponta

> **Complemento de ADR-0011.** O ADR-0011 entregou o **mecanismo no pipeline** (agents): os 5
> system prompts viraram assets versionados, com override por agente injetável por run no
> `brandContext.promptOverrides`, atrás da flag `PROMPT_OVERRIDES_ENABLED` (default `false`), com
> validação + fallback ao base. **O que faltava** (declarado "fora de escopo" no ADR-0011): a **API .NET
> nunca emitia** esse campo — não havia onde o operador guardar o texto nem por onde ele chegasse ao
> agents. Este ADR fecha o ciclo: **persistência** (tabela `PromptOverride`), **montagem** no
> `BuildAgentRequestAsync` e **UI de edição** Admin-gated. O gate da flag continua 100% no agents — a API
> emite **incondicionalmente** (quem decide ler é `jobs.ts`).

## Critério de aceite (binário — no topo)

- [x] **A. Persistência tenant-scoped.** Existe `PromptOverride : TenantEntity { AgentKey, PromptText }`
      com índice ÚNICO `(WorkspaceId, AgentKey)`. Entra no `ApplyTenantFilter` (3 camadas íntegras: read
      filter + `TenantSaveInterceptor` + `TenantFilter`). Migration `AddPromptOverride` aplica e reverte
      (`up→down→up` provado contra Postgres portátil); snapshot commitado.
- [x] **B. Emissão incondicional.** `AgentsBrandContext` ganha um **último** parâmetro posicional
      `PromptOverrides` (`IReadOnlyDictionary<string,string>?`, `JsonIgnore WhenWritingNull`,
      serializa `promptOverrides` camelCase). `BuildAgentRequestAsync` monta o dicionário
      `AgentKey→PromptText` via `BuildPromptOverridesAsync` (espelha `BuildAiOverrideAsync`:
      `AsNoTracking`, **null se vazio** — degradado honesto).
- [x] **C. Byte-equivalência preservada.** Sem override no workspace → campo **omitido** do JSON →
      payload byte-equivalente ao atual. `BriefingPreviewContractTests` (preview==geração) **continua
      verde**. **Um teste novo** prova: 2 overrides → `promptOverrides` presente com as 2 chaves; 0
      overrides → ausente.
- [x] **D. Controller Admin-gated.** `PromptOverridesController` (`[Authorize(Roles="Admin")]`,
      `api/settings/prompts`): GET devolve os overrides (texto **volta**, ao contrário de `Secret`);
      PUT `/{agentKey}` valida `agentKey ∈ 5 chaves canônicas` (senão 400) + tamanho máx + upsert;
      DELETE `/{agentKey}` reseta (volta ao base). Chave inválida → 400.
- [x] **E. UI à prova de leigo.** `settings/prompts` (Admin-only) lista os 5 agentes em PT-BR
      ("instrução do agente"/"texto base"/"voltar ao padrão"), com **aviso de poder perigoso** + nota
      "requer ativação pelo operador" (a flag). Sem jargão, sem nome de env-var exposto.
- [x] **F. Verificações verdes.** `dotnet build` (Core+Api+Worker) + `dotnet test` + agents/web
      typecheck/build + `gen-enums --check`. `AgentKey` NÃO é enum (string livre validada contra a
      lista) — não toca `gen-enums`.

> **Implementado.** `PromptOverride` (migration 17 `AddPromptOverride`), `PromptOverridesController`
> (`api/settings/prompts`, Admin-gated), UI `settings/prompts`, e o campo `PromptOverrides` no
> `AgentsBrandContext` estão no código. Flag `PROMPT_OVERRIDES_ENABLED` OFF por padrão.

## Contexto

- O record `AgentsBrandContext` é **posicional** (`apps/api/Features/Content/AgentsClient.cs:9-30`);
  último param hoje = `Hashtags` (`:30`). Mexer na ordem quebra a instanciação posicional em
  `ContentController.cs:231-236` — por isso o novo campo é **sempre o último**, com default `null`.
- A montagem do briefing vive em `BuildAgentRequestAsync` (`ContentController.cs:174-251`); o padrão de
  "ler um Secret do workspace e omitir quando ausente" já existe em `BuildAiOverrideAsync` (`:334-347`) —
  é o molde de `BuildPromptOverridesAsync`.
- O agents já consome `req.brandContext.promptOverrides` atrás da flag (`jobs.ts:191-192`,
  `sanitizePromptOverrides`); `BrandContext` tem index signature (`types.ts:50`), mas ganha um campo
  explícito `promptOverrides?: Record<string,string>` para documentar o contrato.
- As 5 chaves canônicas são fonte única em `services/agents/src/types/agent-keys.ts:12`
  (`brand-strategist`, `story-architect`, `copywriter`, `visual-compositor`, `quality-validator`). A
  validação .NET espelha essa lista (sem contrato compartilhado — mesma natureza dos enums; comentário-âncora).

## Decisão

**Tabela dedicada `PromptOverride : TenantEntity`** (1 linha por `WorkspaceId`+`AgentKey`).

Alternativas descartadas (tradeoffs avaliados no código real):
- **(.env global):** não é por-workspace, e prompt não é segredo de deploy.
- **(A) coluna JSON em `BrandKit`:** viraria por-*marca* (override é decisão de **operação**, não de
  conteúdo de marca) e misturaria responsabilidades. O override é do workspace, como a chave de IA.
- **(B) reusar `Secret`:** o invariante de `Secret` é "valor **nunca** volta em GET" (`SecretProtector`,
  AES-GCM). O editor de prompt PRECISA devolver o texto para edição → conflito direto. Além disso, prompt
  **não é segredo** (não se cifra). Tabela própria, texto em claro, é o ajuste correto.

`AgentKey` é **string livre validada** contra as 5 chaves (não enum): o domínio das chaves é dos agents
(`agent-keys.ts`), não do .NET; um enum .NET exigiria sincronia via `gen-enums` para um conjunto que já
tem dono do outro lado. KISS: valida contra a lista literal, com comentário-âncora apontando a fonte.

## Modelo de dados / Contrato de API / UI

**Entidade** (`libs/SocialAi.Core/Domain/Entities.cs`, após `AuditEntry`):
```csharp
public class PromptOverride : TenantEntity
{
    public string AgentKey { get; set; } = string.Empty;   // ∈ 5 chaves canônicas (agent-keys.ts)
    public string PromptText { get; set; } = string.Empty; // texto em claro (não é segredo)
}
```
**AppDbContext** (`libs/SocialAi.Core/Data/AppDbContext.cs`): `DbSet<PromptOverride>` (após `:37`);
índice único `(WorkspaceId, AgentKey)` (padrão Template `:80`); `HasQueryFilter` dentro de
`ApplyTenantFilter` (último, antes do `}` `:198`).

**Contrato HTTP** (`PromptOverridesController`, `api/settings/prompts`, Admin):
- `GET` → `{ overrides: [{ agentKey, promptText }], maxLength }` (texto presente).
- `PUT /{agentKey}` body `{ promptText }` → 200 (upsert) | 400 (chave inválida / texto vazio / > máx).
- `DELETE /{agentKey}` → 204 (reset ao base).

**UI** (`apps/web/app/(app)/settings/prompts/page.tsx` + `lib/prompts.ts`): irmã de `settings/ai`,
Admin-gated; lista os 5 agentes com `textarea` por agente, botões "Salvar" e "Voltar ao padrão", aviso de
poder perigoso + nota de ativação pelo operador.

## Estratégia de migração

`AddPromptOverride` é **expand** puro (cria 1 tabela; não toca nada existente) → reversível trivialmente.
`Down()` dropa a tabela. Prova `up→down→up` contra o Postgres portátil; `pg_dump`/backup antes em produção.
Core afeta **api E worker** — ambos rebuildados (o worker não usa a tabela, mas compila o modelo).

## Plano de teste

- **Isolamento (.NET):** inserir override no workspace A não vaza para B (teste no padrão dos
  invariantes de multi-tenancy — read filter + write guard).
- **Byte-equivalência (.NET):** estender `BriefingPreviewContractTests` — sem override, `brandContext`
  byte-a-byte idêntico (campo omitido); com 2 overrides, `promptOverrides` presente com as 2 chaves; e
  preview==geração continua.
- **Validação (.NET):** PUT com chave fora das 5 → 400; com texto vazio → 400; com texto > máx → 400.
- **Build/typecheck (web/agents):** página nova compila; `BrandContext.promptOverrides` tipado.

## Riscos e mitigação

- **Vazamento cross-tenant** se esquecer o `HasQueryFilter` → mitigado pelo aceite A (no `ApplyTenantFilter`)
  + teste de isolamento.
- **Drift de chaves** (.NET ↔ `agent-keys.ts`) → comentário-âncora + validação que rejeita chave fora da
  lista (uma chave nova no agents sem atualizar a lista .NET seria rejeitada no PUT — falha visível, não
  silenciosa).
- **Quebra de byte-equivalência** → `JsonIgnore WhenWritingNull` + `BuildPromptOverridesAsync` retornando
  `null` quando vazio + teste de contrato.

## Fora de escopo

- Override **por marca** (é por workspace, como a chave de IA) — só se virar requisito.
- Versionar/auditar histórico de edições de prompt (a tabela guarda o estado atual; auditoria de ação
  sensível pode entrar via `AuditEntry` num incremento futuro).
- Editor com preview do prompt-base resolvido (o base vive nos `.md` versionados; a UI mostra o override,
  não o base — KISS).
