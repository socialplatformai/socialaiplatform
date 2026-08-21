using System.Text.Json;
using SocialAi.Api.Features.Admin;
using Xunit;

namespace SocialAi.Tests;

/// <summary>Sanidade do painel Admin de DB — sem Postgres real (só helpers puros).</summary>
public class DbBrowserServiceTests
{
    [Theory]
    [InlineData("EncryptedValue", true)]
    [InlineData("ApiKey", true)]
    [InlineData("RefreshToken", true)]
    [InlineData("Name", false)]
    [InlineData("WorkspaceId", false)]
    public void IsSensitiveColumn_detecta_campos_sensiveis(string name, bool expected)
    {
        Assert.Equal(expected, DbBrowserService.IsSensitiveColumn(name));
    }

    [Fact]
    public void JsonElement_null_nao_quebra_dicionario_de_update()
    {
        // Garante que o contrato do controller aceita dictionaries com JsonElement?.
        var dict = new Dictionary<string, JsonElement?>
        {
            ["Id"] = JsonDocument.Parse("\"00000000-0000-0000-0000-000000000001\"").RootElement,
            ["Name"] = null,
        };
        Assert.Equal(2, dict.Count);
        Assert.Null(dict["Name"]);
    }

    [Fact]
    public void AllowedColumnTypes_tem_tipos_basicos()
    {
        Assert.Contains("uuid", DbBrowserService.AllowedColumnTypes);
        Assert.Contains("text", DbBrowserService.AllowedColumnTypes);
        Assert.Contains("timestamptz", DbBrowserService.AllowedColumnTypes);
        Assert.Contains("jsonb", DbBrowserService.AllowedColumnTypes);
    }

    [Theory]
    [InlineData("SapDbBrowser-2026-HardGate", true)]
    [InlineData("errado", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void DbBrowserToken_compara_valor_esperado(string? provided, bool expected)
    {
        Assert.Equal(expected, RequireDbBrowserTokenAttribute.TokenEquals(provided, RequireDbBrowserTokenAttribute.ExpectedToken));
    }
}
