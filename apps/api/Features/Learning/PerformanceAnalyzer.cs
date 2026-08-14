using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;

namespace SocialAi.Api.Features.Learning;

/// <summary>
/// Agrega PerformanceMetrics de um workspace e produz um "learning summary" textual
/// (§2.4): formatos/horários de maior engajamento. O summary é injetado no BrandContext
/// enviado aos agentes (E-5), fechando o loop de aprendizado.
/// </summary>
public class PerformanceAnalyzer(AppDbContext db)
{
    /// <summary>
    /// §2.4 + task 3.3 — learning summary textual injetado no BrandContext dos agentes. Delega ao PONTO
    /// ÚNICO em Core (Learning.WorkspaceLearning.SummaryAsync) — o MESMO que o robô usa na geração
    /// autônoma, já com a preferência PONDERADA do operador embutida (fecha o E2E de aprendizado nos dois
    /// braços). Antes a lógica vivia aqui; foi movida a Core para o worker (que não alcança este classe)
    /// consumir sem duplicar. Semântica idêntica: null com amostra &lt;3.
    /// </summary>
    public Task<string?> BuildLearningSummaryAsync(Guid workspaceId, CancellationToken ct = default)
        => SocialAi.Api.Learning.WorkspaceLearning.SummaryAsync(db, workspaceId, ct);

    /// <summary>
    /// Loop de aprendizado (sinal de controle): sinal TIPADO de aprendizado. Enquanto
    /// BuildLearningSummaryAsync produz texto (bom p/ o copywriter), este devolve o ContentType
    /// vencedor como ENUM — o brand-strategist o usa p/ enviesar a escolha de formato/template (não
    /// como nota de prompt). Null com amostra &lt;3 (mesmo limiar do summary) → sem viés, comportamento
    /// atual preservado. Reusa a mesma query/isolamento das outras agregações.
    /// </summary>
    public async Task<ContentType?> BuildBestFormatAsync(Guid workspaceId, CancellationToken ct = default)
    {
        var rows = await db.PerformanceMetrics
            .Where(m => m.WorkspaceId == workspaceId)
            .Join(db.Contents, m => m.ContentId, c => c.Id, (m, c) => new { m, c.Type })
            .ToListAsync(ct);

        if (rows.Count < 3) return null; // mesmo limiar do summary: sem padrão confiável → sem viés

        return rows
            .GroupBy(r => r.Type)
            .Select(g => new { Format = g.Key, AvgEng = g.Average(x => x.m.Engagement) })
            .OrderByDescending(x => x.AvgEng)
            .First()
            .Format;
    }

    /// <summary>
    /// Bootstrapping honesto: formato PROVISÓRIO pela nota de qualidade das peças que a marca já
    /// gerou (Content.QualityScore) — sinal REAL do workspace, disponível ANTES de publicar. Usado só
    /// quando não há dado de performance (todo workspace fresco). Limiar ≥3 peças COM nota p/ não
    /// recomendar sobre ruído. Devolve (formato, n-amostras) ou (null, 0). NUNCA inventa: se a marca
    /// não gerou nada, não há recomendação. Exclui exemplos de teste (IsSample) e peças que falharam.
    /// </summary>
    public async Task<(string? Format, int N)> BuildProvisionalBestFormatAsync(Guid workspaceId, CancellationToken ct = default)
    {
        var scored = await db.Contents
            .Where(c => c.WorkspaceId == workspaceId && !c.IsSample
                        && c.QualityScore != null && c.Status != ContentStatus.Failed)
            .Select(c => new { c.Type, Score = c.QualityScore!.Value })
            .ToListAsync(ct);

        if (scored.Count < 3) return (null, 0); // sem amostra confiável → sem recomendação provisória

        var best = scored
            .GroupBy(s => s.Type)
            .Select(g => new { Format = g.Key, AvgScore = g.Average(x => x.Score), N = g.Count() })
            .OrderByDescending(x => x.AvgScore)
            .First();

        return (best.Format.ToString(), scored.Count);
    }

