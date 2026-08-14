using Microsoft.AspNetCore.Mvc;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Approval;
using SocialAi.Api.Features.Brands;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// Telas faltantes (sobre backend pronto) — modo de aprovação POR CONTA (workspace).
/// O endpoint PUT já existia; este incremento adiciona o GET que a tela consome. Prova:
/// GET devolve o modo padrão atual; PUT (Admin) muda; GET reflete a mudança. O isolamento
/// por workspace é o das 3 camadas (o controller resolve pelo Ws atual).
/// </summary>
public class ApprovalModeTests
{
    private static BrandResolver Resolver(AppDbContext ctx, Guid brand) =>
        new(ctx, new FakeCurrentBrand { BrandId = brand });

    private static ApprovalController Controller(TestDb db, AppDbContext ctx, Guid brand) =>
        new(ctx, db.Current, Resolver(ctx, brand), TestAudit.Service(ctx));

    private static (Guid ws, Guid brand) Seed(TestDb db, ApprovalMode initial)
    {
        var ws = Guid.NewGuid();
        var brand = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using var seed = db.NewContext();
        seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS", DefaultApprovalMode = initial });
        seed.Brands.Add(new Brand { Id = brand, WorkspaceId = ws, Name = "M" });
        seed.SaveChanges();
        return (ws, brand);
    }

    [Fact]
    public async Task GetWorkspaceMode_devolve_o_modo_padrao_atual()
    {
        using var db = new TestDb();
        var (ws, brand) = Seed(db, ApprovalMode.Manual);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var r = await Controller(db, ctx, brand).GetWorkspaceMode();
        var ok = Assert.IsType<OkObjectResult>(r.Result);
        var dto = Assert.IsType<WorkspaceModeDto>(ok.Value);
        Assert.Equal(ApprovalMode.Manual, dto.Mode);
    }

    [Fact]
    public async Task Put_muda_o_modo_e_o_get_reflete()
    {
        using var db = new TestDb();
        var (ws, brand) = Seed(db, ApprovalMode.Manual);
        db.Current.WorkspaceId = ws;

        using (var ctx = db.NewContext())
        {
            var r = await Controller(db, ctx, brand)
                .SetWorkspaceMode(new SetWorkspaceModeRequest(ApprovalMode.Automatic));
            Assert.IsType<NoContentResult>(r);
        }
        using (var ctx = db.NewContext())
        {
            var r = await Controller(db, ctx, brand).GetWorkspaceMode();
            var ok = Assert.IsType<OkObjectResult>(r.Result);
            var dto = Assert.IsType<WorkspaceModeDto>(ok.Value);
            Assert.Equal(ApprovalMode.Automatic, dto.Mode);
        }
    }
}
