---
adr: 0007
titulo: UX guiada transversal — placeholders/hints, a11y de campos, validação inline, transparência do briefing, busca e onboarding
status: aceito
data: 2026-06-15
---

# ADR-0007 — UX guiada transversal

> Fecha a lacuna de **UX guiada** ("qualquer operador consegue, sem treino"): hoje os formulários
> têm `Field` com `hint`/`error`/`htmlFor` disponíveis mas **subutilizados** (campos sem placeholder,
> sem id, sem validação inline), o wizard mostra só `tone`/`editorialGuidelines` no passo Revisar (não
> o briefing completo que a IA recebe), pautas filtra por status/prioridade/categoria mas **não busca
> por título**, e o onboarding do dashboard reflete estado real mas **desaparece** quando completo e
> só cobre os 3 passos-base. Esta fase é **majoritariamente `apps/web`**; o único toque de backend é
> um endpoint read-only de **preview do briefing** que reusa `BuildAgentRequestAsync` (sem gerar) e,
> opcionalmente, um parâmetro `search` em `PautaController.List`. Depende de E3 (adapter já monta o
> payload, ADR-0003) para E9.5. Brownfield: a menor mudança que satisfaz cada aceite.

## Critério de aceite (binário — no topo; cada item vira teste)

- [x] **E9.1 (placeholder + hint):** auditoria automatizada (`field-audit.test.tsx`) varre todas as
      telas do grupo `(app)` e falha se **qualquer** `<Input>/<Textarea>/<Select>` de formulário não
      tiver `placeholder` **e** o `<Field>` que o envolve não tiver `hint`. Contagem alvo: **0 campos
      sem placeholder/hint**. (Mecanismo: os campos passam a usar `<Field hint=…>` + `placeholder=…`;
      `Field`/`Input` já suportam.)
- [x] **E9.2 (exemplo-semente removível):** nos campos-chave de pauta (Título, Objetivo, Objetivo de
      marketing) e marca (Tom, Diretrizes), há um affordance "usar exemplo" que preenche o controle e
      "limpar" que esvazia. Teste: clicar "usar exemplo" → `value` do input = texto do exemplo; **o
      exemplo NUNCA é enviado se o usuário não o aceitou** (placeholder/seed não viram dado salvo;
      submit com campo intocado envia vazio/`undefined`, não o texto do exemplo).
- [x] **E9.3 (label↔input, a11y):** auditoria (`field-a11y.test.tsx`) falha se algum controle de
      formulário não tiver `id` associado ao `htmlFor` do seu `<Field>`. `Field` passa a gerar e
      propagar o `id` automaticamente (via `useFieldId` + `cloneElement`/contexto) quando não fornecido.
      Contagem alvo: **todos os inputs com id e label associado**.
- [x] **E9.4 (validação inline padronizada):** existe `lib/validate.ts` com `required(v)`, `url(v)`,
      `futureDateTime(v)` retornando mensagem PT-BR clara ou `null`. Submeter com campo obrigatório
      vazio / URL malformada / data no passado → o `<Field>` mostra `error` (não só toast), o
      `<Input>` recebe `error` (aria-invalid), e o submit é **bloqueado**. Teste cobre os 3 validadores
      (mensagem exata) e o bloqueio.
- [x] **E9.5 (transparência do briefing — depende de E3):** antes de gerar (passo Revisar do wizard),
      a UI mostra **o que a IA vai receber** — objetivo, categoria, objetivo de marketing, anexos,
      concorrentes, identidade visual e resumo de aprendizado — buscando de `GET
      /api/content/briefing/preview`. **Determinismo (furo da byte-equivalência):** o preview reusa a
      MESMA montagem da geração (`BuildAgentRequestAsync`), agora **parametrizada pelo `Pauta.Id`** em
      vez de gerar `Guid.NewGuid()` internamente. O teste de contrato (`briefing-preview.contract.ts`)
      prova:
      - **caminho PAUTA:** preview **byte-equivalente** ao `AgentsGenerateRequest` da geração real
        (mesma pauta → `Pauta.Id = pauta.Id`, totalmente determinístico);
      - **caminho TEMA:** preview equivalente em **todos os campos EXCETO `Pauta.Id`** (que é um id
        efêmero/placeholder por design, sem pauta persistida — documentado, não é drift).
      **Degradado:** sem chave de IA o preview funciona igual (é read-only, não toca o pipeline); e em
      workspace **sem BrandKit, sem conta IG e com <3 métricas** o preview retorna `200` com
      `visualIdentity=null`, `handle=null`, `learningSummary=null` (espelha o degradado honesto do
      pipeline, sem inventar dados).