    /// <summary>
    /// C3: Insights estruturados para GET /api/learning/insights — reutiliza a mesma
    /// query/agregação do BuildLearningSummaryAsync sem duplicar lógica de acesso ao banco.
    /// </summary>
    public async Task<LearningInsights> BuildInsightsAsync(Guid workspaceId, CancellationToken ct = default)
    {
        // Mesma query do BuildLearningSummaryAsync: materialize antes de agregar (GOTCHA SQLite).
        var rows = await db.PerformanceMetrics
            .Where(m => m.WorkspaceId == workspaceId)
            .Join(db.Contents, m => m.ContentId, c => c.Id, (m, c) => new { m, c })
            .GroupJoin(db.ScheduledPosts, x => x.c.Id, sp => sp.ContentId,
                (x, sps) => new { x.m, x.c, sps })
            .SelectMany(x => x.sps.DefaultIfEmpty(),
                (x, sp) => new { x.m, x.c.Type, PostedAt = sp != null ? sp.ScheduledFor : x.c.CreatedAt })
            .ToListAsync(ct);

        // C3: quantas métricas da amostra são simuladas (mock) — a UI rotula honestamente.
        var mockCount = rows.Count(r => r.m.Source == Domain.MetricSource.Mock);

        if (rows.Count < 3)
        {
            // A8: sem dado de publicação suficiente → sinal PROVISÓRIO da própria marca, pela nota de
            // qualidade das peças geradas (real, pré-publicação). Mesmo limiar (≥3 peças com nota) p/
            // não recomendar sobre ruído. Null se nem isso existe (workspace recém-criado, 0 peças).
            var (provFormat, provN) = await BuildProvisionalBestFormatAsync(workspaceId, ct);
            return new LearningInsights(null, 0, null, 0, rows.Count, InsufficientData: true,
                MockSampleCount: mockCount, ProvisionalBestFormat: provFormat, ProvisionalSampleSize: provN);
        }

        // Agregação em memória (GOTCHA SQLite: não traduz GROUP BY/OrderBy de DateTimeOffset).
        var byFormat = rows
            .GroupBy(r => r.Type)
            .Select(g => new { Format = g.Key, AvgEng = g.Average(x => x.m.Engagement) })
            .OrderByDescending(x => x.AvgEng)
            .ToList();

        var byHour = rows
            .GroupBy(r => Bucket(r.PostedAt.Hour))
            .Select(g => new { Slot = g.Key, AvgEng = g.Average(x => x.m.Engagement) })
            .OrderByDescending(x => x.AvgEng)
            .ToList();

        var bestFormat = byFormat.First();
        var bestSlot   = byHour.First();

        return new LearningInsights(
            BestFormat:               bestFormat.Format.ToString(),
            BestFormatAvgEngagement:  bestFormat.AvgEng,
            BestWindow:               bestSlot.Slot,
            BestWindowAvgEngagement:  bestSlot.AvgEng,
            SampleSize:               rows.Count,
            InsufficientData:         false,
            MockSampleCount:          mockCount);
    }

    /// <summary>
    /// SoT "Desempenho" (Fatia 3): métricas POR POST para a tabela densa. Reusa exatamente o mesmo
    /// isolamento workspace-scoped e a junção Content das outras queries — não duplica regra de
    /// acesso. Cada linha carrega a métrica real do banco (Reach/Engagement/Likes/Saves) + a nota de
    /// qualidade do conteúdo + a hora de publicação (ScheduledFor, com fallback CreatedAt) + o Source
    /// (Mock/Real) p/ a UI rotular "simulado" honestamente. Ordenado por engajamento desc (o que mais
    /// performou no topo). Sem agregação: é a lista bruta que a tabela e os small-multiples consomem.
    /// </summary>
    public async Task<IReadOnlyList<PostMetricRow>> BuildPostMetricsAsync(Guid workspaceId, CancellationToken ct = default)
    {
        var rows = await db.PerformanceMetrics
            .Where(m => m.WorkspaceId == workspaceId)
            .Join(db.Contents, m => m.ContentId, c => c.Id, (m, c) => new { m, c })
            .GroupJoin(db.ScheduledPosts, x => x.c.Id, sp => sp.ContentId,
                (x, sps) => new { x.m, x.c, sps })
            .SelectMany(x => x.sps.DefaultIfEmpty(),
                (x, sp) => new { x.m, x.c, PostedAt = sp != null ? (DateTimeOffset?)sp.ScheduledFor : null })
            .ToListAsync(ct);

        // Projeção em memória (GOTCHA SQLite: enum/DateTimeOffset não traduzem bem em projeção).
        return rows
            .Select(r => new PostMetricRow(
                ContentId:    r.c.Id,
                Caption:      r.c.Caption,
                Type:         r.c.Type.ToString(),
                Reach:        r.m.Reach,
                Engagement:   r.m.Engagement,
                Likes:        r.m.Likes,
                Saves:        r.m.Saves,
                QualityScore: r.c.QualityScore,
                Window:       Bucket((r.PostedAt ?? r.c.CreatedAt).Hour),
                IsMock:       r.m.Source == Domain.MetricSource.Mock,
                CollectedAt:  r.m.CollectedAt,
                PostedAt:     r.PostedAt ?? r.c.CreatedAt))
            .OrderByDescending(r => r.Engagement)
            .ToList();
    }

