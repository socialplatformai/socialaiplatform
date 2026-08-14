using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;

namespace SocialAi.Worker.Jobs;

/// <summary>
/// A cada minuto: busca ScheduledPosts cujo horário chegou e ainda não foram
/// despachados, e os enfileira para publicação (consumido por PublishJob — E-7).
/// Idempotente: marca Dispatched=true sob a idempotency key, evitando duplo envio (AM-5/R-8).
/// Job sistêmico (sem tenant): usa AppDbContext com ICurrentWorkspace=null (filtro passa).
/// </summary>
public sealed class PublishSchedulerJob(
    IServiceProvider services,
    ILogger<PublishSchedulerJob> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("PublishSchedulerJob iniciado (tick 60s).");
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(60));

        // primeiro tick imediato
        do
        {
            try
            {
                await DispatchDuePosts(stoppingToken);
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                // Erro não derruba o worker (resiliência).
                logger.LogError(ex, "Falha no tick do PublishSchedulerJob.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task DispatchDuePosts(CancellationToken ct)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var now = DateTimeOffset.UtcNow;
        var due = await db.ScheduledPosts
            .Where(p => !p.Dispatched && p.ScheduledFor <= now)
            .OrderBy(p => p.ScheduledFor)
            .Take(50)
            .ToListAsync(ct);

        if (due.Count == 0) return;
        logger.LogInformation("{Count} post(s) due para publicação.", due.Count);

        foreach (var post in due)
        {
            // Idempotência: só despacha uma vez. PublishJob (E-7) faz a publicação real.
            post.Dispatched = true;
            db.PublishLogs.Add(new PublishLog
            {
                WorkspaceId = post.WorkspaceId,
                ScheduledPostId = post.Id,
                Publisher = PublisherKind.Mock, // flip p/ InstagramGraph é config (E-7)
                Result = PublishResult.Pending,
                CorrelationId = Guid.NewGuid().ToString("N"), // tracing ponta-a-ponta (AM-7)
            });
            logger.LogInformation("Post {PostId} enfileirado (idempotencyKey={Key}).", post.Id, post.IdempotencyKey);

            // G5 (ADR-0014): recorrência. Post recorrente → reagenda a PRÓXIMA ocorrência clonando
            // o conteúdo (o Content↔ScheduledPost é 1:1 e o dedup é por ScheduledPostId; reusar a
            // linha/o Content quebraria ambos). Só a próxima ocorrência (não um horizonte).
            if (post.Frequency != Frequency.None)
                await CreateNextOccurrenceAsync(db, post, ct);
        }

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex)
        {
            // F4/C2: o índice único filtrado em PublishLog(ScheduledPostId) pegou uma corrida — outro
            // caminho já enfileirou este post. É IDEMPOTÊNCIA, não erro: descarta o tracking e segue
            // (o post perdedor não vira log duplicado). Próximo tick reconcilia o que faltar.
            logger.LogInformation(ex, "Dedup de publicação: log concorrente já existente — corrida resolvida pelo índice único.");
            db.ChangeTracker.Clear();
        }
    }

    /// <summary>
    /// G5 (ADR-0014): cria a próxima ocorrência de um post recorrente. Clona o Content (cópia rasa
    /// dos campos publicáveis + slides, status Approved, IsSample=false) e cria um novo ScheduledPost
    /// em ScheduledFor + intervalo, com Frequency PROPAGADO e IdempotencyKey NOVO. Preserva os
    /// invariantes: 1:1 Content↔ScheduledPost (clonamos o Content), dedup por ScheduledPostId (id
    /// novo), e isolamento (clone herda WorkspaceId/BrandId do original).
    /// </summary>
    private async Task CreateNextOccurrenceAsync(AppDbContext db, ScheduledPost post, CancellationToken ct)
    {
        var nextWhen = NextOccurrence(post.ScheduledFor, post.Frequency);
        if (nextWhen is null) return; // None (não deveria chegar aqui) → nada a fazer.

        var original = await db.Contents
            .Include(c => c.Slides)
            .FirstOrDefaultAsync(c => c.Id == post.ContentId, ct);
        if (original is null)
        {
            logger.LogWarning("Recorrência ignorada: Content {Id} ausente.", post.ContentId);
            return;
        }

        var clone = CloneContentForRecurrence(original);
        db.Contents.Add(clone);

        db.ScheduledPosts.Add(new ScheduledPost
        {
            WorkspaceId = post.WorkspaceId,
            Content = clone,                 // 1:1 com o clone (não com o original)
            ScheduledFor = nextWhen.Value,
            Frequency = post.Frequency,      // a série continua
            Dispatched = false,
            // IdempotencyKey é novo por construção (default Guid) — cada ocorrência é distinta no IG.
        });

        logger.LogInformation(
            "Recorrência {Freq}: post {PostId} reagendado para {When:o} (novo conteúdo {CloneId}).",
            post.Frequency, post.Id, nextWhen.Value, clone.Id);
    }

    /// <summary>
    /// Próxima ocorrência em UTC a partir do instante atual (UTC) + intervalo de calendário. Daily=+1d,
    /// Weekly=+7d, Monthly=+1 mês (AddMonths respeita fim de mês). Deriva em UTC puro — sem reconverter
    /// fuso (A5/ADR-0010: ScheduledFor é sempre UTC e o worker não reconverte). None → null.
    /// </summary>
    internal static DateTimeOffset? NextOccurrence(DateTimeOffset from, Frequency freq) => freq switch
    {
        Frequency.Daily => from.AddDays(1),
        Frequency.Weekly => from.AddDays(7),
        Frequency.Monthly => from.AddMonths(1),
        _ => null,
    };

    /// <summary>
    /// G5 (ADR-0014): cópia rasa do conteúdo publicável para a próxima ocorrência de uma série. Copia
    /// só o que define o post (marca, conta-alvo, tipo, textos, slides), NÃO o histórico da geração
    /// original (job de geração, aprovação, agendamento). Status = Approved (a série herda a aprovação)
    /// e IsSample = false. Herda WorkspaceId/BrandId do original (isolamento preservado). Função pura
    /// (sem DB) — testável isoladamente.
    /// </summary>
    internal static Content CloneContentForRecurrence(Content original) => new()
    {
        WorkspaceId = original.WorkspaceId,
        BrandId = original.BrandId,
        PautaId = original.PautaId,
        CampaignId = original.CampaignId,
        TargetInstagramAccountId = original.TargetInstagramAccountId,
        Type = original.Type,
        Status = ContentStatus.Approved, // já aprovado: a série herda a aprovação do original
        QualityScore = original.QualityScore,
        ApprovalModeOverride = original.ApprovalModeOverride,
        Caption = original.Caption,
        Cta = original.Cta,
        Hashtags = original.Hashtags,
        FromAutonomousLoop = original.FromAutonomousLoop,
        IsSample = false,
        Slides = original.Slides
            .OrderBy(s => s.Index)
            .Select(s => new ContentSlide
            {
                WorkspaceId = original.WorkspaceId,
                Index = s.Index,
                Copy = s.Copy,
                ImageUrl = s.ImageUrl,
                // FASE 1 (ADR-0014): LayersJson substitui RenderHtml ao copiar slides p/ a série.
                LayersJson = s.LayersJson,
            })
            .ToList(),
    };
}
