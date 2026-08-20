using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Settings;

// B2: o GET devolve só metadados — provider/modelos + flag. A apiKey NUNCA volta em claro.
public record AiConfigDto(bool Configured, string? Provider, string? TextModel, string? ImageModel);
// B1: o POST recebe a chave; ela é cifrada (AES-GCM) e some — não há GET que a devolva.
// ApiKey pode vir vazia/null quando já há config: atualiza só provider/modelos e REUSA a chave salva.
public record SaveAiConfigRequest(string Provider, string? TextModel, string? ImageModel, string? ApiKey = null);
// B3: resultado do teste — sempre HTTP 200; ok distingue sucesso de falha. Detail é PT-BR
// e NUNCA inclui a apiKey.
public record AiTestResponse(bool Ok, string Detail);

/// <summary>
/// Configuração de IA POR WORKSPACE (B/ADR-0008): provider/modelo/chave cifrada por workspace.
/// Espelha MetaAppConfigController (record Stored cifrado, FirstOrDefaultAsync por Kind).
/// Restrito a Admin (B6). 🔴 A apiKey é cifrada em repouso (SecretProtector) e NUNCA volta
/// em GET nem aparece em mensagem de erro/teste (R-9: chave vazada = budget sequestrado).
/// </summary>
[ApiController]
[Route("api/settings/ai")]
[Authorize(Roles = "Admin")]
public class AiConfigController(
    AppDbContext db, SecretProtector protector, IAiKeyTester tester) : ControllerBase
{
    // Valor cifrado guarda { provider, textModel, imageModel, apiKey } juntos. Só a apiKey
    // é sensível; cifrar tudo num registro evita 2ª linha/coluna (zero migration — reusa
    // a tabela secrets e SecretKind.AiProviderKey já existente).
    private record Stored(string Provider, string? TextModel, string? ImageModel, string ApiKey);

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    // Provedores suportados pelo serviço agents (espelha ProviderKind em config.ts). Whitelist na
    // borda: salvar um provider desconhecido falharia silenciosamente no agents (cairia no default
    // gemini), confundindo o operador. Validar aqui dá erro claro e imediato na UI.
    private static readonly HashSet<string> SupportedProviders =
        new(StringComparer.OrdinalIgnoreCase) { "gemini", "openai", "grok", "anthropic" };

    // Defaults explícitos (espelham services/agents AI_DEFAULTS / defaultModelFor). Gravamos estes
    // quando o operador deixa em branco — evita cair num AI_IMAGE_MODEL inválido no env do Agents
    // (já vimos e-mail virar "modelo" → Gemini HTTP 404).
    private static readonly Dictionary<string, (string Text, string? Image)> DefaultModels =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["gemini"] = ("models/gemini-3.5-flash", "models/gemini-3.1-flash-image"),
            ["openai"] = ("gpt-5.5", "gpt-image-2"),
            ["grok"] = ("grok-4.3", null),
            ["anthropic"] = ("claude-opus-4-8", null),
        };

    [HttpGet]
    public async Task<ActionResult<AiConfigDto>> Get()
    {
        var secret = await db.Secrets.FirstOrDefaultAsync(s => s.Kind == SecretKind.AiProviderKey);
        if (secret is null || string.IsNullOrEmpty(secret.EncryptedValue))
            return Ok(new AiConfigDto(false, null, null, null));

        var stored = JsonSerializer.Deserialize<Stored>(protector.Decrypt(secret.EncryptedValue), JsonOpts);
        // B2: devolve provider/modelos (não-sensíveis); a apiKey fica de fora — a presença
        // do secret vira o flag Configured. Modelos inválidos (ex.: e-mail) são omitidos na UI
        // para o operador poder escolher de novo (a geração também sanitiza no BuildAiOverride).
        return Ok(new AiConfigDto(
            true,
            stored?.Provider,
            SanitizeModel(stored?.TextModel),
            SanitizeModel(stored?.ImageModel)));
    }

    [HttpPost]
    public async Task<IActionResult> Save(SaveAiConfigRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Provider))
            return Problem("Provider é obrigatório.", statusCode: 400);

        var provider = req.Provider.Trim().ToLowerInvariant();
        if (!SupportedProviders.Contains(provider))
            return Problem(
                $"Provedor '{req.Provider}' não suportado. Use: gemini, openai, grok ou anthropic.",
                statusCode: 400);

        if (LooksLikeEmail(req.TextModel) || LooksLikeEmail(req.ImageModel))
            return Problem(
                "Modelo inválido: o valor parece um e-mail. Escolha um modelo da lista (ex.: models/gemini-3.1-flash-image).",
                statusCode: 400);

        var secret = await db.Secrets.FirstOrDefaultAsync(s => s.Kind == SecretKind.AiProviderKey);
        var newKey = req.ApiKey?.Trim();
        string apiKeyToStore;

        if (!string.IsNullOrWhiteSpace(newKey))
        {
            // Defesa: a chave NÃO pode parecer id de modelo (troca de campos).
            if (newKey.StartsWith("models/", StringComparison.OrdinalIgnoreCase) || LooksLikeEmail(newKey))
                return Problem(
                    "A chave de IA parece inválida (parece e-mail ou id de modelo). Cole a API key do provedor.",
                    statusCode: 400);
            apiKeyToStore = newKey;
        }
        else if (secret is not null && !string.IsNullOrEmpty(secret.EncryptedValue))
        {
            var existing = JsonSerializer.Deserialize<Stored>(protector.Decrypt(secret.EncryptedValue), JsonOpts);
            if (existing is null || string.IsNullOrWhiteSpace(existing.ApiKey))
                return Problem("Configuração de IA inválida. Informe a chave de IA para salvar.", statusCode: 400);
            apiKeyToStore = existing.ApiKey;
        }
        else
        {
            return Problem("Provider e chave de IA são obrigatórios na primeira configuração.", statusCode: 400);
        }

        // Resolve modelos: valor do form → default do provedor. Nunca persiste null para
        // gemini/openai (imagem) — senão o Agents cai no env e pode herdar AI_IMAGE_MODEL quebrado.
        var defaults = DefaultModels[provider];
        var textModel = SanitizeModel(req.TextModel) ?? defaults.Text;
        var imageModel = provider is "grok" or "anthropic"
            ? null
            : (SanitizeModel(req.ImageModel) ?? defaults.Image);

        var payload = JsonSerializer.Serialize(new Stored(provider, textModel, imageModel, apiKeyToStore));
        var encrypted = protector.Encrypt(payload);

        if (secret is null)
        {
            secret = new Secret { Kind = SecretKind.AiProviderKey };
            db.Secrets.Add(secret);
        }
        secret.EncryptedValue = encrypted;
        await db.SaveChangesAsync();

        return Ok(new AiConfigDto(true, provider, textModel, imageModel));
    }

    /// <summary>
    /// B3: testa a chave salva contra o provider. SEMPRE responde HTTP 200; `ok` distingue
    /// sucesso de falha (chave inválida, provider sem teste, rede/timeout). O Detail é PT-BR
    /// e NUNCA inclui a apiKey — só o status/diagnóstico.
    /// </summary>
    [HttpPost("test")]
    public async Task<ActionResult<AiTestResponse>> Test()
    {
        var secret = await db.Secrets.FirstOrDefaultAsync(s => s.Kind == SecretKind.AiProviderKey);
        if (secret is null || string.IsNullOrEmpty(secret.EncryptedValue))
            return Ok(new AiTestResponse(false, "Nenhuma chave de IA configurada. Salve uma chave antes de testar."));

        var stored = JsonSerializer.Deserialize<Stored>(protector.Decrypt(secret.EncryptedValue), JsonOpts);
        if (stored is null || string.IsNullOrWhiteSpace(stored.ApiKey))
            return Ok(new AiTestResponse(false, "Configuração de IA inválida. Salve a chave novamente."));

        var textModel = SanitizeModel(stored.TextModel);
        var result = await tester.TestAsync(
            stored.Provider, stored.ApiKey, textModel, HttpContext.RequestAborted);
        return Ok(new AiTestResponse(result.Ok, result.Detail));
    }

    [HttpDelete]
    public async Task<IActionResult> Delete()
    {
        var secret = await db.Secrets.FirstOrDefaultAsync(s => s.Kind == SecretKind.AiProviderKey);
        if (secret is null) return NoContent();
        db.Secrets.Remove(secret);
        await db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Null se vazio ou inválido (e-mail / lixo). Usado em GET/Save/teste e pela ContentController.</summary>
    public static string? SanitizeModel(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var v = value.Trim();
        if (LooksLikeEmail(v)) return null;
        return v;
    }

    private static bool LooksLikeEmail(string? value) =>
        !string.IsNullOrWhiteSpace(value) && value.Contains('@') && value.Contains('.');
}
