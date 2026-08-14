using SocialAi.Api.Features.Content;
using SocialAi.Api.Generation;

namespace SocialAi.Api.Features.Usage;

/// <summary>
/// C (ADR-0008): estimador de custo da geração (USD) na fronteira HTTP da API. F5 (Eixo D): a
/// tabela de preços e o cálculo migraram para Core (<see cref="GenerationCostEstimator"/>) — fonte
/// ÚNICA compartilhada com o worker. Este wrapper só adapta o DTO HTTP (AgentsUsage) ao cálculo
/// neutro, para não duplicar a tabela de preços em dois lugares.
///
/// 🔵 ESTIMADO: o custo exibido é sempre rotulado "estimado" na UI. Sem usage (mock/sem chave) →
/// custo 0 (modo mock não gasta). Modelo desconhecido → preço default do Core, nunca lança.
/// </summary>
public static class UsageCostEstimator
{
    /// <summary>
    /// Estima o custo (USD) de uma geração a partir do uso e dos modelos efetivos. Sem usage
    /// (mock) → 0. Delega o cálculo ao <see cref="GenerationCostEstimator"/> (Core).
    /// </summary>
    public static decimal Estimate(AgentsUsage? usage, string? textModel, string? imageModel)
    {
        if (usage is null) return 0m;
        return GenerationCostEstimator.Estimate(
            usage.TextInputTokens, usage.TextOutputTokens, usage.ImageCount, textModel, imageModel);
    }
}
