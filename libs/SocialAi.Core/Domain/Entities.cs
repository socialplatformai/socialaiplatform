namespace SocialAi.Api.Domain;

// ─────────────────────────────────────────────────────────────────────────────
// Modelo de domínio.
// Entidades tenant-scoped carregam WorkspaceId (aplicado pelo global query filter em
// AppDbContext.ApplyTenantFilter). Workspace e User são a raiz do tenant; as demais
// entidades penduram em Workspace. EphemeralPublished (Stories que expiram em 24h) é
// um estado de ContentStatus.
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>Base para entidades isoladas por tenant.</summary>
public abstract class TenantEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WorkspaceId { get; set; }
    public Workspace? Workspace { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Raiz do tenant. DEPLOY_MODE=single => 1 workspace; multi => N (AM-2).</summary>
public class Workspace
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    // Modo de aprovação padrão do workspace (nível mais baixo de precedência).
    public ApprovalMode DefaultApprovalMode { get; set; } = ApprovalMode.Manual;
    // A5 (ADR-0010): fuso do cliente (IANA, ex.: "America/Sao_Paulo"). A conversão local↔UTC
    // acontece na BORDA (API/UI) ao agendar; ScheduledFor persiste SEMPRE UTC (o worker não muda).
    // Fica no Workspace (um deploy/um cliente), não na marca — coerente com o invariante de secrets.
    public string TimeZoneId { get; set; } = "America/Sao_Paulo";
    // Janela de publicação opcional (hora LOCAL). É AVISO (soft), nunca trava o agendamento manual.
    public TimeOnly? PublishWindowStart { get; set; }
    public TimeOnly? PublishWindowEnd { get; set; }

    // ── Fase 2 (task 2.1) — flags de automação governável (o "volante") ──────────────────────────
    // O robô (PostingScheduleJob, task 2.3) só age em workspaces com AutoPostEnabled=true. Default
    // FALSE: autonomia é opt-in, coerente com o kill-switch global Loop:Enabled (também default false).
    public bool AutoPostEnabled { get; set; }
    // Agenda do robô em CSV simples (KISS — não uma tabela nova): dias 0=Dom..6=Sáb e horas HH:mm
    // LOCAIS (mesmo fuso do TimeZoneId). Ex.: Days="1,3,5" Times="09:00,18:00" = Seg/Qua/Sex 9h e 18h.
    // Vazio = robô não tem janela definida (não posta). Parse tolerante no worker (ignora tokens ruins).
    public string PostingScheduleDays { get; set; } = string.Empty;
    public string PostingScheduleTimes { get; set; } = string.Empty;
    // Estratégia de criativo do robô. Hybrid (default) = Creative Director decide por slide (atual).
    public CreativeStrategyMode CreativeStrategy { get; set; } = CreativeStrategyMode.Hybrid;
    // Nota mínima (0-100) do quality-validator p/ auto-aprovar sob modo automático (task 2.5). Default
    // 70 = o mesmo threshold de "passed" do pipeline. Abaixo disso, o conteúdo fica p/ revisão humana.
    public int AutoApprovalThreshold { get; set; } = 70;
    // ─────────────────────────────────────────────────────────────────────────────────────────────

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public ICollection<User> Users { get; set; } = new List<User>();
    // E1/DP1: várias marcas por workspace. Brand é sub-chave DENTRO do workspace
    // (o isolamento continua por WorkspaceId — ver AppDbContext/ADR-0002).
    public ICollection<Brand> Brands { get; set; } = new List<Brand>();
    public BrandKit? BrandKit { get; set; }
    public ICollection<Competitor> Competitors { get; set; } = new List<Competitor>();
    public ICollection<Pauta> Pautas { get; set; } = new List<Pauta>();
    public ICollection<Content> Contents { get; set; } = new List<Content>();
    public ICollection<Campaign> Campaigns { get; set; } = new List<Campaign>();
    // E7/DP2 (ADR-0010 A1): N contas IG por workspace (1:N, não mais 1:1). A cardinalidade
    // fina é 1:N por MARCA (InstagramAccount.BrandId); aqui é a coleção do workspace.
    public ICollection<InstagramAccount> InstagramAccounts { get; set; } = new List<InstagramAccount>();
    public Budget? Budget { get; set; }
}

