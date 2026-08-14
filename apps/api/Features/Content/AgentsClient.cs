using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace SocialAi.Api.Features.Content;

// DTOs espelhando o contrato do microserviço agents (services/agents/src/types.ts).
public record AgentsBrandContext(
    string WorkspaceId,
    string? Branding,
    string? Tone,
    string? Guidelines,
    IEnumerable<string> Competitors,
    IEnumerable<string> VisualReferences,
    string? LearningSummary,
    // I1/S-12: handle do tenant (ex.: "@minha_marca") → vira a assinatura no render dos slides.
    // Sem ele, o agents usa string vazia (nunca handle de terceiro). Serializa como "handle".
    string? Handle = null,
    // Brand config completo: posicionamento e tipos de conteúdo desejados. Persistiam no
    // BrandKit mas não chegavam aos agentes (a IA gerava sem essas diretrizes).
    string? PositioningRules = null,
    string? DesiredContentTypes = null,
    // E2 (ADR-0005): identidade visual + texto de marca → engine. Serializam como
    // visualIdentity/targetAudience/copyExamples (alinhado a agents/types.ts).
    AgentsVisualIdentity? VisualIdentity = null,
    string? TargetAudience = null,
    IEnumerable<string>? CopyExamples = null,
    // E2 (ADR-0008): hashtags da biblioteca de marca → engine. Serializa como "hashtags".
    IEnumerable<string>? Hashtags = null,
    // ADR-0013: override de system-prompt por agente (AgentKey→PromptText). Emitido
    // INCONDICIONALMENTE; o gate da flag PROMPT_OVERRIDES_ENABLED vive no agents (jobs.ts).
    // OMITIDO quando null/vazio (WhenWritingNull) → payload byte-equivalente ao atual.
    // Serializa como "promptOverrides" (camelCase, JsonSerializerDefaults.Web).
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyDictionary<string, string>? PromptOverrides = null,
    // SINAL TIPADO de aprendizado. Enquanto LearningSummary é prosa (lida pelo copywriter),
    // BestFormat é o ContentType vencedor por engajamento (PerformanceAnalyzer.BuildBestFormatAsync) que
    // o brand-strategist usa para ENVIESAR a escolha de template/formato — não substitui o LLM. Null com
    // amostra <3 (sem padrão confiável) → omitido do JSON (WhenWritingNull) → payload atual preservado.
    // Serializa como "bestFormat" (camelCase). Último arg opcional → call-sites posicionais intactos.
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? BestFormat = null);

/// <summary>Identidade visual da marca enviada à engine (E2). Espelha
/// BrandVisualIdentity em services/agents/src/types.ts. Cores como hex string.</summary>
public record AgentsVisualIdentity(
    string? Preset,
    AgentsBrandColors? Colors,
    string? HeadingFont,
    string? BodyFont,
    string? LogoUrl);

public record AgentsBrandColors(
    string? Primary,
    string? Secondary,
    string? Accent,
    string? Background,
    string? Text);

public record AgentsPauta(
    string Id, string Title, string? Objective, string? Context,
    // E3 (ADR-0003): categoria, anexos (referência textual) e objetivo de marketing.
    // Serializam como category/attachments/marketingObjective (agents/types.ts > Pauta).
    string? Category = null,
    IEnumerable<string>? Attachments = null,
    string? MarketingObjective = null);

// B4 (ADR-0008): override de IA por workspace (provider/modelo/chave). Espelha AiOverride
// em services/agents/src/types.ts. 🔴 ApiKey é a chave em CLARO no fio interno (rede Docker,
// autenticada por x-internal-token) — NUNCA é logada nem retornada por GET; o agents redige.
public record AgentsAiOverride(string Provider, string? TextModel, string? ImageModel, string ApiKey);

