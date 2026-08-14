using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace SocialAi.Api.Data;

/// <summary>
/// Permite `dotnet ef migrations add` sem um DB rodando nem DI completo.
/// Em runtime o DbContext é resolvido pelo container (com ICurrentWorkspace do JWT);
/// aqui passamos null (sem tenant) — coerente com o filtro que deixa passar quando null.
/// </summary>
public class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var cs = Environment.GetEnvironmentVariable("ConnectionStrings__Postgres")
                 ?? "Host=localhost;Port=5432;Database=social_ai;Username=social;Password=changeme";

        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(cs)
            .Options;

        return new AppDbContext(options, current: null);
    }
}
