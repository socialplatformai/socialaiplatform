using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Brands;

/// <summary>
/// Resolve a marca efetiva do request (E1/ADR-0002), reutilizável pelos controllers
/// de pauta/conteúdo. Regras:
///  - Header X-Brand-Id presente: valida que a marca pertence ao workspace do JWT
///    (defense-in-depth); se não pertence → CrossWorkspaceBrandException (403 no controller).
///  - Header ausente/inválido: cai na marca-default (a mais antiga do workspace) — assim
///    a 1ª visita (sem seletor) funciona sem fricção.
/// O filtro global por WorkspaceId já garante que só enxergamos marcas do tenant.
/// </summary>
public class BrandResolver(AppDbContext db, ICurrentBrand currentBrand)
{
    /// <summary>Lançada quando o X-Brand-Id não pertence ao workspace do JWT.</summary>
    public sealed class CrossWorkspaceBrandException(Guid brandId)
        : Exception($"Marca {brandId} não pertence ao workspace atual.");

    /// <summary>Resolve o BrandId a usar. Lança CrossWorkspaceBrandException se o header
    /// apontar marca de outro workspace; cai na default se o header estiver ausente.</summary>
    public async Task<Guid> ResolveAsync(CancellationToken ct = default)
    {
        var headerBrand = currentBrand.BrandId;
        if (headerBrand is not null)
        {
            // O filtro global só retorna marcas do workspace do JWT — se não achar, ou
            // não existe, ou é de outro tenant: tratamos como acesso cross-workspace.
            var exists = await db.Brands.AsNoTracking().AnyAsync(b => b.Id == headerBrand.Value, ct);
            if (!exists) throw new CrossWorkspaceBrandException(headerBrand.Value);
            return headerBrand.Value;
        }

        // Sem header: marca-default (mais antiga). Toda conta tem ≥1 marca (backfill + bloqueio
        // de remover a última); se por algum motivo não houver, é estado inválido — lançamos.
        // Ordenação client-side: o conjunto de marcas/workspace é pequeno e isto é portável
        // (SQLite não ordena DateTimeOffset no SQL; Postgres sim — evitamos a divergência).
        var brands = await db.Brands.AsNoTracking()
            .Select(b => new { b.Id, b.CreatedAt })
            .ToListAsync(ct);
        var defaultBrand = brands
            .OrderBy(b => b.CreatedAt).ThenBy(b => b.Id)
            .Select(b => (Guid?)b.Id)
            .FirstOrDefault();
        return defaultBrand ?? throw new InvalidOperationException("Workspace sem nenhuma marca (estado inválido).");
    }
}
