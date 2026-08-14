using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Features.Learning;
using SocialAi.Api.Features.Notifications;
using SocialAi.Api.Features.Publishing;
using SocialAi.Api.Infrastructure;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// FASE 7 Bloco C (ADR-0009): operação diária. C1 (aprovar/rejeitar/excluir em lote),
/// C2 (listar falhas + retry manual), C3 (insights de aprendizado), C4 (notificações
/// derivadas de estado). Exercita a lógica de estado da API direto nos controllers,
/// com o mesmo padrão de seed/factory de Fase7IterarTests/CrossBrandEndpointTests.
/// </summary>
public class Fase7OperacaoTests
{
    // ── Factories de controller (instanciação direta + HttpContext quando preciso) ──
    private static SocialAi.Api.Features.Approval.ApprovalBatchController BatchApproval(TestDb db, AppDbContext ctx, Guid brand) =>
        new(ctx, db.Current, new BrandResolver(ctx, new FakeCurrentBrand { BrandId = brand }))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

    private static SocialAi.Api.Features.Content.ContentBatchController BatchContent(TestDb db, AppDbContext ctx, Guid brand) =>
        new(ctx, db.Current, new BrandResolver(ctx, new FakeCurrentBrand { BrandId = brand }))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

    private static PublishingController Publishing(TestDb db, AppDbContext ctx, Guid brand) =>
        new(ctx, db.Current, new BrandResolver(ctx, new FakeCurrentBrand { BrandId = brand }))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

    private static NotificationsController Notifications(TestDb db, AppDbContext ctx, Guid brand) =>
        new(ctx, db.Current, new BrandResolver(ctx, new FakeCurrentBrand { BrandId = brand }))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

    // insights é workspace-scoped (não usa BrandResolver no caminho), mas o ctor exige os 4.
    private static LearningController Learning(TestDb db, AppDbContext ctx, Guid brand) =>
        new(db.Current, new PerformanceAnalyzer(ctx),
            new BrandResolver(ctx, new FakeCurrentBrand { BrandId = brand }),
            new RejectFeedbackService(ctx))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

    // ── Seed helpers (mesma forma de Fase7IterarTests) ──────────────────────────
    private static (Guid ws, Guid brand) SeedWsBrand(TestDb db)
    {
        var ws = Guid.NewGuid(); var brand = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using var seed = db.NewContext();
        seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS", DefaultApprovalMode = ApprovalMode.Manual });
        seed.Brands.Add(new Brand { Id = brand, WorkspaceId = ws, Name = "Marca" });
        seed.SaveChanges();
        return (ws, brand);
    }

    private static Guid AddBrand(TestDb db, Guid ws)
    {
        var id = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using var s = db.NewContext();
        s.Brands.Add(new Brand { Id = id, WorkspaceId = ws, Name = "Outra" });
        s.SaveChanges();
        return id;
    }

    private static Guid AddContent(TestDb db, Guid ws, Guid brand, ContentStatus status)
    {
        var id = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using var ctx = db.NewContext();
        ctx.Contents.Add(new Content { Id = id, WorkspaceId = ws, BrandId = brand, Type = ContentType.Post, Status = status });
        ctx.SaveChanges();
        return id;
    }

    // Semeia ScheduledPost + PublishLog para um Content; devolve o id do log.
    private static Guid AddPublishLog(TestDb db, Guid ws, Guid contentId, PublishResult result, int attempts = 1, string? error = "boom")
    {
        var logId = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using var ctx = db.NewContext();
        var sp = new ScheduledPost
        {
            Id = Guid.NewGuid(), WorkspaceId = ws, ContentId = contentId,
            ScheduledFor = DateTimeOffset.UtcNow, Dispatched = true,
        };
        ctx.ScheduledPosts.Add(sp);
        ctx.PublishLogs.Add(new PublishLog
        {
            Id = logId, WorkspaceId = ws, ScheduledPostId = sp.Id,
            Result = result, Attempts = attempts, Error = result == PublishResult.Error ? error : null,
            NextRetryAt = result == PublishResult.Error ? DateTimeOffset.UtcNow : null,
        });
        ctx.SaveChanges();
        return logId;
    }

    private static void AddPerformanceMetric(TestDb db, Guid ws, Guid contentId, int engagement = 100)
    {
        db.Current.WorkspaceId = null;
        using var ctx = db.NewContext();
        ctx.PerformanceMetrics.Add(new PerformanceMetric
        {
            Id = Guid.NewGuid(), WorkspaceId = ws, ContentId = contentId,
            Reach = 1000, Engagement = engagement, Likes = 50, Saves = 10,
        });
        ctx.SaveChanges();
    }

