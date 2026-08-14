using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;

namespace SocialAi.Api.Learning;

/// <summary>
/// Fase 3 (tasks 3.3/3.4) — APRENDIZADO em CORE, ponto único que a API e o worker (o robô)
/// consomem. O worker só referencia Core e não alcança o PerformanceAnalyzer (api-side); então a
/// query mínima + a régua ponderada (MetricScoring) vivem aqui.
///   - PreferredFormatAsync (3.4): formato que pontua alto sob a régua do operador → viés do robô.
///   - SummaryAsync (3.3): learning summary textual JÁ com a preferência ponderada embutida → vai
///     aos agentes (tanto na geração do wizard quanto na do robô), fechando o E2E de aprendizado.
/// A API delega BuildLearningSummaryAsync/BuildBestFormatWeightedAsync a estes pontos — mesma régua,
/// mesma função de score, sem divergência silenciosa.
/// </summary>
public static class WorkspaceLearning
{
    // Mesmo limiar dos demais sinais de aprendizado: <3 amostras não formam padrão confiável.
    private const int MinSample = 3;

    /// <summary>Linha materializada da amostra de aprendizado (métrica + formato + hora de publicação).</summary>
    private readonly record struct Row(
        ContentType Type, int Reach, int Likes, int Saves, int Comments, int Engagement, int Hour);

    /// <summary>
    /// Melhor FORMATO do workspace sob a régua ponderada (saves/reach/likes/comments × pesos). Null com
    /// amostra &lt;3 → sem viés (comportamento atual preservado). Materializa antes de agregar (GOTCHA
    /// SQLite/tenant). Workspace-scoped explícito (o worker roda com o filtro de tenant desligado).
    /// </summary>
    public static async Task<ContentType?> PreferredFormatAsync(
        AppDbContext db, Guid workspaceId, CancellationToken ct = default)
    {
        var weights = await LoadWeightsAsync(db, workspaceId, ct);
        var rows = await LoadRowsAsync(db, workspaceId, ct);
        return MetricScoring.PickBestFormat(
            rows.Select(r => new MetricSample(r.Type, r.Reach, r.Likes, r.Saves, r.Comments)), weights, MinSample);
    }

    /// <summary>
    /// Learning summary textual (§2.4) injetado no BrandContext dos agentes: formato/janela de maior
    /// engajamento + a PREFERÊNCIA PONDERADA do operador (3.3) quando difere do engajamento bruto. Null
    /// com amostra &lt;3 (o copywriter roda sem viés — comportamento atual). Reusa uma query única.
    /// </summary>
    public static async Task<string?> SummaryAsync(
        AppDbContext db, Guid workspaceId, CancellationToken ct = default)
    {
        var rows = await LoadRowsAsync(db, workspaceId, ct);
        if (rows.Count < MinSample) return null;

        var byFormat = rows
            .GroupBy(r => r.Type)
            .Select(g => new { Format = g.Key, AvgEng = g.Average(x => x.Engagement) })
            .OrderByDescending(x => x.AvgEng)
            .First();

        var byHour = rows
            .GroupBy(r => Bucket(r.Hour))
            .Select(g => new { Slot = g.Key, AvgEng = g.Average(x => x.Engagement) })
            .OrderByDescending(x => x.AvgEng)
            .First();

        var avgSaves = rows.Average(r => r.Saves);

        var summary =
            $"Aprendizado de performance (amostra={rows.Count}): " +
            $"formato de maior engajamento = {byFormat.Format} (média {byFormat.AvgEng:F0}); " +
            $"melhor janela = {byHour.Slot} (média {byHour.AvgEng:F0}); " +
            $"média de saves = {avgSaves:F0}. " +
            $"Priorize {byFormat.Format} e publique no período da {byHour.Slot}.";

        // task 3.3 — a régua PONDERADA do operador. Só acrescenta quando o vencedor ponderado difere do
        // bruto (senão o summary fica idêntico ao atual — não-regressão de prompt).
        var weights = await LoadWeightsAsync(db, workspaceId, ct);
        var weightedBest = MetricScoring.PickBestFormat(
            rows.Select(r => new MetricSample(r.Type, r.Reach, r.Likes, r.Saves, r.Comments)), weights, MinSample);
        if (weightedBest is { } wb && wb != byFormat.Format)
            summary += $" Pela régua de sucesso do cliente (pesos por sinal), o formato preferido é {wb} — priorize-o.";

        return summary;
    }

    // ── infra compartilhada ────────────────────────────────────────────────────────────────────────
    private static async Task<MetricWeightConfig> LoadWeightsAsync(AppDbContext db, Guid wsId, CancellationToken ct)
        => await db.MetricWeightConfigs.AsNoTracking().FirstOrDefaultAsync(c => c.WorkspaceId == wsId, ct)
           ?? new MetricWeightConfig();

    /// <summary>Amostra de aprendizado: métrica + formato + hora de PUBLICAÇÃO (ScheduledFor, fallback
    /// CreatedAt). Materializada (GOTCHA SQLite: DateTimeOffset/enum não traduzem em GROUP BY).</summary>
    private static async Task<IReadOnlyList<Row>> LoadRowsAsync(AppDbContext db, Guid wsId, CancellationToken ct)
    {
        return await db.PerformanceMetrics
            .Where(m => m.WorkspaceId == wsId)
            .Join(db.Contents, m => m.ContentId, c => c.Id, (m, c) => new { m, c })
            .GroupJoin(db.ScheduledPosts, x => x.c.Id, sp => sp.ContentId, (x, sps) => new { x.m, x.c, sps })
            .SelectMany(x => x.sps.DefaultIfEmpty(), (x, sp) => new Row(
                x.c.Type, x.m.Reach, x.m.Likes, x.m.Saves, x.m.Comments, x.m.Engagement,
                (sp != null ? sp.ScheduledFor : x.c.CreatedAt).Hour))
            .ToListAsync(ct);
    }

    private static string Bucket(int hour) => hour switch
    {
        >= 5 and < 12 => "manhã",
        >= 12 and < 18 => "tarde",
        _ => "noite",
    };
}