- [x] **E12.1 (busca + filtro):** o usuário digita texto no campo de busca de Pautas → a lista filtra
      por título (case/acento-insensível, `%`/`_` tratados como literais). Convive com os filtros
      existentes (status/prioridade/categoria). Teste ponta-a-ponta: digitar substring de um título →
      request carrega `search` → só pautas casantes aparecem; caso de borda: título contendo `%`
      literal é encontrado por busca de `%` (não wildcard).
- [x] **E12.6 (onboarding guiado com função):** o checklist do dashboard reflete estado real (já faz) e
      **cada item linka para a ação exata**; permanece acessível (colapsado) mesmo após 100% concluído,
      sem virar dead-end. Teste: com marca/IG/pauta resolvidos, o checklist mostra 3/3 e o atalho para
      "Gerar conteúdo" aparece; com algum pendente, o CTA daquele passo aponta para a rota correta.
- [x] **Não-regressão:** nenhum invariante muda. Sem novas tabelas, sem mudança de enum, sem mudança no
      contrato async de geração nem nos filtros de tenant. O caminho de **geração real continua
      idêntico** após extrair a montagem (mesma chamada `agents.StartAsync`, mesmo payload byte-a-byte
      no caminho pauta). `dotnet test` e os testes web verdes.

## Contexto (estado real hoje)

- **Primitivas** (`apps/web/components/ui.tsx`): `Field({label,hint,error,htmlFor,children})` já renderiza
  `<label htmlFor>` e prioriza `error` (com `role="alert"`) sobre `hint`. `Input/Textarea/Select` aceitam
  `error?: boolean` (vira `aria-invalid`) e fazem spread de props (logo aceitam `placeholder`/`id`). Já
  existe `useFieldId(provided?)` (`ui.tsx:204`) — **criado mas não usado**: hoje `Field` não gera id nem o
  injeta no filho; quem quer associação tem de passar `htmlFor` E `id` à mão (quase ninguém passa).
- **Pautas** (`apps/web/app/(app)/pautas/page.tsx`): form `NewPauta` tem campos Título/Objetivo/
  Categoria **sem `placeholder` e sem `hint`** (só "Objetivo de marketing" e "Anexo" têm hint); nenhum
  `id` wired. `PautaList` filtra por `priority` e `category` (server-side via `pautaApi.list`), **sem
  busca por título**. Submit usa `form.title && create.mutate()` (validação implícita, sem mensagem).
- **`pautaApi.list`** (`apps/web/lib/pautas.ts:51`): assinatura **posicional** `list(status?, priority?,
  category?)`; call sites atuais usam `list()` e `list(undefined, priority, category || undefined)`.
  Adicionar busca exige tocar este client (não só o backend).
- **`PautaController.List`** (`apps/api/Features/Pautas/PautaController.cs:29`, rota
  `[Route("api/pautas")]`): aceita `status/priority/category`; monta `IQueryable` filtrado por `BrandId`.
  **Não tem `search`.**
- **Wizard** (`apps/web/app/(app)/create/page.tsx`): passo Revisar (`step===2`) mostra apenas
  `kit.tone` e `kit.editorialGuidelines` — **não** o objetivo da pauta, anexos, categoria, objetivo de
  marketing, concorrentes nem o learning summary, todos os quais o pipeline recebe. O `ResultStep` já
  faz validação inline de data (`futureDateTime` ad-hoc em `submitSchedule`) — padrão a extrair.