public record AgentsGenerateRequest(
    AgentsBrandContext BrandContext, AgentsPauta Pauta, string Format,
    // OMITIDO quando null (sem Secret de IA no workspace) → o agents cai no .env. Manter o
    // campo fora do JSON nesse caso preserva o payload byte-equivalente do comportamento
    // anterior (contrato do BriefingPreview).
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    AgentsAiOverride? AiOverride = null,
    // D4 (ADR-0008): templates ativos da marca. Cada item é o Template.SpecJson PARSEADO
    // (JsonNode) — o CarouselTemplate canônico, sem reserializar (fiel ao shape que o agents
    // valida em D5). OMITIDO quando null/vazio → o agents cai no registry built-in.
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IEnumerable<JsonNode>? Templates = null,
    // D3/D4: id (CarouselTemplate.id = Template.Key) do template forçado pela pauta. OMITIDO
    // quando null → seleção normal no agents. A API traduz Pauta.ForcedTemplateId (Guid) → Key.
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? ForcedTemplateId = null,
    // A1 (ADR-0009): instrução de regeneração (top-level). OMITIDA quando null → payload
    // byte-equivalente à geração normal. O agents a injeta verbatim no briefing (additionalNotes).
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? RegenerationInstruction = null,
    // Toggle POR-GERAÇÃO ("usar identidade do logo"): estampa o logo da marca nos slides. A API só
    // envia true quando o toggle está ligado E há LogoUrl no kit; senão OMITIDO (WhenWritingNull) →
    // payload byte-equivalente ao atual. Serializa como "useLogoIdentity" (camelCase, Web defaults).
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    bool? UseLogoIdentity = null,
    // FASE 0 (auditoria — fundação de input criativo): direção criativa por-geração do operador
    // (referência/fundo/CTA/subtítulo). OMITIDA quando null (operador não preencheu nada) → payload
    // byte-equivalente ao atual. Serializa como "creativeInput". O agents roteia no input-adapter.
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    AgentsCreativeInput? CreativeInput = null);

/// <summary>
/// FASE 0: direção criativa por-geração que o operador fornece no wizard. Espelha
/// GenerateRequest.creativeInput em services/agents/src/types.ts. Todos os campos opcionais;
/// a API só monta o objeto quando ao menos um campo tem valor (senão envia null → omitido).
/// referenceUrl/backgroundUrl viram referenceContext no agents; cta/subtitle viram direção de copy.
/// </summary>
public record AgentsCreativeInput(
    string? ReferenceUrl = null,
    string? BackgroundUrl = null,
    string? Cta = null,
    string? Subtitle = null);

// FASE 1 (ADR-0014): RenderHtml removido do contrato (B2). Layers é JSON OPACO (decisão de design
// F1): a API persiste/reemite verbatim, sem raciocinar sobre o interior. JsonElement? captura
// qualquer valor JSON; null/ausente → slide sem camadas (degradado honesto). Serializa como "layers".
public record AgentsSlide(int Index, string Copy, string? ImageUrl, JsonElement? Layers = null);
// C3: quality{score,passed} acompanha o resultado — conteúdo com score baixo NÃO é descartado.
public record AgentsQuality(int Score, bool Passed);
// C (ADR-0008): uso da geração (tokens de texto + nº de imagens). Espelha GenerateUsage
// (services/agents/src/types.ts). Ausente/zerado em mock → custo estimado 0.
// F5 (Eixo D): provider/textModel/imageModel acompanham o uso p/ a API estimar o custo REAL por
// token×modelo (não fixo por formato) e gravar provider/model no SpendEntry. Null em mock/sem chave.
public record AgentsUsage(
    int TextInputTokens, int TextOutputTokens, int ImageCount,
    string? Provider = null, string? TextModel = null, string? ImageModel = null);
// AI-native: o RACIOCÍNIO real dos agentes (por que este template/ângulo, narrativa, checks de
// qualidade). Espelha GenerateResult.reasoning (services/agents/src/types.ts). Tudo opcional —
// null em mock/degradado. Persistido em Content.ReasoningJson p/ o reveal "por que a IA fez assim".
public record AgentsQualityCheck(string Label, bool Passed, string Severity);
// task 1.1: decisão do Creative Director (estratégia visual). Espelha GenerateResult.reasoning
// .creativeStrategy (services/agents/src/types.ts). Null em mock/degradado. DeferredSlides = nº de
// slides cuja estratégia ideal (banco/gráfico) ainda não tem provider e executou via foto generativa.
public record AgentsCreativeStrategy(string Primary, string Rationale, int DeferredSlides);
public record AgentsReasoning(
    string? WhyTemplate = null, string? WhyAngle = null, string? NarrativeAngle = null,
    IEnumerable<string>? KeyInsights = null, string? Narrative = null,
    IEnumerable<AgentsQualityCheck>? QualityChecks = null,
    AgentsCreativeStrategy? CreativeStrategy = null);
