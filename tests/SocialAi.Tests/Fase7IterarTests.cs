using System.Net;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Features.Content;
using SocialAi.Api.Features.Learning;
using SocialAi.Api.Infrastructure;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// FASE 7 Bloco A (ADR-0009): iterar o output. A5 (choose promove/arquiva irmãs), A6 (sample fora
/// da lista). Os testes de A1/A3/A4 (instrução+slide+feedback no briefing) vivem no adapter (Vitest,
/// agents) e no contrato; aqui cobrimos a lógica de estado da API.
/// </summary>
public class Fase7IterarTests
{
    // Stub do agents: POST /generate → 202 jobId (não exercitamos o pipeline real aqui).
    private sealed class StubHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"jobId\":\"job-1\",\"status\":\"queued\"}", Encoding.UTF8, "application/json"),
            });
    }

    private static ContentController Ctrl(TestDb db, AppDbContext ctx, Guid brand)
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

    private static (Guid ws, Guid brand, Guid pautaId) SeedPauta(TestDb db)
    {
        var ws = Guid.NewGuid(); var brand = Guid.NewGuid(); var pautaId = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using var seed = db.NewContext();
        seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS", DefaultApprovalMode = ApprovalMode.Manual });
        seed.Brands.Add(new Brand { Id = brand, WorkspaceId = ws, Name = "Marca" });
        seed.Pautas.Add(new Pauta { Id = pautaId, WorkspaceId = ws, BrandId = brand, Title = "P" });
        seed.SaveChanges();
        return (ws, brand, pautaId);
    }

    private static Guid AddContent(TestDb db, Guid ws, Guid brand, Guid? pautaId, ContentStatus status, bool sample = false)
    {
        var id = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using var ctx = db.NewContext();
        ctx.Contents.Add(new Content { Id = id, WorkspaceId = ws, BrandId = brand, PautaId = pautaId, Type = ContentType.Post, Status = status, IsSample = sample });
        ctx.SaveChanges();
        return id;
    }

    // ── A5: escolher promove a escolhida e arquiva as irmãs decidíveis ──────────
    [Fact]
    public async Task Choose_promove_escolhida_e_arquiva_irmas()
    {
        using var db = new TestDb();
        var (ws, brand, pautaId) = SeedPauta(db);
        var escolhida = AddContent(db, ws, brand, pautaId, ContentStatus.Draft);
        var irma1 = AddContent(db, ws, brand, pautaId, ContentStatus.Draft);
        var irma2 = AddContent(db, ws, brand, pautaId, ContentStatus.PendingApproval);
        var jaPublicada = AddContent(db, ws, brand, pautaId, ContentStatus.Published);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await Ctrl(db, ctx, brand).Choose(escolhida);
        Assert.IsType<NoContentResult>(res);

        using var verify = db.NewContext();
        // Modo Manual (workspace default) → escolhida vira PendingApproval (não Approved).
        Assert.Equal(ContentStatus.PendingApproval, (await verify.Contents.FindAsync(escolhida))!.Status);
        // Irmãs decidíveis → Rejected.
        Assert.Equal(ContentStatus.Rejected, (await verify.Contents.FindAsync(irma1))!.Status);
        Assert.Equal(ContentStatus.Rejected, (await verify.Contents.FindAsync(irma2))!.Status);
        // Já publicada → NÃO regride.
        Assert.Equal(ContentStatus.Published, (await verify.Contents.FindAsync(jaPublicada))!.Status);
    }

    // ── QA race (CHOOSE-duplo): irmã JÁ no funil (Approved/Scheduled) → 409, não 2ª vencedora ──
    [Theory]
    [InlineData(ContentStatus.Approved)]
    [InlineData(ContentStatus.Scheduled)]
    public async Task Choose_com_irma_ja_no_funil_recusa_409(ContentStatus statusIrma)
    {
        using var db = new TestDb();
        var (ws, brand, pautaId) = SeedPauta(db);
        // Uma irmã já venceu a decisão corrente (ex.: escolhida numa 2ª aba) e está em aprovação/agenda.
        AddContent(db, ws, brand, pautaId, statusIrma);
        var tardia = AddContent(db, ws, brand, pautaId, ContentStatus.Draft); // o operador tenta escolher OUTRA
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await Ctrl(db, ctx, brand).Choose(tardia);
        var obj = Assert.IsType<ObjectResult>(res);
        Assert.Equal(409, obj.StatusCode);

        using var verify = db.NewContext();
        // a tardia NÃO foi promovida (segue Draft) — sem 2ª vencedora ativa.
        Assert.Equal(ContentStatus.Draft, (await verify.Contents.FindAsync(tardia))!.Status);
    }

    // Não-regressão: irmã PUBLICADA (rodada anterior, terminal) NÃO bloqueia escolher nova variação.
    [Fact]
    public async Task Choose_com_irma_publicada_anterior_NAO_bloqueia()
    {
        using var db = new TestDb();
        var (ws, brand, pautaId) = SeedPauta(db);
        AddContent(db, ws, brand, pautaId, ContentStatus.Published); // rodada anterior, encerrada
        var nova = AddContent(db, ws, brand, pautaId, ContentStatus.Draft);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var res = await Ctrl(db, ctx, brand).Choose(nova);
        Assert.IsType<NoContentResult>(res); // legítimo: escolher nova após publicação passada

        using var verify = db.NewContext();
        Assert.Equal(ContentStatus.PendingApproval, (await verify.Contents.FindAsync(nova))!.Status);
    }

    [Fact]
    public async Task Choose_idempotente_na_ja_aprovada()
    {
        using var db = new TestDb();
        var (ws, brand, pautaId) = SeedPauta(db);
        var c = AddContent(db, ws, brand, pautaId, ContentStatus.Approved);
        db.Current.WorkspaceId = ws;
        using var ctx = db.NewContext();
        var res = await Ctrl(db, ctx, brand).Choose(c);
        Assert.IsType<NoContentResult>(res); // no-op
    }

    [Fact]
    public async Task Choose_de_outra_marca_e_404()
    {
        using var db = new TestDb();
        var (ws, brand, pautaId) = SeedPauta(db);
        var outraMarca = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using (var s = db.NewContext()) { s.Brands.Add(new Brand { Id = outraMarca, WorkspaceId = ws, Name = "B" }); s.SaveChanges(); }
        var c = AddContent(db, ws, brand, pautaId, ContentStatus.Draft);
        db.Current.WorkspaceId = ws;
        using var ctx = db.NewContext();
        // No contexto da OUTRA marca, escolher o content da marca → 404 (isolamento C6).
        var res = await Ctrl(db, ctx, outraMarca).Choose(c);
        Assert.IsType<NotFoundResult>(res);
    }

    // ── A6: sample fora da listagem normal; ?pautaId= traz variações ────────────
    [Fact]
    public async Task List_exclui_sample_e_filtra_por_pauta()
    {
        using var db = new TestDb();
        var (ws, brand, pautaId) = SeedPauta(db);
        AddContent(db, ws, brand, pautaId, ContentStatus.Draft);            // normal, da pauta
        AddContent(db, ws, brand, null, ContentStatus.Draft, sample: true);  // sample → fora
        var outraPauta = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using (var s = db.NewContext()) { s.Pautas.Add(new Pauta { Id = outraPauta, WorkspaceId = ws, BrandId = brand, Title = "P2" }); s.SaveChanges(); }
        AddContent(db, ws, brand, outraPauta, ContentStatus.Draft);          // outra pauta
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        // Sem filtro: 2 (os 2 não-sample), o sample fica fora.
        var todos = await Ctrl(db, ctx, brand).List(null);
        var listaTodos = Assert.IsAssignableFrom<IEnumerable<ContentDto>>(Assert.IsType<OkObjectResult>(todos.Result).Value);
        Assert.Equal(2, listaTodos.Count());

        // Com ?pautaId=: só as variações daquela pauta (1).
        var daPauta = await Ctrl(db, ctx, brand).List(pautaId);
        var listaPauta = Assert.IsAssignableFrom<IEnumerable<ContentDto>>(Assert.IsType<OkObjectResult>(daPauta.Result).Value);
        Assert.Single(listaPauta);
    }
}