    // ════════════════════════════════════════════════════════════════════════════
    // C1 — batch aprovar/rejeitar
    // ════════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Batch_aprovar_em_lote_torna_tudo_approved()
    {
        using var db = new TestDb();
        var (ws, brand) = SeedWsBrand(db);
        var c1 = AddContent(db, ws, brand, ContentStatus.Draft);
        var c2 = AddContent(db, ws, brand, ContentStatus.PendingApproval);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await BatchApproval(db, ctx, brand)
            .Batch(new SocialAi.Api.Features.Approval.BatchApprovalRequest(new[] { c1, c2 }, "approve", null));
        var ok = Assert.IsType<OkObjectResult>(res.Result);
        var body = Assert.IsType<SocialAi.Api.Features.Approval.BatchResult>(ok.Value);
        Assert.Equal(2, body.Applied.Count());
        Assert.Empty(body.Skipped);

        using var verify = db.NewContext();
        Assert.Equal(ContentStatus.Approved, (await verify.Contents.FindAsync(c1))!.Status);
        Assert.Equal(ContentStatus.Approved, (await verify.Contents.FindAsync(c2))!.Status);
    }

    [Fact]
    public async Task Batch_rejeitar_em_lote_persiste_comentario_no_approval()
    {
        using var db = new TestDb();
        var (ws, brand) = SeedWsBrand(db);
        var c1 = AddContent(db, ws, brand, ContentStatus.Draft);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await BatchApproval(db, ctx, brand)
            .Batch(new SocialAi.Api.Features.Approval.BatchApprovalRequest(new[] { c1 }, "reject", "fora do tom"));
        var ok = Assert.IsType<OkObjectResult>(res.Result);
        var body = Assert.IsType<SocialAi.Api.Features.Approval.BatchResult>(ok.Value);
        Assert.Single(body.Applied);

        using var verify = db.NewContext();
        Assert.Equal(ContentStatus.Rejected, (await verify.Contents.FindAsync(c1))!.Status);
        var approval = await verify.Approvals.FirstAsync(a => a.ContentId == c1);
        Assert.False(approval.Approved);
        Assert.Equal("fora do tom", approval.Comments);
    }

    [Fact]
    public async Task Batch_pula_outra_marca_e_estado_nao_decidivel_sem_alterar()
    {
        using var db = new TestDb();
        var (ws, brand) = SeedWsBrand(db);
        var outraMarca = AddBrand(db, ws);
        var publicado = AddContent(db, ws, brand, ContentStatus.Published);     // estado não-decidível
        var deOutraMarca = AddContent(db, ws, outraMarca, ContentStatus.Draft); // marca errada
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await BatchApproval(db, ctx, brand)
            .Batch(new SocialAi.Api.Features.Approval.BatchApprovalRequest(new[] { publicado, deOutraMarca }, "approve", null));
        var ok = Assert.IsType<OkObjectResult>(res.Result);
        var body = Assert.IsType<SocialAi.Api.Features.Approval.BatchResult>(ok.Value);
        Assert.Empty(body.Applied);
        Assert.Equal(2, body.Skipped.Count());

        using var verify = db.NewContext();
        Assert.Equal(ContentStatus.Published, (await verify.Contents.FindAsync(publicado))!.Status);
        Assert.Equal(ContentStatus.Draft, (await verify.Contents.FindAsync(deOutraMarca))!.Status);
    }

    [Fact]
    public async Task Batch_acao_invalida_retorna_400()
    {
        using var db = new TestDb();
        var (ws, brand) = SeedWsBrand(db);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await BatchApproval(db, ctx, brand)
            .Batch(new SocialAi.Api.Features.Approval.BatchApprovalRequest(Array.Empty<Guid>(), "foo", null));
        var obj = Assert.IsType<ObjectResult>(res.Result);
        Assert.Equal(400, obj.StatusCode);
    }

