using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Brand;
using SocialAi.Api.Features.Brands;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// FASE 3 / E2 (ADR-0005) — identidade visual & texto de marca em BrandKit.
/// Prova: (a) os campos novos persistem e releem (E2.1); (b) a cardinalidade fina
/// BrandKit 1:1 Brand (unique index em BrandId) barra um 2º kit na mesma marca.
/// Isolamento por WorkspaceId permanece intacto (coberto por BrandIsolationTests).
/// </summary>
public class BrandVisualIdentityTests
{
    [Fact]
    public void Campos_de_identidade_visual_persistem_e_releem()
    {
        using var db = new TestDb();
        var ws = Guid.NewGuid();
        var brand = Guid.NewGuid();

        db.Current.WorkspaceId = null;
        using (var seed = db.NewContext())
        {
            seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
            seed.Brands.Add(new Brand { Id = brand, WorkspaceId = ws, Name = "Marca" });
            seed.BrandKits.Add(new BrandKit
            {
                WorkspaceId = ws,
                BrandId = brand,
                VisualPreset = "bold",
                PrimaryColorHex = "#FF0066",
                AccentColorHex = "#00E5FF",
                HeadingFont = "Poppins",
                BodyFont = "Inter",
                LogoUrl = "https://cdn/logo.png",
                TargetAudience = "Mulheres 25-40, urbanas",
                CopyExamples = "[\"Sua rotina merece ritual.\",\"Menos é mais.\"]",
            });
            seed.SaveChanges();
        }

        db.Current.WorkspaceId = ws;
        using var ctx = db.NewContext();
        var kit = ctx.BrandKits.AsNoTracking().Single(k => k.BrandId == brand);
        Assert.Equal("bold", kit.VisualPreset);
        Assert.Equal("#FF0066", kit.PrimaryColorHex);
        Assert.Equal("#00E5FF", kit.AccentColorHex);
        Assert.Equal("Poppins", kit.HeadingFont);
        Assert.Equal("Inter", kit.BodyFont);
        Assert.Equal("https://cdn/logo.png", kit.LogoUrl);
        Assert.Equal("Mulheres 25-40, urbanas", kit.TargetAudience);
        Assert.Equal("[\"Sua rotina merece ritual.\",\"Menos é mais.\"]", kit.CopyExamples);
    }

    [Fact]
    public void Dois_BrandKits_na_mesma_marca_sao_barrados_pelo_unique_index()
    {
        using var db = new TestDb();
        var ws = Guid.NewGuid();
        var brand = Guid.NewGuid();

        db.Current.WorkspaceId = null;
        using (var seed = db.NewContext())
        {
            seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
            seed.Brands.Add(new Brand { Id = brand, WorkspaceId = ws, Name = "Marca" });
            seed.BrandKits.Add(new BrandKit { WorkspaceId = ws, BrandId = brand });
            seed.SaveChanges();
        }

        // 2º kit para a MESMA marca viola o unique index IX_BrandKits_BrandId (E2).
        db.Current.WorkspaceId = ws;
        using var ctx = db.NewContext();
        ctx.BrandKits.Add(new BrandKit { WorkspaceId = ws, BrandId = brand });
        Assert.ThrowsAny<DbUpdateException>(() => ctx.SaveChanges());
    }

    // ── Validação de entrada no PutKit (E2 / achados adversariais) ───────────────
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

    private static BrandController Controller(TestDb db, AppDbContext ctx, Guid brand) =>
        new(ctx, db.Current, new BrandResolver(ctx, new FakeCurrentBrand { BrandId = brand }));

    [Fact]
    public async Task PutKit_rejeita_cor_hex_invalida_com_400()
    {
        var (db, ws, brand) = SeedMarca();
        using (db)
        {
            db.Current.WorkspaceId = ws;
            using var ctx = db.NewContext();
            var ctrl = Controller(db, ctx, brand);
            var r = await ctrl.PutKit(new BrandKitDto(null, null, null, null, null, PrimaryColorHex: "roxo"));
            var obj = Assert.IsType<ObjectResult>(r.Result);
            Assert.Equal(400, obj.StatusCode);
        }
    }

    [Fact]
    public async Task PutKit_rejeita_LogoUrl_perigosa_com_400()
    {
        var (db, ws, brand) = SeedMarca();
        using (db)
        {
            db.Current.WorkspaceId = ws;
            using var ctx = db.NewContext();
            var ctrl = Controller(db, ctx, brand);
            var r = await ctrl.PutKit(new BrandKitDto(null, null, null, null, null, LogoUrl: "javascript:alert(1)"));
            var obj = Assert.IsType<ObjectResult>(r.Result);
            Assert.Equal(400, obj.StatusCode);
        }
    }

    [Fact]
    public async Task PutKit_aceita_payload_valido_e_grava_normalizando_preset()
    {
        var (db, ws, brand) = SeedMarca();
        using (db)
        {
            db.Current.WorkspaceId = ws;
            using (var ctx = db.NewContext())
            {
                var ctrl = Controller(db, ctx, brand);
                var r = await ctrl.PutKit(new BrandKitDto(
                    "Marca", "Direto", null, null, null,
                    VisualPreset: "BOLD", PrimaryColorHex: "#FF0066",
                    LogoUrl: "https://cdn/logo.png",
                    TargetAudience: "Jovens", CopyExamples: new[] { "Exemplo 1", "  ", "Exemplo 2" }));
                Assert.IsType<OkObjectResult>(r.Result);
            }

            using var verify = db.NewContext();
            var kit = verify.BrandKits.AsNoTracking().Single(k => k.BrandId == brand);
            Assert.Equal("bold", kit.VisualPreset);   // normalizado p/ minúsculo
            Assert.Equal("#FF0066", kit.PrimaryColorHex);
            Assert.Equal("https://cdn/logo.png", kit.LogoUrl);
            Assert.Equal("[\"Exemplo 1\",\"Exemplo 2\"]", kit.CopyExamples); // vazios descartados
        }
    }

    [Fact]
    public void BrandKit_sem_campos_visuais_e_estado_valido()
    {
        // Marca criada pelo CRUD (E1-d) nasce sem kit; um kit sem campos visuais também
        // é válido — o input-adapter cai no preset/default APEX (degradado honesto).
        using var db = new TestDb();
        var ws = Guid.NewGuid();
        var brand = Guid.NewGuid();

        db.Current.WorkspaceId = null;
        using (var seed = db.NewContext())
        {
            seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
            seed.Brands.Add(new Brand { Id = brand, WorkspaceId = ws, Name = "Marca" });
            seed.BrandKits.Add(new BrandKit { WorkspaceId = ws, BrandId = brand });
            seed.SaveChanges();
        }

        db.Current.WorkspaceId = ws;
        using var ctx = db.NewContext();
        var kit = ctx.BrandKits.AsNoTracking().Single(k => k.BrandId == brand);
        Assert.Null(kit.VisualPreset);
        Assert.Null(kit.PrimaryColorHex);
        Assert.Null(kit.CopyExamples);
    }
}
