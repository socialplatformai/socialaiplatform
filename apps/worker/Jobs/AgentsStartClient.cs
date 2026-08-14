using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using SocialAi.Api.Domain;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Worker.Jobs;

/// <summary>
/// Fase 2 (task 2.3) — cliente que INICIA a geração real a partir do worker (o robô). Contraparte de
/// escrita do AgentsPollClient (que só lê): POST /generate → { jobId }. Fecha o elo worker→agents que
/// faltava — o robô agora dispara a MESMA pipeline de 6 agentes que o wizard, deixando o
/// GeneratingReaperJob reconciliar o resultado (slides + QualityScore) exatamente como faz para as
/// gerações do navegador. Sem novo caminho de persistência: reusa o reaper.
///
/// Request MÍNIMO-mas-honesto: workspaceId + o essencial do BrandKit (tom, identidade, público) +
/// pauta + formato + o AiOverride (chave de IA do workspace, decifrada). Campos opcionais do contrato
/// (templates, hashtags, learning) são omitidos — o agents degrada com graça (o pipeline não exige).
/// O que NÃO omitimos é a chave: sem AiOverride e sem AI_PROVIDER_KEY no ambiente do agents, a
/// geração falha (fronteira honesta — o robô não inventa arte sem chave).
///
/// Espelha o subconjunto de escrita do contrato (services/agents/src/types.ts), camelCase. O
/// x-internal-token é setado no DI (Program.cs) — o agents o exige quando AGENTS_INTERNAL_TOKEN existe.
/// </summary>
public sealed class AgentsStartClient(HttpClient http, SecretProtector protector)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    // ── DTOs do contrato /generate (subconjunto necessário; campos null são OMITIDOS) ──────────────
    private sealed record BrandContext(
        string WorkspaceId,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Branding,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Tone,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Guidelines,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? PositioningRules,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? TargetAudience,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? LearningSummary,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Handle);

    private sealed record PautaDto(
        string Id, string Title,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Objective,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Context,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Category,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? MarketingObjective);

    private sealed record AiOverrideDto(string Provider, string? TextModel, string? ImageModel, string ApiKey);

    private sealed record GenerateRequest(
        BrandContext BrandContext, PautaDto Pauta, string Format,
        [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] AiOverrideDto? AiOverride);

    private sealed record Accepted(string JobId, string Status);

    // Espelha o Stored cifrado de AiConfigController (mesmo shape do StoredAi da API).
    private sealed record StoredAi(string Provider, string? TextModel, string? ImageModel, string ApiKey);

    /// <summary>
    /// Inicia a geração de UMA pauta. Retorna o jobId (o reaper reconcilia depois) ou null se o agents
    /// recusou/está fora do ar — o robô trata null como "não gerou" (degradado honesto, não quebra o
    /// tick). NUNCA lança para o chamador: uma falha de geração de um workspace não pode derrubar o robô.
    /// <paramref name="aiSecret"/> é o Secret{AiProviderKey} do workspace (já resolvido pelo robô com
    /// predicado WorkspaceId explícito — o worker roda sem filtro de tenant); null → o agents cai no .env.
    /// </summary>
    public async Task<string?> StartAsync(
        Workspace ws, Pauta pauta, string? handle, string? learningSummary,
        BrandKit? kit, Secret? aiSecret, CancellationToken ct = default)
    {
        var req = new GenerateRequest(
            new BrandContext(
                ws.Id.ToString(),
                kit?.Branding, kit?.Tone, kit?.EditorialGuidelines, kit?.PositioningRules,
                kit?.TargetAudience, learningSummary, handle),
            new PautaDto(
                pauta.Id.ToString(), pauta.Title, pauta.Objective, pauta.Context,
                pauta.Category, pauta.MarketingObjective),
            FormatOf(pauta.DesiredType),
            BuildAiOverride(aiSecret));

        try
        {
            var resp = await http.PostAsync("/generate",
                new StringContent(JsonSerializer.Serialize(req, Json), Encoding.UTF8, "application/json"), ct);
            if (!resp.IsSuccessStatusCode) return null;
            var accepted = JsonSerializer.Deserialize<Accepted>(await resp.Content.ReadAsStringAsync(ct), Json);
            return string.IsNullOrEmpty(accepted?.JobId) ? null : accepted.JobId;
        }
        catch (Exception) when (!ct.IsCancellationRequested)
        {
            return null; // agents dormindo/caiu/rede — o robô aguarda o próximo tick.
        }
    }

    /// <summary>
    /// Decifra o Secret{AiProviderKey} do workspace → AiOverride, análogo ao BuildAiOverrideAsync da API.
    /// Sem Secret/chave → null (o agents cai no .env — degradado honesto). A chave só entra no payload
    /// ao agents; nunca é logada.
    /// </summary>
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
}