// G4 (A/B barato): as ALTERNATIVAS que o copywriter já gera (2 headlines + 2 CTAs) e que antes eram
// descartadas. Per-content. Espelha GenerateResult.alternatives (services/agents/src/types.ts). Null
// em mock/degradado. Persistidas DENTRO do envelope ReasoningJson (sem coluna/migração nova) e
// re-extraídas no GET p/ ContentDto.Alternatives (mantém o painel de Raciocínio limpo).
public record AgentsAlternatives(IEnumerable<string> Headlines, IEnumerable<string> Ctas);
public record AgentsResult(
    IEnumerable<AgentsSlide> Slides, string Caption, string Cta, IEnumerable<string> Hashtags,
    AgentsQuality? Quality = null,
    AgentsUsage? Usage = null,
    // F6/B3: template escolhido pelo pipeline (para o reveal no wizard). Null em mock/degradado.
    string? TemplateName = null,
    // AI-native: justificativa dos agentes (reveal no Resultado/editor). Null em mock/degradado.
    AgentsReasoning? Reasoning = null,
    // G4: opções A/B baratas (já pagas na geração). Null quando o copywriter não as produziu.
    AgentsAlternatives? Alternatives = null);
// POST /generate retorna { jobId, status }; GET /generate/{id} retorna o Job completo { id, ... }.
public record AgentsAccepted(string JobId, string Status);
public record AgentsJob(string Id, string Status, int Progress, string? Step, AgentsResult? Result, string? Error);

// Categoria de falha ao falar com o microserviço agents / provedor de IA. Cada uma vira um HTTP
// status + mensagem PT-BR específicos no controller (ProblemDetails), nunca um 500 cru na UI.
public enum AgentsErrorKind { RateLimited, BadCredential, Unavailable, Upstream }

/// <summary>
/// Falha controlada ao iniciar a geração: carrega a categoria (p/ o controller escolher o status
/// HTTP) e uma mensagem já pronta para o operador. O corpo bruto do upstream vai só p/ o log.
/// </summary>
public sealed class AgentsUnavailableException(AgentsErrorKind kind, string userMessage, object? detail = null)
    : Exception(userMessage)
{
    public AgentsErrorKind Kind { get; } = kind;
    public string UserMessage { get; } = userMessage;
    public string? UpstreamDetail { get; } = detail as string
        ?? (detail as Exception)?.Message;
}

