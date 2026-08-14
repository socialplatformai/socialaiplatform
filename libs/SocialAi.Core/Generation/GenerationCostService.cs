using Microsoft.Extensions.Configuration;
using SocialAi.Api.Domain;

namespace SocialAi.Api.Generation;

/// <summary>
/// B2/B4 (ADR-0009): custo ESTIMADO de geração POR FORMATO, fonte única da FASE 7. Lê a tabela
/// versionada em config (`Generation:UnitCostUsd:{Post|Carousel|Story}`), com FAIL-SAFE não-zero
/// (custo zero silencioso furaria o teto de B3) e `Generation:MaxVariations` (clamp de count).
///
/// 🔵 ESTIMADO, não billing fiscal (DEC-5/D3): o objetivo é TETO + PREVISIBILIDADE. Por construção
/// nesta fase, estimativa (B2) == gasto gravado (B4) — ambos usam unitCost(format). Quando E5.5 medir
/// tokens reais, a tabela vira piso e revisita-se. NUNCA chama a IA (L8: determinismo > geração).
///
/// Vive em Core p/ ser compartilhado entre a API (poll) e o worker (reconciliador) — o gasto é
/// o MESMO valor computado de Content.Type, sem decifrar segredo de provider (D3).
/// </summary>
public class GenerationCostService(IConfiguration cfg)
{
    // Defaults versionados (espelham appsettings.json). Fail-safe FINAL — se nem a config existir,
    // estes valores não-zero garantem que o gate de B3 nunca libere por estimativa=0.
    private const decimal DefaultPost = 0.05m;
    private const decimal DefaultCarousel = 0.15m;
    private const decimal DefaultStory = 0.05m;
    private const int DefaultMaxVariations = 5;

    /// <summary>Teto de variações por requisição (B3). >=1 sempre (config inválida → default).
    /// Usa o indexer + parse manual (Core só referencia Configuration.Abstractions, sem o Binder).</summary>
    public int MaxVariations
    {
        get
        {
            var raw = cfg["Generation:MaxVariations"];
            return int.TryParse(raw, out var v) && v >= 1 ? v : DefaultMaxVariations;
        }
    }

    /// <summary>Clampa count a [1, MaxVariations] (B2/B3).</summary>
    public int ClampCount(int count) => Math.Clamp(count, 1, MaxVariations);

    /// <summary>
    /// Custo unitário (USD) de gerar 1 conteúdo do formato. Fail-safe: chave ausente OU &lt;=0 →
    /// default versionado não-zero (B2). NUNCA retorna 0 (custo zero silencioso fura o teto).
    /// </summary>
    public decimal UnitCostUsd(ContentType format)
    {
        var (key, fallback) = format switch
        {
            ContentType.Carousel => ("Generation:UnitCostUsd:Carousel", DefaultCarousel),
            ContentType.Story => ("Generation:UnitCostUsd:Story", DefaultStory),
            _ => ("Generation:UnitCostUsd:Post", DefaultPost), // Post e qualquer desconhecido
        };
        // Indexer + parse invariante (sem o pacote Binder no Core). Fail-safe: vazio/inválido/<=0 → default.
        var configured = decimal.TryParse(cfg[key],
            System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var c)
            ? c : 0m;
        return configured > 0m ? configured : fallback;
    }

    /// <summary>Reason canônico do SpendEntry de geração (B4) — chave de dedupe junto de ContentId.</summary>
    public static string ReasonFor(ContentType format) => $"generate:{format.ToString().ToLowerInvariant()}";

    /// <summary>Custo total estimado de N gerações de um formato (B2/B3). count é clampado.</summary>
    public decimal TotalCostUsd(ContentType format, int count) => UnitCostUsd(format) * ClampCount(count);
}
