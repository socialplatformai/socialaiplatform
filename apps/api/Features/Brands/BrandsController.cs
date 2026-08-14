using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Infrastructure;
// Desambigua: existe o namespace SocialAi.Api.Features.Brand (singular, feature do
// BrandKit) que colide com o TIPO de domínio Brand. Alias distinto p/ o tipo.
using DomainBrand = SocialAi.Api.Domain.Brand;

namespace SocialAi.Api.Features.Brands;

/// <summary>
/// CRUD de Marcas (E1/DP1). Marca é agrupador DENTRO do workspace; o isolamento
/// de tenant continua por WorkspaceId (filtro global). Resolução da marca atual é
/// por header X-Brand-Id (ver BrandResolver / ICurrentBrand).
/// </summary>
[ApiController]
[Authorize]
[Route("api/brands")]
public class BrandsController(AppDbContext db, ICurrentWorkspace current) : ControllerBase
{
    private Guid Ws => current.WorkspaceId!.Value;

    private static BrandDto ToDto(DomainBrand b) => new(b.Id, b.Name, b.CreatedAt);

    [HttpGet]
    public async Task<ActionResult<IEnumerable<BrandDto>>> List()
    {
        // Filtro global por WorkspaceId já restringe ao tenant; ordenamos por criação
        // (client-side p/ portabilidade SQLite/Postgres — conjunto pequeno por workspace).
        var list = (await db.Brands.AsNoTracking().ToListAsync())
            .OrderBy(b => b.CreatedAt).ThenBy(b => b.Id)
            .ToList();
        return Ok(list.Select(ToDto));
    }

    [HttpPost]
    public async Task<ActionResult<BrandDto>> Create(BrandInput input)
    {
        if (string.IsNullOrWhiteSpace(input.Name)) return Problem("Nome da marca obrigatório.", statusCode: 400);
        var brand = new DomainBrand { WorkspaceId = Ws, Name = input.Name.Trim() };
        db.Brands.Add(brand);
        await db.SaveChangesAsync();
        return Ok(ToDto(brand));
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<BrandDto>> Rename(Guid id, BrandInput input)
    {
        if (string.IsNullOrWhiteSpace(input.Name)) return Problem("Nome da marca obrigatório.", statusCode: 400);
        var brand = await db.Brands.FirstOrDefaultAsync(b => b.Id == id);
        if (brand is null) return NotFound();
        brand.Name = input.Name.Trim();
        await db.SaveChangesAsync();
        return Ok(ToDto(brand));
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var brand = await db.Brands.FirstOrDefaultAsync(b => b.Id == id);
        if (brand is null) return NotFound();

        // Bloqueia remover a ÚLTIMA marca do workspace (sempre há uma marca-default).
        var count = await db.Brands.CountAsync();
        if (count <= 1) return Problem("Não é possível remover a última marca do workspace.", statusCode: 400);

        db.Brands.Remove(brand);
        await db.SaveChangesAsync();
        return NoContent();
    }
}
