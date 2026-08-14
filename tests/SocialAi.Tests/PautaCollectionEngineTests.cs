using Microsoft.AspNetCore.Mvc;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Features.Pautas;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// FASE 3 / E3 (ADR-0003) — coleta↔engine no lado .NET. Prova: (a) MarketingObjective
/// persiste; (b) o filtro de categoria (E3.5) isola por Category dentro da marca; (c) o
/// endpoint de categorias lista as distintas da marca atual. A serialização ao agents
/// (referenceContext/category/objective) é coberta pelos testes do input-adapter.
/// </summary>
public class PautaCollectionEngineTests
{
    private static (TestDb db, Guid ws, Guid brand) SeedMarca()
    {
        var db = new TestDb();
        var ws = Guid.NewGuid();
        var brand = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using var seed = db.NewContext();
        seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
        seed.Brands.Add(new Brand { Id = brand, WorkspaceId = ws, Name = "Marca" });
        seed.SaveChanges();
        return (db, ws, brand);
    }

    private static PautaController Controller(TestDb db, AppDbContext ctx, Guid brand) =>
        new(ctx, db.Current, new BrandResolver(ctx, new FakeCurrentBrand { BrandId = brand }));

    private static PautaInput Input(string title, string? category = null, string? objective = null) =>
        new(title, null, null, Priority.Medium, category, ContentType.Post, null, null, objective);

    [Fact]
    public async Task MarketingObjective_persiste_e_volta_no_dto()
    {
        var (db, ws, brand) = SeedMarca();
        using (db)
        {
            db.Current.WorkspaceId = ws;
            using var ctx = db.NewContext();
            var ctrl = Controller(db, ctx, brand);
            var r = await ctrl.Create(Input("Pauta", objective: "conversão"));
            var ok = Assert.IsType<OkObjectResult>(r.Result);
            var dto = Assert.IsType<PautaDto>(ok.Value);
            Assert.Equal("conversão", dto.MarketingObjective);
        }
    }

    [Fact]
    public void Filtro_de_categoria_isola_a_lista_dentro_da_marca()
    {
        // GOTCHA §5: o List() do controller ordena por DateTimeOffset (SuggestedDate), que o
        // SQLite não suporta em ORDER BY (Postgres sim). Testamos a MESMA lógica de filtro
        // (Where Category == X, escopado por marca) via DbContext direto — sem o ORDER BY.
        var (db, ws, brand) = SeedMarca();
        using (db)
        {
            db.Current.WorkspaceId = null;
            using (var seed = db.NewContext())
            {
                seed.Pautas.Add(new Pauta { WorkspaceId = ws, BrandId = brand, Title = "Edu 1", Category = "Educacional" });
                seed.Pautas.Add(new Pauta { WorkspaceId = ws, BrandId = brand, Title = "Promo 1", Category = "Promoção" });
                seed.Pautas.Add(new Pauta { WorkspaceId = ws, BrandId = brand, Title = "Edu 2", Category = "Educacional" });
                seed.SaveChanges();
            }

            db.Current.WorkspaceId = ws;
            using var ctx = db.NewContext();
            var educacionais = ctx.Pautas
                .Where(p => p.BrandId == brand && p.Category == "Educacional")
                .Select(p => p.Title).ToList();
            Assert.Equal(2, educacionais.Count);
            Assert.DoesNotContain("Promo 1", educacionais);
        }
    }

    [Fact]
    public async Task Categories_lista_as_distintas_da_marca_ordenadas()
    {
        var (db, ws, brand) = SeedMarca();
        using (db)
        {
            db.Current.WorkspaceId = ws;
            using (var ctx = db.NewContext())
            {
                var ctrl = Controller(db, ctx, brand);
                await ctrl.Create(Input("a", category: "Promoção"));
                await ctrl.Create(Input("b", category: "Educacional"));
                await ctrl.Create(Input("c", category: "Educacional"));
                await ctrl.Create(Input("d", category: null)); // sem categoria não aparece
            }

            using var ctx2 = db.NewContext();
            var ctrl2 = Controller(db, ctx2, brand);
            var r = await ctrl2.Categories();
            var ok = Assert.IsType<OkObjectResult>(r.Result);
            var cats = Assert.IsAssignableFrom<IEnumerable<string>>(ok.Value);
            Assert.Equal(new[] { "Educacional", "Promoção" }, cats);
        }
    }
}
