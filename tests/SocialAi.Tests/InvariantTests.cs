using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Approval;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// S-30 — invariantes-joia. Cada teste falha se a invariante regredir.
/// </summary>
public class InvariantTests
{
    // ── Isolamento multi-tenant: leitura ────────────────────────────────────────
    [Fact]
    public void Leitura_de_um_workspace_nunca_enxerga_dado_de_outro()
    {
        using var db = new TestDb();
        var wsA = Guid.NewGuid();
        var wsB = Guid.NewGuid();

        // Semeia sem filtro (contexto sistêmico = WorkspaceId null). Cria os Workspaces
        // primeiro (FK de Pauta.WorkspaceId), e uma marca-default por workspace (E1:
        // Pauta.BrandId é NOT NULL desde o contract).
        var brandA = Guid.NewGuid();
        var brandB = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using (var seed = db.NewContext())
        {
            seed.Workspaces.Add(new Workspace { Id = wsA, Name = "A" });
            seed.Workspaces.Add(new Workspace { Id = wsB, Name = "B" });
            seed.Brands.Add(new Brand { Id = brandA, WorkspaceId = wsA, Name = "Marca A" });
            seed.Brands.Add(new Brand { Id = brandB, WorkspaceId = wsB, Name = "Marca B" });
            seed.Pautas.Add(new Pauta { WorkspaceId = wsA, BrandId = brandA, Title = "Pauta A" });
            seed.Pautas.Add(new Pauta { WorkspaceId = wsB, BrandId = brandB, Title = "Pauta B" });
            seed.SaveChanges();
        }

        // Como tenant A, só vê A.
        db.Current.WorkspaceId = wsA;
        using (var ctx = db.NewContext())
        {
            var titulos = ctx.Pautas.Select(p => p.Title).ToList();
            Assert.Equal(new[] { "Pauta A" }, titulos);
        }
    }

    // ── Isolamento multi-tenant: escrita (write-guard) ──────────────────────────
    [Fact]
    public void Escrita_cross_tenant_e_bloqueada()
    {
        using var db = new TestDb();
        var wsA = Guid.NewGuid();
        var wsB = Guid.NewGuid();

        // Cria os dois workspaces (FK) sem filtro.
        db.Current.WorkspaceId = null;
        using (var seed = db.NewContext())
        {
            seed.Workspaces.Add(new Workspace { Id = wsA, Name = "A" });
            seed.Workspaces.Add(new Workspace { Id = wsB, Name = "B" });
            seed.SaveChanges();
        }

        db.Current.WorkspaceId = wsA; // request é do tenant A
        using var ctx = db.NewContext();
        // Tenta gravar uma entidade marcada com o workspace de B → deve recusar (sync E async).
        ctx.Pautas.Add(new Pauta { WorkspaceId = wsB, Title = "Intruso" });
        var ex = Assert.Throws<InvalidOperationException>(() => ctx.SaveChanges());
        Assert.Contains("Cross-tenant", ex.Message);
    }

    [Fact]
    public void Insert_sem_workspace_recebe_o_workspace_do_request()
    {
        using var db = new TestDb();
        var wsA = Guid.NewGuid();
        var brandA = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using (var seed = db.NewContext())
        {
            seed.Workspaces.Add(new Workspace { Id = wsA, Name = "A" });
            seed.Brands.Add(new Brand { Id = brandA, WorkspaceId = wsA, Name = "Marca A" });
            seed.SaveChanges();
        }

        db.Current.WorkspaceId = wsA;
        using var ctx = db.NewContext();
        var p = new Pauta { Title = "Sem ws", BrandId = brandA }; // WorkspaceId = Guid.Empty
        ctx.Pautas.Add(p);
        ctx.SaveChanges();
        Assert.Equal(wsA, p.WorkspaceId); // carimbado automaticamente pelo interceptor
    }

    // ── Dedup de slides: índice único (ContentId, Index) ────────────────────────
    [Fact]
    public void Slide_duplicado_no_mesmo_index_e_rejeitado_pelo_indice_unico()
    {
        using var db = new TestDb();
        var ws = Guid.NewGuid();
        var brand = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using (var seed = db.NewContext())
        {
            seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
            seed.Brands.Add(new Brand { Id = brand, WorkspaceId = ws, Name = "Marca" });
            seed.SaveChanges();
        }

        db.Current.WorkspaceId = ws;
        using var ctx = db.NewContext();

        var content = new Content { WorkspaceId = ws, BrandId = brand, Type = ContentType.Carousel };
        ctx.Contents.Add(content);
        ctx.ContentSlides.Add(new ContentSlide { WorkspaceId = ws, ContentId = content.Id, Index = 0, Copy = "A" });
        ctx.SaveChanges();

        using var ctx2 = db.NewContext();
        ctx2.ContentSlides.Add(new ContentSlide { WorkspaceId = ws, ContentId = content.Id, Index = 0, Copy = "B" });
        // Mesmo (ContentId, Index) → o índice único (S-13) recusa o 2º insert.
        Assert.ThrowsAny<DbUpdateException>(() => ctx2.SaveChanges());
    }

    // ── Gate de aprovação: precedência conteúdo > campanha > workspace ───────────
    [Fact]
    public void ResolveMode_segue_precedencia_conteudo_campanha_workspace()
    {
        var ws = new Workspace { DefaultApprovalMode = ApprovalMode.Manual };
        var campaign = new Campaign { ApprovalMode = ApprovalMode.Automatic };

        // Conteúdo herda da campanha (override nulo) → Automatic.
        var herdaCampanha = new Content();
        Assert.Equal(ApprovalMode.Automatic, ApprovalController.ResolveMode(herdaCampanha, campaign, ws));

        // Override no conteúdo vence a campanha → Manual.
        var overrideConteudo = new Content { ApprovalModeOverride = ApprovalMode.Manual };
        Assert.Equal(ApprovalMode.Manual, ApprovalController.ResolveMode(overrideConteudo, campaign, ws));

        // Sem campanha nem override → cai no workspace (Manual).
        var soWorkspace = new Content();
        Assert.Equal(ApprovalMode.Manual, ApprovalController.ResolveMode(soWorkspace, null, ws));
    }

    // ── Sincronia de enums .NET ↔ TS (status crus no front) ─────────────────────
    [Fact]
    public void ContentStatus_mantem_os_valores_inteiros_que_o_front_assume()
    {
        // O front usa inteiros crus (lib/content.ts CONTENT_STATUS_LABEL). Se alguém
        // reordenar o enum, o front passa a rotular errado — este teste trava isso.
        Assert.Equal(0, (int)ContentStatus.Draft);
        Assert.Equal(1, (int)ContentStatus.Generating);
        Assert.Equal(2, (int)ContentStatus.PendingApproval);
        Assert.Equal(3, (int)ContentStatus.Approved);
        Assert.Equal(4, (int)ContentStatus.Rejected);
        Assert.Equal(5, (int)ContentStatus.Scheduled);
        Assert.Equal(6, (int)ContentStatus.Published);
        Assert.Equal(7, (int)ContentStatus.EphemeralPublished);
        Assert.Equal(8, (int)ContentStatus.Failed);
    }

    [Fact]
    public void ContentType_mantem_os_valores_inteiros_do_front()
    {
        Assert.Equal(0, (int)ContentType.Post);
        Assert.Equal(1, (int)ContentType.Carousel);
        Assert.Equal(2, (int)ContentType.Story);
    }
}
