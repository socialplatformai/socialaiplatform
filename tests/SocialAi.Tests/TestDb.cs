using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using SocialAi.Api.Data;
using SocialAi.Api.Generation;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Tests;

/// <summary>
/// Fábrica de serviços de geração (FASE 7) para os testes. Config opcional: sem ela, o
/// GenerationCostService cai nos defaults fail-safe não-zero (post/story=0.05, carousel=0.15) —
/// suficiente p/ testes que não exercitam a tabela de custo. Quem testa custo passa um IConfiguration.
/// </summary>
public static class TestGeneration
{
    public static IConfiguration Config(IDictionary<string, string?>? values = null) =>
        new ConfigurationBuilder().AddInMemoryCollection(values ?? new Dictionary<string, string?>()).Build();

    public static GenerationCostService Costs(IConfiguration? cfg = null) => new(cfg ?? Config());

    public static GenerationCompletionService Completion(IConfiguration? cfg = null) => new(Costs(cfg));
}

/// <summary>AuditService de teste: usa NullLogger (sem dependência de logging real).</summary>
public static class TestAudit
{
    public static SocialAi.Api.Features.Audit.AuditService Service(AppDbContext ctx) =>
        new(ctx, Microsoft.Extensions.Logging.Abstractions.NullLogger<SocialAi.Api.Features.Audit.AuditService>.Instance);
}

/// <summary>ICurrentWorkspace mutável para teste: troca o tenant "logado" entre asserções.</summary>
public sealed class FakeCurrentWorkspace : ICurrentWorkspace
{
    public Guid? WorkspaceId { get; set; }
}

/// <summary>ICurrentBrand de teste com BrandId nulo — p/ exercitar o caminho "sem X-Brand-Id".</summary>
public sealed class FakeNullBrand : ICurrentBrand
{
    public Guid? BrandId => null;
}

/// <summary>ICurrentBrand mutável para teste: simula o header X-Brand-Id.</summary>
public sealed class FakeCurrentBrand : ICurrentBrand
{
    public Guid? BrandId { get; set; }
}

/// <summary>
/// AppDbContext sobre SQLite in-memory (relacional: respeita índices únicos e o global
/// query filter). A conexão fica aberta durante a vida do TestDb (in-memory some ao fechar).
/// </summary>
public sealed class TestDb : IDisposable
{
    private readonly SqliteConnection _conn;
    public FakeCurrentWorkspace Current { get; } = new();

    public TestDb()
    {
        _conn = new SqliteConnection("DataSource=:memory:");
        _conn.Open();
        using var ctx = NewContext();
        ctx.Database.EnsureCreated(); // cria o schema a partir do modelo (sem migrations)
    }

    /// <summary>Novo contexto compartilhando a mesma conexão in-memory e o tenant atual.</summary>
    public AppDbContext NewContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(_conn)
            .Options;
        return new AppDbContext(options, Current);
    }

    public void Dispose() => _conn.Dispose();
}
