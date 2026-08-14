using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Domain;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// FASE 2 / E1 — isolamento de MARCA (sub-chave dentro do workspace). Brand NÃO é um
/// novo nível de tenancy: o isolamento de tenant continua por WorkspaceId (filtro global
/// + interceptor). Estes testes provam que (a) o modelo suporta N marcas/workspace,
/// (b) filtrar por BrandId isola dentro do workspace (cross-brand), (c) o isolamento de
/// workspace permanece intacto com Brand no modelo (cross-workspace, não-regressão).
/// </summary>
public class BrandIsolationTests
{
    // ── Cross-brand: duas marcas no MESMO workspace; filtrar por marca isola ──────
    [Fact]
    public void Filtrar_por_BrandId_isola_pautas_dentro_do_mesmo_workspace()
    {
        using var db = new TestDb();
        var ws = Guid.NewGuid();
        var brandA = Guid.NewGuid();
        var brandB = Guid.NewGuid();

        db.Current.WorkspaceId = null; // semeia sem filtro
        using (var seed = db.NewContext())
        {
            seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
            seed.Brands.Add(new Brand { Id = brandA, WorkspaceId = ws, Name = "Marca A" });
            seed.Brands.Add(new Brand { Id = brandB, WorkspaceId = ws, Name = "Marca B" });
            seed.Pautas.Add(new Pauta { WorkspaceId = ws, BrandId = brandA, Title = "Pauta A" });
            seed.Pautas.Add(new Pauta { WorkspaceId = ws, BrandId = brandB, Title = "Pauta B" });
            seed.SaveChanges();
        }

        // Como tenant do workspace, ao filtrar por marca A só vê A (filtro explícito
        // por BrandId — é o que o controller faz com o header X-Brand-Id, E1-b).
        db.Current.WorkspaceId = ws;
        using var ctx = db.NewContext();
        var daMarcaA = ctx.Pautas.Where(p => p.BrandId == brandA).Select(p => p.Title).ToList();
        var daMarcaB = ctx.Pautas.Where(p => p.BrandId == brandB).Select(p => p.Title).ToList();
        Assert.Equal(new[] { "Pauta A" }, daMarcaA);
        Assert.Equal(new[] { "Pauta B" }, daMarcaB);
    }

    // ── O seletor de marca lista só as marcas do workspace atual ─────────────────
    [Fact]
    public void Marcas_de_um_workspace_nunca_aparecem_em_outro()
    {
        using var db = new TestDb();
        var wsA = Guid.NewGuid();
        var wsB = Guid.NewGuid();

        db.Current.WorkspaceId = null;
        using (var seed = db.NewContext())
        {
            seed.Workspaces.Add(new Workspace { Id = wsA, Name = "A" });
            seed.Workspaces.Add(new Workspace { Id = wsB, Name = "B" });
            seed.Brands.Add(new Brand { WorkspaceId = wsA, Name = "Marca de A" });
            seed.Brands.Add(new Brand { WorkspaceId = wsB, Name = "Marca de B" });
            seed.SaveChanges();
        }

        db.Current.WorkspaceId = wsA;
        using var ctx = db.NewContext();
        // O filtro global por WorkspaceId aplica a Brand (é TenantEntity) — só vê as de A.
        var nomes = ctx.Brands.Select(x => x.Name).ToList();
        Assert.Equal(new[] { "Marca de A" }, nomes);
    }

    // ── Cross-workspace (não-regressão): interceptor barra Brand de outro tenant ──
    [Fact]
    public void Inserir_Brand_de_outro_workspace_e_bloqueado()
    {
        using var db = new TestDb();
        var wsA = Guid.NewGuid();
        var wsB = Guid.NewGuid();

        db.Current.WorkspaceId = null;
        using (var seed = db.NewContext())
        {
            seed.Workspaces.Add(new Workspace { Id = wsA, Name = "A" });
            seed.Workspaces.Add(new Workspace { Id = wsB, Name = "B" });
            seed.SaveChanges();
        }

        db.Current.WorkspaceId = wsA; // request do tenant A
        using var ctx = db.NewContext();
        ctx.Brands.Add(new Brand { WorkspaceId = wsB, Name = "Intrusa" }); // marca de B
        var ex = Assert.Throws<InvalidOperationException>(() => ctx.SaveChanges());
        Assert.Contains("Cross-tenant", ex.Message);
    }

    // ── Interceptor carimba o workspace do request numa Brand sem workspace ──────
    [Fact]
    public void Brand_sem_workspace_recebe_o_workspace_do_request()
    {
        using var db = new TestDb();
        var ws = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using (var seed = db.NewContext())
        {
            seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
            seed.SaveChanges();
        }

        db.Current.WorkspaceId = ws;
        using var ctx = db.NewContext();
        var brand = new Brand { Name = "Nova" }; // WorkspaceId = Guid.Empty
        ctx.Brands.Add(brand);
        ctx.SaveChanges();
        Assert.Equal(ws, brand.WorkspaceId); // carimbado pelo interceptor
    }
}
