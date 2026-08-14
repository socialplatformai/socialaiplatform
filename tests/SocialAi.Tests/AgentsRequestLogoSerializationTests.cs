using System.Text.Json;
using SocialAi.Api.Features.Content;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// Toggle "usar identidade do logo" no contrato api→agents (AgentsGenerateRequest.UseLogoIdentity).
/// Regra de payload (espelha RegenerationInstruction/ForcedTemplateId): OMITIDO quando null →
/// JSON byte-equivalente ao atual quando o toggle está desligado; PRESENTE (camelCase) quando true.
/// </summary>
public class AgentsRequestLogoSerializationTests
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private static AgentsGenerateRequest Req(bool? useLogo) =>
        new(new AgentsBrandContext("ws", null, null, null, [], [], null),
            new AgentsPauta("p", "t", null, null), "post",
            UseLogoIdentity: useLogo);

    [Fact]
    public void Null_omite_o_campo_do_json_payload_byte_equivalente()
    {
        var json = JsonSerializer.Serialize(Req(null), Web);
        Assert.DoesNotContain("useLogoIdentity", json);
    }

    [Fact]
    public void True_emite_useLogoIdentity_true_em_camelCase()
    {
        var json = JsonSerializer.Serialize(Req(true), Web);
        Assert.Contains("\"useLogoIdentity\":true", json);
    }
}
