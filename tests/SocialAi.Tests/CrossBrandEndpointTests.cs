using System.Net;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Approval;
using SocialAi.Api.Features.Audit;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Features.Content;
using SocialAi.Api.Features.Learning;
using SocialAi.Api.Features.Publishing;
using SocialAi.Api.Features.Scheduling;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// FASE 2 / E1 — fecha o furo cross-brand pego na auditoria adversarial: Approval e
/// Schedule (e outros) DEVEM escopar por marca, não só por workspace. Exercita o
/// caminho de ataque exato — agir sobre conteúdo da marca B no contexto da marca A —
/// e prova que é bloqueado (NotFound). Mata o "teatro de teste" anterior.
/// </summary>
public class CrossBrandEndpointTests
{
    // Helpers para montar um workspace com 2 marcas e 1 conteúdo na marca A.
    private static (Guid ws, Guid brandA, Guid brandB, Guid contentA) Seed(TestDb db)
    {
        var ws = Guid.NewGuid();
        var brandA = Guid.NewGuid();
        var brandB = Guid.NewGuid();
        var contentA = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using var seed = db.NewContext();
        seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS", DefaultApprovalMode = ApprovalMode.Manual });
        seed.Brands.Add(new Brand { Id = brandA, WorkspaceId = ws, Name = "A" });
        seed.Brands.Add(new Brand { Id = brandB, WorkspaceId = ws, Name = "B" });
        seed.Contents.Add(new Content
        {
            Id = contentA, WorkspaceId = ws, BrandId = brandA,
            Type = ContentType.Post, Status = ContentStatus.Draft,
        });
        seed.SaveChanges();
        return (ws, brandA, brandB, contentA);
    }

    private static BrandResolver Resolver(TestDb db, AppDbContext ctx, Guid brand) =>
        new(ctx, new FakeCurrentBrand { BrandId = brand });

    // ── Approval ────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Pending_so_lista_conteudo_da_marca_atual()
    {
        using var db = new TestDb();
        var (ws, brandA, brandB, _) = Seed(db);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var ctrlA = new ApprovalController(ctx, db.Current, Resolver(db, ctx, brandA), TestAudit.Service(ctx));
        var rA = await ctrlA.Pending();
        var okA = Assert.IsType<OkObjectResult>(rA.Result);
        var listA = Assert.IsAssignableFrom<IEnumerable<PendingContentDto>>(okA.Value);
        Assert.Single(listA); // marca A vê o seu Draft

        using var ctx2 = db.NewContext();
        var ctrlB = new ApprovalController(ctx2, db.Current, Resolver(db, ctx2, brandB), TestAudit.Service(ctx2));
        var rB = await ctrlB.Pending();
        var okB = Assert.IsType<OkObjectResult>(rB.Result);
        var listB = Assert.IsAssignableFrom<IEnumerable<PendingContentDto>>(okB.Value);
        Assert.Empty(listB); // marca B NÃO vê o conteúdo da A
    }

    [Fact]
    public async Task Decidir_conteudo_de_outra_marca_e_bloqueado()
    {
        using var db = new TestDb();
        var (ws, _, brandB, contentA) = Seed(db);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        // No contexto da marca B, tentar aprovar o conteúdo da marca A → NotFound.
        var ctrlB = new ApprovalController(ctx, db.Current, Resolver(db, ctx, brandB), TestAudit.Service(ctx));
        var res = await ctrlB.Decide(contentA, new ApprovalDecision(true, "x", null));
        Assert.IsType<NotFoundResult>(res);
    }

    [Fact]
    public async Task SetContentMode_de_outra_marca_e_bloqueado()
    {
        using var db = new TestDb();
        var (ws, _, brandB, contentA) = Seed(db);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var ctrlB = new ApprovalController(ctx, db.Current, Resolver(db, ctx, brandB), TestAudit.Service(ctx));
        var res = await ctrlB.SetContentMode(contentA, new SetContentModeRequest(ApprovalMode.Automatic));
        Assert.IsType<NotFoundResult>(res);
    }

    // ── Schedule ──────────────────────────────────────────────────────────────
    [Fact]
    public async Task Agendar_conteudo_de_outra_marca_e_bloqueado()
    {
        using var db = new TestDb();
        var (ws, brandA, brandB, contentA) = Seed(db);
        // deixa o conteúdo aprovado (senão o gate de aprovação barraria antes do brand)
        db.Current.WorkspaceId = null;
        using (var s = db.NewContext())
        {
            var c = s.Contents.Find(contentA)!;
            c.Status = ContentStatus.Approved;
            s.SaveChanges();
        }
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        // No contexto da marca B, agendar o conteúdo da marca A → NotFound (não vaza).
        var ctrlB = new ScheduleController(ctx, db.Current, Resolver(db, ctx, brandB));
        var res = await ctrlB.Schedule(new ScheduleRequest(contentA, DateTimeOffset.UtcNow.AddDays(1), null));
        Assert.IsType<NotFoundObjectResult>(res.Result);

        // Sanidade: no contexto da marca A (dona), agenda com sucesso.
        using var ctx2 = db.NewContext();
        var ctrlA = new ScheduleController(ctx2, db.Current, Resolver(db, ctx2, brandA));
        var resA = await ctrlA.Schedule(new ScheduleRequest(contentA, DateTimeOffset.UtcNow.AddDays(1), null));
        Assert.IsType<OkObjectResult>(resA.Result);
    }

