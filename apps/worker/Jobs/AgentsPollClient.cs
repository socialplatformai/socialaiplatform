using System.Text.Json;
using System.Text.Json.Serialization;
using SocialAi.Api.Generation;

namespace SocialAi.Worker.Jobs;

/// <summary>
/// Cliente MÍNIMO do microserviço agents para o reconciliador (B4/D3): só consulta
/// GET /generate/{jobId}. NÃO inicia geração (isso é da API). Mapeia o Job → GenerationOutcome
/// (tipo neutro de Core) quando done, p/ o GenerationCompletionService persistir o resultado e o
/// gasto — o MESMO dono usado pelo poll da API (sem duplicar a transição).
///
/// Espelha o subconjunto necessário do contrato (services/agents/src/types.ts), camelCase.
/// x-internal-token é setado no DI (Program.cs) — o agents exige quando AGENTS_INTERNAL_TOKEN existe.
/// </summary>
public sealed class AgentsPollClient(HttpClient http)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    // FASE 1 (ADR-0014): RenderHtml removido (B2); Layers é JSON OPACO (espelha o AgentsSlide da API).
    private sealed record AgentsSlide(int Index, string? Copy, string? ImageUrl, JsonElement? Layers = null);
    private sealed record AgentsQuality(int Score, bool Passed);
    // F5 (Eixo D): uso real (tokens + nº de imagens + provider/modelos) p/ custo por modelo no SpendEntry.
    private sealed record AgentsUsage(
        int TextInputTokens, int TextOutputTokens, int ImageCount,
        string? Provider = null, string? TextModel = null, string? ImageModel = null);
    // AI-native: raciocínio dos agentes (reveal). JsonElement opaco — reserializado verbatim p/ persistir.
    // G4: alternatives (opções A/B) viajam como JsonElement opaco e são enxertadas no MESMO envelope
    // ReasoningJson (espelha BuildReasoningEnvelope da API) — para o reaper do worker não perdê-las.
    private sealed record AgentsResult(
        IEnumerable<AgentsSlide> Slides, string Caption, string Cta, IEnumerable<string> Hashtags,
        AgentsQuality? Quality = null, AgentsUsage? Usage = null, string? TemplateName = null,
        JsonElement? Reasoning = null, JsonElement? Alternatives = null);
    private sealed record AgentsJob(string Id, string Status, int Progress, string? Step, AgentsResult? Result, string? Error);

    /// <summary>Status do job + outcome neutro quando done. null,null se o job sumiu (404/restart do agents).</summary>
    public async Task<(string? Status, GenerationOutcome? Outcome)> PollAsync(string jobId, CancellationToken ct = default)
    {
        HttpResponseMessage resp;
        try { resp = await http.GetAsync($"/generate/{jobId}", ct); }
        catch (HttpRequestException) { return (null, null); } // agents fora do ar → trata como ausente

        if (!resp.IsSuccessStatusCode) return (null, null);

        var job = JsonSerializer.Deserialize<AgentsJob>(await resp.Content.ReadAsStringAsync(ct), Json);
        if (job is null) return (null, null);
        if (job.Status != "done" || job.Result is null) return (job.Status, null);

        var r = job.Result;
        var outcome = new GenerationOutcome(
            r.Caption, r.Cta, r.Hashtags.ToList(), r.Quality?.Score,
            // FASE 1 (ADR-0014): serializa o JsonElement das camadas verbatim p/ LayersJson (string).
            r.Slides.Select(s => new OutcomeSlide(
                s.Index, s.Copy, s.ImageUrl, s.Layers is { } el ? el.GetRawText() : null)).ToList(),
            // F5 (Eixo D): uso real → custo por modelo no SpendEntry (null em mock → custo fixo por formato).
            r.Usage is { } u
                ? new GenerationUsage(u.TextInputTokens, u.TextOutputTokens, u.ImageCount, u.Provider, u.TextModel, u.ImageModel)
                : null,
            // F6/B3: template escolhido pelo pipeline (reveal no wizard).
            r.TemplateName,
            // Envelope ReasoningJson = raciocínio + alternatives. Delega ao PONTO ÚNICO
            // (ReasoningEnvelope.Build em Core) que a API também usa — sem builder espelhado que
            // divergiria em silêncio. JsonElement opaco → string JSON antes de delegar.
            ReasoningEnvelope.Build(
                r.Reasoning is { } rj ? rj.GetRawText() : null,
                r.Alternatives is { } a ? a.GetRawText() : null));
        return (job.Status, outcome);
    }
}