- **Briefing real** (`apps/api/Features/Content/ContentController.cs:179` `BuildAgentRequestAsync`):
  **privado**, monta `AgentsGenerateRequest` a partir de `(pauta, theme, format, brandId)`. É a única
  fonte de verdade do que a IA recebe. **Ponto de atenção:** quando não há pauta (caminho tema), o
  `Pauta.Id` é montado como `Guid.NewGuid().ToString()` (linha 204) — **não-determinístico**; reusar
  para preview exige parametrizar esse id (ver Decisão / E9.5).
- **Dashboard** (`apps/web/app/(app)/dashboard/page.tsx`): bloco "Comece por aqui" já é um checklist
  com estado real (`hasBrand/connected/hasPautas`) e deep-links (`SetupStep href`). Mas é renderizado
  **só** `!setupDone` — some ao completar, sem reentrada.

## Decisão

Agrupar os 7 épicos em **3 incrementos coesos**, ordenados por dependência. Princípio transversal:
**elevar as primitivas `Field`/`Input` uma vez** e fazer as telas consumirem — nada de validação
artesanal por tela (DRY onde há repetição real, não abstração prematura).

### Incremento A — Primitivas guiadas (E9.1 + E9.3 + E9.4 + E9.2)  · sem IA
1. **`Field` auto-associa id (E9.3):** `Field` gera `id` via `useFieldId(htmlFor)` e o injeta no único
   filho de formulário via `cloneElement` (passando `id` e `aria-describedby`). Telas só passam
   `placeholder`; a associação label↔input fica automática.
   - *Alternativa descartada:* obrigar cada tela a passar `id`+`htmlFor` casados. Rejeitada: é o estado
     atual que produziu o débito (ninguém passa); descentraliza a a11y e a auditoria só pega depois.
2. **Validação inline (E9.4):** `lib/validate.ts` com validadores puros PT-BR. Telas compõem
   `{ campo: validate.required(v) }`; o `<Field error>` exibe e o submit checa "sem erros". Toast
   (`providers.tsx`) continua para erros de **servidor**; validação de **forma** é inline (no campo).
   - *Alternativa descartada:* adotar React Hook Form + Zod. Rejeitada por KISS: 2 libs novas para 4
     formulários simples; os validadores cabem em ~30 linhas e o estado de erro já existe no `Field`.
3. **Placeholders + hints (E9.1):** preencher `placeholder`/`hint` em todos os campos das telas
   `(app)`. Auditoria por teste trava a contagem em 0.
4. **Exemplo-semente (E9.2):** componente leve `<FieldSeed value example onUse onClear>` que renderiza
   os botões "usar exemplo"/"limpar". **O exemplo vive só como texto do botão e como `placeholder`** —
   ao clicar "usar exemplo" ele é copiado para o `state` do form (vira dado real, editável); intocado,
   o submit envia vazio. Garante "não polui o dado salvo".
   - *Alternativa descartada:* pré-preencher o `state` com o exemplo e marcar "dirty". Rejeitada: um
     submit acidental gravaria o texto do exemplo como dado do cliente (exatamente o que o aceite proíbe).

### Incremento B — Transparência do briefing (E9.5)  · read-only, sem IA
5. **Endpoint `GET /api/content/briefing/preview`** (querystring `pautaId?`, `theme?`, `format`):
   torna `BuildAgentRequestAsync` reutilizável e retorna o **mesmo `AgentsGenerateRequest`** que a
   geração montaria — **sem** chamar `agents.StartAsync`. Reusa o `BrandResolver`/isolamento existentes
   (marca de outra → 404, como em `Get`). Wizard passo Revisar consome e exibe o briefing legível.
   - **Não-determinismo do `Pauta.Id`:** `BuildAgentRequestAsync` passa a
     **receber o `Pauta.Id` resolvido** como parâmetro em vez de chamar `Guid.NewGuid()` internamente.
     - caminho de **geração real**: o caller passa `pauta?.Id` (ou um id estável correlacionado ao
       Content) — comportamento idêntico ao atual, payload byte-a-byte preservado;
     - caminho de **preview por tema** (sem pauta persistida): passa um id placeholder fixo (ex.:
       `"preview"`), tornando o preview reproduzível; o teste de contrato compara tudo exceto esse campo.
   - *Alternativa descartada:* montar o resumo do briefing no front a partir dos dados de marca/pauta já
     carregados. Rejeitada: duplicaria a lógica de `BuildAgentRequestAsync` (learning summary, normalização
     de handle, fallback de visualIdentity) e **divergiria** do que a IA realmente recebe — o teste de
     contrato byte-equivalente seria impossível. Endpoint = fonte única.
   - *Alternativa descartada:* manter `Guid.NewGuid()` interno e afirmar byte-equivalência.
     Rejeitada: é literalmente impossível de provar no caminho tema; parametrizar o id é a menor
     mudança que torna o critério verificável.

