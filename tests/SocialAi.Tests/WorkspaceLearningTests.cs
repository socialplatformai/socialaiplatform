using SocialAi.Api.Domain;
using SocialAi.Api.Learning;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// Fase 3 (tasks 3.3/3.4) — o FIO robô→analyzer e o learning summary PONDERADO, agora em Core (ponto
/// único que a API e o worker consomem). Prova:
///  - MetricScoring.PickBestFormat: a régua do operador escolhe o formato (função pura);
///  - WorkspaceLearning.PreferredFormatAsync: o robô deriva o formato preferido do banco (3.4);
///  - WorkspaceLearning.SummaryAsync: o summary embute a preferência ponderada quando difere do bruto (3.3).
/// </summary>
public class WorkspaceLearningTests
{
    private static readonly Guid Ws = Guid.NewGuid();

    // ── MetricScoring.PickBestFormat (pura) ───────────────────────────────────────────────────
    [Fact]
    public void PickBestFormat_regua_do_operador_escolhe_o_formato()
    {
        // Carousel tem muitos saves; Post tem muito reach. A régua decide qual vence.
        var samples = new[]
        {
            new MetricSample(ContentType.Carousel, Reach: 0,    Likes: 0, Saves: 100, Comments: 0),
            new MetricSample(ContentType.Post,     Reach: 1000, Likes: 0, Saves: 0,   Comments: 0),
            new MetricSample(ContentType.Story,    Reach: 1,    Likes: 1, Saves: 1,   Comments: 1),
        };

        var pesaSaves = new MetricWeightConfig { SavesWeight = 10, ReachWeight = 1, LikesWeight = 0, CommentsWeight = 0 };
        Assert.Equal(ContentType.Carousel, MetricScoring.PickBestFormat(samples, pesaSaves));

        var pesaReach = new MetricWeightConfig { SavesWeight = 1, ReachWeight = 10, LikesWeight = 0, CommentsWeight = 0 };
        Assert.Equal(ContentType.Post, MetricScoring.PickBestFormat(samples, pesaReach));
    }

    [Fact]
    public void PickBestFormat_null_com_amostra_insuficiente()
    {
        var poucas = new[]
        {
            new MetricSample(ContentType.Post, 1, 1, 1, 1),
            new MetricSample(ContentType.Post, 1, 1, 1, 1),
        };
        Assert.Null(MetricScoring.PickBestFormat(poucas, new MetricWeightConfig())); // <3 → sem viés
    }

    // ── WorkspaceLearning.PreferredFormatAsync (fio 3.4, via banco) ───────────────────────────
    [Fact]
    public async Task PreferredFormatAsync_prefere_o_formato_que_pontua_alto_sob_a_regua()
    {
        using var db = new TestDb();
        db.Current.WorkspaceId = null; // worker roda sem filtro de tenant (isolação por predicado)
        var brandId = Guid.NewGuid();

        await using (var ctx = db.NewContext())
        {
            Seed(ctx, Ws, brandId);
            // Régua que valoriza SAVES → o formato com mais saves (Carousel) deve vencer.
            ctx.MetricWeightConfigs.Add(new MetricWeightConfig
            {
                WorkspaceId = Ws, SavesWeight = 10, ReachWeight = 1, LikesWeight = 0, CommentsWeight = 0,
            });
            AddMetric(ctx, Ws, brandId, ContentType.Carousel, reach: 0, saves: 50);
            AddMetric(ctx, Ws, brandId, ContentType.Carousel, reach: 0, saves: 60);
            AddMetric(ctx, Ws, brandId, ContentType.Post, reach: 500, saves: 0);
            await ctx.SaveChangesAsync();
        }

        await using (var ctx = db.NewContext())
        {
            var best = await WorkspaceLearning.PreferredFormatAsync(ctx, Ws);
            Assert.Equal(ContentType.Carousel, best);
        }
    }

    // ── WorkspaceLearning.SummaryAsync (3.3, via banco) ───────────────────────────────────────
    [Fact]
    public async Task SummaryAsync_embute_preferencia_ponderada_quando_difere_do_bruto()
    {
        using var db = new TestDb();
        db.Current.WorkspaceId = null;
        var brandId = Guid.NewGuid();

        await using (var ctx = db.NewContext())
        {
            Seed(ctx, Ws, brandId);
            // Régua que valoriza SAVES ao extremo. Engajamento BRUTO favorece Post (alto engagement);
            // a régua do operador favorece Carousel (muitos saves). A frase extra deve aparecer.
            ctx.MetricWeightConfigs.Add(new MetricWeightConfig
            {
                WorkspaceId = Ws, SavesWeight = 10, ReachWeight = 0, LikesWeight = 0, CommentsWeight = 0,
            });
            // Post: engajamento bruto alto, saves baixos.
            AddMetric(ctx, Ws, brandId, ContentType.Post, reach: 0, saves: 0, engagement: 1000);
            AddMetric(ctx, Ws, brandId, ContentType.Post, reach: 0, saves: 0, engagement: 900);
            // Carousel: engajamento bruto baixo, saves altos.
            AddMetric(ctx, Ws, brandId, ContentType.Carousel, reach: 0, saves: 200, engagement: 10);
            AddMetric(ctx, Ws, brandId, ContentType.Carousel, reach: 0, saves: 200, engagement: 10);
            await ctx.SaveChangesAsync();
        }

        await using (var ctx = db.NewContext())
        {
            var summary = await WorkspaceLearning.SummaryAsync(ctx, Ws);
            Assert.NotNull(summary);
            Assert.Contains("Aprendizado de performance", summary);
            // A régua do operador (saves) prefere Carousel, mesmo o bruto favorecendo Post.
            Assert.Contains("régua de sucesso do cliente", summary);
            Assert.Contains("Carousel", summary);
        }
    }

    [Fact]
    public async Task SummaryAsync_null_com_amostra_insuficiente()
    {
        using var db = new TestDb();
        db.Current.WorkspaceId = null;
        await using var ctx = db.NewContext();
        Assert.Null(await WorkspaceLearning.SummaryAsync(ctx, Ws)); // 0 métricas → null
    }

    private static void Seed(SocialAi.Api.Data.AppDbContext ctx, Guid ws, Guid brandId)
    {
        ctx.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
        ctx.Brands.Add(new Brand { Id = brandId, WorkspaceId = ws, Name = "Marca" });
    }

    private static void AddMetric(
        SocialAi.Api.Data.AppDbContext ctx, Guid ws, Guid brandId, ContentType type,
        int reach = 0, int saves = 0, int engagement = 0)
    {
        var content = new Content
        {
            WorkspaceId = ws, BrandId = brandId, Type = type, Status = ContentStatus.Published,
        };
        ctx.Contents.Add(content);
        ctx.PerformanceMetrics.Add(new PerformanceMetric
        {
            WorkspaceId = ws, ContentId = content.Id,
            Reach = reach, Saves = saves, Likes = 0, Comments = 0, Engagement = engagement,
        });
    }
}
