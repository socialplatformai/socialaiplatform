using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Publishing;

// C2 (aceite): DTO de falha de publicação — expõe LogId, ContentId, mensagem de erro,
// contagem de tentativas e data da última tentativa (mapeada de UpdatedAt do log).
public record FailureDto(
    Guid LogId,
    Guid ContentId,
    string? Error,
    int Attempts,
    DateTimeOffset? LastTriedAt);

/// <summary>
/// C2 (aceite): endpoints para listar falhas de publicação e re-tentar manualmente.
/// Escopo brand-scoped (X-Brand-Id via BrandResolver); o filtro global de WorkspaceId
/// já aplica isolamento de tenant em todas as TenantEntity envolvidas.
/// A ligação log→content é: PublishLog.ScheduledPostId → ScheduledPost.ContentId → Content.BrandId.
/// </summary>
[ApiController]
[Authorize]
[Route("api/publishing")]
public class PublishingController(
    AppDbContext db,
    ICurrentWorkspace current,
    BrandResolver brands) : ControllerBase
{
    private Guid Ws => current.WorkspaceId!.Value;

    /// <summary>
    /// C2: lista todos os PublishLog com Result==Error cujo Content pertence à marca atual.
    /// GOTCHA SQLite: ORDER BY DateTimeOffset não traduz em SQL sob o filtro de tenant —
    /// materializa com ToListAsync() antes e ordena em memória (padrão do codebase).
    /// </summary>
    [HttpGet("failures")]
    public async Task<ActionResult<IEnumerable<FailureDto>>> Failures()
    {
        // C2: resolve a marca atual (header X-Brand-Id ou default do workspace).
        var brandId = await brands.ResolveAsync();

        // C2: join em 3 tabelas para garantir que o log pertence à marca atual.
        // GOTCHA: não usar Domain.Brand aqui — qualificação desnecessária para tipos
        // de entidade (o namespace SocialAi.Api.Domain está importado via using).
        // O filtro global de WorkspaceId já restringe ScheduledPosts e Contents ao tenant.
        var query =
            from log in db.PublishLogs.AsNoTracking()
            join post in db.ScheduledPosts.AsNoTracking()
                on log.ScheduledPostId equals post.Id
            join content in db.Contents.AsNoTracking()
                on post.ContentId equals content.Id
            where log.Result == PublishResult.Error
               && content.BrandId == brandId
            select new
            {
                log.Id,
                ContentId = content.Id,
                log.Error,
                log.Attempts,
                log.UpdatedAt
            };

        // GOTCHA SQLite: materializa ANTES de ordenar (DateTimeOffset não traduz em ORDER BY no SQL).
        var rows = (await query.ToListAsync())
            .OrderByDescending(r => r.UpdatedAt)
            .ToList();

        var dtos = rows.Select(r => new FailureDto(
            r.Id,
            r.ContentId,
            r.Error,
            r.Attempts,
            r.UpdatedAt));

        return Ok(dtos);
    }

    /// <summary>
    /// C2: re-tenta manualmente uma falha de publicação — reseta o log para Pending e
    /// devolve o processamento ao worker (que consome PublishLog.Result==Pending).
    /// NÃO publica aqui; apenas reusa a fila existente (PublishLog no Postgres).
    /// Retorna 404 se o log não pertence à marca atual; 409 se o conteúdo já foi publicado
    /// ou se o log não está em estado de erro.
    /// </summary>
    [HttpPost("{logId:guid}/retry")]
    public async Task<IActionResult> Retry(Guid logId)
    {
        // C2: resolve a marca atual para validação de posse do log.
        var brandId = await brands.ResolveAsync();

        // C2: carrega o log com join garantindo que o Content pertence à marca atual.
        // O filtro global de WorkspaceId já isola o tenant em todos os DbSets.
        var row = await (
            from log in db.PublishLogs
            join post in db.ScheduledPosts
                on log.ScheduledPostId equals post.Id
            join content in db.Contents
                on post.ContentId equals content.Id
            where log.Id == logId
               && content.BrandId == brandId
            select new { Log = log, Content = content }
        ).FirstOrDefaultAsync();

        // C2: log inexistente ou pertencente a outra marca → 404 (não vaza existência).
        if (row is null) return NotFound();

        // Nomes distintos das variáveis de range da query acima (evita CS1931).
        var pubLog = row.Log;
        var pubContent = row.Content;

        // C2: só atua em logs de erro — outros estados não devem ser re-tentados.
        if (pubLog.Result != PublishResult.Error)
            return Problem(
                "Somente registros de publicação com falha podem ser re-tentados.",
                statusCode: 409);

        // C2: conteúdo já publicado (Published ou EphemeralPublished) → 409.
        // Re-tentar post que chegou ao Instagram seria duplicata.
        if (pubContent.Status is ContentStatus.Published or ContentStatus.EphemeralPublished)
            return Problem(
                "O conteúdo já foi publicado e não pode ser re-tentado.",
                statusCode: 409);

        // C2: reseta o log para Pending — o PublishJob do worker reprocessa.
        pubLog.Result = PublishResult.Pending;
        pubLog.Attempts = 0;
        pubLog.NextRetryAt = null;
        pubLog.Error = null;
        pubLog.UpdatedAt = DateTimeOffset.UtcNow;

        // C2: se o Content estava Failed, repõe para Approved para que o worker
        // encontre o post agendado e consiga processar normalmente (o PublishSchedulerJob
        // já marcou o ScheduledPost como Dispatched na primeira tentativa, então o
        // PublishJob consome diretamente pelo PublishLog Pending).
        if (pubContent.Status == ContentStatus.Failed)
        {
            pubContent.TransitionTo(ContentStatus.Approved); // F4/C1: Failed → Approved (re-tentativa de publish)
        }

        await db.SaveChangesAsync();

        return NoContent();
    }
}