    // ── FASE 7 / C6 (ADR-0009): recurso de outra marca → 404 nos endpoints de iterar/operar ──
    // Estende o E1: além de Approval/Schedule, os endpoints da FASE 7 (regenerate, variations,
    // publishing retry) DEVEM escopar por marca. No contexto da marca B, agir sobre recurso da
    // marca A não pode vazar existência — sempre NotFound. ('choose' cross-brand já está coberto
    // em Fase7IterarTests.Choose_de_outra_marca_e_404 — não duplicado aqui.)

    // Stub do agents: POST /generate → 202 jobId (não exercitamos o pipeline real aqui).
    private sealed class StubHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"jobId\":\"job-1\",\"status\":\"queued\"}", Encoding.UTF8, "application/json"),
            });
    }

    private static ContentController Ctrl(TestDb db, AppDbContext ctx, Guid brand)
    {
        var agents = new AgentsClient(new HttpClient(new StubHandler()) { BaseAddress = new Uri("http://agents") });
        return new ContentController(
            ctx, db.Current, agents, new PerformanceAnalyzer(ctx),
            new BrandResolver(ctx, new FakeCurrentBrand { BrandId = brand }),
            TestSecrets.Protector(), TestGeneration.Costs(), TestGeneration.Completion(),
            new RejectFeedbackService(ctx))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
    }

    // ── C6: regenerate de conteúdo de outra marca → 404 ──────────────────────────
    [Fact]
    public async Task Regenerate_conteudo_de_outra_marca_e_404()
    {
        using var db = new TestDb();
        var (ws, _, brandB, contentA) = Seed(db);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        // No contexto da marca B, regenerar o conteúdo da marca A → NotFound (não vaza).
        var ctrlB = Ctrl(db, ctx, brandB);
        var res = await ctrlB.Regenerate(contentA, new ContentController.RegenerateRequest("refaz", null));
        Assert.IsType<NotFoundResult>(res.Result);
    }

    // ── C6: variations sobre pauta de outra marca → 404 ──────────────────────────
    [Fact]
    public async Task Variations_de_pauta_de_outra_marca_e_404()
    {
        using var db = new TestDb();
        var (ws, brandA, brandB, _) = Seed(db);
        // Semeia uma pauta na marca A (alvo do ataque cross-brand).
        var pautaA = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using (var s = db.NewContext())
        {
            s.Pautas.Add(new Pauta { Id = pautaA, WorkspaceId = ws, BrandId = brandA, Title = "PA" });
            s.SaveChanges();
        }
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        // No contexto da marca B, gerar variações da pauta da marca A → NotFound (pauta não
        // encontrada na marca B). Confirm=true e Count válido p/ passar dos gates anteriores.
        var ctrlB = Ctrl(db, ctx, brandB);
        var res = await ctrlB.Variations(new ContentController.VariationsRequest(pautaA, ContentType.Post, 1, true));
        Assert.IsType<NotFoundObjectResult>(res.Result);
    }

    // ── C6: publishing retry de log de outra marca → 404 ─────────────────────────
    [Fact]
    public async Task Retry_log_de_outra_marca_e_404()
    {
        using var db = new TestDb();
        var (ws, _, brandB, contentA) = Seed(db);
        // Semeia o encadeamento de publicação da marca A: ScheduledPost → PublishLog(Error).
        var logA = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using (var s = db.NewContext())
        {
            var postId = Guid.NewGuid();
            s.ScheduledPosts.Add(new ScheduledPost
            {
                Id = postId, WorkspaceId = ws, ContentId = contentA,
                ScheduledFor = DateTimeOffset.UtcNow, Dispatched = true,
            });
            s.PublishLogs.Add(new PublishLog
            {
                Id = logA, WorkspaceId = ws, ScheduledPostId = postId,
                Result = PublishResult.Error, Error = "falhou", Attempts = 1,
            });
            s.SaveChanges();
        }
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        // No contexto da marca B, re-tentar o log da marca A → NotFound (não vaza existência).
        var ctrlB = new PublishingController(ctx, db.Current, Resolver(db, ctx, brandB));
        var res = await ctrlB.Retry(logA);
        Assert.IsType<NotFoundResult>(res);
    }
}
