using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Features.Learning;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// FASE 7 Bloco A (ADR-0009): A4 — expor o último motivo de rejeição à UI via
/// GET /api/learning/reject-feedback. A regra real vive em RejectFeedbackService (dono único);
/// aqui cobrimos o contrato do endpoint: caminho feliz, "último vence", ausência (null, não 404)
/// e o isolamento cross-brand (C6) — feedback de outra marca nunca vaza.
/// </summary>
public class Fase7RejectFeedbackTests
{
    private static LearningController Ctrl(TestDb db, AppDbContext ctx, Guid brand) =>
        new(
            db.Current, new PerformanceAnalyzer(ctx),
            new BrandResolver(ctx, new FakeCurrentBrand { BrandId = brand }),
            new RejectFeedbackService(ctx))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

    private static (Guid ws, Guid brand, Guid pautaId) SeedPauta(TestDb db)
    {
        var ws = Guid.NewGuid(); var brand = Guid.NewGuid(); var pautaId = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using var seed = db.NewContext();
        seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS", DefaultApprovalMode = ApprovalMode.Manual });
        seed.Brands.Add(new Brand { Id = brand, WorkspaceId = ws, Name = "Marca" });
        seed.Pautas.Add(new Pauta { Id = pautaId, WorkspaceId = ws, BrandId = brand, Title = "P" });
        seed.SaveChanges();
        return (ws, brand, pautaId);
    }

    private static Guid AddContent(TestDb db, Guid ws, Guid brand, Guid pautaId)
    {
        var id = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using var ctx = db.NewContext();
        ctx.Contents.Add(new Content { Id = id, WorkspaceId = ws, BrandId = brand, PautaId = pautaId, Type = ContentType.Post, Status = ContentStatus.Rejected });
        ctx.SaveChanges();
        return id;
    }

    private static void AddRejeicao(TestDb db, Guid ws, Guid contentId, string comments, DateTimeOffset decidedAt)
    {
        db.Current.WorkspaceId = null;
        using var ctx = db.NewContext();
        ctx.Approvals.Add(new Approval { Id = Guid.NewGuid(), WorkspaceId = ws, ContentId = contentId, Approved = false, Comments = comments, DecidedAt = decidedAt });
        ctx.SaveChanges();
    }

    // ── Caminho feliz: a rejeição com comentário da pauta volta no DTO ──────────
    [Fact]
    public async Task RejectFeedback_devolve_o_ultimo_comentario()
    {
        using var db = new TestDb();
        var (ws, brand, pautaId) = SeedPauta(db);
        var c = AddContent(db, ws, brand, pautaId);
        AddRejeicao(db, ws, c, "ficou genérico", DateTimeOffset.UtcNow);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await Ctrl(db, ctx, brand).RejectFeedback(pautaId, default);
        var dto = Assert.IsType<LearningController.RejectFeedbackDto>(Assert.IsType<OkObjectResult>(res.Result).Value);
        Assert.Equal("ficou genérico", dto.Comments);
        Assert.Equal(pautaId, dto.PautaId);
    }

    // ── Último vence: duas rejeições na mesma pauta → a mais recente por DecidedAt ──
    [Fact]
    public async Task RejectFeedback_o_mais_recente_vence()
    {
        using var db = new TestDb();
        var (ws, brand, pautaId) = SeedPauta(db);
        var antigo = AddContent(db, ws, brand, pautaId);
        var recente = AddContent(db, ws, brand, pautaId);
        AddRejeicao(db, ws, antigo, "muito formal", DateTimeOffset.UtcNow.AddHours(-2));
        AddRejeicao(db, ws, recente, "faltou CTA", DateTimeOffset.UtcNow);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await Ctrl(db, ctx, brand).RejectFeedback(pautaId, default);
        var dto = Assert.IsType<LearningController.RejectFeedbackDto>(Assert.IsType<OkObjectResult>(res.Result).Value);
        Assert.Equal("faltou CTA", dto.Comments);
    }

    // ── Sem rejeição: pauta sem Approval rejeitado → Comments=null (não 404) ─────
    [Fact]
    public async Task RejectFeedback_sem_rejeicao_e_null_nao_404()
    {
        using var db = new TestDb();
        var (ws, brand, pautaId) = SeedPauta(db);
        AddContent(db, ws, brand, pautaId); // content sem Approval rejeitado
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await Ctrl(db, ctx, brand).RejectFeedback(pautaId, default);
        var dto = Assert.IsType<LearningController.RejectFeedbackDto>(Assert.IsType<OkObjectResult>(res.Result).Value);
        Assert.Null(dto.Comments);
    }

    // ── Isolamento cross-brand (C6): feedback da marca A não vaza no contexto da B ──
    [Fact]
    public async Task RejectFeedback_nao_vaza_entre_marcas()
    {
        using var db = new TestDb();
        var (ws, brandA, pautaId) = SeedPauta(db);
        var brandB = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using (var s = db.NewContext()) { s.Brands.Add(new Brand { Id = brandB, WorkspaceId = ws, Name = "B" }); s.SaveChanges(); }
        var c = AddContent(db, ws, brandA, pautaId);
        AddRejeicao(db, ws, c, "ficou genérico", DateTimeOffset.UtcNow);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        // No contexto da marca B, consultar a pauta da marca A → o filtro brandId não acha (null, sem vazamento).
        var res = await Ctrl(db, ctx, brandB).RejectFeedback(pautaId, default);
        var dto = Assert.IsType<LearningController.RejectFeedbackDto>(Assert.IsType<OkObjectResult>(res.Result).Value);
        Assert.Null(dto.Comments);
    }
}
