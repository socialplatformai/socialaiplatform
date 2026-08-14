namespace SocialAi.Api.Domain;

/// <summary>
/// Scoring de "bom post" ponderado pela régua do operador, em Core.
///
/// Movido para Core (era static no PerformanceAnalyzer, api-side) para que o worker (que só
/// referencia Core, não a API) possa derivar o formato que pontua alto sob a régua do cliente
/// para priorizar tema (ThemeSelection.preferredType). Sem este ponto único, a lógica de score
/// teria de ser duplicada no worker — risco de divergência silenciosa.
///
/// Funções puras e determinísticas (sem DB): a API e o worker as consomem do mesmo lugar. O
/// PerformanceAnalyzer (api-side) mantém wrappers finos que delegam aqui.
/// </summary>
public static class MetricScoring
{
    /// <summary>
    /// SCORE PONDERADO de um post: Σ (sinal × peso). Cada sinal (saves/reach/likes/comments) entra
    /// multiplicado pelo peso do workspace (MetricWeightConfig, 0-10). Antes o "bom post" era
    /// engajamento bruto (peso implícito igual); agora a régua é do operador.
    /// </summary>
    public static double WeightedScore(
        int reach, int likes, int saves, int comments, MetricWeightConfig weights) =>
        (double)saves * weights.SavesWeight
        + (double)reach * weights.ReachWeight
        + (double)likes * weights.LikesWeight
        + (double)comments * weights.CommentsWeight;

    /// <summary>
    /// Melhor FORMATO (ContentType) pela régua ponderada, a partir de linhas já materializadas
    /// (reach/likes/saves/comments + tipo). Média do WeightedScore por tipo; o topo é o preferido.
    /// Null com amostra &lt; <paramref name="minSample"/> (default 3, mesmo limiar dos demais sinais)
    /// → sem viés, comportamento atual preservado. Determinística: desempate por nome do tipo para
    /// estabilidade (sem depender da ordem de enumeração).
    /// </summary>
    public static ContentType? PickBestFormat(
        IEnumerable<MetricSample> samples, MetricWeightConfig weights, int minSample = 3)
    {
        var rows = samples as IReadOnlyList<MetricSample> ?? samples.ToList();
        if (rows.Count < minSample) return null;

        return rows
            .GroupBy(s => s.Type)
            .Select(g => new
            {
                Format = g.Key,
                Avg = g.Average(x => WeightedScore(x.Reach, x.Likes, x.Saves, x.Comments, weights)),
            })
            .OrderByDescending(x => x.Avg)
            .ThenBy(x => x.Format.ToString(), StringComparer.Ordinal)
            .First()
            .Format;
    }
}

/// <summary>
/// Amostra mínima para o scoring ponderado (uma métrica + o formato do conteúdo). Neutra: a API a
/// materializa de PerformanceMetric+Content; o worker faz o mesmo. Não acopla ao EF.
/// </summary>
public readonly record struct MetricSample(
    ContentType Type, int Reach, int Likes, int Saves, int Comments);