    private static string Bucket(int hour) => hour switch
    {
        >= 5 and < 12 => "manhã",
        >= 12 and < 18 => "tarde",
        _ => "noite",
    };

    // ── Fase 3 (task 3.3) — score de "bom post" PONDERADO pela régua do operador ──────────────────

    /// <summary>
    /// task 3.3 — SCORE PONDERADO de um post (função PURA, testável). Wrapper fino que delega ao PONTO
    /// ÚNICO em Core (MetricScoring.WeightedScore) — a lógica saiu daqui para o worker (que só referencia
    /// Core) poder derivar o formato preferido sem duplicar o cálculo (fecha o fio robô→analyzer, 3.4).
    /// Mantido como método estático da classe para não quebrar call-sites/testes existentes.
    /// </summary>
    public static double WeightedScore(
        int reach, int likes, int saves, int comments, MetricWeightConfig weights) =>
        MetricScoring.WeightedScore(reach, likes, saves, comments, weights);

    /// <summary>
    /// Carrega a régua de "bom post" do workspace (task 3.1) ou os DEFAULTS do código quando não há
    /// config — comportamento atual preservado, nunca 404/exceção.
    /// </summary>
    public async Task<MetricWeightConfig> GetWeightsAsync(Guid workspaceId, CancellationToken ct = default)
        => await db.MetricWeightConfigs.AsNoTracking().FirstOrDefaultAsync(c => c.WorkspaceId == workspaceId, ct)
           ?? new MetricWeightConfig();

    /// <summary>
    /// task 3.3/3.4 — melhor FORMATO pela régua ponderada do operador (não mais por engajamento bruto).
    /// Média do WeightedScore por ContentType; o topo é o formato preferido. Consumido pelo robô (3.4).
    /// Null com amostra &lt;3 (mesmo limiar dos demais sinais) → sem viés, comportamento atual.
    /// </summary>
    public async Task<ContentType?> BuildBestFormatWeightedAsync(Guid workspaceId, CancellationToken ct = default)
    {
        var weights = await GetWeightsAsync(workspaceId, ct);
        // Materializa as amostras (GOTCHA SQLite: agregação em memória) e delega ao PONTO ÚNICO em Core
        // (MetricScoring.PickBestFormat) — o mesmo que o worker usa para priorizar tema (3.4).
        var samples = await db.PerformanceMetrics
            .Where(m => m.WorkspaceId == workspaceId)
            .Join(db.Contents, m => m.ContentId, c => c.Id,
                (m, c) => new MetricSample(c.Type, m.Reach, m.Likes, m.Saves, m.Comments))
            .ToListAsync(ct);

        return MetricScoring.PickBestFormat(samples, weights);
    }
}

/// <summary>
/// SoT "Desempenho": uma linha da tabela densa de posts. Dado REAL do banco (PerformanceMetric +
/// Content). IsMock=true ⇒ métrica sintética (sem token IG) → a UI rotula "simulado". Window é a
/// faixa (manhã/tarde/noite) da hora de publicação — alimenta o small-multiple "engajamento × janela".
/// </summary>
public record PostMetricRow(
    Guid     ContentId,
    string?  Caption,
    string   Type,
    int      Reach,
    int      Engagement,
    int      Likes,
    int      Saves,
    int?     QualityScore,
    string   Window,
    bool     IsMock,
    DateTimeOffset CollectedAt,
    DateTimeOffset PostedAt);

/// <summary>
/// C3: Payload de insights retornado por GET /api/learning/insights.
/// </summary>
public record LearningInsights(
    string? BestFormat,
    double  BestFormatAvgEngagement,
    string? BestWindow,
    double  BestWindowAvgEngagement,
    int     SampleSize,
    bool    InsufficientData,
    // C3/DEC-5: quantas métricas da amostra são SIMULADAS (Source=Mock). Sem token IG, o learning
    // roda sobre dado sintético — a UI rotula "Simulado" p/ não enganar (honestidade de estado).
    int     MockSampleCount = 0,
    // Bootstrapping honesto: quando NÃO há dado de PUBLICAÇÃO suficiente (o caso
    // de todo workspace fresco/demo), ProvisionalBestFormat traz o formato que a PRÓPRIA marca produz
    // com maior NOTA DE QUALIDADE (Content.QualityScore) — sinal REAL do workspace, disponível antes
    // de publicar. NUNCA inventado: é null se nem isso existe. A UI o usa SÓ quando InsufficientData,
    // rotulando "baseado na qualidade das suas peças (ainda sem dados de publicação)" — honestidade de
    // proveniência: o operador sabe que é provisório, não aprendizado de performance real.
    string? ProvisionalBestFormat = null,
    int     ProvisionalSampleSize = 0);
