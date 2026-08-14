using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Infrastructure;
using SocialAi.Worker.Publishing;

namespace SocialAi.Worker.Jobs;

/// <summary>
/// Consome PublishLogs Pending (criados pelo PublishSchedulerJob), publica via IPublisher
/// e grava o resultado operacional. Seleção Mock vs Graph: por PUBLISHER_MODE + validade
/// do token. Erros não derrubam o worker (resiliência).
///
/// DEDUP (C1): antes de publicar, se já existe um PublishLog Success para o mesmo
/// ScheduledPostId, este log vira Skipped — nunca republica o mesmo post.
/// RETRY (B4): falha transitória mantém Pending, incrementa Attempts e agenda NextRetryAt
/// com backoff exponencial (teto ~30min, até 5 tentativas); falha permanente vira Error.
/// SaveChanges é por item (blast radius de 20 → 1).
/// </summary>
public sealed class PublishJob(
    IServiceProvider services,
    IConfiguration cfg,
    ILogger<PublishJob> logger) : BackgroundService
{
    private readonly string _mode = cfg["Publisher:Mode"] ?? "mock";

    // Storage de mídia: há MinIO/S3 configurado? Sem ele, a imagem do slide é base64 no Postgres e
    // a Meta a baixa da rota pública assinada da própria API (MediaUrlSigner) — sem storage externo.
    private readonly bool _hasMinio =
        !string.IsNullOrWhiteSpace(cfg["Minio:Endpoint"]) || !string.IsNullOrWhiteSpace(cfg["Minio:PublicBaseUrl"]);
    // Base pública da API (alcançável pela internet) — onde a rota /public/media responde p/ a Meta.
    private readonly string _apiPublicBase = (cfg["Api:PublicBaseUrl"] ?? "").TrimEnd('/');

    // B4: limite de tentativas e teto do backoff. Após o teto, a falha vira permanente (Error).
    private const int MaxAttempts = 5;
    private static readonly TimeSpan MaxBackoff = TimeSpan.FromMinutes(30);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("PublishJob iniciado (tick 30s, modo={Mode}).", _mode);
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        do
        {
            try { await ProcessPendingAsync(stoppingToken); }
            catch (OperationCanceledException) { break; }
            catch (Exception ex) { logger.LogError(ex, "Falha no tick do PublishJob."); }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task ProcessPendingAsync(CancellationToken ct)
    {
        using var scope = services.CreateScope();
        var sp = scope.ServiceProvider;
        var db = sp.GetRequiredService<AppDbContext>();
        var protector = sp.GetRequiredService<SecretProtector>();
        var media = sp.GetRequiredService<MediaService>();
        // Assinador da URL pública de mídia — usado no fallback sem-MinIO (a Meta baixa da API).
        var mediaSigner = sp.GetRequiredService<MediaUrlSigner>();

        // Só processa Pending PRONTO: sem NextRetryAt agendado ou já vencido (B4 retry/backoff).
        var now = DateTimeOffset.UtcNow;
        var pending = await db.PublishLogs
            .Where(l => l.Result == PublishResult.Pending
                        && (l.NextRetryAt == null || l.NextRetryAt <= now))
            .OrderBy(l => l.CreatedAt)
            .Take(20)
            .ToListAsync(ct);

        foreach (var log in pending)
        {
            var post = await db.ScheduledPosts
                .Include(p => p.Content!).ThenInclude(c => c.Slides)
                .FirstOrDefaultAsync(p => p.Id == log.ScheduledPostId, ct);
            if (post?.Content is null)
            {
                log.Result = PublishResult.Skipped;
                log.Error = "ScheduledPost/Content ausente.";
                await db.SaveChangesAsync(ct); // commit por item (B4): blast radius 20 → 1.
                continue;
            }

            // S-04 (defesa em profundidade): só publica conteúdo Approved/Scheduled. O gate
            // humano não pode ser furado nem por estado inconsistente do banco.
            if (post.Content.Status is not (ContentStatus.Approved or ContentStatus.Scheduled))
            {
                log.Result = PublishResult.Skipped;
                log.Error = $"Conteúdo em status {post.Content.Status} (não Approved/Scheduled) — não publicável.";
                logger.LogWarning("Publish IGNORADO: conteúdo {Id} em status {Status}.",
                    post.ContentId, post.Content.Status);
                await db.SaveChangesAsync(ct);
                continue;
            }

            // C1 (dedup de negócio): se já houve Success para este ScheduledPost, não republica.
            var jaPublicado = await db.PublishLogs.AnyAsync(
                l => l.ScheduledPostId == post.Id && l.Result == PublishResult.Success, ct);
            if (jaPublicado)
            {
                log.Result = PublishResult.Skipped;
                log.Error = "Já existe publicação Success para este post (dedup).";
                logger.LogInformation("Publish IGNORADO (dedup): post {PostId} já publicado.", post.Id);
                await db.SaveChangesAsync(ct);
                continue;
            }

            // A3 (ADR-0010): conta-alvo por precedência override→IsPrimary→1ª conectada (predicado
            // explícito BrandId+WorkspaceId — isolamento do worker). SelectPublisher Mock/Graph não muda.
            var account = await TargetAccountResolver.ResolveAsync(db, post.Content, ct);

            var publisher = SelectPublisher(sp, account, out var kind);
            log.Publisher = kind;

            // Publish honesto: em modo graph, cair no Mock significa conta desconectada /
            // token expirado — NÃO é uma demo legítima. Publicar via mock e marcar Published seria
            // mentir (o post não está no Instagram). Recusa honesta: marca Failed com motivo claro
            // para o operador reconectar a conta; NÃO chama o publisher, NÃO vira Published.
            // Em modo mock legítimo (demo, sem App Review), o fluxo segue e o badge "Simulado" aparece.
            if (IsUnintendedMockFallback(_mode, kind))
            {
                log.Result = PublishResult.Error;
                log.Attempts++;
                log.NextRetryAt = null;
                log.Error = "Modo de publicação é 'graph' mas a conta do Instagram está desconectada ou " +
                            "sem token válido — publicação recusada (não simulada). Reconecte a conta para publicar.";
                post.Content.Status = ContentStatus.Failed;
                logger.LogWarning("Publish RECUSADO (fallback não-intencional p/ mock em modo graph): " +
                    "conteúdo {Id} — conta desconectada/sem token. Não marcado como Published.", post.ContentId);
                await db.SaveChangesAsync(ct);
                continue;
            }

            try
            {
                // Prepara mídia: data-url/PNG dos slides -> JPEG público no MinIO (AM-5/R-6).
                var imageUrls = new List<string>();
                foreach (var slide in post.Content.Slides.OrderBy(s => s.Index))
                {
                    if (string.IsNullOrEmpty(slide.ImageUrl)) continue;
                    if (slide.ImageUrl.StartsWith(MediaService.RefScheme))
                        // Imagem de slide (MinIO): referência estável da geração → presign fresco p/ a Meta baixar.
                        imageUrls.Add(await media.ResolveForPublishAsync(slide.ImageUrl, ct));
                    else if (slide.ImageUrl.StartsWith("http"))
                        imageUrls.Add(slide.ImageUrl); // já é URL pública
                    else if (_hasMinio)
                        // Legado/degradado (base64 inline) com MinIO → sobe agora (caminho original).
                        imageUrls.Add(await media.ToPublicJpegUrlAsync(
                            slide.ImageUrl, $"{post.WorkspaceId}/{post.ContentId}/{slide.Index}", ct));
                    else
                        // SEM MinIO: a imagem é base64 no Postgres e a Meta a baixa da rota pública
                        // assinada da própria API (sem storage externo). Exige Api:PublicBaseUrl
                        // alcançável pela internet — senão a Meta não resolve a URL.
                        imageUrls.Add(BuildPublicMediaUrl(mediaSigner, post.ContentId, slide.Index));
                }

                // S-17 (guarda de mídia vazia): sem imagem não há o que publicar. Evita
                // IndexOutOfRange no Graph (req.ImageUrls[0]) e "Published" vazio. Carrossel
                // exige ≥2 slides. NÃO chama o publisher.
                var midiaInsuficiente = imageUrls.Count == 0
                    || (post.Content.Type == ContentType.Carousel && imageUrls.Count < 2);
                if (midiaInsuficiente)
                {
                    log.Result = PublishResult.Skipped;
                    log.Error = post.Content.Type == ContentType.Carousel
                        ? $"Carrossel com {imageUrls.Count} imagem(ns) (mínimo 2) — não publicado."
                        : "Conteúdo sem slides com imagem — não publicado.";
                    logger.LogWarning("Publish IGNORADO: mídia insuficiente para conteúdo {Id} ({N} imagem(ns)).",
                        post.ContentId, imageUrls.Count);
                    await db.SaveChangesAsync(ct);
                    continue;
                }

                var token = !string.IsNullOrEmpty(account?.EncryptedAccessToken)
                    ? protector.Decrypt(account!.EncryptedAccessToken) : "";

                var req = new PublishRequest(
                    post.Content.Type,
                    $"{post.Content.Caption}\n\n{post.Content.Hashtags}".Trim(),
                    imageUrls,
                    account?.IgUserId ?? "",
                    token);

                var outcome = await publisher.PublishAsync(req, ct);

                if (outcome.Success)
                {
                    log.Result = PublishResult.Success;
                    log.GraphResponse = outcome.RawResponse;
                    log.Error = null;
                    log.RemoteId = outcome.RemoteId; // liga publish↔insights sem cruzar workspace (E1)
                    log.NextRetryAt = null;
                    post.Content.Status = post.Content.Type == ContentType.Story
                        ? ContentStatus.EphemeralPublished // Stories expiram 24h (AM-6)
                        : ContentStatus.Published;
                    logger.LogInformation("Publish Success para conteúdo {Id} via {Kind} (corr={Corr}).",
                        post.ContentId, kind, log.CorrelationId);
                }
                else
                {
                    // Falha reportada pelo publisher (sem exceção): pode ser transitória.
                    AplicarFalha(log, post.Content, outcome.Error ?? "falha desconhecida",
                        outcome.RawResponse, EhTransitoria(outcome.Error));
                }
            }
            catch (Exception ex)
            {
                // Exceção (ex.: HttpRequestException, timeout, falha de mídia) — geralmente transitória.
                AplicarFalha(log, post.Content, ex.Message, "{}", EhTransitoria(ex));
                logger.LogError(ex, "Falha ao publicar conteúdo {Id} (tentativa {Attempt}).",
                    post.ContentId, log.Attempts);
            }

            await db.SaveChangesAsync(ct); // commit por item (B4).
        }
    }

    /// <summary>
    /// Monta a URL pública ABSOLUTA e assinada da imagem de um slide, p/ a Graph API baixar quando
    /// não há MinIO (a imagem é base64 no Postgres e a própria API a serve em /public/media).
    /// Exige Api:PublicBaseUrl alcançável pela internet — sem ela, a Meta não resolve a URL e o
    /// publish falharia silenciosamente; por isso recusamos com mensagem clara (vira Failed honesto).
    /// </summary>
    private string BuildPublicMediaUrl(MediaUrlSigner signer, Guid contentId, int index)
    {
        var inacessivel = string.IsNullOrWhiteSpace(_apiPublicBase)
            || _apiPublicBase.Contains("localhost", StringComparison.OrdinalIgnoreCase)
            || _apiPublicBase.Contains("127.0.0.1", StringComparison.OrdinalIgnoreCase);
        if (inacessivel)
            throw new InvalidOperationException(
                "Publicação real sem MinIO exige Api:PublicBaseUrl com URL pública alcançável pela " +
                "internet (a Graph API baixa a imagem da rota /public/media da API). Configure " +
                "Api__PublicBaseUrl ou provisione storage (Minio__*).");

        return _apiPublicBase + signer.SignSlidePath(contentId, index);
    }

    /// <summary>
    /// Aplica o resultado de falha: transitória → reagenda (Pending + Attempts + NextRetryAt
    /// com backoff 2^Attempts min, teto 30min) até MaxAttempts; permanente ou esgotada → Error.
    /// </summary>
    private void AplicarFalha(PublishLog log, Content content, string erro, string raw, bool transitoria)
    {
        log.GraphResponse = raw;
        log.Error = erro;

        if (transitoria && log.Attempts + 1 < MaxAttempts)
        {
            log.Attempts++;
            // Backoff exponencial: 2^Attempts minutos, limitado ao teto.
            var minutos = Math.Min(MaxBackoff.TotalMinutes, Math.Pow(2, log.Attempts));
            log.NextRetryAt = DateTimeOffset.UtcNow.AddMinutes(minutos);
            log.Result = PublishResult.Pending; // continua na fila p/ nova tentativa
            // Conteúdo NÃO vai para Failed numa falha transitória — ainda pode publicar.
            logger.LogWarning("Falha transitória no conteúdo {Id}: nova tentativa em {Min:N0}min " +
                "(tentativa {Attempt}/{Max}).", content.Id, minutos, log.Attempts, MaxAttempts);
        }
        else
        {
            log.Attempts++;
            log.Result = PublishResult.Error;
            log.NextRetryAt = null;
            content.Status = ContentStatus.Failed;
            logger.LogError("Falha {Tipo} no conteúdo {Id} após {Attempts} tentativa(s): {Erro}",
                transitoria ? "esgotada" : "permanente", content.Id, log.Attempts, erro);
        }
    }

    // Sinais de transitoriedade no texto do erro (publisher devolve string, não status code).
    private static bool EhTransitoria(string? erro)
    {
        if (string.IsNullOrEmpty(erro)) return false;
        var e = erro.ToLowerInvariant();
        return e.Contains("timeout") || e.Contains("rate_limit") || e.Contains("rate limit")
            || e.Contains("nao ficou pronto") || e.Contains("não ficou pronto") // container ainda processando
            || e.Contains("media nao pronta") || e.Contains("mídia não pronta")
            || e.Contains("status_code indisponível") || e.Contains("in_progress")
            || e.Contains(" 500") || e.Contains(" 502") || e.Contains(" 503") || e.Contains(" 504");
    }

    // Exceções tipicamente transitórias (rede). Demais exceções = permanentes.
    private static bool EhTransitoria(Exception ex)
        => ex is HttpRequestException or TaskCanceledException or TimeoutException
           || EhTransitoria(ex.Message);

    /// <summary>
    /// Mock vs Graph: Graph só quando PUBLISHER_MODE!=mock E há token válido não-expirado.
    /// Caso contrário, MockPublisher cumpre o fluxo (R-1).
    /// </summary>
    private IPublisher SelectPublisher(IServiceProvider sp, InstagramAccount? account, out PublisherKind kind)
    {
        var tokenValid = account is { IsConnected: true } &&
                         !string.IsNullOrEmpty(account.EncryptedAccessToken) &&
                         account.TokenExpiresAt > DateTimeOffset.UtcNow;

        if (_mode != "mock" && tokenValid)
        {
            kind = PublisherKind.InstagramGraph;
            return sp.GetRequiredService<InstagramGraphPublisher>();
        }
        kind = PublisherKind.Mock;
        return sp.GetRequiredService<MockPublisher>();
    }

    /// <summary>
    /// Publish honesto: TRUE quando o modo configurado é 'graph' (publicação real esperada)
    /// mas o publisher selecionado caiu no Mock — sinal de conta desconectada / token expirado, NÃO
    /// uma demo. Nesse caso o PublishJob recusa a publicação (Failed honesto) em vez de marcar
    /// Published com um id fake. Em modo 'mock' legítimo retorna FALSE (a simulação é o comportamento
    /// desejado, sinalizada pelo badge "Simulado"). Puro/estático: testável sem o BackgroundService.
    /// </summary>
    public static bool IsUnintendedMockFallback(string mode, PublisherKind selected)
        => mode != "mock" && selected == PublisherKind.Mock;
}
