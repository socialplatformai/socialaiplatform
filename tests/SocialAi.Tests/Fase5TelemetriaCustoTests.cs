using System.Net;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Features.Content;
using SocialAi.Api.Features.Learning;
using SocialAi.Api.Generation;
using SocialAi.Api.Infrastructure;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// FASE 5 (Eixo D) — telemetria de custo REAL. Prova os 3 entregáveis do GATE:
///  1. SpendEntry grava JobId/Provider/Model/tokens reais (custo por token×modelo, não fixo);
///  2. sem uso (mock/sem chave) cai no custo fixo por formato (degradado honesto, sem inventar);
///  3. a geração MANUAL respeita o teto mensal (402 quando estoura), e só quando há teto (>0).
/// O correlation id (JobId) é o mesmo do Content que originou o gasto — rastreável ponta a ponta.
/// </summary>
public class Fase5TelemetriaCustoTests
{
    // ── 1. Custo REAL por token×modelo + telemetria gravada no SpendEntry ─────────
    [Fact]
    public async Task Spend_grava_custo_real_e_telemetria_quando_ha_uso()
    {
        using var db = new TestDb();
        var (ws, brand, contentId, jobId) = SeedContent(db, ContentStatus.Generating);
        db.Current.WorkspaceId = ws;

        var completion = TestGeneration.Completion();
        // gpt-4.1: in 0.0020/1k, out 0.0080/1k ; gpt-image-1: 0.0400/imagem.
        // 1000 in → 0.0020 ; 1000 out → 0.0080 ; 2 imagens → 0.0800. Total = 0.0900.
        var usage = new GenerationUsage(1000, 1000, 2, "openai", "gpt-4.1", "gpt-image-1");
        var outcome = new GenerationOutcome("legenda", "cta", new[] { "x" }, 80,
            new[] { new OutcomeSlide(0, "copy 0", null, null) }, usage);

        using (var ctx = db.NewContext())
        {
            var c = await ctx.Contents.Include(x => x.Slides).FirstAsync(x => x.Id == contentId);
            await completion.TryCompleteAsync(ctx, c, outcome);
            await ctx.SaveChangesAsync();
        }

        using (var ctx = db.NewContext())
        {
            var entry = await ctx.SpendEntries.SingleAsync(s => s.ContentId == contentId);
            Assert.Equal(0.0900m, entry.AmountUsd);     // custo REAL por token×modelo (não 0.05 fixo de Post)
            Assert.Equal(jobId, entry.JobId);           // correlation id ponta a ponta
            Assert.Equal("openai", entry.Provider);
            Assert.Equal("gpt-4.1", entry.Model);
            Assert.Equal(1000, entry.TextInputTokens);
            Assert.Equal(1000, entry.TextOutputTokens);
            Assert.Equal(2, entry.ImageCount);
        }
    }

    // ── 2. Sem uso (mock) → custo FIXO por formato; telemetria nula (degradado honesto) ──
    [Fact]
    public async Task Spend_cai_no_custo_fixo_quando_nao_ha_uso()
    {
        using var db = new TestDb();
        var (ws, _, contentId, _) = SeedContent(db, ContentStatus.Generating);
        db.Current.WorkspaceId = ws;

        var completion = TestGeneration.Completion();
        // Usage = null (mock/sem chave) → custo fixo por formato (Post default = 0.05).
        var outcome = new GenerationOutcome("legenda", "cta", new[] { "x" }, 80,
            new[] { new OutcomeSlide(0, "copy 0", null, null) }, Usage: null);

        using (var ctx = db.NewContext())
        {
            var c = await ctx.Contents.Include(x => x.Slides).FirstAsync(x => x.Id == contentId);
            await completion.TryCompleteAsync(ctx, c, outcome);
            await ctx.SaveChangesAsync();
        }

        using (var ctx = db.NewContext())
        {
            var entry = await ctx.SpendEntries.SingleAsync(s => s.ContentId == contentId);
            Assert.Equal(0.05m, entry.AmountUsd);   // custo fixo de Post (fail-safe não-zero)
            Assert.Null(entry.Provider);            // sem uso → sem telemetria (não inventa)
            Assert.Null(entry.TextInputTokens);
        }
    }

