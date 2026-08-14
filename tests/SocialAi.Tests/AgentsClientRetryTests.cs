using System.Net;
using System.Text;
using SocialAi.Api.Features.Content;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// Cold-start do agents (Render free dorme ~15min): a 1ª chamada após o sono falha (502/503 do
/// proxy ou conexão) enquanto ele acorda. StartAsync ABSORVE isso re-tentando o erro TRANSITÓRIO
/// (Unavailable) com backoff — só vira 503 ao operador se esgotar. Erros não-transitórios (429,
/// credencial) NÃO re-tentam (não adianta esperar). Estes testes guardam essas duas regras.
/// </summary>
public class AgentsClientRetryTests
{
    // Handler que responde conforme uma sequência de status; conta as chamadas a /generate.
    private sealed class SeqStub(params (HttpStatusCode code, string body)[] responses) : HttpMessageHandler
    {
        public int Calls { get; private set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var i = Math.Min(Calls, responses.Length - 1);
            Calls++;
            var (code, body) = responses[i];
            return Task.FromResult(new HttpResponseMessage(code)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            });
        }
    }

    private static AgentsClient Client(SeqStub stub) =>
        new(new HttpClient(stub) { BaseAddress = new Uri("http://agents.test") });

    private static AgentsGenerateRequest Req() =>
        new(new AgentsBrandContext("ws", null, null, null, [], [], null), new AgentsPauta("p", "t", null, null), "post");

    [Fact]
    public async Task StartAsync_retoma_apos_cold_start_503_e_sucede()
    {
        // 2 respostas 503 (agents acordando) e depois 202 com jobId → deve re-tentar e devolver o id.
        var stub = new SeqStub(
            (HttpStatusCode.ServiceUnavailable, "{}"),
            (HttpStatusCode.ServiceUnavailable, "{}"),
            (HttpStatusCode.Accepted, "{\"jobId\":\"job-123\",\"status\":\"queued\"}"));

        var jobId = await Client(stub).StartAsync(Req());

        Assert.Equal("job-123", jobId);
        Assert.Equal(3, stub.Calls); // 2 falhas + 1 sucesso
    }

    [Fact]
    public async Task StartAsync_nao_retenta_429_falha_na_hora()
    {
        // 429 (rate-limit do provedor) NÃO é cold-start → não adianta re-tentar; falha já.
        var stub = new SeqStub((HttpStatusCode.TooManyRequests, "{\"error\":\"rate\"}"));

        var ex = await Assert.ThrowsAsync<AgentsUnavailableException>(() => Client(stub).StartAsync(Req()));

        Assert.Equal(AgentsErrorKind.RateLimited, ex.Kind);
        Assert.Equal(1, stub.Calls); // uma só — sem retry
    }
}
