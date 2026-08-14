using System.Text.Json;
using SocialAi.Api.Generation;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// O envelope Content.ReasoningJson é montado por DOIS caminhos (API poll e worker reaper), que
/// persistem o MESMO conteúdo conforme quem vence a corrida Generating→Draft. Antes havia builders
/// espelhados que divergiriam em silêncio no 1º campo novo (bug-fantasma só sob restart de agents).
/// Agora ambos delegam a ReasoningEnvelope.Build (Core). Estes testes TRAVAM o contrato: a forma do
/// envelope, a paridade entre os dois caminhos e o degradado honesto.
/// </summary>
public class ReasoningEnvelopeParityTests
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    [Fact]
    public void Raciocinio_e_alternatives_co_localizam_no_mesmo_envelope()
    {
        var env = ReasoningEnvelope.Build(
            """{"whyTemplate":"X","keyInsights":["a"]}""",
            """{"headlines":["H1","H2"],"ctas":["C1"]}""");
        Assert.NotNull(env);
        using var doc = JsonDocument.Parse(env!);
        var root = doc.RootElement;
        Assert.Equal("X", root.GetProperty("whyTemplate").GetString());
        Assert.True(root.TryGetProperty("alternatives", out var alt));
        Assert.Equal("H1", alt.GetProperty("headlines")[0].GetString());
    }

    [Fact]
    public void Ambos_ausentes_da_null()
    {
        Assert.Null(ReasoningEnvelope.Build(null, null));
        Assert.Null(ReasoningEnvelope.Build("  ", ""));
    }

    [Fact]
    public void So_alternatives_da_objeto_sem_campos_de_raciocinio()
    {
        var env = ReasoningEnvelope.Build(null, """{"headlines":["H"],"ctas":[]}""");
        Assert.NotNull(env);
        using var doc = JsonDocument.Parse(env!);
        // só a chave alternatives (sem whyTemplate etc.) → o GET devolve reasoning=null nesse caso.
        Assert.True(doc.RootElement.TryGetProperty("alternatives", out _));
        Assert.False(doc.RootElement.TryGetProperty("whyTemplate", out _));
    }

    [Fact]
    public void Json_malformado_em_um_lado_e_tratado_como_ausente_sem_lancar()
    {
        // raciocínio malformado + alternatives ok → envelope só com alternatives (degradado honesto).
        var env = ReasoningEnvelope.Build("{ não json", """{"headlines":["H"],"ctas":[]}""");
        Assert.NotNull(env);
        Assert.Contains("alternatives", env);
    }

    /// <summary>
    /// O CORAÇÃO do teste: o caminho da API (tipos fortes serializados) e o caminho do worker
    /// (JsonElement opaco → GetRawText) devem produzir JSON IDÊNTICO para o mesmo insumo lógico.
    /// Simula como cada caller invoca ReasoningEnvelope.Build hoje.
    /// </summary>
    [Fact]
    public void Caminho_API_e_caminho_worker_produzem_o_MESMO_envelope()
    {
        // API: tipos fortes (camelCase web) → string.
        var apiReasoning = JsonSerializer.Serialize(new { whyTemplate = "X", keyInsights = new[] { "a", "b" } }, Web);
        var apiAlternatives = JsonSerializer.Serialize(new { headlines = new[] { "H1", "H2" }, ctas = new[] { "C1" } }, Web);
        var apiEnvelope = ReasoningEnvelope.Build(apiReasoning, apiAlternatives);

        // Worker: o mesmo conteúdo chega como JsonElement (do JSON dos agents) → GetRawText().
        using var rDoc = JsonDocument.Parse(apiReasoning);
        using var aDoc = JsonDocument.Parse(apiAlternatives);
        var workerEnvelope = ReasoningEnvelope.Build(rDoc.RootElement.GetRawText(), aDoc.RootElement.GetRawText());

        Assert.Equal(apiEnvelope, workerEnvelope);
    }
}
