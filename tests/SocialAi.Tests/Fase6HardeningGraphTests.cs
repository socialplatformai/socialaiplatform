using System.Net;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using SocialAi.Api.Domain;
using SocialAi.Worker.Publishing;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// FASE 6 (Eixos E) — hardening da integração com a Graph API:
///  E1: a versão da Graph API vem de CONFIG (GraphApiConfig), não hardcoded — a URL reflete a config.
///  E2: o check de rate-limit é FAIL-CLOSED — sem confirmação de cota (erro/corpo inesperado/exceção)
///      BLOQUEIA o publish (não arrisca ban da conta IG). Só LIBERA com quota_usage < 50 confirmado.
/// Doc oficial: GET /{ig-user-id}/content_publishing_limit (rate-limiting) + versionamento da Graph API.
/// </summary>
public class Fase6HardeningGraphTests
{
    // ── Stub de HttpClient roteado por substring de URL (rate-limit / container / publish) ──
    private sealed class RouteStub(Func<string, (HttpStatusCode, string)> route) : HttpMessageHandler
    {
        public List<string> Urls { get; } = [];
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var url = request.RequestUri!.ToString();
            Urls.Add(url);
            var (code, body) = route(url);
            return Task.FromResult(new HttpResponseMessage(code)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            });
        }
    }

    private static GraphApiConfig GraphCfg(string? version = null)
    {
        var values = new Dictionary<string, string?>();
        if (version is not null) values["Instagram:GraphVersion"] = version;
        var cfg = new ConfigurationBuilder().AddInMemoryCollection(values).Build();
        return new GraphApiConfig(cfg, NullLogger<GraphApiConfig>.Instance);
    }

    private static InstagramGraphPublisher Publisher(RouteStub stub, GraphApiConfig graph) =>
        new(new HttpClient(stub), NullLogger<InstagramGraphPublisher>.Instance, graph);

    private static PublishRequest Req() =>
        new(ContentType.Post, "legenda", new[] { "https://cdn.example/img.jpg" }, "ig-123", "tok-abc");

    // ── E1: a versão configurada aparece na URL versionada ───────────────────────
    [Fact]
    public void GraphApiConfig_usa_versao_de_config()
    {
        Assert.Equal("v23.0", GraphCfg("v23.0").Version);
        Assert.Equal("https://graph.instagram.com/v23.0", GraphCfg("v23.0").BaseUrl);
    }

    [Fact]
    public void GraphApiConfig_default_e_versao_invalida_caem_no_v22()
    {
        Assert.Equal("v22.0", GraphCfg(null).Version);          // sem config → default
        Assert.Equal("v22.0", GraphCfg("xpto").Version);        // formato inválido → default
        Assert.Equal("v22.0", GraphCfg("").Version);            // vazio → default
    }

    [Fact]
    public async Task E1_a_versao_de_config_e_usada_na_chamada_de_rate_limit()
    {
        // Rate-limit confirma cota baixa; o publish segue e chama o container — todas as URLs na v23.0.
        var stub = new RouteStub(url =>
            url.Contains("content_publishing_limit")
                ? (HttpStatusCode.OK, "{\"data\":[{\"quota_usage\":1}]}")
                : (HttpStatusCode.BadRequest, "{\"error\":\"para aqui no teste\"}")); // não publica de verdade
        await Publisher(stub, GraphCfg("v23.0")).PublishAsync(Req());

        Assert.Contains(stub.Urls, u => u.StartsWith("https://graph.instagram.com/v23.0/"));
        Assert.DoesNotContain(stub.Urls, u => u.Contains("/v22.0/"));
    }

    // ── E2: FAIL-CLOSED — sem confirmação de cota, bloqueia ──────────────────────
    [Fact]
    public async Task E2_rate_limit_indisponivel_HTTP_erro_bloqueia()
    {
        // O check de rate-limit responde erro → fail-closed: publish NÃO ocorre.
        var stub = new RouteStub(_ => (HttpStatusCode.InternalServerError, "{}"));
        var outcome = await Publisher(stub, GraphCfg()).PublishAsync(Req());

        Assert.False(outcome.Success);
        Assert.Equal("rate_limit_atingido", outcome.Error);
        // Só a chamada de rate-limit foi feita; nenhuma de container/publish.
        Assert.Single(stub.Urls);
        Assert.Contains("content_publishing_limit", stub.Urls[0]);
    }

    [Fact]
    public async Task E2_rate_limit_corpo_sem_quota_bloqueia()
    {
        // HTTP 200 mas corpo sem 'quota_usage' → não confirma cota → fail-closed.
        var stub = new RouteStub(_ => (HttpStatusCode.OK, "{\"data\":[]}"));
        var outcome = await Publisher(stub, GraphCfg()).PublishAsync(Req());

        Assert.False(outcome.Success);
        Assert.Equal("rate_limit_atingido", outcome.Error);
    }

    [Fact]
    public async Task E2_cota_esgotada_bloqueia()
    {
        // quota_usage >= 50 (limite 50/24h) → bloqueia.
        var stub = new RouteStub(_ => (HttpStatusCode.OK, "{\"data\":[{\"quota_usage\":50}]}"));
        var outcome = await Publisher(stub, GraphCfg()).PublishAsync(Req());

        Assert.False(outcome.Success);
        Assert.Equal("rate_limit_atingido", outcome.Error);
    }

    [Fact]
    public async Task E2_cota_disponivel_libera_o_publish()
    {
        // quota_usage < 50 confirmado → o circuit breaker LIBERA e o fluxo prossegue (chama container).
        var stub = new RouteStub(url =>
            url.Contains("content_publishing_limit")
                ? (HttpStatusCode.OK, "{\"data\":[{\"quota_usage\":10}]}")
                : (HttpStatusCode.BadRequest, "{\"error\":\"para aqui (não é o foco do teste)\"}"));
        var outcome = await Publisher(stub, GraphCfg()).PublishAsync(Req());

        // Passou do rate-limit (não é "rate_limit_atingido"); falhou depois, no container (esperado).
        Assert.False(outcome.Success);
        Assert.NotEqual("rate_limit_atingido", outcome.Error);
        Assert.Contains(stub.Urls, u => u.Contains("/media")); // chegou a tentar criar o container
    }
}
