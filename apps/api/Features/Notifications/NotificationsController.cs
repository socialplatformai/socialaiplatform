using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Notifications;

// C4 (aceite): projeção de estado in-app para o sino de notificações.
// Sem tabela nova, sem job, sem e-mail/push — só leitura derivada de estado existente.
// Três fontes: aprovações pendentes · falhas de publicação · token IG expirando.
// Estratégia de agregação: item-por-tipo (não item-por-ocorrência). Um sino com
// "3 conteúdos aguardando aprovação" é mais limpo que 3 entradas idênticas — o campo
// Ref fica null no item agregado (múltiplos conteúdos, sem single-ref).

/// <summary>DTO de notificação in-app. Kind identifica o tipo (para roteamento na UI).</summary>
/// <param name="Kind">Identificador de tipo: "approval_pending" | "publish_failed" | "ig_token_expiring".</param>
/// <param name="Title">Mensagem exibida no sino (PT-BR).</param>
/// <param name="Ref">Id do recurso relacionado (string) ou null quando agregado/múltiplos.</param>
/// <param name="Severity">Nível visual: "info" | "error" | "warning".</param>
public record NotificationDto(string Kind, string Title, string? Ref, string Severity);

/// <summary>
/// C4 (aceite): GET /api/notifications — lista DERIVADA DE ESTADO (sem tabela nova, sem job).
/// Retorna notificações agregadas por tipo para a marca/workspace atual.
/// E-mail e push estão FORA DE ESCOPO desta fase (D6).
/// </summary>
[ApiController]
[Authorize]
[Route("api/notifications")]
public class NotificationsController(
    AppDbContext db,
    ICurrentWorkspace current,
    BrandResolver brands) : ControllerBase
{
    private Guid Ws => current.WorkspaceId!.Value;

    /// <summary>
    /// C4: lista de notificações derivadas de estado para a marca/workspace atual.
    /// Retorna lista vazia quando não há alertas. Nunca retorna 404/500 por falta de dados.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<IEnumerable<NotificationDto>>> Get()
    {
        var brandId = await brands.ResolveAsync();
        var notifications = new List<NotificationDto>();

        // ── Fonte (a): aprovações pendentes ────────────────────────────────────
        // Contents da marca em PendingApproval OU Draft (não IsSample) aguardando decisão humana.
        // Materializa antes de contar (GOTCHA: SQLite não traduz DateTimeOffset em ORDER BY;
        // aqui não há ordenação, mas o padrão do codebase é ToListAsync + operação em memória).
        var pendentes = await db.Contents.AsNoTracking()
            .Where(c => c.BrandId == brandId
                        && !c.IsSample
                        && (c.Status == ContentStatus.PendingApproval || c.Status == ContentStatus.Draft))
            .Select(c => c.Id)
            .ToListAsync();

        if (pendentes.Count > 0)
        {
            // Agregado por tipo: um item com contagem. Ref = null (N conteúdos, sem single-ref).
            // Se houver exatamente 1, poderíamos passar o Id — mas a agregação é uniforme (KISS).
            var titulo = pendentes.Count == 1
                ? "1 conteúdo aguardando aprovação"
                : $"{pendentes.Count} conteúdo(s) aguardando aprovação";
            notifications.Add(new NotificationDto("approval_pending", titulo, null, "info"));
        }

        // ── Fonte (b): falhas de publicação ────────────────────────────────────
        // PublishLog.Result == Error cujo Content pertence à marca atual.
        // PublishLog não tem BrandId direto — join via ScheduledPost.ContentId → Content.BrandId.
        // GOTCHA: SQLite não traduz DateTimeOffset — materializa antes de qualquer ordenação/filtro
        // de data em memória. Aqui só filtramos por BrandId (scalar), seguro no SQL.
        var falhas = await (
            from log in db.PublishLogs.AsNoTracking()
            join sp in db.ScheduledPosts.AsNoTracking() on log.ScheduledPostId equals sp.Id
            join c in db.Contents.AsNoTracking() on sp.ContentId equals c.Id
            where c.BrandId == brandId && log.Result == PublishResult.Error
            select c.Id
        ).ToListAsync();

        // Deduplica por ContentId (um conteúdo pode ter múltiplos PublishLog de Error).
        var falhasUnicas = falhas.Distinct().ToList();
        foreach (var contentId in falhasUnicas)
        {
            // Item-por-ocorrência (não agregado): cada conteúdo com falha é uma notificação
            // separada — o operador precisa saber QUAL conteúdo falhou para agir. Ref = contentId.
            notifications.Add(new NotificationDto(
                "publish_failed",
                "Falha ao publicar",
                contentId.ToString(),
                "error"));
        }

        // ── Fonte (c): token Instagram expirando ───────────────────────────────
        // InstagramAccount da marca com TokenExpiresAt != null && TokenExpiresAt < now + 7 dias.
        // GOTCHA: não usar comparação de DateTimeOffset no SQL sob SQLite — materializa e compara
        // em memória (padrão do codebase: PerformanceAnalyzer, BrandReferencesController).
        var contas = await db.InstagramAccounts.AsNoTracking()
            .Where(a => a.BrandId == brandId && a.TokenExpiresAt != null)
            .Select(a => new { a.Id, a.TokenExpiresAt })
            .ToListAsync();

        var limite = DateTimeOffset.UtcNow.AddDays(7);
        // Comparação em memória (GOTCHA crítico: DateTimeOffset não traduz no SQLite).
        var expirandoBreve = contas.Where(a => a.TokenExpiresAt!.Value < limite).ToList();

        if (expirandoBreve.Count > 0)
        {
            // Agregado por tipo: normalmente há 1 conta IG por marca, mas por segurança agregamos.
            notifications.Add(new NotificationDto(
                "ig_token_expiring",
                "Token do Instagram expira em breve",
                null,
                "warning"));
        }

        return Ok(notifications);
    }
}