    // ════════════════════════════════════════════════════════════════════════════
    // C1 — batch-delete
    // ════════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task BatchDelete_remove_da_marca_e_pula_outras()
    {
        using var db = new TestDb();
        var (ws, brand) = SeedWsBrand(db);
        var outraMarca = AddBrand(db, ws);
        var daMarca = AddContent(db, ws, brand, ContentStatus.Draft);
        var deOutra = AddContent(db, ws, outraMarca, ContentStatus.Draft);
        var inexistente = Guid.NewGuid();
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await BatchContent(db, ctx, brand)
            .BatchDelete(new SocialAi.Api.Features.Content.BatchDeleteRequest(new[] { daMarca, deOutra, inexistente }));
        var ok = Assert.IsType<OkObjectResult>(res.Result);
        var body = Assert.IsType<SocialAi.Api.Features.Content.BatchResult>(ok.Value);
        Assert.Single(body.Applied);
        Assert.Equal(2, body.Skipped.Count());

        using var verify = db.NewContext();
        Assert.Null(await verify.Contents.FindAsync(daMarca));            // sumiu
        Assert.NotNull(await verify.Contents.FindAsync(deOutra));         // intacto
    }

    // ════════════════════════════════════════════════════════════════════════════
    // C2 — failures
    // ════════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Failures_lista_apenas_falhas_da_marca_atual()
    {
        using var db = new TestDb();
        var (ws, brand) = SeedWsBrand(db);
        var outraMarca = AddBrand(db, ws);
        var conteudoDaMarca = AddContent(db, ws, brand, ContentStatus.Failed);
        var logDaMarca = AddPublishLog(db, ws, conteudoDaMarca, PublishResult.Error, attempts: 2);
        // Falha de OUTRA marca → NÃO deve aparecer.
        var conteudoOutra = AddContent(db, ws, outraMarca, ContentStatus.Failed);
        AddPublishLog(db, ws, conteudoOutra, PublishResult.Error);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await Publishing(db, ctx, brand).Failures();
        var ok = Assert.IsType<OkObjectResult>(res.Result);
        var lista = Assert.IsAssignableFrom<IEnumerable<FailureDto>>(ok.Value).ToList();

        var dto = Assert.Single(lista);
        Assert.Equal(logDaMarca, dto.LogId);
        Assert.Equal(conteudoDaMarca, dto.ContentId);
        Assert.Equal("boom", dto.Error);
        Assert.Equal(2, dto.Attempts);
    }

    // ════════════════════════════════════════════════════════════════════════════
    // C2 — retry
    // ════════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Retry_reseta_log_para_pending_e_content_para_approved()
    {
        using var db = new TestDb();
        var (ws, brand) = SeedWsBrand(db);
        var content = AddContent(db, ws, brand, ContentStatus.Failed);
        var logId = AddPublishLog(db, ws, content, PublishResult.Error, attempts: 3);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await Publishing(db, ctx, brand).Retry(logId);
        Assert.IsType<NoContentResult>(res);

        using var verify = db.NewContext();
        var log = await verify.PublishLogs.FindAsync(logId);
        Assert.Equal(PublishResult.Pending, log!.Result);
        Assert.Equal(0, log.Attempts);
        Assert.Null(log.Error);
        Assert.Null(log.NextRetryAt);
        Assert.Equal(ContentStatus.Approved, (await verify.Contents.FindAsync(content))!.Status);
    }

    [Fact]
    public async Task Retry_de_conteudo_ja_publicado_retorna_409()
    {
        using var db = new TestDb();
        var (ws, brand) = SeedWsBrand(db);
        var content = AddContent(db, ws, brand, ContentStatus.Published);
        var logId = AddPublishLog(db, ws, content, PublishResult.Error);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await Publishing(db, ctx, brand).Retry(logId);
        var obj = Assert.IsType<ObjectResult>(res);
        Assert.Equal(409, obj.StatusCode);
    }

    [Fact]
    public async Task Retry_de_log_nao_error_retorna_409()
    {
        using var db = new TestDb();
        var (ws, brand) = SeedWsBrand(db);
        var content = AddContent(db, ws, brand, ContentStatus.Approved);
        var logId = AddPublishLog(db, ws, content, PublishResult.Pending);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await Publishing(db, ctx, brand).Retry(logId);
        var obj = Assert.IsType<ObjectResult>(res);
        Assert.Equal(409, obj.StatusCode);
    }

    [Fact]
    public async Task Retry_de_outra_marca_retorna_404()
    {
        using var db = new TestDb();
        var (ws, brand) = SeedWsBrand(db);
        var outraMarca = AddBrand(db, ws);
        var content = AddContent(db, ws, outraMarca, ContentStatus.Failed);
        var logId = AddPublishLog(db, ws, content, PublishResult.Error);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        // No contexto da marca atual, retry de log de OUTRA marca → 404 (não vaza).
        var res = await Publishing(db, ctx, brand).Retry(logId);
        Assert.IsType<NotFoundResult>(res);
    }