/// <summary>
/// Marca (E1/DP1) — agrupador dentro do workspace. NÃO é um novo nível de tenancy:
/// é uma TenantEntity (carrega WorkspaceId) e o isolamento permanece por WorkspaceId.
/// As entidades de marca (BrandKit, Pauta, Content, etc.) ganham BrandId como sub-chave.
/// Campos de identidade visual (cores/tipografia/logo) entram no ADR de E2 (KISS).
/// </summary>
public class Brand : TenantEntity
{
    public string Name { get; set; } = string.Empty;
}

/// <summary>Campanha — nível intermediário de aprovação (workspace &lt; campanha &lt; conteúdo).</summary>
public class Campaign : TenantEntity
{
    // E1: sub-chave de marca. NULLABLE na fase expand; vira NOT NULL no contract
    // após o backfill (ADR-0002). WorkspaceId permanece (chave de isolamento).
    public Guid BrandId { get; set; }
    public Brand? Brand { get; set; }
    public string Name { get; set; } = string.Empty;
    // null = herda do workspace; preenchido = sobrepõe o padrão do workspace.
    public ApprovalMode? ApprovalMode { get; set; }
}

public class User : TenantEntity
{
    public string Email { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string? Name { get; set; }
    // 1º usuário do workspace = Admin (dono). Gate de configs sensíveis (ex.: App Meta).
    public UserRole Role { get; set; } = UserRole.Member;
    public string? RefreshTokenHash { get; set; }
    public DateTimeOffset? RefreshTokenExpiresAt { get; set; }
}

/// <summary>Config estratégica da marca (§2.1). Serializada como contexto p/ os agentes.</summary>
public class BrandKit : TenantEntity
{
    // E1: sub-chave de marca (era 1:1 Workspace → vira 1:1 Brand no contract).
    public Guid BrandId { get; set; }
    public Brand? Brand { get; set; }
    public string? Branding { get; set; }            // identidade
    public string? Tone { get; set; }                // tom de comunicação
    public string? EditorialGuidelines { get; set; } // diretrizes editoriais
    public string? PositioningRules { get; set; }    // posicionamento/linguagem
    public string? DesiredContentTypes { get; set; } // tipos de conteúdo desejados
    public ICollection<VisualReference> VisualReferences { get; set; } = new List<VisualReference>();

