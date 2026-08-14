using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.JsonWebTokens;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Approval;
using SocialAi.Api.Features.Audit;
using SocialAi.Api.Features.Auth;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Features.History;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// FASE 8 — aceites de ACESSO (B1/B2), HISTÓRICO (C1) e AUDITORIA (C2).
///
/// O que estes testes provam (e por que importam):
///  - B1: convite emite token+link e o aceite cria o User com o PAPEL do convite, consumindo o
///        convite (anti-replay: token reusado falha). Sem isto, qualquer link viraria conta livre.
///  - B2: o último Admin não pode ser removido (409) — senão o workspace ficaria sem dono; e a
///        listagem de usuários é isolada por workspace (não vaza usuário de outro tenant).
///  - C1: histórico de publicações/gerações escopa por MARCA (X-Brand-Id), não só por workspace —
///        a marca B nunca vê o que é da marca A no mesmo workspace.
///  - C2: a trilha de auditoria é isolada entre workspaces e aprovar conteúdo grava 1 AuditEntry
///        com o autor (claim sub) — registro append-only de ação sensível.
///
/// Padrões reutilizados (verbatim dos testes existentes): TestDb + seed cross-tenant com
/// WorkspaceId=null (desliga o filtro global), BrandResolver(ctx, FakeCurrentBrand), AuditService(ctx).
/// GOTCHA 4: nada de ordenar/agregar DateTimeOffset no SQL sob o filtro — os controllers materializam.
/// </summary>
public class Fase8AcessoHistoricoTests
{
    // ── Helpers ───────────────────────────────────────────────────────────────────

