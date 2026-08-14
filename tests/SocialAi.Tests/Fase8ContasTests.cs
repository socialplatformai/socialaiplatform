using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.IdentityModel.JsonWebTokens;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Audit;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Features.Content;
using SocialAi.Api.Features.Instagram;
using SocialAi.Api.Features.Learning;
using SocialAi.Worker.Jobs;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// FASE 8 / A1-A4 (ADR-0010) — contas multi-IG por marca. Prova as invariantes OBSERVÁVEIS
/// dos endpoints que NÃO tocam a Graph (Accounts/Disconnect/SetPrimary):
///  - A1: N contas (IgUserIds distintos) coexistem e listam na mesma marca.
///  - A2: a listagem e o disconnect são escopados por marca (cross-brand → 404, não vaza).
///  - A4: o flip de principal é transacional (sempre exatamente 1 principal); cross-brand → 404.
/// O fluxo OAuth completo (callback → insert/dedupe por rede) é coberto pelo QG-3 (clique vivo),
/// fora do escopo de teste unitário — aqui semeamos o estado do banco diretamente.
/// </summary>
public class Fase8ContasTests
{
    // ── Helpers ───────────────────────────────────────────────────────────────────

    /// <summary>Semeia 1 workspace com 2 marcas (A e B), cross-tenant desligado.</summary>
    private static (Guid ws, Guid brandA, Guid brandB) SeedWorkspace(TestDb db)
    {
        var ws = Guid.NewGuid();
        var brandA = Guid.NewGuid();
        var brandB = Guid.NewGuid();
        db.Current.WorkspaceId = null; // desliga o filtro de tenant p/ semear
        using var seed = db.NewContext();
        seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
        seed.Brands.Add(new Brand { Id = brandA, WorkspaceId = ws, Name = "A" });
        seed.Brands.Add(new Brand { Id = brandB, WorkspaceId = ws, Name = "B" });
        seed.SaveChanges();
        return (ws, brandA, brandB);
    }

    /// <summary>Insere uma conta IG (filtro desligado). Token "" é aceito — não exercitamos rede.</summary>
    private static Guid SeedAccount(
        TestDb db, Guid ws, Guid brand, string igUserId,
        bool isPrimary = false, bool isConnected = true, string username = "conta")
    {
        var id = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using var s = db.NewContext();
        s.InstagramAccounts.Add(new InstagramAccount
        {
            Id = id, WorkspaceId = ws, BrandId = brand,
            IgUserId = igUserId, Username = username, EncryptedAccessToken = "",
            IsConnected = isConnected, IsPrimary = isPrimary,
        });
        s.SaveChanges();
        return id;
    }

