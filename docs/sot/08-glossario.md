# 08 — Glossário

> **Quadrante Diátaxis: Referência.**
> Define todo termo de domínio, sigla e jargão técnico usado nesta documentação. Os demais
> documentos linkam para cá na primeira vez que usam um termo. Ordenado alfabeticamente.

---

### Agente (de IA)
Etapa especializada do pipeline de geração. Cada agente recebe a saída do anterior, executa uma
tarefa única (escolher template, escrever texto, validar qualidade…) e devolve um resultado tipado.
São 6 agentes em ordem fixa. Ver [03 — Fluxos](03-fluxos.md) e o orquestrador
`services/agents/src/agents/pipeline-v2.ts`.

### AES-GCM
Algoritmo de criptografia simétrica autenticada (Advanced Encryption Standard – Galois/Counter
Mode). "Autenticada" significa que, além de cifrar, ele detecta se o dado foi adulterado. A
plataforma o usa para guardar segredos em repouso. Ver [07 — Segurança](07-seguranca.md) e
`libs/SocialAi.Core/Infrastructure/SecretProtector.cs`.

### App Review (Meta)
Processo de revisão da Meta (empresa dona do Instagram) que libera um aplicativo para publicar em
contas de terceiros via API. Enquanto não aprovado, a publicação real fica indisponível e a
plataforma opera em [modo mock](#mock-modo-mock). Ver [09 — Roadmap](09-roadmap.md).

### Backbone
Nome da rede interna do Docker Compose onde os 6 serviços conversam. O serviço de
[agentes](#serviço-de-agentes-agents) só é alcançável dentro dela — não tem porta exposta ao host.
Definida em `docker-compose.yml`.

### Carrossel (carousel)
Formato de publicação do Instagram com múltiplos slides (imagens) navegáveis horizontalmente. É um
dos três [tipos de conteúdo](#tipo-de-conteúdo-contenttype).

### Claim (do JWT)
Cada informação carregada dentro de um [JWT](#jwt-json-web-token). Os claims relevantes aqui são `sub` (id do
usuário), `email`, `role` (papel) e **`workspace_id`** — este último é a chave do
[isolamento multi-tenant](#multi-tenant-multilocatário). Ver
`apps/api/Features/Auth/TokenService.cs`.

### Conteúdo (Content)
A peça de conteúdo gerada pela plataforma (um post, carrossel ou story), com seus slides, legenda,
chamada para ação e [status](#status-de-conteúdo-contentstatus). É a entidade central do fluxo de
aprovação e publicação.

### CORS (Cross-Origin Resource Sharing)
Mecanismo do navegador que controla quais origens (domínios) podem chamar a API. A API libera
apenas a origem do front-end, definida em `WEB_ORIGIN`. Ver `apps/api/Program.cs`.

### CSRF (Cross-Site Request Forgery)
Ataque em que um site malicioso induz o navegador da vítima a executar uma ação autenticada sem
consentimento. O fluxo de conexão com o Instagram se protege com um parâmetro `state` de uso único
([anti-CSRF](#oauth)). Ver [07 — Segurança](07-seguranca.md).

### Data URL
Forma de embutir uma imagem diretamente no texto (uma string começando com `data:image/...;base64,`)
em vez de referenciá-la por uma URL externa. Os agentes devolvem imagens assim; o
[worker](#worker-serviço-de-segundo-plano) converte para arquivo antes de publicar.

### Modo degradado
Estado em que a plataforma sobe e funciona **sem** as chaves de Inteligência Artificial
(`AI_PROVIDER_KEY`) ou do Instagram (`META_*`): cadastro, login, interface, marca e dados operam
normalmente; apenas a geração de conteúdo e a publicação real ficam indisponíveis (a publicação
cai no [modo mock](#mock-modo-mock)). **É um estado esperado e suportado, não um defeito.**

### Diátaxis
Framework de organização de documentação técnica em quatro quadrantes por intenção do leitor:
**Tutorial** (aprender fazendo), **How-to** (resolver uma tarefa), **Referência** (consultar fatos)
e **Explicação** (entender o porquê). Cada arquivo desta documentação declara seu quadrante no
cabeçalho.

### EF / EF Core (Entity Framework Core)
Biblioteca de mapeamento objeto-relacional (ORM) da Microsoft usada pela API e pelo worker para
falar com o PostgreSQL. As [migrations](#migration) e o [filtro de tenant](#multi-tenant-multilocatário)
são recursos do EF Core. Ver `libs/SocialAi.Core/Data/AppDbContext.cs`.

### EphemeralPublished (publicado efêmero)
[Status de conteúdo](#status-de-conteúdo-contentstatus) específico de **stories**: indica que o
story foi publicado mas expira em 24 horas, e por isso suas métricas deixam de ser coletáveis depois
desse prazo. Valor inteiro `7`.

### Fail-fast (de segredos)
Decisão de **recusar subir** o serviço quando, em produção, faltam segredos obrigatórios ou eles são
fracos (`JWT_SECRET`, `SECRETS_ENCRYPTION_KEY` com menos de 32 bytes). É preferível não iniciar a
iniciar inseguro. Ver `apps/api/Program.cs` e [07 — Segurança](07-seguranca.md).

### Fire-and-forget ("dispara e segue")
Padrão em que quem chama uma operação longa não espera o resultado na mesma requisição: recebe um
identificador de trabalho ([job](#job-trabalho)) e consulta o progresso depois ([poll](#poll-polling)).
A geração de conteúdo usa este padrão porque leva de 60 a 120 segundos.

### Graph API
A interface de programação (API) da Meta para publicar e ler dados do Instagram. A plataforma usa a
versão **v22.0**. O acesso real a ela é o [modo graph](#graph-modo-graph). Ver
`apps/worker/Publishing/Publishers.cs`.

### Graph (modo graph)
Modo de publicação **real**: o [worker](#worker-serviço-de-segundo-plano) publica de fato no
Instagram via [Graph API](#graph-api). Ativado por `PUBLISHER_MODE=graph` (mais conta conectada e
[URL pública do MinIO](#minio)). O oposto é o [modo mock](#mock-modo-mock). A troca é só
configuração, nunca código.

### IdeaCandidate (candidato a ideia)
Ideia de pauta criada automaticamente pelo [loop autônomo](#loop-autônomo) quando a fila de pautas
está vazia. Nasce sempre com `Promoted=false` e **nunca é publicada automaticamente** — um humano
precisa promovê-la. Ver `apps/worker/Jobs/AutonomousLoopJob.cs`.

### Idempotência
Propriedade de uma operação que, executada mais de uma vez, produz o mesmo efeito de tê-la executado
uma única vez. Aqui garante que **um post agendado seja publicado apenas uma vez**, mesmo se o worker
reiniciar. Implementada por `ScheduledPost.IdempotencyKey` (índice único) e por verificação de
publicação já bem-sucedida. Ver [03 — Fluxos](03-fluxos.md).

### JPEG
Formato de imagem comprimida exigido pela [Graph API](#graph-api) para publicação. O
[worker](#worker-serviço-de-segundo-plano) converte as imagens geradas (PNG/[data URL](#data-url))
para JPEG antes de publicar. Ver `apps/worker/Publishing/MediaService.cs`.

### Job (trabalho)
Uma unidade de processamento assíncrono identificada por um `jobId`. Na
[geração](#fire-and-forget-dispara-e-segue), o serviço de agentes cria um job, devolve o `jobId` e o
front-end faz [poll](#poll-polling) do seu progresso (`queued → running → done | error`). O registro
de jobs dos agentes é em memória — não sobrevive a um reinício do serviço. Ver
`services/agents/src/jobs.ts`.

### JWT (JSON Web Token)
Token de autenticação assinado que o usuário envia a cada requisição (cabeçalho
`Authorization: Bearer`). Carrega os [claims](#claim-do-jwt) de identidade e workspace. O token de
acesso vale 2 horas; um [refresh token](#refresh-token) renova a sessão sem novo login. Ver
`apps/api/Features/Auth/TokenService.cs`.

### Kill-switch (chave geral)
Configuração que liga/desliga uma funcionalidade globalmente. O [loop autônomo](#loop-autônomo) tem
um kill-switch (`Loop:Enabled`) que vem **desligado por padrão** — é preciso optar por ligá-lo.

### Loop autônomo
Tarefa de segundo plano que, quando ligada e dentro do orçamento, **inventa pautas** (cria
[IdeaCandidates](#ideacandidate-candidato-a-ideia)) apenas quando a fila de pautas humanas está
vazia. Tem travas de segurança em camadas (chave geral, ativação por workspace, teto de gasto,
fila vazia) e nunca publica sozinho. Ver `apps/worker/Jobs/AutonomousLoopJob.cs` e
[03 — Fluxos](03-fluxos.md#7-loop-autônomo).

### Migration
Arquivo versionado que descreve uma alteração no esquema do banco de dados (criar tabela, adicionar
coluna, índice…). A API aplica as migrations pendentes automaticamente no boot. Vivem em
`libs/SocialAi.Core/Migrations/`. Ver [06 — Referência](06-referencia.md).

### MinIO
Servidor de armazenamento de arquivos compatível com o protocolo S3 (da Amazon), usado para guardar
as imagens das publicações. O bucket é privado; o acesso à imagem é liberado por uma
[URL pré-assinada](#url-pré-assinada-presigned-url) temporária. Ver
`apps/worker/Publishing/MediaService.cs`.

### Mock (modo mock)
Modo de publicação **simulado**: a plataforma executa todo o fluxo de publicação ponta a ponta sem
chamar o Instagram de verdade (`MockPublisher`). É o padrão (`PUBLISHER_MODE=mock`) enquanto o
[App Review](#app-review-meta) da Meta não é aprovado. O oposto é o [modo graph](#graph-modo-graph).

### Modo de aprovação (ApprovalMode)
Define se um conteúdo precisa de aprovação humana antes de ser agendado. `Manual` (padrão) exige
aprovação; `Automatic` dispensa. O modo efetivo é resolvido por precedência: **Conteúdo > Campanha >
Workspace**. Ver `apps/api/Features/Approval/` e [03 — Fluxos](03-fluxos.md).

### Multi-tenant (multilocatário)
Arquitetura em que uma mesma instância do software serve múltiplos clientes isolados, sem que um veja
os dados do outro. Cada cliente é um [workspace](#workspace-espaço-de-trabalho); o isolamento é imposto
em três camadas (leitura, requisição, escrita). Ver [07 — Segurança](07-seguranca.md).

### OAuth
Protocolo padrão pelo qual o usuário autoriza a plataforma a agir em sua conta do Instagram sem
entregar a senha. Aqui usa-se o **Instagram Login** (`graph.instagram.com`), com proteção
[anti-CSRF](#csrf-cross-site-request-forgery) por `state` de uso único. Ver
`apps/api/Features/Instagram/InstagramAuthController.cs`.

### Pauta
Briefing de conteúdo: o pedido editorial que descreve o que se quer publicar (título, objetivo,
prioridade, formato desejado, data sugerida). É o ponto de partida da geração. Em português de
redação, "pauta" = "uma matéria a ser produzida". Ver `apps/api/Features/Pautas/` e
[status de pauta](#status-de-pauta-pautastatus).

### Poll (polling)
Consultar repetidamente o estado de um [job](#job-trabalho) até ele terminar. O front-end consulta o
progresso da geração a cada ~1,5 segundo. É a contraparte do [fire-and-forget](#fire-and-forget-dispara-e-segue).

### Post
No domínio do Instagram, uma publicação. Nesta documentação, "post" sem qualificador costuma referir
o [tipo de conteúdo](#tipo-de-conteúdo-contenttype) de imagem única (valor `0`); quando o sentido for
"qualquer publicação", o texto deixa claro.

### Presigned URL → ver [URL pré-assinada](#url-pré-assinada-presigned-url)

### PublishLog (registro de publicação)
Linha na tabela `PublishLog` (no PostgreSQL) que representa **uma tentativa de publicação**. É a
"fila de publicação" do sistema: o [worker](#worker-serviço-de-segundo-plano) cria a linha como
`Pending` e depois a atualiza para `Success`/`Error`/`Skipped`. Não há Redis nem fila externa. Ver
[02 — Arquitetura](02-arquitetura.md).

### Quality score (nota de qualidade)
Nota de 0 a 100 atribuída pelo agente `quality-validator` (verificações técnicas + checagem de "voz"
da marca). Abaixo de 70 o pipeline **rejeita** o resultado. A nota é exibida na interface de
aprovação. Ver `services/agents/src/agents/quality-validator.ts`.

### React Query
Biblioteca do front-end que gerencia o ciclo de busca, cache e atualização de dados vindos da API,
com tratamento central de erros (transformados em avisos visuais). Ver `apps/web/app/providers.tsx`.

### Refresh token
Token de longa duração (30 dias) que renova o [JWT](#jwt-json-web-token) de acesso (de 2 horas) silenciosamente,
sem novo login. Guardado no navegador; só o seu hash é armazenado no servidor. Ver
`apps/api/Features/Auth/TokenService.cs`.

### Render-engine (motor de renderização)
Último agente do pipeline. Converte as especificações visuais em HTML/CSS no formato 1080×1350. É
**determinístico** (não usa Inteligência Artificial). Ver
`services/agents/src/agents/render-engine.ts`.

### Reaper ("ceifador")
Tarefa de segundo plano (`GeneratingReaperJob`) que marca como `Failed` os conteúdos presos no
status `Generating` há mais de 10 minutos — limpeza de gerações órfãs (o job store dos agentes é em
memória e se perde se o serviço reiniciar). Ver `apps/worker/Jobs/GeneratingReaperJob.cs`.

### REST
Estilo de API sobre HTTP em que recursos são acessados por URLs e verbos (`GET`, `POST`, `PUT`,
`PATCH`, `DELETE`). A API da plataforma é REST + [JWT](#jwt-json-web-token). Ver [06 — Referência](06-referencia.md).

### ScheduledPost (post agendado)
Entidade que representa um conteúdo marcado para publicar em uma data/hora. O agendador a converte em
[PublishLog](#publishlog-registro-de-publicação) quando chega a hora. Carrega a
[chave de idempotência](#idempotência).

### Segredo (Secret)
Valor sensível guardado cifrado no banco, por workspace: token do Instagram, chave do provedor de IA,
chave do provedor de imagem e segredo do app Meta (quatro tipos — `SecretKind`). Nunca é devolvido
por nenhuma consulta de leitura. Ver `libs/SocialAi.Core/Infrastructure/SecretProtector.cs`.

### Serviço de agentes (agents)
O microserviço em Node + TypeScript que executa o pipeline dos 6 agentes de geração. Roda na porta
interna 4000, **sem porta pública** — só a API o alcança pela rede [backbone](#backbone). Ver
[02 — Arquitetura](02-arquitetura.md).

### Single-tenant por cliente (1 deploy por cliente)
Modelo de entrega em que cada cliente recebe a sua própria instância isolada da plataforma (seu
`.env`, seu banco). A arquitetura é [multi-tenant](#multi-tenant-multilocatário) por dentro
(`DEPLOY_MODE` pode ser `single` ou `multi`), mas a entrega padrão é uma instância por cliente.

### Slide
Cada "tela" (imagem) de um [carrossel](#carrossel-carousel) ou story. O pipeline produz texto e
imagem por slide; toda slide precisa de um título (headline), sob pena de falha dura no agente
`copywriter`.

### Status de conteúdo (ContentStatus)
O estágio de um [conteúdo](#conteúdo-content) no fluxo, representado por um inteiro de 0 a 8. Este
inteiro é um **contrato** entre a API (.NET) e o front-end (TypeScript): mudar um lado obriga a mudar
o outro. Valores em [06 — Referência](06-referencia.md).

### Status de pauta (PautaStatus)
O estágio de uma [pauta](#pauta) (`Backlog`, `Queued`, `InProgress`, `Done`, `Archived` — inteiros 0
a 4). Também é contrato .NET↔TypeScript. Valores em [06 — Referência](06-referencia.md).

### Story
Formato de publicação do Instagram que expira em 24 horas. É um dos três
[tipos de conteúdo](#tipo-de-conteúdo-contenttype); quando publicado, recebe o status
[EphemeralPublished](#ephemeralpublished-publicado-efêmero).

### Tenant → ver [Workspace](#workspace-espaço-de-trabalho) e [multi-tenant](#multi-tenant-multilocatário)

### Tipo de conteúdo (ContentType)
O formato de uma peça: `Post` (imagem única, `0`), `Carousel` ([carrossel](#carrossel-carousel),
`1`) ou `Story` (`2`).

### Token (de acesso do Instagram)
Credencial que autoriza a plataforma a publicar/ler na conta do Instagram do cliente. É de longa
duração (60 dias), guardado cifrado e renovado automaticamente antes de vencer. Ver
`apps/worker/Jobs/IgTokenRefreshJob.cs`.

### URL pré-assinada (presigned URL)
Link temporário e assinado que dá acesso a um arquivo de um bucket **privado** do
[MinIO](#minio) sem expô-lo publicamente. O worker gera uma a cada publicação (validade curta, 1
hora) para que a [Graph API](#graph-api) consiga baixar a imagem. Ver
`apps/worker/Publishing/MediaService.cs`.

### Worker (serviço de segundo plano)
O serviço .NET que executa as tarefas 24/7 sem interface: agendar, publicar, coletar métricas, rodar
o [loop autônomo](#loop-autônomo), limpar gerações órfãs ([reaper](#reaper-ceifador)) e renovar o
token do Instagram. Compartilha o banco da API. Ver [02 — Arquitetura](02-arquitetura.md).

### Workspace (espaço de trabalho)
A unidade de isolamento [multi-tenant](#multi-tenant-multilocatário): cada workspace é um cliente/
marca com seus próprios usuários, marca, pautas, conteúdos e segredos. Toda tabela isolável carrega
um `WorkspaceId`. Ver [07 — Segurança](07-seguranca.md).

### WorkspaceId
A coluna/identificador que marca a qual [workspace](#workspace-espaço-de-trabalho) um registro
pertence. É a chave de todo o [isolamento multi-tenant](#multi-tenant-multilocatário). O worker usa
`WorkspaceId=null` deliberadamente para processar todos os workspaces de uma vez (com predicados
explícitos). Ver `libs/SocialAi.Core/Data/AppDbContext.cs`.

### xUnit
Framework de testes automatizados do .NET usado pela rede de testes dos invariantes críticos
(`tests/SocialAi.Tests`). Ver [04 — Instalação](04-instalacao.md).

---

*Quadrante: Referência. Se um termo aparecer em outro documento sem estar aqui, é uma falha de
documentação — registre-o.*
