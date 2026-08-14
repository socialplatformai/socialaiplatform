using System.Text.Json;
using SocialAi.Api.Features.Content;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// FASE 0 (auditoria — fundação de input criativo): direção criativa por-geração no contrato
/// api→agents (AgentsGenerateRequest.CreativeInput). Regra de payload (espelha UseLogoIdentity/
/// RegenerationInstruction): OMITIDO quando null → JSON byte-equivalente ao atual quando o operador
/// não preencheu nada; PRESENTE (camelCase, "creativeInput") com os campos fornecidos.
/// </summary>
public class AgentsRequestCreativeInputSerializationTests
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private static AgentsGenerateRequest Req(AgentsCreativeInput? creative) =>
        new(new AgentsBrandContext("ws", null, null, null, [], [], null),
            new AgentsPauta("p", "t", null, null), "post",
            CreativeInput: creative);

    [Fact]
    public void Null_omite_o_campo_do_json_payload_byte_equivalente()
    {
        var json = JsonSerializer.Serialize(Req(null), Web);
        Assert.DoesNotContain("creativeInput", json);
    }

    [Fact]
    public void Preenchido_emite_creativeInput_em_camelCase_com_os_campos()
    {
        // Valores ASCII para a asserção literal de JSON (o serializer Web escapa não-ASCII como \uXXXX;
        // o encoding é ortogonal ao que este teste verifica — presença + camelCase do contrato).
        var json = JsonSerializer.Serialize(
            Req(new AgentsCreativeInput("https://cdn/ref.png", "https://cdn/fundo.jpg", "Garanta o seu", "Edicao limitada")),
            Web);
        Assert.Contains("\"creativeInput\":", json);
        Assert.Contains("\"referenceUrl\":\"https://cdn/ref.png\"", json);
        Assert.Contains("\"backgroundUrl\":\"https://cdn/fundo.jpg\"", json);
        Assert.Contains("\"cta\":\"Garanta o seu\"", json);
        Assert.Contains("\"subtitle\":\"Edicao limitada\"", json);
    }
}