    /// <summary>Monta um ControllerContext com claims de um Admin (sub/email/role) — o controller
    /// lê ActorId/ActorEmail destes claims. [Authorize(Roles=...)] NÃO roda em teste unitário
    /// (sem pipeline), então os gates de papel testados aqui (B2) são checagem explícita no corpo.</summary>
    private static ControllerContext AdminCtx(Guid userId, string email = "admin@x.com")
    {
        var http = new DefaultHttpContext();
        http.User = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new Claim(JwtRegisteredClaimNames.Email, email),
            new Claim(ClaimTypes.Role, "Admin"),
        }, "test"));
        return new ControllerContext { HttpContext = http };
    }

    private static BrandResolver Resolver(AppDbContext ctx, Guid brand) =>
        new(ctx, new FakeCurrentBrand { BrandId = brand });

    // ─────────────────────────────────────────────────────────────────────────────
    // B1 — convite por link + aceite
    // ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Invite_admin_cria_convite_com_token_e_link()
    {
        using var db = new TestDb();
        var ws = Guid.NewGuid();
        var adminId = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using (var seed = db.NewContext())
        {
            seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
            seed.Users.Add(new User { Id = adminId, WorkspaceId = ws, Email = "admin@x.com", Role = UserRole.Admin });
            seed.SaveChanges();
        }

        db.Current.WorkspaceId = ws;
        using var ctx = db.NewContext();
        var ctrl = new UsersController(ctx, db.Current, TestAudit.Service(ctx), TestGeneration.Config())
        {
            ControllerContext = AdminCtx(adminId),
        };

        var res = await ctrl.Invite(new InviteRequest("Novo@X.com", UserRole.Member));
        var ok = Assert.IsType<OkObjectResult>(res.Result);
        var body = Assert.IsType<InviteResponse>(ok.Value);
        Assert.False(string.IsNullOrWhiteSpace(body.Token)); // token não-vazio
        Assert.Contains(body.Token, body.Link);              // o link carrega o token

        // No banco: exatamente 1 convite, não consumido, papel Member, e-mail NORMALIZADO.
        using var verify = db.NewContext();
        var invite = Assert.Single(verify.UserInvites.ToList());
        Assert.False(invite.Consumed);
        Assert.Equal(UserRole.Member, invite.Role);
        Assert.Equal("novo@x.com", invite.Email);
        Assert.Equal(body.Token, invite.Token);
    }

    [Fact]
    public async Task AcceptInvite_cria_user_com_papel_do_convite()
    {
        using var db = new TestDb();
        var ws = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using (var seed = db.NewContext())
        {
            seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
            seed.UserInvites.Add(new UserInvite
            {
                WorkspaceId = ws, Token = "tok-abc", Email = "novo@x.com",
                Role = UserRole.Member, ExpiresAt = DateTimeOffset.UtcNow.AddDays(1), Consumed = false,
            });
            seed.SaveChanges();
        }

        // AcceptInvite é anônimo (sem tenant ainda): o controller deriva o workspace do convite.
        db.Current.WorkspaceId = null;
        using var ctx = db.NewContext();
        var ctrl = new AuthController(ctx, new TokenService(TestGeneration.Config()), TestGeneration.Config());

        var res = await ctrl.AcceptInvite(new AcceptInviteRequest("tok-abc", "senhaForte1", "Novo"));
        Assert.IsType<OkObjectResult>(res.Result);

        // No banco (sem filtro de tenant p/ inspecionar): User criado com o papel do convite,
        // ligado ao workspace certo; e o convite ficou consumido (não reaproveitável).
        using var verify = db.NewContext();
        var user = Assert.Single(verify.Users.IgnoreQueryFilters().Where(u => u.Email == "novo@x.com").ToList());
        Assert.Equal(UserRole.Member, user.Role);
        Assert.Equal(ws, user.WorkspaceId);
        var invite = Assert.Single(verify.UserInvites.IgnoreQueryFilters().ToList());
        Assert.True(invite.Consumed);
    }

    [Fact]
    public async Task AcceptInvite_token_reusado_falha()
    {
        using var db = new TestDb();
        var ws = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using (var seed = db.NewContext())
        {
            seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
            // Convite JÁ consumido — anti-replay: aceitar de novo deve falhar (400).
            seed.UserInvites.Add(new UserInvite
            {
                WorkspaceId = ws, Token = "tok-abc", Email = "novo@x.com",
                Role = UserRole.Member, ExpiresAt = DateTimeOffset.UtcNow.AddDays(1), Consumed = true,
            });
            seed.SaveChanges();
        }

        db.Current.WorkspaceId = null;
        using var ctx = db.NewContext();
        var ctrl = new AuthController(ctx, new TokenService(TestGeneration.Config()), TestGeneration.Config());

        var res = await ctrl.AcceptInvite(new AcceptInviteRequest("tok-abc", "senhaForte1", "Novo"));
        // Problem(...) vira ObjectResult com ProblemDetails (StatusCode no ProblemDetails.Status).
        var obj = Assert.IsType<ObjectResult>(res.Result);
        var problem = Assert.IsType<ProblemDetails>(obj.Value);
        Assert.Equal(400, problem.Status);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // B2 — remoção de usuário + isolamento da listagem
    // ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Delete_ultimo_admin_bloqueado_409()
    {
        using var db = new TestDb();
        var ws = Guid.NewGuid();
        var adminId = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using (var seed = db.NewContext())
        {
            seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
            // Único Admin do workspace — removê-lo deixaria o tenant sem dono.
            seed.Users.Add(new User { Id = adminId, WorkspaceId = ws, Email = "admin@x.com", Role = UserRole.Admin });
            seed.SaveChanges();
        }

        db.Current.WorkspaceId = ws;
        using var ctx = db.NewContext();
        var ctrl = new UsersController(ctx, db.Current, TestAudit.Service(ctx), TestGeneration.Config())
        {
            ControllerContext = AdminCtx(adminId),
        };

        var res = await ctrl.Delete(adminId);
        var obj = Assert.IsType<ObjectResult>(res);
        var problem = Assert.IsType<ProblemDetails>(obj.Value);
        Assert.Equal(409, problem.Status);

        // E o admin continua no banco (a remoção foi barrada antes de tocar o estado).
        using var verify = db.NewContext();
        Assert.True(verify.Users.Any(u => u.Id == adminId));
    }

    [Fact]
    public async Task Delete_admin_com_outro_admin_sucede()
    {
        using var db = new TestDb();
        var ws = Guid.NewGuid();
        var admin1 = Guid.NewGuid();
        var admin2 = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using (var seed = db.NewContext())
        {
            seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
            seed.Users.Add(new User { Id = admin1, WorkspaceId = ws, Email = "a1@x.com", Role = UserRole.Admin });
            seed.Users.Add(new User { Id = admin2, WorkspaceId = ws, Email = "a2@x.com", Role = UserRole.Admin });
            seed.SaveChanges();
        }

        db.Current.WorkspaceId = ws;
        using var ctx = db.NewContext();
        var ctrl = new UsersController(ctx, db.Current, TestAudit.Service(ctx), TestGeneration.Config())
        {
            ControllerContext = AdminCtx(admin1),
        };

        // Há 2 Admins: remover um é seguro → NoContent, sobra 1.
        var res = await ctrl.Delete(admin2);
        Assert.IsType<NoContentResult>(res);

        using var verify = db.NewContext();
        Assert.Single(verify.Users.Where(u => u.Role == UserRole.Admin).ToList());
    }

    [Fact]
    public async Task List_so_usuarios_do_workspace()
    {
        using var db = new TestDb();
        var ws1 = Guid.NewGuid();
        var ws2 = Guid.NewGuid();
        var admin1 = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using (var seed = db.NewContext())
        {
            seed.Workspaces.Add(new Workspace { Id = ws1, Name = "WS1" });
            seed.Workspaces.Add(new Workspace { Id = ws2, Name = "WS2" });
            seed.Users.Add(new User { Id = admin1, WorkspaceId = ws1, Email = "a1@x.com", Role = UserRole.Admin });
            seed.Users.Add(new User { WorkspaceId = ws1, Email = "m1@x.com", Role = UserRole.Member });
            // Usuário de OUTRO workspace — não pode aparecer na listagem de ws1.
            seed.Users.Add(new User { WorkspaceId = ws2, Email = "intruso@x.com", Role = UserRole.Admin });
            seed.SaveChanges();
        }

        db.Current.WorkspaceId = ws1;
        using var ctx = db.NewContext();
        var ctrl = new UsersController(ctx, db.Current, TestAudit.Service(ctx), TestGeneration.Config())
        {
            ControllerContext = AdminCtx(admin1),
        };

        var res = await ctrl.List();
        var ok = Assert.IsType<OkObjectResult>(res.Result);
        var users = Assert.IsAssignableFrom<IEnumerable<UserDto>>(ok.Value);
        var emails = users.Select(u => u.Email).ToList();
        Assert.Equal(2, emails.Count);                       // só os 2 do ws1
        Assert.DoesNotContain("intruso@x.com", emails);      // o de ws2 não vaza
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // C1 — histórico isolado por marca
    // ─────────────────────────────────────────────────────────────────────────────

    /// <summary>Semeia ws com marcas A e B; conteúdo+agendamento+publicação SÓ na marca A.</summary>
    private static (Guid ws, Guid brandA, Guid brandB) SeedHistory(TestDb db)
    {
        var ws = Guid.NewGuid();
        var brandA = Guid.NewGuid();
        var brandB = Guid.NewGuid();
        var contentA = Guid.NewGuid();
        var postA = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using var seed = db.NewContext();
        seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
        seed.Brands.Add(new Brand { Id = brandA, WorkspaceId = ws, Name = "A" });
        seed.Brands.Add(new Brand { Id = brandB, WorkspaceId = ws, Name = "B" });
        seed.Contents.Add(new Content
        {
            Id = contentA, WorkspaceId = ws, BrandId = brandA,
            Type = ContentType.Post, Status = ContentStatus.Published, Caption = "pub A",
        });
        seed.ScheduledPosts.Add(new ScheduledPost
        {
            Id = postA, WorkspaceId = ws, ContentId = contentA,
            ScheduledFor = DateTimeOffset.UtcNow, Dispatched = true,
        });
        seed.PublishLogs.Add(new PublishLog
        {
            WorkspaceId = ws, ScheduledPostId = postA,
            Publisher = PublisherKind.Mock, Result = PublishResult.Success,
        });
        seed.SaveChanges();
        return (ws, brandA, brandB);
    }

    [Fact]
    public async Task Publications_isolado_por_marca()
    {
        using var db = new TestDb();
        var (ws, brandA, brandB) = SeedHistory(db);
        db.Current.WorkspaceId = ws;

        using var ctxA = db.NewContext();
        var ctrlA = new HistoryController(ctxA, db.Current, Resolver(ctxA, brandA));
        var rA = await ctrlA.Publications(1, 20);
        var okA = Assert.IsType<OkObjectResult>(rA.Result);
        var pageA = Assert.IsType<Page<PublicationHistoryDto>>(okA.Value);
        Assert.True(pageA.Total >= 1); // marca A vê a sua publicação

        using var ctxB = db.NewContext();
        var ctrlB = new HistoryController(ctxB, db.Current, Resolver(ctxB, brandB));
        var rB = await ctrlB.Publications(1, 20);
        var okB = Assert.IsType<OkObjectResult>(rB.Result);
        var pageB = Assert.IsType<Page<PublicationHistoryDto>>(okB.Value);
        Assert.Equal(0, pageB.Total); // marca B não vê nada
    }

    [Fact]
    public async Task Generations_isolado_por_marca()
    {
        using var db = new TestDb();
        var (ws, brandA, brandB) = SeedHistory(db);
        db.Current.WorkspaceId = ws;

        using var ctxA = db.NewContext();
        var ctrlA = new HistoryController(ctxA, db.Current, Resolver(ctxA, brandA));
        var rA = await ctrlA.Generations(1, 20);
        var okA = Assert.IsType<OkObjectResult>(rA.Result);
        var pageA = Assert.IsType<Page<GenerationHistoryDto>>(okA.Value);
        Assert.True(pageA.Total >= 1); // marca A vê o seu conteúdo gerado

        using var ctxB = db.NewContext();
        var ctrlB = new HistoryController(ctxB, db.Current, Resolver(ctxB, brandB));
        var rB = await ctrlB.Generations(1, 20);
        var okB = Assert.IsType<OkObjectResult>(rB.Result);
        var pageB = Assert.IsType<Page<GenerationHistoryDto>>(okB.Value);
        Assert.Equal(0, pageB.Total); // marca B não vê nada
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // C2 — auditoria isolada + gravação ao aprovar
    // ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Audit_isolado_entre_workspaces()
    {
        using var db = new TestDb();
        var ws1 = Guid.NewGuid();
        var ws2 = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using (var seed = db.NewContext())
        {
            seed.Workspaces.Add(new Workspace { Id = ws1, Name = "WS1" });
            seed.Workspaces.Add(new Workspace { Id = ws2, Name = "WS2" });
            seed.AuditEntries.Add(new AuditEntry
            {
                WorkspaceId = ws1, ActorUserId = Guid.NewGuid(), ActorEmail = "a@1.com",
                Action = "content.approve", Target = "c1", OccurredAt = DateTimeOffset.UtcNow,
            });
            seed.AuditEntries.Add(new AuditEntry
            {
                WorkspaceId = ws2, ActorUserId = Guid.NewGuid(), ActorEmail = "a@2.com",
                Action = "instagram.connect", Target = "ig2", OccurredAt = DateTimeOffset.UtcNow,
            });
            seed.SaveChanges();
        }

        db.Current.WorkspaceId = ws1;
        using var ctx = db.NewContext();
        var ctrl = new AuditController(ctx, db.Current);
        var res = await ctrl.Get(1, 20);
        var ok = Assert.IsType<OkObjectResult>(res.Result);
        var page = Assert.IsType<AuditPage>(ok.Value);
        Assert.Equal(1, page.Total);                                  // só a entrada de ws1
        Assert.All(page.Items, e => Assert.Equal("a@1.com", e.ActorEmail)); // ws2 não vaza
    }

    [Fact]
    public async Task Aprovar_conteudo_gera_auditentry()
    {
        using var db = new TestDb();
        var ws = Guid.NewGuid();
        var brandA = Guid.NewGuid();
        var contentA = Guid.NewGuid();
        var adminId = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using (var seed = db.NewContext())
        {
            seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS", DefaultApprovalMode = ApprovalMode.Manual });
            seed.Brands.Add(new Brand { Id = brandA, WorkspaceId = ws, Name = "A" });
            seed.Contents.Add(new Content
            {
                Id = contentA, WorkspaceId = ws, BrandId = brandA,
                Type = ContentType.Post, Status = ContentStatus.Draft,
            });
            seed.SaveChanges();
        }

        db.Current.WorkspaceId = ws;
        using var ctx = db.NewContext();
        var ctrl = new ApprovalController(ctx, db.Current, Resolver(ctx, brandA), TestAudit.Service(ctx))
        {
            ControllerContext = AdminCtx(adminId),
        };

        var res = await ctrl.Decide(contentA, new ApprovalDecision(true, "rev", null));
        Assert.IsType<NoContentResult>(res);

        // Exatamente 1 AuditEntry de aprovação, com o autor do claim (sub).
        using var verify = db.NewContext();
        var entries = verify.AuditEntries
            .Where(e => e.Action == "content.approve" && e.ActorUserId == adminId)
            .ToList();
        Assert.Single(entries);
    }
}
