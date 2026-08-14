using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Features.Pautas;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// ACEITE D3 (ADR-0008): Pauta.ForcedTemplateId só é aceito se o template existe no workspace.
/// Template de outro workspace ou inexistente → 400. null → pauta criada normalmente.
/// </summary>
public class PautaForcedTemplateTests
{
    /// <summary>
    /// Seed sistêmico: workspace + marca + template no workspace.
    /// Retorna os IDs e o TestDb (caller é responsável por dispor).
    /// </summary>
    private static (TestDb db, Guid ws, Guid brand, Guid templateId) SeedBase()
    {
        var db = new TestDb();
        var ws = Guid.NewGuid();
        var brand = Guid.NewGuid();
        var templateId = Guid.NewGuid();

        // Seed sistêmico sem filtro de tenant (WorkspaceId = null bypassa o global filter).
        db.Current.WorkspaceId = null;
        using var seed = db.NewContext();
        seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
        seed.Brands.Add(new Brand { Id = brand, WorkspaceId = ws, Name = "Marca" });
        // Template pertence ao workspace — D3 valida AnyAsync(t => t.Id == tid) com o filtro global.
        seed.Templates.Add(new Template
        {
            Id = templateId,
            WorkspaceId = ws,
            Key = "t1",
            Name = "Template 1",
            SpecJson = "{}",
        });
        seed.SaveChanges();

        return (db, ws, brand, templateId);
    }

    private static PautaController Controller(TestDb db, AppDbContext ctx, Guid brand) =>
        new(ctx, db.Current, new BrandResolver(ctx, new FakeCurrentBrand { BrandId = brand }));

    // ─────────────────────────────────────────────────────────────────────────
    // Teste 1 — D3: template válido (existe no workspace) → persiste ForcedTemplateId.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Create_com_template_valido_persiste_ForcedTemplateId()
    {
        var (db, ws, brand, templateId) = SeedBase();
        using (db)
        {
            db.Current.WorkspaceId = ws;
            using var ctx = db.NewContext();
            var ctrl = Controller(db, ctx, brand);

            // D3: template existe no workspace → deve aceitar e persistir.
            var input = new PautaInput(
                Title: "T",
                Objective: null,
                Context: null,
                Priority: Priority.Medium,
                Category: null,
                DesiredType: ContentType.Carousel,
                SuggestedDate: null,
                Attachments: null,
                ForcedTemplateId: templateId);

            var res = await ctrl.Create(input);

            var ok = Assert.IsType<OkObjectResult>(res.Result);
            var dto = Assert.IsType<PautaDto>(ok.Value);

            // Recarrega do banco para garantir que o valor foi persistido (não apenas retornado).
            using var verify = db.NewContext();
            var pauta = await verify.Pautas.AsNoTracking().FirstAsync(p => p.Id == dto.Id);
            Assert.Equal(templateId, pauta.ForcedTemplateId);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Teste 2 — D3: template inexistente (GUID aleatório) → 400.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Create_com_template_inexistente_e_400()
    {
        var (db, ws, brand, _) = SeedBase();
        using (db)
        {
            db.Current.WorkspaceId = ws;
            using var ctx = db.NewContext();
            var ctrl = Controller(db, ctx, brand);

            // D3: GUID aleatório — não existe nenhum Template com esse Id no workspace.
            var input = new PautaInput(
                Title: "T",
                Objective: null,
                Context: null,
                Priority: Priority.Medium,
                Category: null,
                DesiredType: ContentType.Carousel,
                SuggestedDate: null,
                Attachments: null,
                ForcedTemplateId: Guid.NewGuid());

            var res = await ctrl.Create(input);

            // Problem() retorna ObjectResult com StatusCode 400.
            var obj = Assert.IsType<ObjectResult>(res.Result);
            Assert.Equal(400, obj.StatusCode);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Teste 3 — D3: ForcedTemplateId=null → pauta criada normalmente, campo fica null.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Create_sem_template_ok()
    {
        var (db, ws, brand, _) = SeedBase();
        using (db)
        {
            db.Current.WorkspaceId = ws;
            using var ctx = db.NewContext();
            var ctrl = Controller(db, ctx, brand);

            // D3: null → sem validação de template, comportamento padrão (agents seleciona).
            var input = new PautaInput(
                Title: "T",
                Objective: null,
                Context: null,
                Priority: Priority.Medium,
                Category: null,
                DesiredType: ContentType.Carousel,
                SuggestedDate: null,
                Attachments: null,
                ForcedTemplateId: null);

            var res = await ctrl.Create(input);

            var ok = Assert.IsType<OkObjectResult>(res.Result);
            var dto = Assert.IsType<PautaDto>(ok.Value);
            Assert.Null(dto.ForcedTemplateId);
        }
    }
}
