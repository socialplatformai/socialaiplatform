// C1 (batch-delete): POST /api/content/batch-delete — exclui múltiplos conteúdos em uma operação.
// Conteúdos de outra marca ou ids inexistentes são silenciosamente ignorados (skipped).
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Content;

public record BatchDeleteRequest(IEnumerable<Guid> Ids);

// BatchResult declarado localmente (parallel a ApprovalBatchController; cada namespace tem o seu).
public record BatchResult(IEnumerable<Guid> Applied, IEnumerable<Guid> Skipped);

[ApiController]
[Authorize]
[Route("api/content")]
public class ContentBatchController(AppDbContext db, ICurrentWorkspace current, BrandResolver brands) : ControllerBase
{
    private Guid Ws => current.WorkspaceId!.Value;

    /// <summary>
    /// C1 (batch-delete): exclusão em lote de conteúdos da marca atual. Apenas ids que
    /// pertencem à marca corrente (BrandId) e ao workspace (filtro global) são removidos.
    /// Ids inválidos ou de outra marca vão para skipped — sem abortar a operação batch.
    /// A cascata de ContentSlide é via FK (configurada no AppDbContext); não é necessário
    /// remover slides manualmente.
    /// </summary>
    [HttpPost("batch-delete")]
    public async Task<ActionResult<BatchResult>> BatchDelete(BatchDeleteRequest req)
    {
        var brandId = await brands.ResolveAsync();
        var ids = req.Ids.ToList();

        // C1: carrega apenas conteúdos da marca atual cujos ids foram informados.
        // GOTCHA: filtro global já aplica WorkspaceId; BrandId é a sub-chave da marca.
        // Materializa com ToListAsync (GOTCHA SQLite: padrão do codebase — operações
        // em memória após materialização).
        var encontrados = await db.Contents
            .Where(c => c.BrandId == brandId && ids.Contains(c.Id))
            .ToListAsync();

        var encontradosSet = encontrados.Select(c => c.Id).ToHashSet();
        var skipped = ids.Where(id => !encontradosSet.Contains(id)).ToList();
        var applied = new List<Guid>(encontrados.Count);

        foreach (var content in encontrados)
        {
            db.Contents.Remove(content);
            applied.Add(content.Id);
        }

        await db.SaveChangesAsync();
        return Ok(new BatchResult(applied, skipped));
    }
}
