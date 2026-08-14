using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using SocialAi.Api.Domain;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Worker.Jobs;

/// <summary>
/// Cliente que INVENTA uma pauta a partir do worker (o cérebro do loop autônomo, ADR-0010/§2.4).
/// Análogo TEXTUAL do AgentsStartClient (que gera arte): POST /invent-pauta → pauta pronta
/// (título+objetivo+contexto). O worker não fala com LLM — delega ao agents, exatamente como faz
/// para gerar arte. Fecha o buraco do stub: em vez de texto fixo, o robô agora pede ao LLM uma
/// pauta RELEVANTE ao que a marca faz (BrandKit) + anti-repetição (títulos recentes).
///
/// Sem chave de IA → o agents devolve 503; este cliente devolve null (degradado honesto — o robô
/// NÃO cria pauta-lixo sem IA). NUNCA lança para o chamador: uma falha de invenção num workspace
/// não pode derrubar o loop.
/// </summary>
public sealed class AgentsInventClient(HttpClient http, SecretProtector protector)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    // ── DTOs do contrato /invent-pauta (subconjunto; nulls OMITIDOS) ────────────────────────────────
    private sealed record BrandCtx(
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Branding,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Tone,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Guidelines,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? PositioningRules,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? TargetAudience,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? DesiredContentTypes);

    private sealed record AiOverrideDto(string Provider, string? TextModel, string? ImageModel, string ApiKey);

    private sealed record InventRequest(
        BrandCtx Brand,
        string[] RecentTitles,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? DesiredFormat,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] AiOverrideDto? AiOverride);

    private sealed record StoredAi(string Provider, string? TextModel, string? ImageModel, string ApiKey);

    /// <summary>A pauta inventada — shape espelhado de InventedPauta (agents). null-safe no worker.</summary>
    public sealed record InventedPauta(
        string Title, string Objective, string Context, string Category,
        string MarketingObjective, string SuggestedType, string Rationale);

    /// <summary>
    /// Pede ao agents UMA pauta nova para a marca. Retorna a pauta ou null se o agents recusou/está
    /// fora do ar (sem chave de IA, JSON inválido, rede) — o robô trata null como "não inventou".
    /// <paramref name="aiSecret"/> é o Secret{AiProviderKey} do workspace (resolvido pelo chamador com
    /// predicado WorkspaceId explícito); null → o agents cai no .env (degradado honesto).
    /// </summary>
    public async Task<InventedPauta?> InventAsync(
        BrandKit? kit, IReadOnlyList<string> recentTitles, ContentType? desiredType,
        Secret? aiSecret, CancellationToken ct = default)
    {
        var req = new InventRequest(
            new BrandCtx(
                kit?.Branding, kit?.Tone, kit?.EditorialGuidelines, kit?.PositioningRules,
                kit?.TargetAudience, kit?.DesiredContentTypes),
            recentTitles.Where(t => !string.IsNullOrWhiteSpace(t)).Take(30).ToArray(),
            desiredType is null ? null : FormatOf(desiredType.Value),
            BuildAiOverride(aiSecret));

        try
        {
            var resp = await http.PostAsync("/invent-pauta",
                new StringContent(JsonSerializer.Serialize(req, Json), Encoding.UTF8, "application/json"), ct);
            if (!resp.IsSuccessStatusCode) return null;
            var pauta = JsonSerializer.Deserialize<InventedPauta>(await resp.Content.ReadAsStringAsync(ct), Json);
            return string.IsNullOrWhiteSpace(pauta?.Title) ? null : pauta;
        }
        catch (Exception) when (!ct.IsCancellationRequested)
        {
            return null; // agents dormindo/caiu/rede — o robô aguarda o próximo tick.
        }
    }

    private AiOverrideDto? BuildAiOverride(Secret? secret)
    {
        if (secret is null || string.IsNullOrEmpty(secret.EncryptedValue)) return null;
        try
        {
            var stored = JsonSerializer.Deserialize<StoredAi>(
                protector.Decrypt(secret.EncryptedValue),
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (stored is null || string.IsNullOrWhiteSpace(stored.ApiKey)) return null;
            return new AiOverrideDto(stored.Provider, stored.TextModel, stored.ImageModel, stored.ApiKey);
        }
        catch
        {
            return null; // chave corrompida/formato inválido → degradado honesto (cai no .env do agents).
        }
    }

    private static string FormatOf(ContentType t) => t switch
    {
        ContentType.Carousel => "carousel",
        ContentType.Story => "story",
        _ => "post",
    };

    /// <summary>Mapeia o suggestedType (string do agents) → ContentType do domínio. Default Post.</summary>
    public static ContentType ParseType(string? s) => s?.Trim().ToLowerInvariant() switch
    {
        "carousel" => ContentType.Carousel,
        "story" => ContentType.Story,
        _ => ContentType.Post,
    };
}
