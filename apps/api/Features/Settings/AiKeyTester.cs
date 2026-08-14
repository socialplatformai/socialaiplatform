using System.Net;
using System.Net.Http.Headers;

namespace SocialAi.Api.Features.Settings;

/// <summary>Resultado de um teste de conexão de IA. `Detail` é PT-BR e NUNCA inclui a apiKey.</summary>
public record AiTestResult(bool Ok, string Detail);

/// <summary>
/// Testa a chave de IA fazendo uma chamada MÍNIMA ao provider (B3/ADR-0008). Abstraído
/// atrás de interface para que o controller seja testável sem rede (o teste injeta um fake).
/// A implementação real NUNCA ecoa a chave no Detail — só o status/diagnóstico.
/// </summary>
public interface IAiKeyTester
{
    /// <summary>Faz uma chamada de baixo custo ao provider. Não lança: traduz tudo p/ AiTestResult.</summary>
    Task<AiTestResult> TestAsync(string provider, string apiKey, string? textModel, CancellationToken ct = default);
}

/// <summary>
/// Implementação HTTP do teste de chave. Cada provider tem uma chamada barata:
///  - openai: GET /v1/models (Bearer) — 200 = chave ok; 401 = chave inválida.
///  - gemini: GET /v1/models?key=… — 200 = ok; 400/403 = chave inválida.
/// Provider sem suporte de teste → ok:false com detalhe claro (caso ii do B3).
/// Erro de rede/timeout → ok:false com detalhe neutro (caso iii). A chave nunca aparece
/// no Detail (só "openai"/"gemini" + status). Fail-open NÃO se aplica aqui: é um teste,
/// não o caminho de geração — reportamos honestamente o que aconteceu.
/// </summary>
public class AiKeyTester(IHttpClientFactory httpFactory) : IAiKeyTester
{
    public async Task<AiTestResult> TestAsync(
        string provider, string apiKey, string? textModel, CancellationToken ct = default)
    {
        var p = (provider ?? "").Trim().ToLowerInvariant();
        try
        {
            return p switch
            {
                "openai" => await TestOpenAiAsync(apiKey, ct),
                "gemini" => await TestGeminiAsync(apiKey, ct),
                "grok" => await TestGrokAsync(apiKey, ct),
                "anthropic" => await TestAnthropicAsync(apiKey, ct),
                // Caso (ii): provider conhecido pelo modelo mas sem teste de conexão implementado.
                _ => new AiTestResult(false,
                    $"Provider '{provider}' não tem teste de conexão disponível. Salve uma chave de gemini, openai, grok ou anthropic."),
            };
        }
        catch (OperationCanceledException)
        {
            // Caso (iii): timeout/cancelamento — sem eco da chave.
            return new AiTestResult(false, "Tempo esgotado ao contatar o provider de IA. Tente novamente.");
        }
        catch (HttpRequestException ex)
        {
            // Caso (iii): erro de rede — mensagem neutra, sem a chave.
            return new AiTestResult(false, $"Erro de rede ao contatar o provider de IA: {ex.Message}");
        }
    }

    private async Task<AiTestResult> TestOpenAiAsync(string apiKey, CancellationToken ct)
    {
        var http = httpFactory.CreateClient();
        http.Timeout = TimeSpan.FromSeconds(15);
        using var req = new HttpRequestMessage(HttpMethod.Get, "https://api.openai.com/v1/models");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        using var resp = await http.SendAsync(req, ct);

        if (resp.IsSuccessStatusCode)
            return new AiTestResult(true, "Conexão com a OpenAI validada com sucesso.");
        if (resp.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            return new AiTestResult(false, "Chave da OpenAI inválida ou sem permissão (HTTP 401/403).");
        return new AiTestResult(false, $"A OpenAI respondeu com erro (HTTP {(int)resp.StatusCode}).");
    }

    private async Task<AiTestResult> TestGeminiAsync(string apiKey, CancellationToken ct)
    {
        var http = httpFactory.CreateClient();
        http.Timeout = TimeSpan.FromSeconds(15);
        // A chave vai na query (padrão do Generative Language API). NÃO é logada — o Detail
        // abaixo nunca a inclui; só o status. Uri.EscapeDataString evita quebrar a URL.
        var url = $"https://generativelanguage.googleapis.com/v1beta/models?key={Uri.EscapeDataString(apiKey)}";
        using var resp = await http.GetAsync(url, ct);

        if (resp.IsSuccessStatusCode)
            return new AiTestResult(true, "Conexão com o Gemini validada com sucesso.");
        if (resp.StatusCode is HttpStatusCode.BadRequest or HttpStatusCode.Forbidden or HttpStatusCode.Unauthorized)
            return new AiTestResult(false, "Chave do Gemini inválida ou sem permissão (HTTP 400/401/403).");
        return new AiTestResult(false, $"O Gemini respondeu com erro (HTTP {(int)resp.StatusCode}).");
    }

    // xAI/Grok: endpoint OpenAI-compatible. GET /v1/models com Bearer — 200 = chave ok; 401/403 = inválida.
    private async Task<AiTestResult> TestGrokAsync(string apiKey, CancellationToken ct)
    {
        var http = httpFactory.CreateClient();
        http.Timeout = TimeSpan.FromSeconds(15);
        using var req = new HttpRequestMessage(HttpMethod.Get, "https://api.x.ai/v1/models");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        using var resp = await http.SendAsync(req, ct);

        if (resp.IsSuccessStatusCode)
            return new AiTestResult(true, "Conexão com o Grok (xAI) validada com sucesso.");
        if (resp.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            return new AiTestResult(false, "Chave do Grok (xAI) inválida ou sem permissão (HTTP 401/403).");
        return new AiTestResult(false, $"O Grok (xAI) respondeu com erro (HTTP {(int)resp.StatusCode}).");
    }

    // Anthropic/Claude: GET /v1/models valida a chave (x-api-key + anthropic-version obrigatórios).
    // Não custa tokens (não é geração). 200 = ok; 401 = chave inválida.
    private async Task<AiTestResult> TestAnthropicAsync(string apiKey, CancellationToken ct)
    {
        var http = httpFactory.CreateClient();
        http.Timeout = TimeSpan.FromSeconds(15);
        using var req = new HttpRequestMessage(HttpMethod.Get, "https://api.anthropic.com/v1/models");
        req.Headers.Add("x-api-key", apiKey); // NÃO Authorization: Bearer
        req.Headers.Add("anthropic-version", "2023-06-01"); // obrigatório
        using var resp = await http.SendAsync(req, ct);

        if (resp.IsSuccessStatusCode)
            return new AiTestResult(true, "Conexão com o Claude (Anthropic) validada com sucesso.");
        if (resp.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            return new AiTestResult(false, "Chave do Claude (Anthropic) inválida ou sem permissão (HTTP 401/403).");
        return new AiTestResult(false, $"O Claude (Anthropic) respondeu com erro (HTTP {(int)resp.StatusCode}).");
    }
}
