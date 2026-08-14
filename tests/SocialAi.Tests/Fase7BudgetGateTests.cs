using System.Net;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Features.Content;
using SocialAi.Api.Features.Learning;
using SocialAi.Api.Infrastructure;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// FASE 7 Bloco B (ADR-0009): gate B3 do endpoint POST /api/content/variations. Cobre os 3 códigos
/// de recusa (400 sem confirmação, 400 count fora do teto, 402 saldo insuficiente) + sanidade do
/// caminho feliz (Ok com a lista de jobs). Custo/teto são determinísticos via IConfiguration custom
/// (MaxVariations=3, Carousel=0.15) passado a TestGeneration.Costs(cfg)/Completion(cfg).
/// </summary>
public class Fase7BudgetGateTests
{
    // Stub do agents: POST /generate → 202 jobId (não exercitamos o pipeline real aqui).
    private sealed class StubHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"jobId\":\"job-1\",\"status\":\"queued\"}", Encoding.UTF8, "application/json"),
            });
    }

    // Config determinística do gate: teto de 3 variações e carousel a 0.15 USD.
    private static IConfiguration GateConfig() => TestGeneration.Config(new Dictionary<string, string?>
    {
        ["Generation:MaxVariations"] = "3",
        ["Generation:UnitCostUsd:Carousel"] = "0.15",
    });

    private static ContentController Ctrl(TestDb db, AppDbContext ctx, Guid brand, IConfiguration? cfg = null)
    {
        var agents = new AgentsClient(new HttpClient(new StubHandler()) { BaseAddress = new Uri("http://agents") });
        return new ContentController(
            ctx, db.Current, agents, new PerformanceAnalyzer(ctx),
            new BrandResolver(ctx, new FakeCurrentBrand { BrandId = brand }),
            TestSecrets.Protector(), TestGeneration.Costs(cfg), TestGeneration.Completion(cfg),
            new RejectFeedbackService(ctx))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
    }

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

    private static Guid AddContent(TestDb db, Guid ws, Guid brand, Guid? pautaId, ContentStatus status, bool sample = false)
    {
        var id = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using var ctx = db.NewContext();
        ctx.Contents.Add(new Content { Id = id, WorkspaceId = ws, BrandId = brand, PautaId = pautaId, Type = ContentType.Post, Status = status, IsSample = sample });
        ctx.SaveChanges();
        return id;
    }

    // Semeia um Budget com teto pequeno para a workspace (gate de saldo B1/B3).
    private static void SeedBudget(TestDb db, Guid ws, decimal capUsd)
    {
        db.Current.WorkspaceId = null;
        using var seed = db.NewContext();
        seed.Budgets.Add(new Budget { WorkspaceId = ws, MonthlyCapUsd = capUsd, AutonomousLoopEnabled = false });
        seed.SaveChanges();
    }

    // ── Gate 1 (B3): sem confirmação → 400 ──────────────────────────────────────
    [Fact]
    public async Task Variations_sem_confirm_e_400()
    {
        using var db = new TestDb();
        var (ws, brand, pautaId) = SeedPauta(db);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await Ctrl(db, ctx, brand, GateConfig())
            .Variations(new ContentController.VariationsRequest(pautaId, ContentType.Carousel, 1, Confirm: false));

        var obj = Assert.IsType<ObjectResult>(res.Result);
        Assert.Equal(400, obj.StatusCode);
    }

    // ── Gate 2 (B3): count acima do teto (MaxVariations=3) → 400 ─────────────────
    [Fact]
    public async Task Variations_count_acima_do_teto_e_400()
    {
        using var db = new TestDb();
        var (ws, brand, pautaId) = SeedPauta(db);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        // count=10 com Max=3 → recusa explícita (não clampa).
        var res = await Ctrl(db, ctx, brand, GateConfig())
            .Variations(new ContentController.VariationsRequest(pautaId, ContentType.Carousel, 10, Confirm: true));

        var obj = Assert.IsType<ObjectResult>(res.Result);
        Assert.Equal(400, obj.StatusCode);
    }

    // ── Gate 3 (B3): custo total > saldo → 402 ──────────────────────────────────
    [Fact]
    public async Task Variations_saldo_insuficiente_e_402()
    {
        using var db = new TestDb();
        var (ws, brand, pautaId) = SeedPauta(db);
        // Cap 0.10 USD, sem SpendEntry → saldo 0.10. Carousel custa 0.15 → estoura.
        SeedBudget(db, ws, 0.10m);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await Ctrl(db, ctx, brand, GateConfig())
            .Variations(new ContentController.VariationsRequest(pautaId, ContentType.Carousel, 1, Confirm: true));

        var obj = Assert.IsType<ObjectResult>(res.Result);
        Assert.Equal(402, obj.StatusCode);
    }

    // ── Sanidade (caminho feliz): saldo suficiente + confirm + count válido → Ok ──
    [Fact]
    public async Task Variations_saldo_suficiente_dispara_jobs_e_Ok()
    {
        using var db = new TestDb();
        var (ws, brand, pautaId) = SeedPauta(db);
        // Cap 1.00 USD cobre 1 carousel (0.15).
        SeedBudget(db, ws, 1.00m);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await Ctrl(db, ctx, brand, GateConfig())
            .Variations(new ContentController.VariationsRequest(pautaId, ContentType.Carousel, 1, Confirm: true));

        var ok = Assert.IsType<OkObjectResult>(res.Result);
        var lista = Assert.IsAssignableFrom<IEnumerable<ContentController.GenerateAsyncResponse>>(ok.Value);
        var item = Assert.Single(lista);
        Assert.Equal("job-1", item.JobId); // StubHandler do AgentsClient devolve jobId
    }
}
