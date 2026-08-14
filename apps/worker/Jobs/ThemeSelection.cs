using SocialAi.Api.Domain;

namespace SocialAi.Worker.Jobs;

/// <summary>
/// Fase 2 (task 2.4) — ESCOLHA AUTÔNOMA de tema/pauta para o robô, com ANTI-REPETIÇÃO. Lógica pura
/// (sem DB), testável. Regra sã (a priorização "fina" por score ponderado é a task 3.4):
///   1. Prefere pautas cujo TÍTULO não foi usado recentemente (dedup editorial — não repetir tema).
///   2. Entre as elegíveis, a de MAIOR prioridade; empate → a mais antiga (FIFO da fila editorial).
///   3. Se TODAS são repetição recente, cai na de maior prioridade mesmo assim (não trava o robô) —
///      mas sinaliza (o chamador loga/audita "sem tema novo").
///
/// "Tema recente" = título normalizado (trim+lower) presente no conjunto de títulos já publicados na
/// janela de dedup. Comparação simples por título — o robô do MVP não faz NLP de similaridade (3.5
/// evolui). Determinística (ordenação total → sem empate ambíguo).
/// </summary>
public static class ThemeSelection
{
    public sealed record Selection(Pauta Pauta, bool IsFreshTheme);

    /// <summary>
    /// Escolhe a pauta a gerar. <paramref name="candidates"/> = pautas elegíveis (Backlog/Queued do
    /// workspace); <paramref name="recentTitles"/> = títulos normalizados publicados na janela de dedup.
    /// <paramref name="preferredType"/> (task 3.4) = formato que pontua alto sob a régua do operador
    /// (derivado do score ponderado pelo PerformanceAnalyzer, api-side); null = sem preferência
    /// (comportamento 2.4). Quando informado, pautas desse formato ganham prioridade de desempate.
    /// null se não há candidatos.
    /// </summary>
    public static Selection? Choose(
        IReadOnlyCollection<Pauta> candidates, ISet<string> recentTitles, ContentType? preferredType = null)
    {
        if (candidates.Count == 0) return null;

        // Ordenação total determinística. task 3.4: o formato PREFERIDO (que pontua alto sob a régua do
        // cliente) entra como 1ª chave de desempate — o robô prioriza o que dá resultado. Depois:
        // prioridade DESC, mais antiga (CreatedAt ASC), Id. preferredType null → 1ª chave é constante
        // (não afeta a ordem) → comportamento 2.4 preservado.
        IEnumerable<Pauta> Ordered(IEnumerable<Pauta> src) => src
            .OrderByDescending(p => preferredType.HasValue && p.DesiredType == preferredType.Value ? 1 : 0)
            .ThenByDescending(p => (int)p.Priority)
            .ThenBy(p => p.CreatedAt)
            .ThenBy(p => p.Id);

        var fresh = Ordered(candidates.Where(p => !recentTitles.Contains(Normalize(p.Title)))).FirstOrDefault();
        if (fresh is not null) return new Selection(fresh, IsFreshTheme: true);

        // Todas são repetição recente → escolhe a melhor mesmo assim (não trava), marcando não-fresh.
        var fallback = Ordered(candidates).First();
        return new Selection(fallback, IsFreshTheme: false);
    }

    /// <summary>Normaliza um título p/ comparação de dedup: trim + lower invariante. Vazio → "".</summary>
    public static string Normalize(string? title) => (title ?? string.Empty).Trim().ToLowerInvariant();
}