    // ── E2 (ADR-0005): identidade visual & texto de marca → engine ───────────
    // Todos nullable: ausência é estado válido (o input-adapter cai no preset/default
    // APEX). VisualPreset escolhe o design system (apex|minimal|bold); as cores/fontes
    // sobrescrevem o preset campo-a-campo no adapter.
    public string? VisualPreset { get; set; }
    public string? PrimaryColorHex { get; set; }
    public string? SecondaryColorHex { get; set; }
    public string? AccentColorHex { get; set; }
    public string? BackgroundColorHex { get; set; }
    public string? TextColorHex { get; set; }
    public string? HeadingFont { get; set; }
    public string? BodyFont { get; set; }
    public string? LogoUrl { get; set; }
    public string? TargetAudience { get; set; }      // E3.1 — público-alvo
    public string? CopyExamples { get; set; }        // E3.3 — JSON array de string
}

public class Competitor : TenantEntity
{
    // E1: sub-chave de marca.
    public Guid BrandId { get; set; }
    public Brand? Brand { get; set; }
    public string Handle { get; set; } = string.Empty;
    public string? Notes { get; set; }
}

public class VisualReference : TenantEntity
{
    public Guid BrandKitId { get; set; }
    public BrandKit? BrandKit { get; set; }
    public string Url { get; set; } = string.Empty; // MinIO/local
    public string? Description { get; set; }
}

/// <summary>Pauta alimentada pela equipe (§2.2, §2.6).</summary>
public class Pauta : TenantEntity
{
    // E1: sub-chave de marca.
    public Guid BrandId { get; set; }
    public Brand? Brand { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Objective { get; set; }
    public string? Context { get; set; }
    public Priority Priority { get; set; } = Priority.Medium;
    public string? Category { get; set; }
    // E3.2 (ADR-0003): objetivo de marketing (texto curto). O input-adapter normaliza
    // p/ goal.objective (awareness|consideration|conversion). null → fallback awareness.
    public string? MarketingObjective { get; set; }
    public ContentType DesiredType { get; set; } = ContentType.Post;
    public DateTimeOffset? SuggestedDate { get; set; }
    public PautaStatus Status { get; set; } = PautaStatus.Backlog;
    // D3 (ADR-0008): template forçado. NULLABLE — null = o agents roda selectBestTemplate
    // (comportamento atual). Setado → o agents usa EXATAMENTE esse template (FK p/ Template).
    public Guid? ForcedTemplateId { get; set; }
    public ICollection<Attachment> Attachments { get; set; } = new List<Attachment>();
}

public class Attachment : TenantEntity
{
    public Guid PautaId { get; set; }
    public Pauta? Pauta { get; set; }
    public string Url { get; set; } = string.Empty;
    public string? FileName { get; set; }
    public string? ContentType { get; set; }
}

/// <summary>Conteúdo gerado a partir de uma pauta (ou do loop autônomo).</summary>
public class Content : TenantEntity
{
    // E1: sub-chave de marca.
    public Guid BrandId { get; set; }
    public Brand? Brand { get; set; }
    public Guid? PautaId { get; set; }
    public Pauta? Pauta { get; set; }
    public Guid? CampaignId { get; set; }
    public Campaign? Campaign { get; set; }
    // A3 (ADR-0010/DEC-8): conta-alvo override por pauta/conteúdo. NULLABLE — null = o worker
    // resolve por precedência (IsPrimary da marca → 1ª conectada). FK SetNull: desconectar a conta
    // não apaga o conteúdo, só zera o override (cai no fallback). Validada na API (pertence à marca).
    public Guid? TargetInstagramAccountId { get; set; }
    public InstagramAccount? TargetInstagramAccount { get; set; }
    public ContentType Type { get; set; } = ContentType.Post;
    public ContentStatus Status { get; set; } = ContentStatus.Draft;
    // C2: id do job assíncrono de geração (agents). Permite ao reaper/JobStatus correlacionar
    // um Content preso em Generating ao job que o produz (ou que sumiu).
    public string? JobId { get; set; }
    // C3: nota de qualidade do quality-validator (0-100). Conteúdo com score baixo NÃO é
    // descartado (vira Draft com aviso); null quando não avaliado.
    public int? QualityScore { get; set; }
    // null = herda de campanha/workspace; preenchido = nível mais alto de precedência.
    public ApprovalMode? ApprovalModeOverride { get; set; }
    public string? Caption { get; set; }
    public string? Cta { get; set; }
    public string? Hashtags { get; set; } // CSV/JSON
    // F6/B3: nome do template que o brand-strategist usou nesta geração (ex.: "Product Launch").
    // Para o reveal pós-geração no wizard ("usei o template X"). null quando o pipeline não
    // reportou (mock/degradado/geração anterior à fase) — a UI omite o reveal.
    public string? TemplateName { get; set; }
    // AI-native (teatro c/ justificativa): o raciocínio dos agentes desta geração, serializado em
    // JSON (por que este template/ângulo, narrativa, checks de qualidade). Para o reveal "por que a
    // IA fez assim" no Resultado/editor. null quando o pipeline não reportou (mock/degradado) — a UI
    // omite o painel. JSON opaco no transporte; a web o tipa (Content.reasoning em lib/content.ts).
    public string? ReasoningJson { get; set; }
    public bool FromAutonomousLoop { get; set; }
    // A6 (ADR-0009): exemplo de "testar marca" — gerado sem pauta real (tema sintético). Não
    // aparece na listagem normal (GET /api/content filtra IsSample=false). Default false.
    public bool IsSample { get; set; }
    public ICollection<ContentSlide> Slides { get; set; } = new List<ContentSlide>();
    public Approval? Approval { get; set; }
    public ScheduledPost? ScheduledPost { get; set; }
}

public class ContentSlide : TenantEntity
{
    public Guid ContentId { get; set; }
    public Content? Content { get; set; }
    public int Index { get; set; }
    public string? Copy { get; set; }
    public string? ImageUrl { get; set; }  // MinIO público (JPEG p/ Graph API — AM-5/R-6)
    // FASE 1 (ADR-0014): camadas de composição (fundo + elementos posicionados) como JSON OPACO.
    // Substitui RenderHtml (removido — era ~1 MB de base64 inútil, B2). NULL = slide sem camadas
    // (manual/antigo); a UI cai no preview só-imagem. O `<SlideCanvas>` (F2) renderiza estas camadas.
    public string? LayersJson { get; set; }
}

public class Approval : TenantEntity
{
    public Guid ContentId { get; set; }
    public Content? Content { get; set; }
    public ApprovalMode Mode { get; set; } = ApprovalMode.Manual;
    public bool? Approved { get; set; }
    public string? Reviewer { get; set; }
    public string? Comments { get; set; }
    public DateTimeOffset? DecidedAt { get; set; }
}

public class ScheduledPost : TenantEntity
{
    public Guid ContentId { get; set; }
    public Content? Content { get; set; }
    public DateTimeOffset ScheduledFor { get; set; }
    // G5 (ADR-0014): recorrência tipada. None = 1×; Daily/Weekly/Monthly reagendam no worker.
    public Frequency Frequency { get; set; } = Frequency.None;
    public bool Dispatched { get; set; }
    // Idempotency key obrigatória: retry sem ela = post duplicado no IG real (AM-5/R-8).
    public string IdempotencyKey { get; set; } = Guid.NewGuid().ToString("N");
    public ICollection<PublishLog> PublishLogs { get; set; } = new List<PublishLog>();
}

public class PublishLog : TenantEntity
{
    public Guid ScheduledPostId { get; set; }
    public ScheduledPost? ScheduledPost { get; set; }
    public PublisherKind Publisher { get; set; }
    public PublishResult Result { get; set; } = PublishResult.Pending;
    public string? GraphResponse { get; set; }
    public string? Error { get; set; }
    public string? CorrelationId { get; set; } // tracing ponta-a-ponta (AM-7)
    // B4: retry com backoff em falha transitória. Attempts conta tentativas; NextRetryAt
    // só reprocessa quando <= now (null = pronto/permanente).
    public int Attempts { get; set; }
    public DateTimeOffset? NextRetryAt { get; set; }
    // B1/E1: id remoto do post publicado (creation_id/media id) — liga publish↔insights
    // sem cruzar workspace (corrige o lookup cross-tenant do MetricsCollector).
    public string? RemoteId { get; set; }
}

/// <summary>Conta Instagram conectada via OAuth (Instagram Login — AM-5). Token cifrado.</summary>
public class InstagramAccount : TenantEntity
{
    // E1/DP2: sub-chave de marca (era 1:1 Workspace → vira 1:N Brand no contract).
    public Guid BrandId { get; set; }
    public Brand? Brand { get; set; }
    public string IgUserId { get; set; } = string.Empty;
    public string? Username { get; set; }
    public string EncryptedAccessToken { get; set; } = string.Empty;
    public DateTimeOffset? TokenExpiresAt { get; set; } // 60d; refresh 30-45d (AM-5)
    public bool IsConnected { get; set; }
    // A4 (ADR-0010/DEC-8): conta principal da marca — ≤1 true por marca (regra transacional,
    // não unique index parcial — o flip set-all-false→true garante a unicidade). A 1ª conta
    // conectada de uma marca nasce IsPrimary=true; é o fallback default da conta-alvo.
    public bool IsPrimary { get; set; }
}

public class PerformanceMetric : TenantEntity
{
    public Guid ContentId { get; set; }
    public Content? Content { get; set; }
    public int Reach { get; set; }
    public int Engagement { get; set; }
    public int Likes { get; set; }
    public int Saves { get; set; }
    // Fase 3 (task 3.5): comentários coletados dos insights (comments_count). Default 0 (linhas
    // legadas / mock sem o campo). Entra no score ponderado (WeightedScore) sob CommentsWeight.
    public int Comments { get; set; }
    // C3 (ADR-0010/DEC-5): origem da métrica. Default Mock (linhas legadas = Mock: o passado
    // ERA mock — verdade histórica). Real só quando o parse de /insights teve sucesso com token.
    public MetricSource Source { get; set; } = MetricSource.Mock;
    public DateTimeOffset CollectedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Ideia gerada pelo loop autônomo quando a fila de pautas esvazia (§2.4, E-8).</summary>
public class IdeaCandidate : TenantEntity
{
    public string Title { get; set; } = string.Empty;
    public string? Rationale { get; set; }
    public ContentType SuggestedType { get; set; } = ContentType.Post;
    public bool Promoted { get; set; } // virou Content?
    // E4.4 (ADR-0006): sub-chave de marca. NULLABLE (expand-only): o AutonomousLoopJob
    // cria ideias sem marca (não tem BrandResolver); a promoção usa a marca atual do
    // request (X-Brand-Id), nunca infere. Carimbo pelo loop fica fora de escopo.
    public Guid? BrandId { get; set; }
    public Brand? Brand { get; set; }
}

/// <summary>
/// D1: state anti-CSRF do OAuth Instagram. NÃO é tenant-scoped — mapeia um state
/// aleatório (uso único, TTL curto) ao workspace/usuário que iniciou o fluxo, antes
/// de haver contexto de tenant no callback (anônimo). Sem isto, state=workspaceId
/// permitiria account-binding CSRF (atacante liga o IG dele ao workspace da vítima).
/// </summary>
public class OAuthState
{
    public string State { get; set; } = string.Empty; // PK: 32 bytes aleatórios base64url
    public Guid WorkspaceId { get; set; }
    public Guid UserId { get; set; }
    // A1 (ADR-0010): marca-alvo FIXADA no connect-url (exige X-Brand-Id). O callback (redirect
    // anônimo, sem header) deriva a marca DAQUI — nunca de query param (mesmo princípio anti-CSRF
    // do State). NULLABLE: states em voo durante o deploy não têm BrandId → callback cai na
    // marca-default (degradação conhecida, TTL 10min). Não é FK navegável (OAuthState não é tenant).
    public Guid? BrandId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset ExpiresAt { get; set; }
    public bool Consumed { get; set; } // uso único: marcado ao consumir no callback
}

// ── AM-3: gestão de segredos + budget/spend por workspace ─────────────────────

/// <summary>Segredo por workspace. Valor cifrado em repouso (chave de cifra vem do env — day-2).</summary>
public class Secret : TenantEntity
{
    public SecretKind Kind { get; set; }
    public string EncryptedValue { get; set; } = string.Empty;
    public DateTimeOffset? ExpiresAt { get; set; }
}

/// <summary>Teto de gasto por workspace p/ o loop autônomo (AM-6/R-7). Kill-switch global é config.</summary>
public class Budget : TenantEntity
{
    public decimal MonthlyCapUsd { get; set; }
    public bool AutonomousLoopEnabled { get; set; } // opt-in; gate humano antes do 1º auto (moderação)
    public ICollection<SpendEntry> Spend { get; set; } = new List<SpendEntry>();
}

public class SpendEntry : TenantEntity
{
    public Guid BudgetId { get; set; }
    public Budget? Budget { get; set; }
    // C (ADR-0008): sub-chave de marca p/ o painel de uso quebrar o gasto por marca.
    // NULLABLE: gastos sem marca (ex.: "loop:idea" do AutonomousLoopJob) não têm marca —
    // o isolamento continua por WorkspaceId; BrandId é só uma dimensão de agregação.
    public Guid? BrandId { get; set; }
    public Brand? Brand { get; set; }
    // B4 (ADR-0009): Content que originou o gasto (gerações manuais). NULLABLE — entries do loop
    // autônomo ("loop:idea") não têm Content de geração manual. Junto de Reason forma a chave de
    // DEDUPE (índice único filtrado WHERE ContentId IS NOT NULL): poll + reconciliador nunca duplicam.
    public Guid? ContentId { get; set; }
    public Content? Content { get; set; }
    public decimal AmountUsd { get; set; }
    public string? Reason { get; set; } // ex.: "generate:carousel", "image:gemini", "loop:idea"
    public DateTimeOffset OccurredAt { get; set; } = DateTimeOffset.UtcNow;

