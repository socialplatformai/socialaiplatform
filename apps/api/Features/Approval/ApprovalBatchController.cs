// C1 (batch): POST /api/approval/batch — aprova ou rejeita múltiplos conteúdos em uma operação.
// Conteúdos de outra marca ou em estado não-decidível são silenciosamente ignorados (skipped).
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Approval;

public record BatchApprovalRequest(IEnumerable<Guid> Ids, string Action, string? Comments);
public record BatchResult(IEnumerable<Guid> Applied, IEnumerable<Guid> Skipped);

[ApiController]
[Authorize]
[Route("api/approval")]
public class ApprovalBatchController(AppDbContext db, ICurrentWorkspace current, BrandResolver brands) : ControllerBase
{
    private Guid Ws => current.WorkspaceId!.Value;

    /// <summary>
    /// C1 (batch): aprovação/rejeição em lote. Apenas conteúdos da marca atual em estado
    /// decidível (Draft|PendingApproval) são processados. Inválidos vão para skipped —
    /// nunca erro, para que um id inválido não aborte toda a operação batch.
    /// </summary>
    [HttpPost("batch")]
    public async Task<ActionResult<BatchResult>> Batch(BatchApprovalRequest req)
    {
        // Valida a ação antes de tocar no banco — falha rápida, sem custo de IO.
        if (req.Action is not ("approve" or "reject"))
            return Problem("Ação inválida. Use 'approve' ou 'reject'.", statusCode: 400);

        var brandId = await brands.ResolveAsync();
        var ids = req.Ids.ToList();

        // C1: carrega apenas conteúdos da marca atual em estado decidível.
        // GOTCHA: filtro global já aplica WorkspaceId; BrandId é a sub-chave.
        // Materializa com ToListAsync antes de filtrar em memória (GOTCHA SQLite: sem ORDER BY
        // de DateTimeOffset no SQL — aqui não há ORDER BY mas o padrão do projeto materializa).
        var decidíveis = await db.Contents
            .Include(c => c.Approval)
            .Where(c => c.BrandId == brandId
                        && ids.Contains(c.Id)
                        && (c.Status == ContentStatus.Draft || c.Status == ContentStatus.PendingApproval))
            .ToListAsync();

        var decidíveisSet = decidíveis.Select(c => c.Id).ToHashSet();
        var skipped = ids.Where(id => !decidíveisSet.Contains(id)).ToList();
        var applied = new List<Guid>(decidíveis.Count);

        var now = DateTimeOffset.UtcNow;

        foreach (var content in decidíveis)
        {
            if (req.Action == "approve")
            {
                content.TransitionTo(ContentStatus.Approved); // F4/C1: validado
            }
            else // "reject"
            {
                content.TransitionTo(ContentStatus.Rejected); // F4/C1: validado

                // C1: upsert do Approval com Approved=false e os comentários da rejeição.
                // Segue o mesmo padrão de ApprovalController.Decide (sem nullable WorkspaceId).
                if (content.Approval is null)
                {
                    content.Approval = new Domain.Approval
                    {
                        WorkspaceId = Ws,
                        ContentId = content.Id
                    };
                    db.Approvals.Add(content.Approval);
                }

                content.Approval.Approved = false;
                content.Approval.Comments = req.Comments;
                content.Approval.DecidedAt = now;
            }

            applied.Add(content.Id);
        }

        await db.SaveChangesAsync();
        return Ok(new BatchResult(applied, skipped));
    }
}
