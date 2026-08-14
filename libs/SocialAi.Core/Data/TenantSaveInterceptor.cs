using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using SocialAi.Api.Domain;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Data;

/// <summary>
/// Isolamento de ESCRITA por tenant (T-2.2.2 / D8). Aplicado via interceptor para cobrir
/// AMBOS os caminhos — SaveChanges (síncrono) e SaveChangesAsync. Antes a guarda vivia só
/// no override de SaveChangesAsync, deixando o caminho síncrono sem proteção (furo latente
/// pego pelo teste de invariante S-30):
///   - inserts sem WorkspaceId recebem o workspace do request (auto-stamp);
///   - insert/update/delete com WorkspaceId de OUTRO tenant é recusado;
///   - Modified/Deleted cross-tenant também são bloqueados (defesa em profundidade).
/// Quando não há tenant no contexto (jobs sistêmicos/migrations), a guarda não se aplica.
/// </summary>
public sealed class TenantSaveInterceptor(ICurrentWorkspace? current) : SaveChangesInterceptor
{
    public override InterceptionResult<int> SavingChanges(
        DbContextEventData eventData, InterceptionResult<int> result)
    {
        Apply(eventData.Context);
        return base.SavingChanges(eventData, result);
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result, CancellationToken ct = default)
    {
        Apply(eventData.Context);
        return base.SavingChangesAsync(eventData, result, ct);
    }

    private void Apply(DbContext? db)
    {
        if (db is null) return;
        var ws = current?.WorkspaceId;

        foreach (var entry in db.ChangeTracker.Entries<TenantEntity>())
        {
            switch (entry.State)
            {
                case EntityState.Added:
                    if (entry.Entity.WorkspaceId == Guid.Empty && ws is { } add)
                        entry.Entity.WorkspaceId = add; // auto-stamp do workspace do request
                    else if (ws is { } w && entry.Entity.WorkspaceId != Guid.Empty && entry.Entity.WorkspaceId != w)
                        throw Cross();
                    break;

                case EntityState.Modified:
                case EntityState.Deleted:
                    // Update/Delete só é permitido dentro do próprio tenant.
                    if (ws is { } cur && entry.Entity.WorkspaceId != cur)
                        throw Cross();
                    if (entry.State == EntityState.Modified)
                        entry.Entity.UpdatedAt = DateTimeOffset.UtcNow;
                    break;
            }
        }
    }

    private static InvalidOperationException Cross() => new(
        "Cross-tenant write bloqueado: WorkspaceId da entidade difere do workspace do request.");
}
