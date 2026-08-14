using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;

namespace SocialAi.Api.Features.Learning;

/// <summary>
/// A4 (ADR-0009): dono ÚNICO da regra "último motivo de rejeição de uma pauta+marca".
/// Reutilizado por dois chamadores (mesmo padrão do GenerationCompletionService):
///   1. ContentController.BuildAgentRequestAsync — injeta o feedback no briefing da regeneração;
///   2. LearningController.RejectFeedback (GET /api/learning/reject-feedback) — expõe à UI.
/// Centralizar evita duplicar a query (e seu GOTCHA de SQLite) em dois lugares.
/// </summary>
public sealed class RejectFeedbackService(AppDbContext db)
{
    /// <summary>
    /// Último Approval.Comments de um Content REJEITADO da pauta+marca, por ordem de decisão.
    /// SQLite não traduz ORDER BY DateTimeOffset → materializa e ordena em memória (GOTCHA do
    /// codebase). null se nunca houve rejeição com comentário. SEMPRE escopado por brandId
    /// (isolamento E1): feedback de outra marca nunca vaza.
    /// </summary>
    public async Task<string?> UltimoMotivoAsync(Guid pautaId, Guid brandId, CancellationToken ct = default)
    {
        var rejeicoes = await (
            from a in db.Approvals.AsNoTracking()
            join c in db.Contents.AsNoTracking() on a.ContentId equals c.Id
            where c.PautaId == pautaId && c.BrandId == brandId
                  && a.Approved == false && a.Comments != null && a.Comments != ""
            select new { a.Comments, a.DecidedAt }).ToListAsync(ct);
        return rejeicoes.OrderByDescending(x => x.DecidedAt).Select(x => x.Comments).FirstOrDefault();
    }
}
