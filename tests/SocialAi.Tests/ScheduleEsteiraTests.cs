using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Features.Scheduling;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// Fase 2 (task 2.7) — esteira de agendamento: editar / lote / lookahead. Exercita o ScheduleController
/// direto (mesmo padrão de seed de Fase7OperacaoTests). Prova: lookahead ordena e limita; batch agenda
/// vários com resultado por item (um item ruim não derruba os bons); reschedule move um post não-despachado
/// e recusa data no passado.
/// </summary>
public class ScheduleEsteiraTests
{
    private static ScheduleController Ctrl(TestDb db, AppDbContext ctx, Guid brand) =>
        new(ctx, db.Current, new BrandResolver(ctx, new FakeCurrentBrand { BrandId = brand }))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

    private static (Guid ws, Guid brand) SeedWsBrand(TestDb db)
    {
        var ws = Guid.NewGuid(); var brand = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using var seed = db.NewContext();
        // Modo Automatic → agendar não exige aprovação humana (simplifica o teste da esteira).
        seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS", DefaultApprovalMode = ApprovalMode.Automatic });
        seed.Brands.Add(new Brand { Id = brand, WorkspaceId = ws, Name = "Marca" });
        seed.SaveChanges();
        return (ws, brand);
    }

    private static Guid AddContent(TestDb db, Guid ws, Guid brand, ContentStatus status = ContentStatus.Approved)
    {
        var id = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using var ctx = db.NewContext();
        ctx.Contents.Add(new Content { Id = id, WorkspaceId = ws, BrandId = brand, Type = ContentType.Post, Status = status });
        ctx.SaveChanges();
        return id;
    }

    private static Guid AddScheduled(TestDb db, Guid ws, Guid contentId, DateTimeOffset when, bool dispatched = false)
    {
        var id = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using var ctx = db.NewContext();
        ctx.ScheduledPosts.Add(new ScheduledPost { Id = id, WorkspaceId = ws, ContentId = contentId, ScheduledFor = when, Dispatched = dispatched });
        ctx.SaveChanges();
        return id;
    }

    [Fact]
    public async Task Lookahead_retorna_proximos_ordenados_e_limitados()
    {
        var db = new TestDb();
        var (ws, brand) = SeedWsBrand(db);
        var now = DateTimeOffset.UtcNow;
        // 3 futuros (fora de ordem) + 1 passado + 1 despachado (devem ser excluídos).
        var c1 = AddContent(db, ws, brand); AddScheduled(db, ws, c1, now.AddHours(5));
        var c2 = AddContent(db, ws, brand); AddScheduled(db, ws, c2, now.AddHours(1));
        var c3 = AddContent(db, ws, brand); AddScheduled(db, ws, c3, now.AddHours(3));
        var c4 = AddContent(db, ws, brand); AddScheduled(db, ws, c4, now.AddHours(-2)); // passado
        var c5 = AddContent(db, ws, brand); AddScheduled(db, ws, c5, now.AddHours(2), dispatched: true); // despachado

        db.Current.WorkspaceId = ws;
        using var ctx = db.NewContext();
        var res = await Ctrl(db, ctx, brand).Lookahead(count: 2);

        var list = Assert.IsAssignableFrom<IEnumerable<ScheduledPostDto>>(((OkObjectResult)res.Result!).Value!).ToList();
        Assert.Equal(2, list.Count);                       // limitado a count
        Assert.Equal(c2, list[0].ContentId);               // +1h primeiro
        Assert.Equal(c3, list[1].ContentId);               // +3h segundo (passado/despachado fora)
    }

    [Fact]
    public async Task Batch_agenda_varios_e_item_invalido_nao_derruba_os_bons()
    {
        var db = new TestDb();
        var (ws, brand) = SeedWsBrand(db);
        var now = DateTimeOffset.UtcNow;
        var ok1 = AddContent(db, ws, brand);
        var ok2 = AddContent(db, ws, brand);
        var passado = AddContent(db, ws, brand);
        var inexistente = Guid.NewGuid();

        db.Current.WorkspaceId = ws;
        using var ctx = db.NewContext();
        var req = new BatchScheduleRequest(new[]
        {
            new BatchScheduleItem(ok1, now.AddHours(1)),
            new BatchScheduleItem(ok2, now.AddHours(2)),
            new BatchScheduleItem(passado, now.AddHours(-5)),   // data no passado → falha só este
            new BatchScheduleItem(inexistente, now.AddHours(1)), // não existe → falha só este
        });
        var res = await Ctrl(db, ctx, brand).ScheduleBatch(req);
        var results = Assert.IsAssignableFrom<IEnumerable<BatchScheduleResult>>(((OkObjectResult)res.Result!).Value!).ToList();

        Assert.True(results.Single(r => r.ContentId == ok1).Scheduled);
        Assert.True(results.Single(r => r.ContentId == ok2).Scheduled);
        Assert.False(results.Single(r => r.ContentId == passado).Scheduled);
        Assert.False(results.Single(r => r.ContentId == inexistente).Scheduled);

        // Os 2 bons persistiram; os 2 ruins não.
        Assert.Equal(2, ctx.ScheduledPosts.Count());
    }

    [Fact]
    public async Task Reschedule_move_post_e_recusa_passado()
    {
        var db = new TestDb();
        var (ws, brand) = SeedWsBrand(db);
        var now = DateTimeOffset.UtcNow;
        var c = AddContent(db, ws, brand, ContentStatus.Scheduled);
        var postId = AddScheduled(db, ws, c, now.AddHours(1));

        db.Current.WorkspaceId = ws;
        using (var ctx = db.NewContext())
        {
            var ok = await Ctrl(db, ctx, brand).Reschedule(postId, new RescheduleRequest(now.AddHours(4)));
            var dto = Assert.IsType<ScheduledPostDto>(((OkObjectResult)ok.Result!).Value!);
            Assert.True(dto.ScheduledFor > now.AddHours(3)); // moveu para +4h
        }
        using (var ctx = db.NewContext())
        {
            var bad = await Ctrl(db, ctx, brand).Reschedule(postId, new RescheduleRequest(now.AddHours(-1)));
            Assert.IsType<ObjectResult>(bad.Result); // Problem(400) → ObjectResult, não Ok
        }
    }
}