    // ── 3a. Geração MANUAL respeita o teto: estoura → 402 (sem chamar agents) ─────
    [Fact]
    public async Task Geracao_manual_bloqueia_quando_teto_estourado()
    {
        using var db = new TestDb();
        var (ws, brand) = SeedWorkspaceBrand(db);
        // Teto baixo (0.10) já quase gasto (0.09) → a próxima geração (estimativa Post 0.05) estoura.
        SeedBudgetComGasto(db, ws, brand, cap: 0.10m, gastoMes: 0.09m);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var r = await Controller(db, ctx, brand).GenerateAsyncStart(
            new ContentController.GenerateAsyncRequest(null, "tema livre", ContentType.Post));

        var problem = Assert.IsType<ObjectResult>(r.Result);
        Assert.Equal(402, problem.StatusCode); // teto estourado → 402 Payment Required
        // Não criou Content (nenhuma geração disparada).
        Assert.Empty(await ctx.Contents.IgnoreQueryFilters().ToListAsync());
    }

    // ── 3b. Sem teto configurado (cap=0) → geração livre (não regressão) ─────────
    [Fact]
    public async Task Geracao_manual_livre_quando_nao_ha_teto()
    {
        using var db = new TestDb();
        var (ws, brand) = SeedWorkspaceBrand(db);
        // cap=0 = sem orçamento configurado; gasto alto não deve bloquear.
        SeedBudgetComGasto(db, ws, brand, cap: 0m, gastoMes: 999m);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var r = await Controller(db, ctx, brand).GenerateAsyncStart(
            new ContentController.GenerateAsyncRequest(null, "tema livre", ContentType.Post));

        // Passa do gate de teto e dispara a geração (stub do agents devolve jobId) → 200.
        var ok = Assert.IsType<OkObjectResult>(r.Result);
        Assert.IsType<ContentController.GenerateAsyncResponse>(ok.Value);
    }

    // ── helpers ──────────────────────────────────────────────────────────────────
    private sealed class StubAgents : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"jobId\":\"job-stub\",\"status\":\"queued\"}",
                    Encoding.UTF8, "application/json"),
            });
    }

    private static ContentController Controller(TestDb db, AppDbContext ctx, Guid brand)
    {
        var agents = new AgentsClient(new HttpClient(new StubAgents()) { BaseAddress = new Uri("http://agents") });
        return new ContentController(
            ctx, db.Current, agents, new PerformanceAnalyzer(ctx),
            new BrandResolver(ctx, new FakeCurrentBrand { BrandId = brand }), TestSecrets.Protector(),
            TestGeneration.Costs(), TestGeneration.Completion(), new RejectFeedbackService(ctx))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
    }

    private static (Guid ws, Guid brand, Guid contentId, string jobId) SeedContent(TestDb db, ContentStatus status)
    {
        var ws = Guid.NewGuid();
        var brand = Guid.NewGuid();
        var contentId = Guid.NewGuid();
        var jobId = "job-" + Guid.NewGuid().ToString("N")[..8];
        db.Current.WorkspaceId = null;
        using var seed = db.NewContext();
        seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
        seed.Brands.Add(new Brand { Id = brand, WorkspaceId = ws, Name = "Marca" });
        seed.Contents.Add(new Content
        {
            Id = contentId, WorkspaceId = ws, BrandId = brand,
            Type = ContentType.Post, Status = status, JobId = jobId,
        });
        seed.SaveChanges();
        return (ws, brand, contentId, jobId);
    }

    private static (Guid ws, Guid brand) SeedWorkspaceBrand(TestDb db)
    {
        var ws = Guid.NewGuid();
        var brand = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using var seed = db.NewContext();
        seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
        seed.Brands.Add(new Brand { Id = brand, WorkspaceId = ws, Name = "Marca" });
        seed.SaveChanges();
        return (ws, brand);
    }

    private static void SeedBudgetComGasto(TestDb db, Guid ws, Guid brand, decimal cap, decimal gastoMes)
    {
        db.Current.WorkspaceId = null;
        using var seed = db.NewContext();
        var budget = new Budget { WorkspaceId = ws, MonthlyCapUsd = cap, AutonomousLoopEnabled = false };
        seed.Budgets.Add(budget);
        seed.SaveChanges();
        if (gastoMes > 0m)
        {
            seed.SpendEntries.Add(new SpendEntry
            {
                WorkspaceId = ws, BudgetId = budget.Id, BrandId = brand,
                AmountUsd = gastoMes, Reason = "seed:gasto-do-mes",
                OccurredAt = DateTimeOffset.UtcNow,
            });
            seed.SaveChanges();
        }
    }
}