    /// <summary>IHttpClientFactory inerte: os métodos testados (Accounts/Disconnect/SetPrimary)
    /// nunca tocam a Graph, então o client retornado jamais é usado.</summary>
    private sealed class StubHttpFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new();
    }

    /// <summary>Constrói o controller no contexto de uma marca, com claims Admin (sub/email/role)
    /// para que Disconnect/SetPrimary leiam ActorId/ActorEmail sem NRE.</summary>
    private static InstagramAuthController Ctrl(TestDb db, AppDbContext ctx, Guid brand, Guid? userId = null)
    {
        var http = new DefaultHttpContext();
        http.User = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, (userId ?? Guid.NewGuid()).ToString()),
            new Claim(JwtRegisteredClaimNames.Email, "admin@ws.com"),
            new Claim(ClaimTypes.Role, "Admin"),
        }, "test"));

        var currentBrand = new FakeCurrentBrand { BrandId = brand };
        return new InstagramAuthController(
            ctx, db.Current,
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>()).Build(),
            TestSecrets.Protector(), new StubHttpFactory(),
            new BrandResolver(ctx, currentBrand), currentBrand,
            TestAudit.Service(ctx), TestEnv.Development,
            NullLogger<InstagramAuthController>.Instance)
        {
            ControllerContext = new ControllerContext { HttpContext = http },
        };
    }

    // ── A1 ──────────────────────────────────────────────────────────────────────
    // O destravamento de A1 é "N contas por marca". Provamos a invariante observável (sem rede):
    // 2 contas com IgUserIds DISTINTOS na mesma marca coexistem e listam ambas. O fluxo OAuth
    // completo (callback insere/deduplica) é coberto por QG-3 (clique vivo).
    [Fact]
    public async Task A1_Duas_contas_distintas_na_mesma_marca_coexistem_e_listam()
    {
        using var db = new TestDb();
        var (ws, brandA, _) = SeedWorkspace(db);
        SeedAccount(db, ws, brandA, "ig-1", isPrimary: true, username: "primeira");
        SeedAccount(db, ws, brandA, "ig-2", isPrimary: false, username: "segunda");
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await Ctrl(db, ctx, brandA).Accounts();

        var ok = Assert.IsType<OkObjectResult>(res.Result);
        var list = Assert.IsAssignableFrom<IEnumerable<InstagramAccountDto>>(ok.Value).ToList();
        Assert.Equal(2, list.Count); // duas contas distintas convivem na marca
    }

    // ── A2: isolamento por marca na listagem ─────────────────────────────────────
    [Fact]
    public async Task A2_Accounts_lista_so_contas_da_marca_corrente()
    {
        using var db = new TestDb();
        var (ws, brandA, brandB) = SeedWorkspace(db);
        SeedAccount(db, ws, brandA, "ig-a1", isPrimary: true);
        SeedAccount(db, ws, brandA, "ig-a2", isPrimary: false);
        SeedAccount(db, ws, brandB, "ig-b1", isPrimary: true);
        db.Current.WorkspaceId = ws;

        using var ctxA = db.NewContext();
        var resA = await Ctrl(db, ctxA, brandA).Accounts();
        var okA = Assert.IsType<OkObjectResult>(resA.Result);
        var listA = Assert.IsAssignableFrom<IEnumerable<InstagramAccountDto>>(okA.Value).ToList();
        Assert.Equal(2, listA.Count); // marca A vê só as suas 2

        using var ctxB = db.NewContext();
        var resB = await Ctrl(db, ctxB, brandB).Accounts();
        var okB = Assert.IsType<OkObjectResult>(resB.Result);
        var listB = Assert.IsAssignableFrom<IEnumerable<InstagramAccountDto>>(okB.Value).ToList();
        Assert.Single(listB); // marca B vê só a sua 1, nunca as da A
    }

    // ── A2: disconnect escopado por marca ────────────────────────────────────────
    [Fact]
    public async Task A2_Disconnect_conta_de_outra_marca_e_404()
    {
        using var db = new TestDb();
        var (ws, brandA, brandB) = SeedWorkspace(db);
        var idA = SeedAccount(db, ws, brandA, "ig-a", isPrimary: true);
        db.Current.WorkspaceId = ws;

        // No contexto da marca B, desconectar a conta da marca A → NotFound (não vaza existência).
        using var ctxB = db.NewContext();
        var res = await Ctrl(db, ctxB, brandB).Disconnect(idA);
        Assert.IsType<NotFoundResult>(res);

        // Sanidade: a dona (marca A) desconecta com sucesso → NoContent, IsConnected=false, token "".
        using var ctxA = db.NewContext();
        var resA = await Ctrl(db, ctxA, brandA).Disconnect(idA);
        Assert.IsType<NoContentResult>(resA);

        db.Current.WorkspaceId = null; // relê tudo, sem filtro
        using var verify = db.NewContext();
        var acct = verify.InstagramAccounts.Single(a => a.Id == idA);
        Assert.False(acct.IsConnected);
        Assert.Equal("", acct.EncryptedAccessToken);
    }

    // ── A1: connect-url exige X-Brand-Id (400 sem) — não cai na marca-default ─────
    [Fact]
    public async Task A1_ConnectUrl_sem_XBrandId_retorna_400()
    {
        using var db = new TestDb();
        var (ws, _, _) = SeedWorkspace(db);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var http = new DefaultHttpContext();
        http.User = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, Guid.NewGuid().ToString()),
            new Claim(ClaimTypes.Role, "Admin"),
        }, "test"));
        // currentBrand SEM marca (header X-Brand-Id ausente) → connect-url deve recusar com 400.
        var nullBrand = new FakeNullBrand();
        var ctrl = new InstagramAuthController(
            ctx, db.Current,
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>()).Build(),
            TestSecrets.Protector(), new StubHttpFactory(),
            new BrandResolver(ctx, nullBrand), nullBrand,
            TestAudit.Service(ctx), TestEnv.Development,
            NullLogger<InstagramAuthController>.Instance)
        {
            ControllerContext = new ControllerContext { HttpContext = http },
        };

        var res = await ctrl.ConnectUrl();
        var obj = Assert.IsType<ObjectResult>(res.Result);
        var problem = Assert.IsType<ProblemDetails>(obj.Value);
        Assert.Equal(400, problem.Status);
    }

    // ── A4: desconectar a principal transfere a primazia p/ a conta conectada restante ──
    [Fact]
    public async Task A4_Disconnect_da_principal_transfere_primazia()
    {
        using var db = new TestDb();
        var (ws, brandA, _) = SeedWorkspace(db);
        var idPrincipal = SeedAccount(db, ws, brandA, "ig-p", isPrimary: true, username: "principal");
        var idOutra = SeedAccount(db, ws, brandA, "ig-o", isPrimary: false, username: "outra");
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await Ctrl(db, ctx, brandA).Disconnect(idPrincipal);
        Assert.IsType<NoContentResult>(res);

        // A principal desconectada deixa de ser principal; a outra (conectada) herda a primazia.
        db.Current.WorkspaceId = null;
        using var verify = db.NewContext();
        Assert.False(verify.InstagramAccounts.Single(a => a.Id == idPrincipal).IsPrimary);
        Assert.True(verify.InstagramAccounts.Single(a => a.Id == idOutra).IsPrimary);
    }

    // ── A4: flip transacional de principal ───────────────────────────────────────
    [Fact]
    public async Task A4_SetPrimary_faz_flip_transacional()
    {
        using var db = new TestDb();
        var (ws, brandA, _) = SeedWorkspace(db);
        var idX = SeedAccount(db, ws, brandA, "ig-x", isPrimary: true, username: "X");
        var idY = SeedAccount(db, ws, brandA, "ig-y", isPrimary: false, username: "Y");
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await Ctrl(db, ctx, brandA).SetPrimary(idY);
        Assert.IsType<NoContentResult>(res);

        // Relê do banco (sem filtro): Y virou principal, X deixou de ser → exatamente 1 principal.
        db.Current.WorkspaceId = null;
        using var verify = db.NewContext();
        var contas = verify.InstagramAccounts.Where(a => a.BrandId == brandA).ToList();
        Assert.True(contas.Single(a => a.Id == idY).IsPrimary);
        Assert.False(contas.Single(a => a.Id == idX).IsPrimary);
        Assert.Equal(1, contas.Count(a => a.IsPrimary)); // invariante ≤1 principal/marca, e =1 aqui
    }

    // ── A4: set-primary escopado por marca ───────────────────────────────────────
    [Fact]
    public async Task A4_SetPrimary_de_outra_marca_e_404()
    {
        using var db = new TestDb();
        var (ws, brandA, brandB) = SeedWorkspace(db);
        var idA = SeedAccount(db, ws, brandA, "ig-a", isPrimary: true);
        db.Current.WorkspaceId = ws;

        // No contexto da marca B, tornar principal a conta da marca A → NotFound (não vaza).
        using var ctxB = db.NewContext();
        var res = await Ctrl(db, ctxB, brandB).SetPrimary(idA);
        Assert.IsType<NotFoundResult>(res);
    }

    // ── A3: conta-alvo (override) — API e resolver do worker ─────────────────────

    /// <summary>Semeia 1 conteúdo Draft na marca dada (p/ os testes de conta-alvo).</summary>
    private static Guid SeedContent(TestDb db, Guid ws, Guid brand)
    {
        var id = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using var s = db.NewContext();
        s.Contents.Add(new Content
        {
            Id = id, WorkspaceId = ws, BrandId = brand,
            Type = ContentType.Post, Status = ContentStatus.Draft,
        });
        s.SaveChanges();
        return id;
    }

    private static ContentController ContentCtrl(TestDb db, AppDbContext ctx, Guid brand)
    {
        var agents = new AgentsClient(new HttpClient(new StubHandler()) { BaseAddress = new Uri("http://agents") });
        return new ContentController(
            ctx, db.Current, agents, new PerformanceAnalyzer(ctx),
            new BrandResolver(ctx, new FakeCurrentBrand { BrandId = brand }),
            TestSecrets.Protector(), TestGeneration.Costs(), TestGeneration.Completion(),
            new RejectFeedbackService(ctx))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
    }

    private sealed class StubHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK)
            {
                Content = new StringContent("{\"jobId\":\"job-1\",\"status\":\"queued\"}",
                    System.Text.Encoding.UTF8, "application/json"),
            });
    }

    [Fact]
    public async Task A3_SetTargetAccount_da_propria_marca_persiste()
    {
        using var db = new TestDb();
        var (ws, brandA, _) = SeedWorkspace(db);
        var contentId = SeedContent(db, ws, brandA);
        var accId = SeedAccount(db, ws, brandA, "ig-a", isPrimary: true);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await ContentCtrl(db, ctx, brandA)
            .SetTargetAccount(contentId, new ContentController.SetTargetAccountRequest(accId));
        Assert.IsType<NoContentResult>(res);

        db.Current.WorkspaceId = null;
        using var verify = db.NewContext();
        Assert.Equal(accId, verify.Contents.Single(c => c.Id == contentId).TargetInstagramAccountId);
    }

    [Fact]
    public async Task A3_SetTargetAccount_de_outra_marca_e_400()
    {
        using var db = new TestDb();
        var (ws, brandA, brandB) = SeedWorkspace(db);
        var contentId = SeedContent(db, ws, brandA);
        // Conta na marca B — não pode ser alvo de um conteúdo da marca A.
        var accB = SeedAccount(db, ws, brandB, "ig-b", isPrimary: true);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await ContentCtrl(db, ctx, brandA)
            .SetTargetAccount(contentId, new ContentController.SetTargetAccountRequest(accB));
        var obj = Assert.IsType<ObjectResult>(res);
        var problem = Assert.IsType<ProblemDetails>(obj.Value);
        Assert.Equal(400, problem.Status); // conta-alvo de outra marca rejeitada na API
    }

    [Fact]
    public async Task A3_Resolver_precedencia_override_primary_primeira()
    {
        using var db = new TestDb();
        var (ws, brandA, _) = SeedWorkspace(db);
        var primaryId = SeedAccount(db, ws, brandA, "ig-primary", isPrimary: true, username: "principal");
        var overrideId = SeedAccount(db, ws, brandA, "ig-override", isPrimary: false, username: "override");

        // 1) override explícito vence a principal.
        db.Current.WorkspaceId = null;
        using (var ctx = db.NewContext())
        {
            var content = new Content { WorkspaceId = ws, BrandId = brandA, TargetInstagramAccountId = overrideId };
            var acc = await TargetAccountResolver.ResolveAsync(ctx, content, default);
            Assert.Equal(overrideId, acc!.Id);
        }

        // 2) sem override → cai na principal (IsPrimary).
        using (var ctx = db.NewContext())
        {
            var content = new Content { WorkspaceId = ws, BrandId = brandA, TargetInstagramAccountId = null };
            var acc = await TargetAccountResolver.ResolveAsync(ctx, content, default);
            Assert.Equal(primaryId, acc!.Id);
        }
    }

    [Fact]
    public async Task A3_Resolver_override_DESCONECTADO_cai_na_conta_conectada()
    {
        // Auditoria final: override morto (conta desconectada) NÃO deve curto-circuitar a
        // precedência — senão a publicação degradaria Graph→Mock em silêncio mesmo havendo
        // outra conta viva. Simetria com o endurecimento já feito no fallback.
        using var db = new TestDb();
        var (ws, brandA, _) = SeedWorkspace(db);
        // Override aponta para uma conta DESCONECTADA; existe outra conta CONECTADA na marca.
        var deadOverrideId = SeedAccount(db, ws, brandA, "ig-dead", isPrimary: false, isConnected: false, username: "morta");
        var liveId = SeedAccount(db, ws, brandA, "ig-live", isPrimary: true, isConnected: true, username: "viva");

        db.Current.WorkspaceId = null;
        using (var ctx = db.NewContext())
        {
            var content = new Content { WorkspaceId = ws, BrandId = brandA, TargetInstagramAccountId = deadOverrideId };
            var acc = await TargetAccountResolver.ResolveAsync(ctx, content, default);
            // NÃO usa o override morto; cai na conta conectada (a principal viva).
            Assert.Equal(liveId, acc!.Id);
            Assert.True(acc.IsConnected);
        }

        // Caso de borda: se a ÚNICA conta é o override desconectado, ainda assim resolve para ela
        // (o fallback final não exige conectada) — degradar p/ Mock é correto quando não há viva.
        using var db2 = new TestDb();
        var (ws2, brandB, _) = SeedWorkspace(db2);
        var onlyDeadId = SeedAccount(db2, ws2, brandB, "ig-only-dead", isConnected: false, username: "unica-morta");
        db2.Current.WorkspaceId = null;
        using (var ctx = db2.NewContext())
        {
            var content = new Content { WorkspaceId = ws2, BrandId = brandB, TargetInstagramAccountId = onlyDeadId };
            var acc = await TargetAccountResolver.ResolveAsync(ctx, content, default);
            Assert.Equal(onlyDeadId, acc!.Id); // sem conta viva, resolve para a única existente
        }
    }
}

/// <summary>Stub de IWebHostEnvironment p/ os testes do InstagramAuthController (que só consulta
/// IsProduction()). Development → exercita o caminho dev (fallback localhost do RedirectUri).</summary>
file sealed class TestEnv : Microsoft.AspNetCore.Hosting.IWebHostEnvironment
{
    public static TestEnv Development { get; } = new() { EnvironmentName = "Development" };
    public string EnvironmentName { get; set; } = "Development";
    public string ApplicationName { get; set; } = "Tests";
    public string WebRootPath { get; set; } = "";
    public Microsoft.Extensions.FileProviders.IFileProvider WebRootFileProvider { get; set; } = new Microsoft.Extensions.FileProviders.NullFileProvider();
    public string ContentRootPath { get; set; } = "";
    public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = new Microsoft.Extensions.FileProviders.NullFileProvider();
}
