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
public record SaveAiConfigRequest(string Provider, string? TextModel, string? ImageModel, string ApiKey);
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

    // Provedores suportados pelo serviço agents (espelha ProviderKind em config.ts). Whitelist na
    // borda: salvar um provider desconhecido falharia silenciosamente no agents (cairia no default
    // gemini), confundindo o operador. Validar aqui dá erro claro e imediato na UI.
    private static readonly HashSet<string> SupportedProviders =
        new(StringComparer.OrdinalIgnoreCase) { "gemini", "openai", "grok", "anthropic" };

    [HttpGet]
    public async Task<ActionResult<AiConfigDto>> Get()
    {
        var secret = await db.Secrets.FirstOrDefaultAsync(s => s.Kind == SecretKind.AiProviderKey);
        if (secret is null || string.IsNullOrEmpty(secret.EncryptedValue))
            return Ok(new AiConfigDto(false, null, null, null));

        var stored = JsonSerializer.Deserialize<Stored>(protector.Decrypt(secret.EncryptedValue));
        // B2: devolve provider/modelos (não-sensíveis); a apiKey fica de fora — a presença
        // do secret vira o flag Configured. NÃO existe campo apiKey neste DTO, por construção.
        return Ok(new AiConfigDto(true, stored?.Provider, stored?.TextModel, stored?.ImageModel));
    }

    [HttpPost]
    public async Task<IActionResult> Save(SaveAiConfigRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Provider) || string.IsNullOrWhiteSpace(req.ApiKey))
            return Problem("Provider e chave de IA são obrigatórios.", statusCode: 400);

        if (!SupportedProviders.Contains(req.Provider.Trim()))
            return Problem(
                $"Provedor '{req.Provider}' não suportado. Use: gemini, openai, grok ou anthropic.",
                statusCode: 400);

        var payload = JsonSerializer.Serialize(new Stored(
            req.Provider.Trim().ToLowerInvariant(),
            string.IsNullOrWhiteSpace(req.TextModel) ? null : req.TextModel.Trim(),
            string.IsNullOrWhiteSpace(req.ImageModel) ? null : req.ImageModel.Trim(),
            req.ApiKey.Trim()));
        var encrypted = protector.Encrypt(payload);

        var secret = await db.Secrets.FirstOrDefaultAsync(s => s.Kind == SecretKind.AiProviderKey);
        if (secret is null)
        {
            secret = new Secret { Kind = SecretKind.AiProviderKey };
            db.Secrets.Add(secret);
        }
        secret.EncryptedValue = encrypted;
        await db.SaveChangesAsync();

        // Eco só de metadados (a apiKey NUNCA volta).
        return Ok(new AiConfigDto(true,
            req.Provider.Trim().ToLowerInvariant(),
            string.IsNullOrWhiteSpace(req.TextModel) ? null : req.TextModel.Trim(),
            string.IsNullOrWhiteSpace(req.ImageModel) ? null : req.ImageModel.Trim()));
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

        var stored = JsonSerializer.Deserialize<Stored>(protector.Decrypt(secret.EncryptedValue));
        if (stored is null || string.IsNullOrWhiteSpace(stored.ApiKey))
            return Ok(new AiTestResponse(false, "Configuração de IA inválida. Salve a chave novamente."));

        var result = await tester.TestAsync(
            stored.Provider, stored.ApiKey, stored.TextModel, HttpContext.RequestAborted);
        // O tester já devolve um Detail PT-BR sem a chave; só repassamos (HTTP 200 sempre).
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
}
