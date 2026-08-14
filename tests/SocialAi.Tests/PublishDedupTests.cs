using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Domain;
using Xunit;

namespace SocialAi.Tests;

// F4/C2 (ADR-0014) — dedup ATÔMICO de publicação: o índice único filtrado em
// PublishLog(ScheduledPostId) WHERE Result IN (Pending,Success) garante que dois caminhos
// concorrentes NÃO consigam enfileirar o mesmo ScheduledPost duas vezes (gate §6: "UNIQUE prova
// 0 dupla-publicação em teste concorrente"). SQLite in-memory respeita o índice parcial do modelo.
public class PublishDedupTests
{
    private static (Guid ws, Guid postId) Seed(TestDb db)
    {
        var ws = Guid.NewGuid();
        db.Current.WorkspaceId = ws;
        using var ctx = db.NewContext();
        // Workspace + Brand existem (FKs obrigatórias: Brand→Workspace, Content→Brand, Restrict).
        var brandId = Guid.NewGuid();
        ctx.Workspaces.Add(new Workspace { Id = ws, Name = "WS", DefaultApprovalMode = ApprovalMode.Manual });
        ctx.Brands.Add(new Brand { Id = brandId, WorkspaceId = ws, Name = "T" });
        var content = new Content { WorkspaceId = ws, BrandId = brandId, Type = ContentType.Post, Status = ContentStatus.Scheduled };
        ctx.Contents.Add(content);
        var post = new ScheduledPost { WorkspaceId = ws, Content = content, ScheduledFor = DateTimeOffset.UtcNow };
        ctx.ScheduledPosts.Add(post);
        ctx.SaveChanges();
        return (ws, post.Id);
    }

    private static PublishLog NewLog(Guid ws, Guid postId, PublishResult result) =>
        new() { WorkspaceId = ws, ScheduledPostId = postId, Publisher = PublisherKind.Mock, Result = result };

    [Fact]
    public void DoisPublishLogsAtivos_ParaOMesmoPost_O_Segundo_Falha()
    {
        using var db = new TestDb();
        var (ws, postId) = Seed(db);

        // 1º enfileiramento (Pending) — OK.
        using (var ctx = db.NewContext())
        {
            ctx.PublishLogs.Add(NewLog(ws, postId, PublishResult.Pending));
            ctx.SaveChanges();
        }

        // 2º enfileiramento CONCORRENTE do MESMO post (Pending) — deve bater no índice único.
        using (var ctx = db.NewContext())
        {
            ctx.PublishLogs.Add(NewLog(ws, postId, PublishResult.Pending));
            Assert.Throws<DbUpdateException>(() => ctx.SaveChanges());
        }

        // Prova "0 dupla-publicação": existe EXATAMENTE 1 log ativo para o post.
        using (var ctx = db.NewContext())
        {
            var ativos = ctx.PublishLogs.Count(l => l.ScheduledPostId == postId
                && (l.Result == PublishResult.Pending || l.Result == PublishResult.Success));
            Assert.Equal(1, ativos);
        }
    }

    [Fact]
    public void Retentativa_AposErro_EhPermitida_ForaDoFiltro()
    {
        using var db = new TestDb();
        var (ws, postId) = Seed(db);

        // 1ª tentativa terminou em Error (FORA do filtro Pending/Success).
        using (var ctx = db.NewContext())
        {
            ctx.PublishLogs.Add(NewLog(ws, postId, PublishResult.Error));
            ctx.SaveChanges();
        }

        // Re-tentativa: novo log Pending p/ o mesmo post — PERMITIDO (o Error não ocupa o índice).
        using (var ctx = db.NewContext())
        {
            ctx.PublishLogs.Add(NewLog(ws, postId, PublishResult.Pending));
            ctx.SaveChanges(); // não lança
        }

        using (var ctx = db.NewContext())
        {
            Assert.Equal(1, ctx.PublishLogs.Count(l => l.ScheduledPostId == postId && l.Result == PublishResult.Error));
            Assert.Equal(1, ctx.PublishLogs.Count(l => l.ScheduledPostId == postId && l.Result == PublishResult.Pending));
        }
    }

    [Fact]
    public void Sucesso_DeUmPost_NaoBloqueia_OutroPost()
    {
        using var db = new TestDb();
        var (ws, postA) = Seed(db);
        // 2º ScheduledPost no MESMO workspace (o índice é por ScheduledPostId — posts distintos não colidem).
        Guid postB;
        using (var ctx = db.NewContext())
        {
            var brand = ctx.Brands.First().Id;
            var content = new Content { WorkspaceId = ws, BrandId = brand, Type = ContentType.Post, Status = ContentStatus.Scheduled };
            ctx.Contents.Add(content);
            var p = new ScheduledPost { WorkspaceId = ws, Content = content, ScheduledFor = DateTimeOffset.UtcNow };
            ctx.ScheduledPosts.Add(p);
            ctx.SaveChanges();
            postB = p.Id;
        }

        using (var ctx = db.NewContext())
        {
            ctx.PublishLogs.Add(NewLog(ws, postA, PublishResult.Success));
            ctx.PublishLogs.Add(NewLog(ws, postB, PublishResult.Pending));
            ctx.SaveChanges(); // posts distintos → sem colisão
            Assert.Equal(2, ctx.PublishLogs.Count(l => l.ScheduledPostId == postA || l.ScheduledPostId == postB));
        }
    }
}