### Incremento C — Busca e onboarding (E12.1 + E12.6)  · sem IA
6. **Busca de pautas (E12.1):**
   - **Backend:** parâmetro opcional `search` em **`PautaController.List`** (rota `GET /api/pautas`),
     `q.Where(p => EF.Functions.ILike(p.Title, "%" + Escape(search) + "%", "\\"))` — Postgres `ILike`
     parametrizado (case-insensitive, sem trazer tudo ao cliente), com `%`/`_`/`\\` **escapados** no
     termo para que sejam tratados como literais (não curingas).
   - **Client:** `pautaApi.list` ganha `search?` **sem quebrar os call sites posicionais existentes**
     (`list()`, `list(undefined, priority, category)`) — adicionar como 4º parâmetro posicional
     documentado ou migrar para um objeto de opções; o `URLSearchParams` só seta `search` quando não vazio.
   - **UI:** `PautaList` ganha estado de busca + campo de texto, com **debounce ~300ms** embutido na
     query key. Convive com os filtros atuais.
   - *Alternativa descartada:* filtrar no cliente (`.filter` sobre a lista já carregada). Rejeitada:
     não escala além da página atual e diverge do padrão server-side já estabelecido para
     status/prioridade/categoria nesta mesma tela.
7. **Onboarding persistente (E12.6):** o checklist passa a ser **sempre montado**; quando `setupDone`,
   colapsa para uma faixa fina "Configuração concluída — Gerar conteúdo" (deep-link), sem sumir. Cada
   `SetupStep` já linka à ação; reforçar que o CTA aponta para a rota exata do passo pendente.

## Modelo de dados / Contrato / UI

- **Modelo de dados:** **nenhuma mudança de schema.** Nenhuma tabela, coluna ou enum novo.
- **Contrato (novo, aditivo):**
  - `GET /api/content/briefing/preview?pautaId={guid?}&theme={string?}&format={ContentType}` → `200
    AgentsGenerateRequest` (o mesmo DTO já enviado a agents, serializado em camelCase via
    `JsonSerializerDefaults.Web`) | `404` pauta de outra marca/inexistente | `400` sem pauta nem tema.
    **Read-only, idempotente, não cria Content nem job.** No caminho de tema, `pauta.id` é um
    placeholder fixo (não persistido).
  - **`GET /api/pautas`** (`PautaController.List`) ganha query param **opcional** `search`
    (default = sem filtro; requests existentes inalterados). O client `pautaApi.list` ganha `search?`
    de forma compatível com os call sites posicionais atuais.
- **UI:**
  - `Field` injeta `id`/`aria-describedby` automaticamente; assinatura pública inalterada.
  - Novos: `lib/validate.ts`, `<FieldSeed>` (em `components/ui.tsx`), campo de busca em Pautas, painel
    de briefing no passo Revisar do wizard, checklist colapsável no dashboard.

## Estratégia de migração

**Não há migração de schema** (nada toca o banco). Logo, sem `expand→migrate→contract` e sem `Down()`.
A mudança é aditiva no contrato (param/endpoint novos) — clientes existentes seguem funcionando. Os
dois cuidados de compatibilidade:
1. tornar `BuildAgentRequestAsync` reutilizável **sem** alterar o caminho de geração (extrair a
   montagem, manter a chamada de `agents.StartAsync` só no fluxo de geração);
2. ao **parametrizar o `Pauta.Id`** (em vez de `Guid.NewGuid()` interno), o caller de geração passa o
   mesmo id que produziria hoje, de modo que o payload da geração real fique **byte-idêntico** ao atual
   (não-regressão provada pela suíte de geração existente).