    // ════════════════════════════════════════════════════════════════════════════
    // C3 — insights (workspace-scoped)
    // ════════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Insights_com_menos_de_3_metricas_marca_insuficiente()
    {
        using var db = new TestDb();
        var (ws, brand) = SeedWsBrand(db);
        var c1 = AddContent(db, ws, brand, ContentStatus.Published);
        var c2 = AddContent(db, ws, brand, ContentStatus.Published);
        AddPerformanceMetric(db, ws, c1);
        AddPerformanceMetric(db, ws, c2);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await Learning(db, ctx, brand).Insights(default);
        var ok = Assert.IsType<OkObjectResult>(res);
        var insights = Assert.IsType<LearningInsights>(ok.Value);
        Assert.True(insights.InsufficientData);
        Assert.Equal(2, insights.SampleSize);
    }

    [Fact]
    public async Task Insights_com_3_ou_mais_metricas_retorna_amostra_suficiente()
    {
        using var db = new TestDb();
        var (ws, brand) = SeedWsBrand(db);
        var c1 = AddContent(db, ws, brand, ContentStatus.Published);
        var c2 = AddContent(db, ws, brand, ContentStatus.Published);
        var c3 = AddContent(db, ws, brand, ContentStatus.Published);
        AddPerformanceMetric(db, ws, c1, engagement: 300);
        AddPerformanceMetric(db, ws, c2, engagement: 200);
        AddPerformanceMetric(db, ws, c3, engagement: 100);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await Learning(db, ctx, brand).Insights(default);
        var ok = Assert.IsType<OkObjectResult>(res);
        var insights = Assert.IsType<LearningInsights>(ok.Value);
        Assert.False(insights.InsufficientData);
        Assert.Equal(3, insights.SampleSize);
    }

    // ════════════════════════════════════════════════════════════════════════════
    // C4 — notifications
    // ════════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Notifications_pendentes_geram_um_item_approval_pending()
    {
        using var db = new TestDb();
        var (ws, brand) = SeedWsBrand(db);
        AddContent(db, ws, brand, ContentStatus.PendingApproval);
        AddContent(db, ws, brand, ContentStatus.PendingApproval);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await Notifications(db, ctx, brand).Get();
        var ok = Assert.IsType<OkObjectResult>(res.Result);
        var lista = Assert.IsAssignableFrom<IEnumerable<NotificationDto>>(ok.Value).ToList();
        var item = Assert.Single(lista);
        Assert.Equal("approval_pending", item.Kind);
    }

    [Fact]
    public async Task Notifications_falha_de_publicacao_gera_publish_failed_com_ref()
    {
        using var db = new TestDb();
        var (ws, brand) = SeedWsBrand(db);
        var content = AddContent(db, ws, brand, ContentStatus.Failed);
        AddPublishLog(db, ws, content, PublishResult.Error);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await Notifications(db, ctx, brand).Get();
        var ok = Assert.IsType<OkObjectResult>(res.Result);
        var lista = Assert.IsAssignableFrom<IEnumerable<NotificationDto>>(ok.Value).ToList();
        var item = Assert.Single(lista, n => n.Kind == "publish_failed");
        Assert.Equal(content.ToString(), item.Ref);
    }

    [Fact]
    public async Task Notifications_token_ig_expirando_gera_ig_token_expiring()
    {
        using var db = new TestDb();
        var (ws, brand) = SeedWsBrand(db);
        db.Current.WorkspaceId = null;
        using (var s = db.NewContext())
        {
            s.InstagramAccounts.Add(new InstagramAccount
            {
                Id = Guid.NewGuid(), WorkspaceId = ws, BrandId = brand,
                IgUserId = "ig-1", IsConnected = true,
                EncryptedAccessToken = "x",
                TokenExpiresAt = DateTimeOffset.UtcNow.AddDays(3), // < now + 7d
            });
            s.SaveChanges();
        }
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await Notifications(db, ctx, brand).Get();
        var ok = Assert.IsType<OkObjectResult>(res.Result);
        var lista = Assert.IsAssignableFrom<IEnumerable<NotificationDto>>(ok.Value).ToList();
        Assert.Single(lista, n => n.Kind == "ig_token_expiring");
    }

    [Fact]
    public async Task Notifications_sem_estado_relevante_retorna_lista_vazia()
    {
        using var db = new TestDb();
        var (ws, brand) = SeedWsBrand(db);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await Notifications(db, ctx, brand).Get();
        var ok = Assert.IsType<OkObjectResult>(res.Result);
        var lista = Assert.IsAssignableFrom<IEnumerable<NotificationDto>>(ok.Value);
        Assert.Empty(lista);
    }
}
