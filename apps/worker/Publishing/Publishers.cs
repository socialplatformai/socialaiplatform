using System.Text.Json;
using SocialAi.Api.Domain;

namespace SocialAi.Worker.Publishing;

public record PublishRequest(
    ContentType Type,
    string Caption,
    IReadOnlyList<string> ImageUrls, // URLs públicas JPEG (já no MinIO)
    string IgUserId,
    string AccessToken);

public record PublishOutcome(bool Success, string? RemoteId, string? Error, string RawResponse);

public interface IPublisher
{
    PublisherKind Kind { get; }
    Task<PublishOutcome> PublishAsync(PublishRequest req, CancellationToken ct = default);
}

/// <summary>
/// MockPublisher: cumpre o fluxo end-to-end sem a Meta (enquanto App Review não sai — R-1).
/// Simula sucesso e devolve um id fake. Flip p/ GraphPublisher é config (PUBLISHER_MODE).
/// </summary>
public sealed class MockPublisher(ILogger<MockPublisher> logger) : IPublisher
{
    public PublisherKind Kind => PublisherKind.Mock;

    public Task<PublishOutcome> PublishAsync(PublishRequest req, CancellationToken ct = default)
    {
        logger.LogInformation("[MockPublisher] Simulando publicação {Type} ({N} mídia(s)) para IG {Ig}.",
            req.Type, req.ImageUrls.Count, req.IgUserId);
        var fakeId = $"mock_{Guid.NewGuid():N}";
        return Task.FromResult(new PublishOutcome(true, fakeId, null,
            $"{{\"mock\":true,\"id\":\"{fakeId}\"}}"));
    }
}

