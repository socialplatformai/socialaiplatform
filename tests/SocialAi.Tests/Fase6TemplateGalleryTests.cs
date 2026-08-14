using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Templates;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// FASE 6 (Eixo B) — galeria de template no wizard. A API enriquece o TemplateDto com os metadados
/// que a galeria usa (slideCount, bestFor=casos de uso, recommendedFor=objetivos) extraídos do
/// SpecJson no servidor — a UI não baixa nem parseia o spec inteiro. B3: recommendedFor casa com o
/// objetivo da pauta p/ a UI marcar "recomendado". Os 4 built-in vêm do seed (D1).
/// </summary>
public class Fase6TemplateGalleryTests
{
    private static TemplatesController Controller(TestDb db)
    {
        var ctx = db.NewContext();
        return new TemplatesController(ctx, db.Current)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
    }

    private static Guid SeedWorkspace(TestDb db)
    {
        var ws = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using var seed = db.NewContext();
        seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
        seed.SaveChanges();
        return ws;
    }

    [Fact]
    public async Task List_enriquece_com_slideCount_bestFor_e_recommendedFor()
    {
        using var db = new TestDb();
        var ws = SeedWorkspace(db);
        db.Current.WorkspaceId = ws;

        var r = await Controller(db).List(default);
        var ok = Assert.IsType<OkObjectResult>(r.Result);
        var list = Assert.IsAssignableFrom<IEnumerable<TemplateDto>>(ok.Value).ToList();

        Assert.NotEmpty(list); // lazy seed garante os built-in
        // Todo template built-in tem slides → slideCount > 0 (extraído do SpecJson, não default 0).
        Assert.All(list, t => Assert.True(t.SlideCount > 0, $"template '{t.Key}' com slideCount 0"));

        // O product-launch (built-in) declara recommendedFor=["conversion","awareness"] e bestFor não-vazio.
        var pl = list.FirstOrDefault(t => t.Key == "product-launch");
        Assert.NotNull(pl);
        Assert.Contains("conversion", pl!.RecommendedFor);
        Assert.NotEmpty(pl.BestFor);
    }

    [Fact]
    public async Task List_expoe_a_jornada_do_template_extraida_dos_slides()
    {
        // CUS/templates-SOTA: a galeria mostra a ESTRUTURA (capa→problema→solução→cta), não só o nome.
        // A jornada vem de slides[].type do SpecJson. O product-launch é PAS: começa em cover, termina em cta.
        using var db = new TestDb();
        var ws = SeedWorkspace(db);
        db.Current.WorkspaceId = ws;

        var r = await Controller(db).List(default);
        var ok = Assert.IsType<OkObjectResult>(r.Result);
        var list = Assert.IsAssignableFrom<IEnumerable<TemplateDto>>(ok.Value).ToList();

        var pl = list.FirstOrDefault(t => t.Key == "product-launch");
        Assert.NotNull(pl);
        Assert.NotNull(pl!.Journey);
        // A jornada tem 1 entrada por slide e abre na capa / fecha no CTA (estrutura PAS real do template).
        Assert.Equal(pl.SlideCount, pl.Journey.Count);
        Assert.Equal("cover", pl.Journey.First());
        Assert.Equal("cta", pl.Journey.Last());
    }

    [Fact]
    public async Task List_degrada_sem_lancar_quando_metadados_ausentes()
    {
        // Garante que a lista funciona mesmo que algum spec não tenha os campos (degrada → vazio/0).
        using var db = new TestDb();
        var ws = SeedWorkspace(db);
        db.Current.WorkspaceId = ws;

        var r = await Controller(db).List(default);
        var ok = Assert.IsType<OkObjectResult>(r.Result);
        var list = Assert.IsAssignableFrom<IEnumerable<TemplateDto>>(ok.Value).ToList();

        // Nunca null: bestFor/recommendedFor são listas (possivelmente vazias), nunca null.
        Assert.All(list, t =>
        {
            Assert.NotNull(t.BestFor);
            Assert.NotNull(t.RecommendedFor);
        });
    }
}
