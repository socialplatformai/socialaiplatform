namespace SocialAi.Api.Generation;

/// <summary>
/// F5 (Eixo D): estimador de custo REAL da geração (USD) por token×modelo + nº de imagens. Vive em
/// Core p/ ser a fonte ÚNICA compartilhada entre a API (poll) e o worker (reconciliador) — ambos
/// gravam o MESMO valor de custo no SpendEntry, sem divergir.
///
/// 🔵 ESTIMADO, não billing fiscal: o objetivo é TETO + PREVISIBILIDADE + rastreio (qual modelo
/// gastou). O provider real cobra por regras próprias (tiers, cache). Sem usage (mock/sem chave) →
/// 0 (modo mock não gasta). Modelo desconhecido → preço default conservador, NUNCA lança.
/// Determinístico (L8: nunca chama IA). Substitui o custo FIXO por formato quando há usage real.
/// </summary>
public static class GenerationCostEstimator
{
    // Preço por 1k tokens de ENTRADA e SAÍDA, por substring do id do modelo (USD). A chave é um
    // prefixo/substring case-insensitive — casa "gpt-4.1", "models/gemini-flash-latest", etc.
    // Mantido curto (KISS): é estimativa, não tabela de billing. Editar num lugar só ajusta tudo.
    private static readonly (string Match, decimal InputPer1k, decimal OutputPer1k)[] TextPrices =
    [
        // Anthropic/Claude (aprox. tabela pública jun/2026) — USD/1k tokens.
        ("claude-opus",   0.0050m, 0.0250m),  // Opus 4.8: $5/$25 por 1M
        ("claude-sonnet", 0.0030m, 0.0150m),  // Sonnet 4.6: $3/$15 por 1M
        ("claude-haiku",  0.0010m, 0.0050m),  // Haiku 4.5: $1/$5 por 1M
        ("claude",        0.0050m, 0.0250m),  // fallback Claude → Opus (conservador)
        // xAI/Grok (aprox.) — USD/1k tokens.
        ("grok",    0.0030m, 0.0150m),
        // OpenAI (aprox. tabela pública) — USD/1k tokens.
        ("gpt-5",   0.0013m, 0.0100m),  // série GPT-5 (aprox.)
        ("gpt-4.1", 0.0020m, 0.0080m),
        ("gpt-4o",  0.0025m, 0.0100m),
        ("gpt-4",   0.0300m, 0.0600m),
        // Gemini (aprox.) — flash é barato; pro é mais caro.
        ("flash",   0.0003m, 0.0010m),
        ("pro",     0.0012m, 0.0050m),
        ("gemini",  0.0003m, 0.0010m),
    ];

    // Preço por IMAGEM gerada (USD), por substring do id do modelo de imagem.
    private static readonly (string Match, decimal PerImage)[] ImagePrices =
    [
        ("gpt-image", 0.0400m),  // OpenAI gpt-image-1 (aprox.)
        ("imagen",    0.0400m),
        ("gemini",    0.0300m),  // Gemini image (aprox.)
    ];

    // Defaults quando o modelo não casa nenhuma entrada (heurística conservadora).
    private const decimal DefaultInputPer1k = 0.0010m;
    private const decimal DefaultOutputPer1k = 0.0030m;
    private const decimal DefaultPerImage = 0.0400m;

    /// <summary>
    /// Estima o custo (USD) a partir de tokens/imagens e dos modelos efetivos. Arredonda a 4 casas
    /// (a coluna AmountUsd é decimal(12,4) — F5; 4 casas preservam o custo sub-centavo de 1 geração).
    /// </summary>
    public static decimal Estimate(int textInputTokens, int textOutputTokens, int imageCount,
        string? textModel, string? imageModel)
    {
        var (inputPer1k, outputPer1k) = TextPriceFor(textModel);
        var perImage = ImagePriceFor(imageModel);

        var textCost = (textInputTokens / 1000m) * inputPer1k
                     + (textOutputTokens / 1000m) * outputPer1k;
        var imageCost = imageCount * perImage;

        return Math.Round(textCost + imageCost, 4, MidpointRounding.AwayFromZero);
    }

    private static (decimal Input, decimal Output) TextPriceFor(string? model)
    {
        if (!string.IsNullOrWhiteSpace(model))
        {
            var m = model.ToLowerInvariant();
            foreach (var (match, input, output) in TextPrices)
                if (m.Contains(match)) return (input, output);
        }
        return (DefaultInputPer1k, DefaultOutputPer1k);
    }

    private static decimal ImagePriceFor(string? model)
    {
        if (!string.IsNullOrWhiteSpace(model))
        {
            var m = model.ToLowerInvariant();
            foreach (var (match, perImage) in ImagePrices)
                if (m.Contains(match)) return perImage;
        }
        return DefaultPerImage;
    }
}
