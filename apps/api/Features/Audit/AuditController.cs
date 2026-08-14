using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Audit;

// C2 (ADR-0010): leitura da trilha de auditoria. A ESCRITA é dona do AuditService (append-only
// nos pontos sensíveis); aqui só lemos, paginado, do mais recente p/ o mais antigo.
public record AuditEntryDto(
    Guid Id, Guid? BrandId, Guid ActorUserId, string ActorEmail,
    string Action, string Target, DateTimeOffset OccurredAt);
public record AuditPage(IReadOnlyList<AuditEntryDto> Items, int Page, int PageSize, int Total);

/// <summary>
/// C2 (ADR-0010): trilha de auditoria do WORKSPACE, somente leitura, restrita a Admin.
///
/// Isolamento entre workspaces: o global query filter (AppDbContext) já anexa
/// WorkspaceId == current.WorkspaceId a toda consulta de AuditEntry — o Admin enxerga só a
/// trilha do seu próprio workspace; não há predicado cross-workspace algum aqui e a existência
/// de entradas de outro tenant nunca vaza. [Authorize(Roles="Admin")] + RequireWorkspaceFilter
/// (global) garantem request autenticada, Admin e com workspace válido.
/// </summary>
[ApiController]
[Authorize(Roles = "Admin")]
[Route("api/audit")]
public class AuditController(AppDbContext db, ICurrentWorkspace current) : ControllerBase
{
    private Guid Ws => current.WorkspaceId!.Value;

    [HttpGet("")]
    public async Task<ActionResult<AuditPage>> Get(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);

        // GOTCHA 4: ordenar OccurredAt (DateTimeOffset) no SQL sob o filtro de tenant não traduz
        // no SQLite dos testes. Materializamos a trilha do workspace (já escopada pelo global
        // filter) e ordenamos/paginamos EM MEMÓRIA. Id como desempate determinístico.
        var todas = await db.AuditEntries.AsNoTracking().ToListAsync();
        var ord = todas
            .OrderByDescending(a => a.OccurredAt)
            .ThenByDescending(a => a.Id)
            .ToList();

        var total = ord.Count;
        var items = ord
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(a => new AuditEntryDto(
                a.Id, a.BrandId, a.ActorUserId, a.ActorEmail,
                a.Action, a.Target, a.OccurredAt))
            .ToList();

        return Ok(new AuditPage(items, page, pageSize, total));
    }
}
