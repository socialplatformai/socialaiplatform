using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Domain;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options, ICurrentWorkspace? current = null)
    : DbContext(options)
{
    private readonly ICurrentWorkspace? _current = current;

    public DbSet<Workspace> Workspaces => Set<Workspace>();
    public DbSet<Brand> Brands => Set<Brand>();
    public DbSet<Campaign> Campaigns => Set<Campaign>();
    public DbSet<User> Users => Set<User>();
    public DbSet<BrandKit> BrandKits => Set<BrandKit>();
    public DbSet<Competitor> Competitors => Set<Competitor>();
    public DbSet<VisualReference> VisualReferences => Set<VisualReference>();
    public DbSet<Pauta> Pautas => Set<Pauta>();
    public DbSet<Attachment> Attachments => Set<Attachment>();
    public DbSet<Content> Contents => Set<Content>();
    public DbSet<ContentSlide> ContentSlides => Set<ContentSlide>();
    public DbSet<Approval> Approvals => Set<Approval>();
    public DbSet<ScheduledPost> ScheduledPosts => Set<ScheduledPost>();
    public DbSet<PublishLog> PublishLogs => Set<PublishLog>();
    public DbSet<InstagramAccount> InstagramAccounts => Set<InstagramAccount>();
    public DbSet<PerformanceMetric> PerformanceMetrics => Set<PerformanceMetric>();
    public DbSet<IdeaCandidate> IdeaCandidates => Set<IdeaCandidate>();
    public DbSet<Secret> Secrets => Set<Secret>();
    public DbSet<Budget> Budgets => Set<Budget>();
    public DbSet<SpendEntry> SpendEntries => Set<SpendEntry>();
    public DbSet<Template> Templates => Set<Template>();              // D1 (ADR-0008): templates em dados
    public DbSet<BrandTemplate> BrandTemplates => Set<BrandTemplate>(); // D2: curadoria por marca
    public DbSet<BrandLibraryItem> BrandLibraryItems => Set<BrandLibraryItem>(); // E1: biblioteca de marca
    public DbSet<OAuthState> OAuthStates => Set<OAuthState>(); // D1: anti-CSRF (não tenant-scoped)
    public DbSet<SystemSetting> SystemSettings => Set<SystemSetting>(); // config global de deploy (não-tenant)
    public DbSet<UserInvite> UserInvites => Set<UserInvite>();   // B1 (ADR-0010): convites de acesso
    public DbSet<AuditEntry> AuditEntries => Set<AuditEntry>();  // C2 (ADR-0010): trilha de auditoria
    public DbSet<PromptOverride> PromptOverrides => Set<PromptOverride>(); // ADR-0013: override de prompt/agente
    public DbSet<MetricWeightConfig> MetricWeightConfigs => Set<MetricWeightConfig>(); // Fase 3 (task 3.1): pesos de "bom post"

    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);

        // ── Workspace / User ────────────────────────────────────────────────
        b.Entity<Workspace>(e =>
        {
            e.HasMany(w => w.Users).WithOne(u => u.Workspace!).HasForeignKey(u => u.WorkspaceId);
            e.HasOne(w => w.BrandKit).WithOne(k => k.Workspace!).HasForeignKey<BrandKit>(k => k.WorkspaceId);
            // A1 (ADR-0010): Workspace ↔ InstagramAccount agora é 1:N (era 1:1 — o HasOne/WithOne
            // impunha UNIQUE(WorkspaceId) e travava N contas/marca). A cardinalidade fina (1:N por
            // marca) já estava no relacionamento Brand↔InstagramAccount abaixo.
            e.HasMany(w => w.InstagramAccounts).WithOne(a => a.Workspace!).HasForeignKey(a => a.WorkspaceId);
            e.HasOne(w => w.Budget).WithOne(x => x.Workspace!).HasForeignKey<Budget>(x => x.WorkspaceId);
            e.HasMany(w => w.Brands).WithOne(br => br.Workspace!).HasForeignKey(br => br.WorkspaceId);
        });

        // ── E1: Brand (sub-chave dentro do workspace) ───────────────────────
        // Índice por workspace (lista de marcas do tenant é a consulta comum).
        b.Entity<Brand>().HasIndex(br => br.WorkspaceId);
        // CONTRACT (E1-c): BrandId é NOT NULL (FK obrigatória). Delete = Restrict —
        // apagar uma marca com dados é bloqueado (o controller já barra remover a
        // última marca; remover marca não-vazia exige mover/limpar antes — sem cascata
        // destrutiva). WorkspaceId permanece como chave de isolamento.
        // E2 (ADR-0005): cardinalidade fina finalizada. BrandKit 1:1 Brand (unique index
        // em BrandId — uma config por marca); InstagramAccount permanece 1:N (DP2, sem
        // unique). WorkspaceId segue a chave de isolamento (não muda — ADR-0002).
        b.Entity<BrandKit>().HasOne(k => k.Brand).WithMany().HasForeignKey(k => k.BrandId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<BrandKit>().HasIndex(k => k.BrandId).IsUnique();
        b.Entity<Competitor>().HasOne(c => c.Brand).WithMany().HasForeignKey(c => c.BrandId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<InstagramAccount>().HasOne(a => a.Brand).WithMany().HasForeignKey(a => a.BrandId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Pauta>().HasOne(p => p.Brand).WithMany().HasForeignKey(p => p.BrandId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Content>().HasOne(c => c.Brand).WithMany().HasForeignKey(c => c.BrandId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Campaign>().HasOne(c => c.Brand).WithMany().HasForeignKey(c => c.BrandId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<BrandTemplate>().HasOne(x => x.Brand).WithMany().HasForeignKey(x => x.BrandId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<BrandLibraryItem>().HasOne(x => x.Brand).WithMany().HasForeignKey(x => x.BrandId).OnDelete(DeleteBehavior.Restrict);

        // ── D (ADR-0008): templates em dados + curadoria por marca ──────────
        // Key é o id estável do template no workspace — único por workspace (idempotência do
        // seed built-in; evita 2 "product-launch" no mesmo tenant). BrandTemplate aponta p/
        // Template (Restrict: não apagar template curado). Curadoria única por (Brand, Template).
        b.Entity<Template>().HasIndex(t => new { t.WorkspaceId, t.Key }).IsUnique();
        b.Entity<BrandTemplate>().HasOne(x => x.Template).WithMany().HasForeignKey(x => x.TemplateId).OnDelete(DeleteBehavior.Restrict);
        b.Entity<BrandTemplate>().HasIndex(x => new { x.BrandId, x.TemplateId }).IsUnique();
        // Pauta.ForcedTemplateId (D3): FK opcional p/ Template, sem cascata (apagar template não
        // apaga pauta — fica órfão e o agents cai no fallback do registry, degradado honesto).
        b.Entity<Pauta>().HasOne<Template>().WithMany().HasForeignKey(p => p.ForcedTemplateId).OnDelete(DeleteBehavior.SetNull);
        // E1: biblioteca de marca — consulta comum é por (marca, tipo).
        b.Entity<BrandLibraryItem>().HasIndex(x => new { x.BrandId, x.Kind });

        // ADR-0013: 1 override por (workspace, agente). Único como o Template — o upsert do
        // PromptOverridesController depende deste índice para não duplicar a chave no tenant.
        b.Entity<PromptOverride>().HasIndex(p => new { p.WorkspaceId, p.AgentKey }).IsUnique();

        b.Entity<User>(e =>
        {
            // Índice tenant-scoped (consultas por workspace) — não-único.
            e.HasIndex(u => new { u.WorkspaceId, u.Email });
            // D2: a unicidade GLOBAL de e-mail é um índice FUNCIONAL em lower("Email"),
            // que o EF não consegue expressar no modelo. É criado por SQL na migration
            // AddGlobalUniqueEmail (CREATE UNIQUE INDEX ... (lower("Email"))). O e-mail é
            // sempre gravado normalizado (lower) pelo AuthController — ver NormalizeEmail.
        });

        // ── Relações 1:N ────────────────────────────────────────────────────
        b.Entity<BrandKit>().HasMany(k => k.VisualReferences).WithOne(v => v.BrandKit!).HasForeignKey(v => v.BrandKitId);
        b.Entity<Pauta>().HasMany(p => p.Attachments).WithOne(a => a.Pauta!).HasForeignKey(a => a.PautaId);
        b.Entity<Content>().HasMany(c => c.Slides).WithOne(s => s.Content!).HasForeignKey(s => s.ContentId);
        b.Entity<Content>().HasOne(c => c.Approval).WithOne(a => a.Content!).HasForeignKey<Approval>(a => a.ContentId);
        b.Entity<Content>().HasOne(c => c.ScheduledPost).WithOne(s => s.Content!).HasForeignKey<ScheduledPost>(s => s.ContentId);
        b.Entity<Content>().HasOne(c => c.Pauta).WithMany().HasForeignKey(c => c.PautaId).OnDelete(DeleteBehavior.SetNull);
        b.Entity<Content>().HasOne(c => c.Campaign).WithMany().HasForeignKey(c => c.CampaignId).OnDelete(DeleteBehavior.SetNull);
        b.Entity<Workspace>().HasMany(w => w.Campaigns).WithOne(c => c.Workspace!).HasForeignKey(c => c.WorkspaceId);
        b.Entity<ScheduledPost>().HasMany(s => s.PublishLogs).WithOne(l => l.ScheduledPost!).HasForeignKey(l => l.ScheduledPostId);
        b.Entity<Budget>().HasMany(x => x.Spend).WithOne(s => s.Budget!).HasForeignKey(s => s.BudgetId);

        // Idempotency key única por ScheduledPost (AM-5/R-8).
        b.Entity<ScheduledPost>().HasIndex(s => s.IdempotencyKey).IsUnique();

        // F4/C2 (ADR-0014): dedup ATÔMICO de publicação. Antes, o dispatch era SELECT(!Dispatched)+
        // INSERT(PublishLog) não-atômico — dois ticks/instâncias concorrentes podiam enfileirar o
        // MESMO ScheduledPost duas vezes → dupla publicação no Instagram. Índice único filtrado em
        // (ScheduledPostId) sobre os logs ATIVOS (Pending=0 ou Success=1) garante NO MÁXIMO um log
        // ativo por post: a 2ª inserção concorrente falha com DbUpdateException (rede final, igual ao
        // dedup de slides). Result=Error(2)/Skipped(3) ficam FORA do filtro → uma re-tentativa (que
        // recria Pending após um Error) é permitida. Postgres: índice parcial com HasFilter.
        b.Entity<PublishLog>()
            .HasIndex(l => l.ScheduledPostId)
            .IsUnique()
            .HasFilter("\"Result\" IN (0, 1)");

        // D1: OAuthState — PK no próprio state (aleatório, uso único). Não-tenant.
        b.Entity<OAuthState>(e =>
        {
            e.HasKey(s => s.State);
            e.Property(s => s.State).HasMaxLength(64);
            e.HasIndex(s => s.ExpiresAt); // varredura de expirados barata
        });

        // Config global de deploy — PK na própria Key. Não-tenant (fora do ApplyTenantFilter).
        b.Entity<SystemSetting>(e =>
        {
            e.HasKey(s => s.Key);
            e.Property(s => s.Key).HasMaxLength(128);
        });

        // ── FASE 8 (ADR-0010) ───────────────────────────────────────────────
        // A3: Content.TargetInstagramAccountId — FK opcional p/ InstagramAccount, SetNull
        // (desconectar a conta zera o override, não apaga o conteúdo → cai no fallback).
        // Sem nav-collection inversa (WithMany() vazio): a conta não precisa listar conteúdos.
        b.Entity<Content>()
            .HasOne(c => c.TargetInstagramAccount).WithMany()
            .HasForeignKey(c => c.TargetInstagramAccountId)
            .OnDelete(DeleteBehavior.SetNull);

        // A5: default IANA do fuso no nível do banco (workspaces legados herdam fuso VÁLIDO).
        // Explícito no modelo p/ o snapshot bater com a migration (sem drift no próximo add).
        b.Entity<Workspace>().Property(w => w.TimeZoneId).HasDefaultValue("America/Sao_Paulo");

        // B1: UserInvite — Token em índice ÚNICO (uso único, anti-replay como o OAuthState).
        b.Entity<UserInvite>().HasIndex(i => i.Token).IsUnique();

        // C2: AuditEntry — consultas comuns por workspace+tempo (lista paginada decrescente).
        b.Entity<AuditEntry>().HasIndex(a => new { a.WorkspaceId, a.OccurredAt });

        // G2: slide único por (ContentId, Index) — a 2ª escrita concorrente na janela do
        // 'done' falha com DbUpdateException (tratada como idempotente: já persistido).
        b.Entity<ContentSlide>().HasIndex(s => new { s.ContentId, s.Index }).IsUnique();

        // ── Índices em workspace_id + status (consultas tenant-scoped) ──────
        b.Entity<Pauta>().HasIndex(p => new { p.WorkspaceId, p.Status, p.Priority });
        b.Entity<Content>().HasIndex(c => new { c.WorkspaceId, c.Status });
        b.Entity<ScheduledPost>().HasIndex(s => new { s.WorkspaceId, s.ScheduledFor, s.Dispatched });

        // ── Precisão decimal de valores monetários ──────────────────────────
        b.Entity<Budget>().Property(x => x.MonthlyCapUsd).HasPrecision(12, 2);
        // F5 (Eixo D): AmountUsd passa a 4 casas — o custo REAL por token×modelo de UMA geração é
        // sub-centavo (ex.: 0.0316 USD). Com 2 casas, o gasto individual zeraria ou perderia fidelidade;
        // 4 casas preservam o acumulado correto no painel de uso e no teto mensal.
        b.Entity<SpendEntry>().Property(x => x.AmountUsd).HasPrecision(12, 4);

        // ── B4 (ADR-0009): dedupe de gasto de geração ───────────────────────
        // FK opcional SpendEntry→Content (SetNull: apagar o Content não apaga o histórico de gasto).
        b.Entity<SpendEntry>().HasOne(s => s.Content).WithMany().HasForeignKey(s => s.ContentId).OnDelete(DeleteBehavior.SetNull);
        // Índice único FILTRADO (ContentId, Reason) WHERE ContentId IS NOT NULL: garante 1 SpendEntry
        // por (geração, motivo) — poll do cliente e reconciliador do worker nunca duplicam. Entries do
        // loop autônomo (ContentId null) ficam FORA do índice (não colidem entre si).
        b.Entity<SpendEntry>().HasIndex(s => new { s.ContentId, s.Reason })
            .IsUnique()
            .HasFilter("\"ContentId\" IS NOT NULL");
        // F5 (Eixo D): índice por JobId (correlation id) — permite rastrear o gasto de um job de ponta a
        // ponta numa query. NÃO único (uma geração pode gerar texto+imagem como entries distintas no futuro).
        b.Entity<SpendEntry>().HasIndex(s => s.JobId);

        // ── Global query filter por workspace (isolamento tenant — T-2.2.2) ─
        // Aplica em todas as TenantEntity. Quando não há workspace (migrations,
        // jobs sistêmicos), _current é null e o filtro deixa passar.
        ApplyTenantFilter(b);
    }

    private void ApplyTenantFilter(ModelBuilder b)
    {
        b.Entity<Brand>().HasQueryFilter(x => _current!.WorkspaceId == null || x.WorkspaceId == _current!.WorkspaceId);
        b.Entity<Campaign>().HasQueryFilter(x => _current!.WorkspaceId == null || x.WorkspaceId == _current!.WorkspaceId);
        b.Entity<User>().HasQueryFilter(x => _current!.WorkspaceId == null || x.WorkspaceId == _current!.WorkspaceId);
        b.Entity<BrandKit>().HasQueryFilter(x => _current!.WorkspaceId == null || x.WorkspaceId == _current!.WorkspaceId);
        b.Entity<Competitor>().HasQueryFilter(x => _current!.WorkspaceId == null || x.WorkspaceId == _current!.WorkspaceId);
        b.Entity<VisualReference>().HasQueryFilter(x => _current!.WorkspaceId == null || x.WorkspaceId == _current!.WorkspaceId);
        b.Entity<Pauta>().HasQueryFilter(x => _current!.WorkspaceId == null || x.WorkspaceId == _current!.WorkspaceId);
        b.Entity<Attachment>().HasQueryFilter(x => _current!.WorkspaceId == null || x.WorkspaceId == _current!.WorkspaceId);
        b.Entity<Content>().HasQueryFilter(x => _current!.WorkspaceId == null || x.WorkspaceId == _current!.WorkspaceId);
        b.Entity<ContentSlide>().HasQueryFilter(x => _current!.WorkspaceId == null || x.WorkspaceId == _current!.WorkspaceId);
        b.Entity<Approval>().HasQueryFilter(x => _current!.WorkspaceId == null || x.WorkspaceId == _current!.WorkspaceId);
        b.Entity<ScheduledPost>().HasQueryFilter(x => _current!.WorkspaceId == null || x.WorkspaceId == _current!.WorkspaceId);
        b.Entity<PublishLog>().HasQueryFilter(x => _current!.WorkspaceId == null || x.WorkspaceId == _current!.WorkspaceId);
        b.Entity<InstagramAccount>().HasQueryFilter(x => _current!.WorkspaceId == null || x.WorkspaceId == _current!.WorkspaceId);
        b.Entity<PerformanceMetric>().HasQueryFilter(x => _current!.WorkspaceId == null || x.WorkspaceId == _current!.WorkspaceId);
        b.Entity<IdeaCandidate>().HasQueryFilter(x => _current!.WorkspaceId == null || x.WorkspaceId == _current!.WorkspaceId);
        b.Entity<Secret>().HasQueryFilter(x => _current!.WorkspaceId == null || x.WorkspaceId == _current!.WorkspaceId);
        b.Entity<Budget>().HasQueryFilter(x => _current!.WorkspaceId == null || x.WorkspaceId == _current!.WorkspaceId);
        b.Entity<SpendEntry>().HasQueryFilter(x => _current!.WorkspaceId == null || x.WorkspaceId == _current!.WorkspaceId);
        // D/E (ADR-0008): entidades novas SÃO tenant-scoped — sem isto, vazariam entre workspaces.
        b.Entity<Template>().HasQueryFilter(x => _current!.WorkspaceId == null || x.WorkspaceId == _current!.WorkspaceId);
        b.Entity<BrandTemplate>().HasQueryFilter(x => _current!.WorkspaceId == null || x.WorkspaceId == _current!.WorkspaceId);
        b.Entity<BrandLibraryItem>().HasQueryFilter(x => _current!.WorkspaceId == null || x.WorkspaceId == _current!.WorkspaceId);
        // FASE 8 (ADR-0010): UserInvite e AuditEntry SÃO tenant-scoped — invariante E.1.
        b.Entity<UserInvite>().HasQueryFilter(x => _current!.WorkspaceId == null || x.WorkspaceId == _current!.WorkspaceId);
        b.Entity<AuditEntry>().HasQueryFilter(x => _current!.WorkspaceId == null || x.WorkspaceId == _current!.WorkspaceId);
        // ADR-0013: PromptOverride É tenant-scoped — sem isto, o override de um workspace vazaria
        // para outro (e o editor de prompt de A leria o texto de B). Invariante das 3 camadas.
        b.Entity<PromptOverride>().HasQueryFilter(x => _current!.WorkspaceId == null || x.WorkspaceId == _current!.WorkspaceId);
        // Fase 3 (task 3.1): MetricWeightConfig É tenant-scoped (uma régua de "bom post" por workspace).
        // Índice único em WorkspaceId garante 1 linha/workspace.
        b.Entity<MetricWeightConfig>().HasQueryFilter(x => _current!.WorkspaceId == null || x.WorkspaceId == _current!.WorkspaceId);
        b.Entity<MetricWeightConfig>().HasIndex(x => x.WorkspaceId).IsUnique();
    }

    // D8: a guarda de escrita por tenant agora vive no TenantSaveInterceptor, que cobre
    // SaveChanges (síncrono) E SaveChangesAsync — o override antigo só cobria o async,
    // deixando o caminho síncrono sem proteção (furo latente). Registrado abaixo.
    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        base.OnConfiguring(optionsBuilder);
        optionsBuilder.AddInterceptors(new TenantSaveInterceptor(_current));
    }
}