## Plano de teste (cada aceite → teste)

| Aceite | Teste | Tipo |
|---|---|---|
| E9.1 | `field-audit.test.tsx` — varre telas `(app)`, conta campos sem placeholder+hint = 0 | web |
| E9.2 | `field-seed.test.tsx` — "usar exemplo" preenche; intocado → submit envia vazio | web |
| E9.3 | `field-a11y.test.tsx` — todo controle tem id ↔ label `htmlFor` (e id único em listas) | web |
| E9.4 | `validate.test.ts` — `required/url/futureDateTime` (mensagem exata) + submit bloqueado | web |
| E9.5 | `briefing-preview.contract.ts` — caminho PAUTA: preview == `AgentsGenerateRequest` da geração (byte-eq); caminho TEMA: igual exceto `Pauta.Id` | api |
| E9.5 | preview funciona sem `AI_PROVIDER_KEY` e em workspace sem kit/IG/learning (visualIdentity/handle/learningSummary = null) | api (degradado) |
| E12.1 | `PautaController` — `search` filtra por título (ILike), convive com filtros, `%` literal não vira wildcard; client envia `search` | api + web |
| E12.6 | `dashboard` — checklist reflete estado, deep-links corretos, persiste (colapsado) a 3/3 | web |
| Não-regressão | `dotnet test` + suíte web; payload da geração real byte-idêntico; contrato de enums e tenant intactos | ambos |

As auditorias E9.1/E9.3 devem falhar antes da implementação (provam que pegam o débito).

## Riscos e mitigação

- **R1 — drift do preview vs geração real (E9.5):** se o front montar o resumo por conta própria,
  diverge do payload real. *Mitigação:* preview reusa `BuildAgentRequestAsync`; teste de contrato
  byte-equivalente (caminho pauta) trava o drift.
- **R1b — não-determinismo do `Pauta.Id` no caminho tema:** `Guid.NewGuid()` por chamada impede a
  byte-equivalência. *Mitigação:* parametrizar o `Pauta.Id`; teste compara tudo exceto esse campo no
  caminho tema, e byte-a-byte no caminho pauta.
- **R2 — `cloneElement` no `Field` quebra campos com múltiplos filhos** (ex.: input + parágrafo de
  ajuda inline, como no wizard). *Mitigação:* só injeta id no primeiro elemento de formulário; campos
  com layout custom passam `htmlFor`/`id` explícitos (escape hatch mantido).
- **R3 — `id` duplicado em listas** (mesmo `Field` repetido por item). *Mitigação:* `useFieldId` usa
  `useId()` (estável por instância React), não índice; auditoria checa unicidade.
- **R4 — exemplo-semente vira dado do cliente** (o furo do aceite). *Mitigação:* seed só como
  placeholder/texto do botão; nunca toca o `state` até "usar exemplo".
- **R5 — `ILike` e SQL injection / curingas.** *Mitigação:* parâmetro via `EF.Functions.ILike`
  (parametrizado, nunca string interpolada crua); além disso, `%`/`_`/`\\` no termo são escapados para
  serem tratados como literais (correção da busca, não só segurança).
- **R6 — quebra de call sites posicionais de `pautaApi.list`** ao adicionar `search`. *Mitigação:*
  adicionar de forma retrocompatível (4º parâmetro opcional ou objeto de opções); typecheck verde
  prova que os call sites atuais seguem válidos.

## Fora de escopo

- **E2.4 (preview visual "assim seus posts vão parecer")** — herdado do ADR-0005 como incremento de UI
  próprio; este ADR cobre transparência **textual** do briefing (E9.5), não o render visual.
- Busca/filtro em **conteúdos** além de pautas (E12.1 menciona "pautas e conteúdos"): entregue para
  pautas neste ADR; conteúdos seguem o mesmo padrão `search` quando a tela de conteúdos existir
  (hoje a lista de conteúdos é consumida pela Aprovações/Calendar, não há tela de busca dedicada).
- Tour interativo/coachmarks no onboarding (E12.6 entrega checklist funcional, não walkthrough animado).
- Override de exemplos-semente por workspace (os exemplos são fixos/versionados no front — KISS).