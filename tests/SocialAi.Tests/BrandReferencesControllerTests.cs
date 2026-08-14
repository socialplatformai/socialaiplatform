using Microsoft.AspNetCore.Mvc;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.References;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// E1 (ADR-0008): CRUD da biblioteca de marca, isolado por marca+workspace.
/// Prova que itens de uma marca nunca aparecem, são afetados ou vazam para outra marca.
/// </summary>
public class BrandReferencesControllerTests
{
    // ── helper: cria workspace com duas marcas (A e B) e retorna ids ─────────────
    private static (Guid ws, Guid brandA, Guid brandB) SeedWorkspaceComDuasMarcas(TestDb db)
    {
        var ws = Guid.NewGuid();
        var brandA = Guid.NewGuid();
        var brandB = Guid.NewGuid();

        // Semeia sem filtro de tenant (padrão sistêmico do TestDb)
        db.Current.WorkspaceId = null;
        using var seed = db.NewContext();
        seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
        seed.Brands.Add(new Brand { Id = brandA, WorkspaceId = ws, Name = "Marca A" });
        seed.Brands.Add(new Brand { Id = brandB, WorkspaceId = ws, Name = "Marca B" });
        seed.SaveChanges();

        return (ws, brandA, brandB);
    }

    // ── 1) E1: criar item na marca A e confirmar isolamento na listagem ───────────
    [Fact]
    public async Task Create_e_List_por_marca()
    {
        // E1: item criado na marca A deve aparecer apenas em List(A) — List(B) devolve 0.
        using var db = new TestDb();
        var (ws, brandA, brandB) = SeedWorkspaceComDuasMarcas(db);

        db.Current.WorkspaceId = ws;
        using var ctx = db.NewContext();
        var ctrl = new BrandReferencesController(ctx, db.Current);

        // Cria item na marca A
        var createRes = await ctrl.Create(brandA, new CreateLibraryItemRequest(LibraryItemKind.Hashtag, "#x", null));
        Assert.IsType<OkObjectResult>(createRes.Result);

        // List(A) retorna exatamente 1 item
        var listA = await ctrl.List(brandA, null);
        var itemsA = Assert.IsAssignableFrom<IEnumerable<LibraryItemDto>>(
            Assert.IsType<OkObjectResult>(listA.Result).Value);
        Assert.Single(itemsA);

        // List(B) retorna 0 — isolamento de marca (E1)
        var listB = await ctrl.List(brandB, null);
        var itemsB = Assert.IsAssignableFrom<IEnumerable<LibraryItemDto>>(
            Assert.IsType<OkObjectResult>(listB.Result).Value);
        Assert.Empty(itemsB);
    }

    // ── 2) E1: filtro por Kind devolve apenas o Kind solicitado ──────────────────
    [Fact]
    public async Task List_filtra_por_kind()
    {
        // E1: List(brandId, Hashtag) deve excluir itens de outro Kind na mesma marca.
        using var db = new TestDb();
        var (ws, brandA, _) = SeedWorkspaceComDuasMarcas(db);

        db.Current.WorkspaceId = ws;
        using var ctx = db.NewContext();
        var ctrl = new BrandReferencesController(ctx, db.Current);

        await ctrl.Create(brandA, new CreateLibraryItemRequest(LibraryItemKind.Hashtag, "#hashtag", null));
        await ctrl.Create(brandA, new CreateLibraryItemRequest(LibraryItemKind.Example, "exemplo de copy", null));

        // Filtra por Hashtag — deve retornar só 1
        var listRes = await ctrl.List(brandA, LibraryItemKind.Hashtag);
        var items = Assert.IsAssignableFrom<IEnumerable<LibraryItemDto>>(
            Assert.IsType<OkObjectResult>(listRes.Result).Value);

        var list = items.ToList();
        Assert.Single(list);
        Assert.Equal(LibraryItemKind.Hashtag, list[0].Kind);
    }

    // ── 3) E1: value vazio deve devolver 400 (Problem) ───────────────────────────
    [Fact]
    public async Task Create_value_vazio_e_400()
    {
        // E1: valor obrigatório — string de espaços deve rejeitar com status 400.
        using var db = new TestDb();
        var (ws, brandA, _) = SeedWorkspaceComDuasMarcas(db);

        db.Current.WorkspaceId = ws;
        using var ctx = db.NewContext();
        var ctrl = new BrandReferencesController(ctx, db.Current);

        var res = await ctrl.Create(brandA, new CreateLibraryItemRequest(LibraryItemKind.Hashtag, "  ", null));

        // Problem() devolve ObjectResult; StatusCode deve ser 400
        var objResult = Assert.IsType<ObjectResult>(res.Result);
        Assert.Equal(400, objResult.StatusCode);
    }

    // ── 4) E1: Delete de item de outra marca devolve 404 e não remove o item ─────
    [Fact]
    public async Task Delete_de_outra_marca_e_404()
    {
        // E1: Delete(brandB, itemDaMarcaA) → 404; item de A continua existindo (não vaza, não apaga).
        using var db = new TestDb();
        var (ws, brandA, brandB) = SeedWorkspaceComDuasMarcas(db);

        db.Current.WorkspaceId = ws;
        using var ctx = db.NewContext();
        var ctrl = new BrandReferencesController(ctx, db.Current);

        // Cria item na marca A e extrai o Id do DTO retornado
        var createRes = await ctrl.Create(brandA, new CreateLibraryItemRequest(LibraryItemKind.Hashtag, "#privado", null));
        var dto = Assert.IsType<LibraryItemDto>(
            Assert.IsType<OkObjectResult>(createRes.Result).Value);
        var itemIdDeA = dto.Id;

        // Tenta deletar via contexto da marca B — deve ser 404 (não vaza existência)
        var deleteRes = await ctrl.Delete(brandB, itemIdDeA);
        Assert.IsType<NotFoundResult>(deleteRes);

        // Confirma que o item de A ainda existe
        var listA = await ctrl.List(brandA, null);
        var itemsA = Assert.IsAssignableFrom<IEnumerable<LibraryItemDto>>(
            Assert.IsType<OkObjectResult>(listA.Result).Value);
        Assert.Single(itemsA);
    }

    // ── 5) E1: Delete da própria marca remove o item corretamente ────────────────
    [Fact]
    public async Task Delete_da_propria_marca_remove()
    {
        // E1: Delete(brandA, itemDeA) → NoContent; List(A) fica vazio.
        using var db = new TestDb();
        var (ws, brandA, _) = SeedWorkspaceComDuasMarcas(db);

        db.Current.WorkspaceId = ws;
        using var ctx = db.NewContext();
        var ctrl = new BrandReferencesController(ctx, db.Current);

        // Cria item e extrai Id
        var createRes = await ctrl.Create(brandA, new CreateLibraryItemRequest(LibraryItemKind.Hashtag, "#remover", null));
        var dto = Assert.IsType<LibraryItemDto>(
            Assert.IsType<OkObjectResult>(createRes.Result).Value);

        // Delete pela própria marca — deve devolver NoContent
        var deleteRes = await ctrl.Delete(brandA, dto.Id);
        Assert.IsType<NoContentResult>(deleteRes);

        // Lista deve estar vazia após remoção
        var listRes = await ctrl.List(brandA, null);
        var items = Assert.IsAssignableFrom<IEnumerable<LibraryItemDto>>(
            Assert.IsType<OkObjectResult>(listRes.Result).Value);
        Assert.Empty(items);
    }
}
