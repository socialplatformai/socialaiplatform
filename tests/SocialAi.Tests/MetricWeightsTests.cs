using SocialAi.Api.Domain;
using SocialAi.Api.Features.Learning;
using SocialAi.Worker.Jobs;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// Fase 3 (tasks 3.3–3.5) — a régua de "bom post" é escolhida pelo operador. Prova as peças PURAS:
///  - PerformanceAnalyzer.WeightedScore: score = Σ (sinal × peso), inclui comentários (3.5);
///  - ThemeSelection.Choose(preferredType): o robô prioriza o formato que pontua alto (3.4).
/// </summary>
public class MetricWeightsTests
{
    private static readonly MetricWeightConfig Defaults = new(); // saves5 reach2 likes3 comments4

    [Fact]
    public void WeightedScore_soma_sinais_vezes_pesos()
    {
        // reach=100*2 + likes=10*3 + saves=5*5 + comments=2*4 = 200+30+25+8 = 263
        var score = PerformanceAnalyzer.WeightedScore(100, 10, 5, 2, Defaults);
        Assert.Equal(263, score);
    }

    [Fact]
    public void WeightedScore_peso_zero_zera_o_sinal()
    {
        var semSaves = new MetricWeightConfig { SavesWeight = 0, ReachWeight = 0, LikesWeight = 0, CommentsWeight = 10 };
        // só comentários contam: 3*10 = 30 (o resto zerado)
        Assert.Equal(30, PerformanceAnalyzer.WeightedScore(999, 999, 999, 3, semSaves));
    }

    [Fact]
    public void WeightedScore_regua_do_operador_muda_o_vencedor()
    {
        // Post A: muitos saves, poucos comentários. Post B: o inverso.
        var A = (reach: 0, likes: 0, saves: 10, comments: 1);
        var B = (reach: 0, likes: 0, saves: 1, comments: 10);

        // Régua "valoriza saves": A vence.
        var pesaSaves = new MetricWeightConfig { SavesWeight = 10, CommentsWeight = 1, ReachWeight = 0, LikesWeight = 0 };
        Assert.True(PerformanceAnalyzer.WeightedScore(A.reach, A.likes, A.saves, A.comments, pesaSaves)
                  > PerformanceAnalyzer.WeightedScore(B.reach, B.likes, B.saves, B.comments, pesaSaves));

        // Régua "valoriza comentários": B vence (a régua do operador inverte o "melhor").
        var pesaComments = new MetricWeightConfig { SavesWeight = 1, CommentsWeight = 10, ReachWeight = 0, LikesWeight = 0 };
        Assert.True(PerformanceAnalyzer.WeightedScore(B.reach, B.likes, B.saves, B.comments, pesaComments)
                  > PerformanceAnalyzer.WeightedScore(A.reach, A.likes, A.saves, A.comments, pesaComments));
    }

    // ── ThemeSelection.Choose com preferredType (task 3.4) ────────────────────────────────────
    private static Pauta P(string title, ContentType type, Priority prio = Priority.Medium) =>
        new()
        {
            Id = Guid.NewGuid(), Title = title, DesiredType = type, Priority = prio,
            CreatedAt = new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero), BrandId = Guid.NewGuid(),
        };

    [Fact]
    public void Choose_preferredType_prioriza_o_formato_que_pontua_alto()
    {
        var pautas = new[]
        {
            P("Post comum", ContentType.Post, Priority.High),    // prioridade maior, mas formato não-preferido
            P("Carrossel top", ContentType.Carousel, Priority.Low), // prioridade menor, mas formato PREFERIDO
        };
        var sel = ThemeSelection.Choose(pautas, new HashSet<string>(), preferredType: ContentType.Carousel);
        Assert.NotNull(sel);
        Assert.Equal("Carrossel top", sel!.Pauta.Title); // formato preferido vence a prioridade
    }

    [Fact]
    public void Choose_sem_preferredType_mantem_comportamento_2_4_prioridade()
    {
        var pautas = new[]
        {
            P("Post comum", ContentType.Post, Priority.High),
            P("Carrossel", ContentType.Carousel, Priority.Low),
        };
        var sel = ThemeSelection.Choose(pautas, new HashSet<string>()); // sem preferência
        Assert.NotNull(sel);
        Assert.Equal("Post comum", sel!.Pauta.Title); // maior prioridade vence (comportamento 2.4)
    }
}
