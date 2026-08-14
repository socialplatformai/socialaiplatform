using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.References;

// E1 (ADR-0008): DTOs da biblioteca de marca — imutáveis, sem deps externas.
public record LibraryItemDto(Guid Id, LibraryItemKind Kind, string Value, string? Label);
public record CreateLibraryItemRequest(LibraryItemKind Kind, string Value, string? Label);

/// <summary>
/// E1 (ADR-0008): CRUD da biblioteca de marca — exemplos de copy, hashtags e referências.
/// Escopo duplo: workspace (filtro global EF) + marca (brandId no path).
/// Item de outra marca devolve 404; nunca vaza existência de dados alheios.
/// </summary>
[ApiController]
[Authorize]
[Route("api/brands/{brandId:guid}/references")]
public class BrandReferencesController(AppDbContext db, ICurrentWorkspace current) : ControllerBase
{
    private Guid Ws => current.WorkspaceId!.Value;

    // E1: valida que a marca do path pertence ao workspace atual.
    // O filtro global de WorkspaceId já restringe a query — marca de outro workspace
    // não é encontrada e devolve 404 (não vaza existência).
    private async Task<bool> BrandExistsAsync(Guid brandId) =>
        await db.Brands.AsNoTracking().AnyAsync(b => b.Id == brandId);

    /// <summary>E1: lista itens da biblioteca, com filtro opcional por Kind, ordenado por CreatedAt.</summary>
    [HttpGet]
    public async Task<ActionResult<IEnumerable<LibraryItemDto>>> List(
        Guid brandId, [FromQuery] LibraryItemKind? kind)
    {
        if (!await BrandExistsAsync(brandId)) return NotFound();

        var q = db.BrandLibraryItems.AsNoTracking().Where(x => x.BrandId == brandId);
        if (kind is not null) q = q.Where(x => x.Kind == kind);

        // GOTCHA: SQLite não traduz DateTimeOffset em ORDER BY — materializa e ordena em memória
        // (padrão do codebase: BrandResolver/PerformanceAnalyzer). O conjunto por marca é pequeno.
        var items = (await q.ToListAsync()).OrderBy(x => x.CreatedAt).ToList();
        return Ok(items.Select(ToDto));
    }

    /// <summary>E1: cria um item na biblioteca da marca.</summary>
    [HttpPost]
    public async Task<ActionResult<LibraryItemDto>> Create(Guid brandId, CreateLibraryItemRequest body)
    {
        if (!await BrandExistsAsync(brandId)) return NotFound();

        // E1: valor obrigatório — string vazia ou espaços não são aceitos.
        if (string.IsNullOrWhiteSpace(body.Value))
            return Problem("O campo 'value' é obrigatório e não pode ser vazio.", statusCode: 400);

        var item = new BrandLibraryItem
        {
            WorkspaceId = Ws,
            BrandId = brandId,
            Kind = body.Kind,
            Value = body.Value.Trim(),
            Label = body.Label,
        };

        db.BrandLibraryItems.Add(item);
        await db.SaveChangesAsync();
        return Ok(ToDto(item));
    }

    /// <summary>E1: remove um item da biblioteca. Item de outra marca → 404 (não vaza).</summary>
    [HttpDelete("{itemId:guid}")]
    public async Task<IActionResult> Delete(Guid brandId, Guid itemId)
    {
        if (!await BrandExistsAsync(brandId)) return NotFound();

        // E1: restringe ao brandId do path — item de outra marca dentro do mesmo workspace vira 404.
        var item = await db.BrandLibraryItems
            .FirstOrDefaultAsync(x => x.Id == itemId && x.BrandId == brandId);

        if (item is null) return NotFound();

        db.BrandLibraryItems.Remove(item);
        await db.SaveChangesAsync();
        return NoContent();
    }

    private static LibraryItemDto ToDto(BrandLibraryItem x) =>
        new(x.Id, x.Kind, x.Value, x.Label);
}
