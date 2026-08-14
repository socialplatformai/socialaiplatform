using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.JsonWebTokens;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Audit;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Approval;

public record ApprovalDecision(bool Approved, string? Reviewer, string? Comments);
public record SetWorkspaceModeRequest(ApprovalMode Mode);
public record SetCampaignModeRequest(ApprovalMode? Mode);
public record SetContentModeRequest(ApprovalMode? Mode);
public record WorkspaceModeDto(ApprovalMode Mode);

public record PendingContentDto(
    Guid ContentId, string? Caption, ContentType Type, ContentStatus Status, ApprovalMode EffectiveMode,
    int? QualityScore); // C3: a tela de aprovações mostra aviso quando score < 70.

[ApiController]
[Authorize]
[Route("api/approval")]
public class ApprovalController(
    AppDbContext db, ICurrentWorkspace current, BrandResolver brands, AuditService audit) : ControllerBase
{
    private Guid Ws => current.WorkspaceId!.Value;
    private Guid ActorId => User.ActorId();
    private string ActorEmail => User.ActorEmail();

    // E1: além do isolamento por workspace (filtro global), TUDO aqui é escopado pela
    // MARCA atual (X-Brand-Id). Sem isto, um user da marca A aprovaria/configuraria
    // conteúdo da marca B no mesmo workspace (furo cross-brand pego na auditoria).
    private Task<Guid> CurrentBrandAsync() => brands.ResolveAsync();

    /// <summary>
    /// Resolve o modo efetivo por PRECEDÊNCIA: conteúdo > campanha > workspace.
    /// null em conteúdo/campanha = herda do nível abaixo.
    /// </summary>
    public static ApprovalMode ResolveMode(Domain.Content content, Campaign? campaign, Workspace workspace) =>
        content.ApprovalModeOverride
        ?? campaign?.ApprovalMode
        ?? workspace.DefaultApprovalMode;

    [HttpGet("pending")]
    public async Task<ActionResult<IEnumerable<PendingContentDto>>> Pending()
    {
        var brandId = await CurrentBrandAsync();
        var ws = await db.Workspaces.AsNoTracking().FirstAsync(w => w.Id == Ws);
        var items = await db.Contents.AsNoTracking()
            .Include(c => c.Campaign)
            .Where(c => c.BrandId == brandId)
            .Where(c => c.Status == ContentStatus.PendingApproval || c.Status == ContentStatus.Draft)
            .ToListAsync();

        return Ok(items.Select(c => new PendingContentDto(
            c.Id, c.Caption, c.Type, c.Status, ResolveMode(c, c.Campaign, ws), c.QualityScore)));
    }

    [HttpPost("content/{id:guid}/decide")]
    public async Task<IActionResult> Decide(Guid id, ApprovalDecision decision)
    {
        var brandId = await CurrentBrandAsync();
        var content = await db.Contents.Include(c => c.Approval).FirstOrDefaultAsync(c => c.Id == id && c.BrandId == brandId);
        if (content is null) return NotFound();

        // G3: decisão só vale em conteúdo pendente. Sem isto, dava para re-aprovar um
        // Published ou rejeitar um Scheduled (que continuava sendo publicado pelo worker).
        if (content.Status is not (ContentStatus.Draft or ContentStatus.PendingApproval))
            return Problem(
                $"Conteúdo em status '{content.Status}' não pode ser aprovado/rejeitado.",
                statusCode: 409);

        // Approval 1:1: cria a linha na 1ª decisão, atualiza nas seguintes. O Add EXPLÍCITO é
        // necessário porque a PK (Guid) já vem preenchida pelo TenantEntity — sem o Add, o EF lê o
        // Guid não-default como "entidade existente" e gera UPDATE (0 linhas → DbUpdateConcurrency).
        if (content.Approval is null)
        {
            content.Approval = new Domain.Approval { WorkspaceId = Ws, ContentId = content.Id };
            db.Approvals.Add(content.Approval);
        }
        content.Approval.Approved = decision.Approved;
        content.Approval.Reviewer = decision.Reviewer;
        content.Approval.Comments = decision.Comments;
        content.Approval.DecidedAt = DateTimeOffset.UtcNow;
        // F4/C1: transição validada pela máquina de estado (Draft/PendingApproval → Approved/Rejected).
        content.TransitionTo(decision.Approved ? ContentStatus.Approved : ContentStatus.Rejected);

        await db.SaveChangesAsync();

        // C2: trilha de auditoria da decisão (aprovar/rejeitar é ação sensível — gate humano).
        await audit.LogAsync(Ws, ActorId, ActorEmail,
            decision.Approved ? "content.approve" : "content.reject", content.Id.ToString(), brandId);
        return NoContent();
    }

    // ── Config de modo nos 3 níveis ───────────────────────────────────────────
    // Sec: ESCRITA do modo de aprovação é sensível — definir Automatic desliga o gate de
    // moderação humana. Restrito a Admin (coerente com MetaAppConfigController). Leitura
    // (Pending/Decide/GetEffectiveMode) segue aberta a qualquer autenticado.
    /// <summary>Modo de aprovação padrão da conta (workspace). Leitura aberta a qualquer
    /// autenticado (como Pending/Decide); a UI mostra/edita em Configurações.</summary>
    [HttpGet("mode/workspace")]
    public async Task<ActionResult<WorkspaceModeDto>> GetWorkspaceMode()
    {
        var ws = await db.Workspaces.AsNoTracking().FirstAsync(w => w.Id == Ws);
        return Ok(new WorkspaceModeDto(ws.DefaultApprovalMode));
    }

    [HttpPut("mode/workspace")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> SetWorkspaceMode(SetWorkspaceModeRequest req)
    {
        var ws = await db.Workspaces.FirstAsync(w => w.Id == Ws);
        ws.DefaultApprovalMode = req.Mode;
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPut("mode/campaign/{id:guid}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> SetCampaignMode(Guid id, SetCampaignModeRequest req)
    {
        var brandId = await CurrentBrandAsync();
        var c = await db.Campaigns.FirstOrDefaultAsync(x => x.Id == id && x.BrandId == brandId);
        if (c is null) return NotFound();
        c.ApprovalMode = req.Mode;
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPut("mode/content/{id:guid}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> SetContentMode(Guid id, SetContentModeRequest req)
    {
        var brandId = await CurrentBrandAsync();
        var c = await db.Contents.FirstOrDefaultAsync(x => x.Id == id && x.BrandId == brandId);
        if (c is null) return NotFound();
        c.ApprovalModeOverride = req.Mode;
        await db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Modo efetivo de um conteúdo (debug/UI).</summary>
    [HttpGet("content/{id:guid}/mode")]
    public async Task<ActionResult<ApprovalMode>> GetEffectiveMode(Guid id)
    {
        var brandId = await CurrentBrandAsync();
        var content = await db.Contents.AsNoTracking().Include(c => c.Campaign).FirstOrDefaultAsync(c => c.Id == id && c.BrandId == brandId);
        if (content is null) return NotFound();
        var ws = await db.Workspaces.AsNoTracking().FirstAsync(w => w.Id == Ws);
        return Ok(ResolveMode(content, content.Campaign, ws));
    }
}