/// <summary>
/// Cliente do microserviço de agentes. /generate é ASYNC (AM-4): POST retorna 202+jobId,
/// depois faz poll de GET /generate/{jobId} até done/error (com timeout).
/// </summary>
public class AgentsClient(HttpClient http)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    // COLD-START (Render free): o serviço agents dorme após ~15min ociosos. A 1ª chamada após o
    // sono falha (conexão recusada OU 502/503 do proxy do Render) enquanto ele acorda (~15-30s).
    // Sem keep-alive externo confiável, ABSORVEMOS isso aqui: re-tentamos a abertura da geração
    // algumas vezes com backoff, dando tempo do agents subir. Paliativo self-contained — sobe junto
    // no ambiente do cliente, sem serviço externo nem plano pago. Só erros TRANSITÓRIOS (Unavailable)
    // re-tentam; 429/credencial falham na hora (não adianta esperar).
    private const int StartMaxAttempts = 4; // 1 + 3 retries
    private static readonly TimeSpan[] StartBackoff =
        [TimeSpan.FromSeconds(3), TimeSpan.FromSeconds(6), TimeSpan.FromSeconds(10)];

    /// <summary>Inicia a geração (async). Retorna o jobId imediatamente (sem aguardar o pipeline).
    /// Re-tenta o cold-start do agents (sono do free tier) antes de desistir.</summary>
    public async Task<string> StartAsync(AgentsGenerateRequest req, CancellationToken ct = default)
    {
        AgentsUnavailableException? lastTransient = null;
        for (var attempt = 0; attempt < StartMaxAttempts; attempt++)
        {
            if (attempt > 0)
                // Espera o agents acordar antes de re-tentar (backoff: 3s, 6s, 10s).
                await Task.Delay(StartBackoff[attempt - 1], ct);
            try
            {
                return await StartOnceAsync(req, ct);
            }
            catch (AgentsUnavailableException ex) when (ex.Kind == AgentsErrorKind.Unavailable)
            {
                // Cold-start / indisponível: transitório → re-tenta. Demais (429/credencial): propaga já.
                lastTransient = ex;
            }
        }
        // Esgotou os retries e o agents seguiu indisponível (não acordou a tempo / caiu de verdade).
        throw lastTransient ?? new AgentsUnavailableException(AgentsErrorKind.Unavailable,
            "Serviço de geração indisponível no momento. Tente novamente em instantes.");
    }

    /// <summary>Uma tentativa de iniciar a geração (sem retry). Erros já classificados em exceção tipada.</summary>
    private async Task<string> StartOnceAsync(AgentsGenerateRequest req, CancellationToken ct)
    {
        HttpResponseMessage post;
        try
        {
            post = await http.PostAsync("/generate",
                new StringContent(JsonSerializer.Serialize(req, Json), Encoding.UTF8, "application/json"), ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            // Sem conexão / timeout com o microserviço agents (dormindo, caiu, rede). Transitório.
            throw new AgentsUnavailableException(AgentsErrorKind.Unavailable,
                "Serviço de geração indisponível no momento. Tente novamente em instantes.", ex);
        }

        // O agents repassa o status do provedor de IA (Gemini/OpenAI/etc.). Traduzimos cada classe
        // num erro com mensagem PT-BR para o operador — nunca um 500 cru com código solto na UI.
        if (!post.IsSuccessStatusCode)
        {
            var body = await post.Content.ReadAsStringAsync(ct);
            throw ClassifyFailure(post.StatusCode, body);
        }

        var accepted = JsonSerializer.Deserialize<AgentsAccepted>(
            await post.Content.ReadAsStringAsync(ct), Json)
            ?? throw new AgentsUnavailableException(AgentsErrorKind.Unavailable,
                "Resposta inválida do serviço de geração. Tente novamente.");
        if (string.IsNullOrEmpty(accepted.JobId))
            throw new AgentsUnavailableException(AgentsErrorKind.Unavailable,
                "Resposta inválida do serviço de geração. Tente novamente.");
        return accepted.JobId;
    }

    /// <summary>
    /// Traduz o `job.error` CRU vindo do pipeline (string em inglês do provedor de IA — ex.
    /// "Rate limited (429)", "Invalid API key") numa mensagem PT-BR para o operador. Quando não
    /// reconhece o padrão, devolve uma frase genérica clara em vez do texto técnico cru.
    /// Usado no poll (JobStatus): é onde o 429 aparece numa geração real de 60-120s.
    /// </summary>
    public static string FriendlyJobError(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return "A geração falhou. Tente novamente.";
        var t = raw.ToLowerInvariant();
        if (t.Contains("429") || t.Contains("rate limit") || t.Contains("quota") || t.Contains("resource_exhausted"))
            return "Limite de geração do provedor de IA atingido. Aguarde cerca de 1 minuto e tente de novo.";
        if (t.Contains("invalid api key") || t.Contains("api key") || t.Contains("unauthorized")
            || t.Contains("401") || t.Contains("403") || t.Contains("permission"))
            return "O provedor de IA recusou a credencial. Verifique a chave de IA nas configurações.";
        if (t.Contains("ausente") || t.Contains("missing") && t.Contains("key"))
            return "Chave de IA não configurada. Defina-a nas configurações para gerar.";
        if (t.Contains("timeout") || t.Contains("timed out") || t.Contains("unavailable") || t.Contains("503"))
            return "Serviço de geração indisponível no momento. Tente novamente em instantes.";
        // Falha de geração de IMAGEM após retry (política: não entregar/publicar gradiente fora-da-marca).
        // O image-generator já emite uma frase clara em PT-BR para o operador — repassamos como está.
        if (t.Contains("geração de imagem falhou") || t.Contains("geracao de imagem falhou"))
            return "Não foi possível gerar as imagens do post (provável limite do provedor de IA). " +
                   "Aguarde alguns instantes e gere novamente.";
        if (t.Contains("headline"))
            return "A IA não conseguiu montar todos os textos do post. Tente gerar novamente.";
        // Desconhecido: não vaza o texto técnico cru — frase neutra (o detalhe fica no log do agents).
        return "A geração falhou. Tente novamente em instantes.";
    }

    /// <summary>Mapeia o status HTTP do agents/provedor de IA numa exceção com mensagem PT-BR clara.</summary>
    private static AgentsUnavailableException ClassifyFailure(System.Net.HttpStatusCode status, string body)
    {
        var code = (int)status;
        return code switch
        {
            429 => new AgentsUnavailableException(AgentsErrorKind.RateLimited,
                "Limite de geração do provedor de IA atingido. Aguarde cerca de 1 minuto e tente de novo.", body),
            401 or 403 => new AgentsUnavailableException(AgentsErrorKind.BadCredential,
                "O provedor de IA recusou a credencial. Verifique a chave de IA nas configurações.", body),
            >= 500 => new AgentsUnavailableException(AgentsErrorKind.Unavailable,
                "Serviço de geração indisponível no momento. Tente novamente em instantes.", body),
            _ => new AgentsUnavailableException(AgentsErrorKind.Upstream,
                "Não foi possível iniciar a geração. Tente novamente.", body),
        };
    }

    /// <summary>Consulta o estado de um job (status/progress/step + result se done).</summary>
    public async Task<AgentsJob?> GetJobAsync(string jobId, CancellationToken ct = default)
    {
        var poll = await http.GetAsync($"/generate/{jobId}", ct);
        if (!poll.IsSuccessStatusCode) return null;
        return JsonSerializer.Deserialize<AgentsJob>(await poll.Content.ReadAsStringAsync(ct), Json);
    }

    /// <summary>
    /// WARM-UP (cold-start do Render free): pinga o /health do agents só para ACORDÁ-LO. Disparado
    /// no LOGIN (a web → API → agents): quando o operador entra, a API já está desperta (a chamada de
    /// login a acordou) e este ping desperta o agents em paralelo — no tempo de navegar até "Gerar",
    /// tudo já está vivo, sem cold-start na 1ª geração. TOLERANTE: nunca lança (é best-effort); timeout
    /// próprio curto para não segurar nada. Não substitui o retry do StartAsync (rede de segurança).
    /// </summary>
    public async Task WarmUpAsync(CancellationToken ct = default)
    {
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(40)); // cobre o cold-start do agents sem travar p/ sempre
            await http.GetAsync("/health", cts.Token);
        }
        catch { /* best-effort: o agents acorda com o próprio request; falha aqui não importa */ }
    }

    /// <summary>
    /// F3 (ADR-0014 §4e): rasteriza as camadas de UM slide → PNG data-uri (Satori+resvg no agents).
    /// Síncrono e rápido (~1s/slide). Falha (fonte ausente/agents down) → null (degradado honesto:
    /// o caller mantém o ImageUrl atual; a edição de texto/camadas ainda é salva). `layers` é o JSON
    /// opaco do slide; `fallbackImageUrl` é o ImageUrl atual (fundo quando as camadas não têm imagem).
    /// </summary>
    public async Task<string?> RasterizeAsync(JsonNode layers, string? fallbackImageUrl, CancellationToken ct = default)
    {
        try
        {
            var payload = new JsonObject { ["layers"] = layers, ["fallbackImageUrl"] = fallbackImageUrl };
            var resp = await http.PostAsync("/rasterize",
                new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json"), ct);
            if (!resp.IsSuccessStatusCode) return null;
            var doc = JsonNode.Parse(await resp.Content.ReadAsStringAsync(ct));
            return doc?["image"]?.GetValue<string>();
        }
        catch
        {
            return null; // nunca derruba o save por falha de rasterização (degradado honesto).
        }
    }
}

public class AgentsGenerationException(string message) : Exception(message);
