using SocialAi.Api.Features.Content;
using SocialAi.Api.Features.Usage;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// C (ADR-0008) — estimador de custo (usage × tabela de preço por modelo). Sem rede: pura.
///  - custo = tokens/1k × preço + imagens × preço por imagem;
///  - SEM usage (mock/sem chave real) → custo 0 (modo mock não gasta);
///  - modelo desconhecido → cai no default (heurística), nunca lança.
/// </summary>
public class UsageCostEstimatorTests
{
    [Fact]
    public void Sem_usage_custo_zero_modo_mock()
    {
        // Mock: a geração não reportou uso → custo 0 (não inventa gasto).
        Assert.Equal(0m, UsageCostEstimator.Estimate(null, "gpt-4.1", "gpt-image-1"));
    }

    [Fact]
    public void Usage_zerado_custo_zero()
    {
        var usage = new AgentsUsage(0, 0, 0);
        Assert.Equal(0m, UsageCostEstimator.Estimate(usage, "gpt-4.1", "gpt-image-1"));
    }

    [Fact]
    public void Custo_e_tokens_vezes_preco_mais_imagens()
    {
        // gpt-4.1: input 0.0020/1k, output 0.0080/1k ; gpt-image-1: 0.0400/imagem.
        // 1000 in → 0.0020 ; 1000 out → 0.0080 ; 2 imagens → 0.0800. Total = 0.0900.
        var usage = new AgentsUsage(1000, 1000, 2);
        var custo = UsageCostEstimator.Estimate(usage, "gpt-4.1", "gpt-image-1");
        Assert.Equal(0.0900m, custo);
    }

    [Fact]
    public void Gemini_flash_e_barato_e_casa_por_substring()
    {
        // models/gemini-flash-latest → casa "flash" (0.0003 in / 0.0010 out); imagem gemini 0.0300.
        // 2000 in → 0.0006 ; 1000 out → 0.0010 ; 1 imagem → 0.0300. Total = 0.0316.
        var usage = new AgentsUsage(2000, 1000, 1);
        var custo = UsageCostEstimator.Estimate(usage, "models/gemini-flash-latest", "models/gemini-2.5-flash-image");
        Assert.Equal(0.0316m, custo);
    }

    [Fact]
    public void Modelo_nulo_ou_desconhecido_usa_default_sem_lancar()
    {
        // Modelos null (env-driven, não configurados) → defaults (0.0010 in / 0.0030 out / 0.0400 img).
        // 1000 in → 0.0010 ; 1000 out → 0.0030 ; 1 imagem → 0.0400. Total = 0.0440.
        var usage = new AgentsUsage(1000, 1000, 1);
        var custo = UsageCostEstimator.Estimate(usage, null, null);
        Assert.Equal(0.0440m, custo);

        // Modelo com nome que não casa nenhuma entrada → também cai no default (não lança).
        var custo2 = UsageCostEstimator.Estimate(new AgentsUsage(1000, 0, 0), "modelo-inexistente-xyz", null);
        Assert.Equal(0.0010m, custo2);
    }
}