    // F5 (Eixo D): telemetria de custo REAL. Quando o pipeline reporta uso, gravamos o JobId
    // (correlation id ponta a ponta), o provider/modelo efetivos e os tokens — assim o custo
    // deixa de ser fixo por formato e fica auditável (qual job/modelo gastou). Todos NULLABLE:
    // gerações em mock/sem chave e entries do loop autônomo não têm uso real (degradado honesto).
    public string? JobId { get; set; }      // correlation id do job de geração (== Content.JobId)
    public string? Provider { get; set; }   // ex.: "gemini", "openai", "anthropic", "grok"
    public string? Model { get; set; }      // modelo de texto efetivo (id do provider)
    public int? TextInputTokens { get; set; }
    public int? TextOutputTokens { get; set; }
    public int? ImageCount { get; set; }
}

/// <summary>
/// Template de carousel em DADOS (D1/ADR-0008) — espelha o registry hardcoded do agents
/// (services/agents/src/templates/index.ts). Workspace-scoped: cada workspace nasce com os
/// 4 built-in (seed idempotente por workspace, ver TemplateSeeder). SpecJson = o CarouselTemplate
/// serializado (camelCase) que o agents recebe e valida (D5). Key é o id estável (ex.:
/// "product-launch") usado p/ idempotência do seed; BuiltIn marca os 4 de fábrica.
/// </summary>
public class Template : TenantEntity
{
    public string Key { get; set; } = string.Empty;       // id estável (idempotência do seed)
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string SpecJson { get; set; } = string.Empty;  // CarouselTemplate serializado (camelCase)
    public bool BuiltIn { get; set; }
}

/// <summary>
/// Curadoria de template por marca (D2/ADR-0008). Liga uma Brand a um Template com flag
/// Enabled. Ausência de linha = NÃO curado (o controller decide o default: built-in ativo).
/// Sub-chave de marca dentro do workspace (Brand não é nível de tenancy — invariante E1).
/// </summary>
public class BrandTemplate : TenantEntity
{
    public Guid BrandId { get; set; }
    public Brand? Brand { get; set; }
    public Guid TemplateId { get; set; }
    public Template? Template { get; set; }
    public bool Enabled { get; set; } = true;
}

/// <summary>
/// Item da biblioteca de marca (E1/ADR-0008): exemplos de copy, hashtags e referências, num
/// modelo único discriminado por Kind (KISS — uma tabela em vez de três). Os itens chegam à
/// engine no brandContext (E2): hashtags→brandContext.hashtags; examples→copyExamples;
/// references→referenceContext. Sub-chave de marca dentro do workspace.
/// </summary>
public class BrandLibraryItem : TenantEntity
{
    public Guid BrandId { get; set; }
    public Brand? Brand { get; set; }
    public LibraryItemKind Kind { get; set; }
    public string Value { get; set; } = string.Empty;
    public string? Label { get; set; }
}

/// <summary>
/// Convite de acesso (B1/D4/ADR-0010). Reusa o padrão anti-replay do OAuthState (uso único via
/// ExecuteUpdate condicional), mas é TenantEntity (PK Guid herdado + Token em índice ÚNICO) — não
/// se mistura os dois modelos. Entrega por e-mail está FORA de escopo (o Admin copia o link); no
/// modo degradado o convite continua funcionando. Consumed marca o aceite (não reaproveitável).
/// </summary>
public class UserInvite : TenantEntity
{
    public string Token { get; set; } = string.Empty;   // aleatório, índice ÚNICO
    public string Email { get; set; } = string.Empty;
    public UserRole Role { get; set; } = UserRole.Member;
    public DateTimeOffset ExpiresAt { get; set; }
    public bool Consumed { get; set; }
}

/// <summary>
/// Trilha de auditoria de ações sensíveis (C2/D5/ADR-0010). Append-only (sem update/delete),
/// gravada EXPLICITAMENTE no handler de cada ação (lista fechada do aceite C2) — não por
/// interceptor mágico (que não sabe "quem" sem reler o JWT e geraria ruído). Autor = claim sub.
/// BrandId nullable: ações de workspace (convite, App Meta) não têm marca.
/// </summary>
public class AuditEntry : TenantEntity
{
    public Guid? BrandId { get; set; }
    public Guid ActorUserId { get; set; }
    public string ActorEmail { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;   // ex.: "instagram.connect", "content.approve"
    public string Target { get; set; } = string.Empty;   // identificador do alvo (id/username/email)
    public DateTimeOffset OccurredAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// Fase 3 (task 3.1) — pesos configuráveis que definem "sucesso" por workspace. UMA linha por
/// workspace (índice único em WorkspaceId). Cada peso ∈ [0,10] pondera um sinal na fórmula de score
/// que o PerformanceAnalyzer usa (task 3.3) e que o robô consulta p/ priorizar tema (task 3.4).
/// Ausência de linha = default razoável no código (não trava): o comportamento atual (engajamento)
/// é preservado quando não há config. "A régua de bom post é escolhida pelo operador, não fixada."
/// </summary>
public class MetricWeightConfig : TenantEntity
{
    // Pesos por sinal (0-10). Defaults replicam o comportamento atual (saves e likes valem, o resto
    // menos) — um workspace sem config nunca muda de comportamento por causa desta entidade.
    public int SavesWeight { get; set; } = 5;
    public int ReachWeight { get; set; } = 2;
    public int LikesWeight { get; set; } = 3;
    public int CommentsWeight { get; set; } = 4;
}

/// <summary>
/// Override de system-prompt por agente, por workspace (ADR-0013, complementa ADR-0011/FASE 9).
/// Uma linha por (WorkspaceId, AgentKey). AgentKey ∈ 5 chaves canônicas dos agentes de LLM
/// (services/agents/src/types/agent-keys.ts: brand-strategist, story-architect, copywriter,
/// visual-compositor, quality-validator) — validado na borda (PromptOverridesController).
/// PromptText é texto EM CLARO (não é segredo: o editor PRECISA devolvê-lo, ao contrário do
/// Secret). A API emite estes overrides INCONDICIONALMENTE no brandContext; quem decide lê-los é
/// o agents, atrás da flag PROMPT_OVERRIDES_ENABLED (gate único em jobs.ts). Sub-chave de tenant.
/// </summary>
public class PromptOverride : TenantEntity
{
    public string AgentKey { get; set; } = string.Empty;
    public string PromptText { get; set; } = string.Empty;
}

/// <summary>
/// Config GLOBAL do deploy (key-value), NÃO tenant-scoped — vale para o processo/deploy inteiro,
/// acima de qualquer workspace. Precedente: OAuthState (também não-tenant). Nasceu para trazer o
/// freio-mestre do robô (Loop:Enabled) do env-var para o banco, controlável por TELA (o operador
/// não deve mexer em variável de servidor). Chave conhecida: "Loop:Enabled" (Value "true"/"false").
/// A leitura sempre cai no env como fallback quando a chave não existe no banco (compat total com
/// deploys que ainda configuram por env — o banco VENCE quando presente).
/// </summary>
public class SystemSetting
{
    public string Key { get; set; } = string.Empty; // PK — ex.: "Loop:Enabled"
    public string Value { get; set; } = string.Empty;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