/// <summary>
/// InstagramGraphPublisher: publicação real via Graph API (AM-5).
/// Feed/story (single) e carrossel. Container -> publish. Circuit breaker consulta o
/// rate-limit em runtime (GET content_publishing_limit) antes de publicar.
/// </summary>
public sealed class InstagramGraphPublisher(
    HttpClient http, ILogger<InstagramGraphPublisher> logger, GraphApiConfig graphCfg) : IPublisher
{
    // F6/E1: versão da Graph API vem de config (GraphApiConfig), não mais hardcoded. A Meta
    // versiona ~trimestralmente e expira versões antigas (~2 anos) — config + telemetria de
    // obsolescência (no boot do GraphApiConfig) evitam o publish quebrar sem aviso.
    private string Graph => graphCfg.BaseUrl;

    // Polling do container até FINISHED: a Graph API processa a mídia de forma assíncrona;
    // publicar antes de FINISHED falha. Backoff entre 2s e 5s, teto ~90s.
    private static readonly TimeSpan PollMin = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan PollMax = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan PollTimeout = TimeSpan.FromSeconds(90);

    public PublisherKind Kind => PublisherKind.InstagramGraph;

    public async Task<PublishOutcome> PublishAsync(PublishRequest req, CancellationToken ct = default)
    {
        // Circuit breaker: rate-limit consultado em runtime (não presumido) — AM-5.
        if (!await WithinRateLimitAsync(req, ct))
            return new PublishOutcome(false, null, "rate_limit_atingido", "{\"circuit\":\"open\"}");

        try
        {
            var creationId = req.Type == ContentType.Carousel
                ? await CreateCarouselContainerAsync(req, ct)
                : await CreateSingleContainerAsync(req, ct);

            // Aguarda o container ficar FINISHED antes de publicar (processamento assíncrono).
            await WaitForContainerReadyAsync(creationId, req.AccessToken, ct);

            // publish
            var pubUrl = $"{Graph}/{req.IgUserId}/media_publish" +
                         $"?creation_id={creationId}&access_token={req.AccessToken}";
            var pubRes = await http.PostAsync(pubUrl, null, ct);
            var pubBody = await pubRes.Content.ReadAsStringAsync(ct);
            if (!pubRes.IsSuccessStatusCode)
                return new PublishOutcome(false, null, $"publish_falhou: {pubBody}", pubBody);

            var id = JsonSerializer.Deserialize<JsonElement>(pubBody).TryGetProperty("id", out var idEl)
                ? idEl.GetString() : null;
            // RemoteId = id do post publicado (media id), persistido pelo PublishJob p/ insights.
            return new PublishOutcome(true, id ?? creationId, null, pubBody);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Falha na publicação Graph API.");
            return new PublishOutcome(false, null, ex.Message, "{}");
        }
    }

    private async Task<string> CreateSingleContainerAsync(PublishRequest req, CancellationToken ct)
    {
        var media = req.ImageUrls[0];
        var isStory = req.Type == ContentType.Story;
        var url = $"{Graph}/{req.IgUserId}/media?image_url={Uri.EscapeDataString(media)}" +
                  $"&caption={Uri.EscapeDataString(req.Caption)}" +
                  (isStory ? "&media_type=STORIES" : "") +
                  $"&access_token={req.AccessToken}";
        return await PostForIdAsync(url, ct);
    }

    private async Task<string> CreateCarouselContainerAsync(PublishRequest req, CancellationToken ct)
    {
        // 1. um container por imagem (is_carousel_item) — cada filho também é assíncrono.
        var children = new List<string>();
        foreach (var img in req.ImageUrls)
        {
            var url = $"{Graph}/{req.IgUserId}/media?image_url={Uri.EscapeDataString(img)}" +
                      $"&is_carousel_item=true&access_token={req.AccessToken}";
            var childId = await PostForIdAsync(url, ct);
            // Espera cada filho ficar pronto antes de montar o container-pai (senão o pai falha).
            await WaitForContainerReadyAsync(childId, req.AccessToken, ct);
            children.Add(childId);
        }
        // 2. container-pai do carrossel
        var parentUrl = $"{Graph}/{req.IgUserId}/media?media_type=CAROUSEL" +
                        $"&children={string.Join(",", children)}" +
                        $"&caption={Uri.EscapeDataString(req.Caption)}" +
                        $"&access_token={req.AccessToken}";
        return await PostForIdAsync(parentUrl, ct);
    }

    private async Task<string> PostForIdAsync(string url, CancellationToken ct)
    {
        var res = await http.PostAsync(url, null, ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"container falhou: {body}");
        return JsonSerializer.Deserialize<JsonElement>(body).GetProperty("id").GetString()!;
    }

    /// <summary>
    /// Faz polling em GET /{creation_id}?fields=status_code até FINISHED, com backoff (2-5s,
    /// teto ~90s). IN_PROGRESS -> aguarda; ERROR/EXPIRED -> falha clara; timeout -> falha.
    /// Necessário porque a Graph API processa a mídia de forma assíncrona após o container.
    /// </summary>
    private async Task WaitForContainerReadyAsync(string creationId, string accessToken, CancellationToken ct)
    {
        var deadline = DateTimeOffset.UtcNow + PollTimeout;
        var delay = PollMin;
        while (true)
        {
            var url = $"{Graph}/{creationId}?fields=status_code&access_token={accessToken}";
            var res = await http.GetAsync(url, ct);
            var body = await res.Content.ReadAsStringAsync(ct);
            if (!res.IsSuccessStatusCode)
                throw new InvalidOperationException($"status_code indisponível: {body}");

            var status = JsonSerializer.Deserialize<JsonElement>(body)
                .TryGetProperty("status_code", out var sc) ? sc.GetString() : null;

            switch (status)
            {
                case "FINISHED":
                    return;
                case "ERROR":
                case "EXPIRED":
                    throw new InvalidOperationException($"container {status} (creation_id={creationId}): {body}");
                default: // IN_PROGRESS ou desconhecido -> aguarda
                    if (DateTimeOffset.UtcNow >= deadline)
                        throw new InvalidOperationException(
                            $"container nao ficou pronto em {PollTimeout.TotalSeconds:N0}s (ultimo status={status ?? "?"}, creation_id={creationId})");
                    await Task.Delay(delay, ct);
                    // backoff progressivo até o teto de 5s.
                    delay = TimeSpan.FromSeconds(Math.Min(PollMax.TotalSeconds, delay.TotalSeconds + 1));
                    break;
            }
        }
    }

    /// <summary>
    /// F6/E2: consulta o limite de publicação em runtime (não presume). Circuit breaker FAIL-CLOSED:
    /// se o check NÃO confirma que há cota (HTTP de erro, corpo sem 'data', ou exceção de rede), BLOQUEIA
    /// — publicar às cegas arrisca ban da conta IG (custo alto, irreversível). Doc oficial da Graph API:
    /// GET /{ig-user-id}/content_publishing_limit retorna quota_usage; limite padrão 50 posts/24h
    /// (developers.facebook.com/docs/instagram-platform/content-publishing#rate-limiting).
    /// Só LIBERA quando lê quota_usage e confirma usage &lt; 50. Mudança vs. fail-open anterior: a
    /// indisponibilidade do check vira "não publica agora" (o post fica Pending e re-tenta no próximo tick),
    /// não "publica mesmo assim".
    /// </summary>
    private async Task<bool> WithinRateLimitAsync(PublishRequest req, CancellationToken ct)
    {
        try
        {
            var url = $"{Graph}/{req.IgUserId}/content_publishing_limit?access_token={req.AccessToken}";
            var res = await http.GetAsync(url, ct);
            if (!res.IsSuccessStatusCode)
            {
                // Loga o CORPO da resposta da Graph (sem o access_token, que vai só na query) — o
                // status sozinho não diz a causa (IG User ID inválido? permissão? versão?). Essencial
                // p/ diagnosticar o 400 sem adivinhar. O body da Graph traz message/code/type do erro.
                var errBody = await res.Content.ReadAsStringAsync(ct);
                logger.LogWarning("[Graph] rate-limit indisponível (HTTP {Status}) — fail-closed: não publica agora. IgUserId={Ig}. Resposta: {Body}",
                    (int)res.StatusCode, req.IgUserId, errBody);
                return false; // fail-CLOSED: sem confirmação de cota, não arrisca ban.
            }
            var body = await res.Content.ReadAsStringAsync(ct);
            var data = JsonSerializer.Deserialize<JsonElement>(body);
            if (data.TryGetProperty("data", out var arr) && arr.GetArrayLength() > 0
                && arr[0].TryGetProperty("quota_usage", out var quotaEl)
                && quotaEl.TryGetInt32(out var usage))
            {
                // limite padrão da Graph API: 50 posts / 24h.
                if (usage >= 50)
                    logger.LogWarning("[Graph] cota de publicação esgotada (quota_usage={Usage}/50) — bloqueado.", usage);
                return usage < 50;
            }
            logger.LogWarning("[Graph] resposta de rate-limit sem 'quota_usage' — fail-closed: não publica agora.");
            return false; // corpo inesperado → não confirma cota → fail-closed.
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "[Graph] falha ao consultar rate-limit — fail-closed: não publica agora.");
            return false; // fail-CLOSED: rate-limit indisponível bloqueia (não arrisca ban).
        }
    }
}
