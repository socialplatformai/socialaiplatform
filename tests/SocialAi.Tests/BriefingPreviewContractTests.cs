using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Features.Content;
using SocialAi.Api.Features.Learning;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// E9.5 (ADR-0007) — contrato do preview do briefing.
/// Prova:
///  - caminho PAUTA: o preview é BYTE-EQUIVALENTE ao AgentsGenerateRequest que a geração
///    real envia ao microserviço agents (mesma pauta → Pauta.Id = pauta.Id);
///  - caminho TEMA: o preview é igual em TODOS os campos EXCETO Pauta.Id (placeholder
///    "preview", efêmero por design — sem pauta persistida);
///  - degradado: workspace sem BrandKit, sem conta IG e com <3 métricas → 200 com
///    visualIdentity/handle/learningSummary = null (degradado honesto, sem inventar dados);
///  - isolamento: pauta de OUTRA marca → 404.
/// O preview NÃO chama agents.StartAsync nem cria Content/job (read-only).
/// </summary>
public class BriefingPreviewContractTests
{
    // Mesmas opções de serialização que o AgentsClient usa para falar com o microserviço.
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    /// <summary>HttpMessageHandler que captura o corpo do POST /generate (payload da geração
    /// real) e responde 200 com um jobId — sem rede. Permite comparar byte-a-byte.</summary>
    private sealed class CapturingHandler : HttpMessageHandler
    {
        public string? CapturedBody { get; private set; }
        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken ct)
        {
            CapturedBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(ct);
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"jobId\":\"job-1\",\"status\":\"queued\"}",
                    Encoding.UTF8, "application/json"),
            };
        }
    }

    private static ContentController Controller(
        TestDb db, AppDbContext ctx, Guid brand, AgentsClient agents)
    {
        var ctrl = new ContentController(
            ctx, db.Current, agents, new PerformanceAnalyzer(ctx),
            new BrandResolver(ctx, new FakeCurrentBrand { BrandId = brand }),
            TestSecrets.Protector(), TestGeneration.Costs(), TestGeneration.Completion(),
            new RejectFeedbackService(ctx));
        // BuildAgentRequestAsync usa HttpContext.RequestAborted — precisa de um HttpContext.
        ctrl.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext(),
        };
        return ctrl;
    }

    private static AgentsClient Agents(CapturingHandler handler) =>
        new(new HttpClient(handler) { BaseAddress = new Uri("http://agents") });

    // Workspace + 1 marca + 1 pauta completa (todos os campos que entram no briefing).
    private static (Guid ws, Guid brand, Guid pautaId) SeedComplete(TestDb db)
    {
        var ws = Guid.NewGuid();
        var brand = Guid.NewGuid();
        var pautaId = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using var seed = db.NewContext();
        seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
        seed.Brands.Add(new Brand { Id = brand, WorkspaceId = ws, Name = "Marca" });
        seed.BrandKits.Add(new BrandKit
        {
            WorkspaceId = ws, BrandId = brand,
            Tone = "Direto", EditorialGuidelines = "Sem jargão", Branding = "Marca X",
            VisualPreset = "bold", PrimaryColorHex = "#FF0066",
            TargetAudience = "Jovens urbanos",
        });
        seed.Pautas.Add(new Pauta
        {
            Id = pautaId, WorkspaceId = ws, BrandId = brand,
            Title = "Rotina matinal", Objective = "Educar a audiência",
            Context = "Série de hábitos", Category = "Bem-estar",
            MarketingObjective = "consideration",
            Attachments = new List<Attachment>
            {
                new() { WorkspaceId = ws, Url = "https://cdn/ref1.png" },
            },
        });
        seed.SaveChanges();
        return (ws, brand, pautaId);
    }

    [Fact]
    public async Task Caminho_pauta_e_byte_equivalente_ao_payload_da_geracao_real()
    {
        using var db = new TestDb();
        var (ws, brand, pautaId) = SeedComplete(db);
        db.Current.WorkspaceId = ws;

        // 1) Geração real: captura o JSON exato enviado ao agents via StartAsync.
        var handler = new CapturingHandler();
        using (var ctx = db.NewContext())
        {
            var ctrl = Controller(db, ctx, brand, Agents(handler));
            var r = await ctrl.GenerateAsyncStart(
                new ContentController.GenerateAsyncRequest(pautaId, null, ContentType.Carousel));
            Assert.IsType<OkObjectResult>(r.Result);
        }
        var generationBody = handler.CapturedBody!;

        // 2) Preview: serializa o resultado com as MESMAS opções e compara byte-a-byte.
        using (var ctx = db.NewContext())
        {
            var ctrl = Controller(db, ctx, brand, Agents(new CapturingHandler()));
            var r = await ctrl.BriefingPreview(pautaId, null, ContentType.Carousel);
            var ok = Assert.IsType<OkObjectResult>(r.Result);
            var req = Assert.IsType<AgentsGenerateRequest>(ok.Value);
            var previewBody = JsonSerializer.Serialize(req, Web);
            Assert.Equal(generationBody, previewBody);
        }

        // 3) Read-only: o preview NÃO criou nenhum Content (só a geração da etapa 1 criou).
        using (var verify = db.NewContext())
        {
            db.Current.WorkspaceId = ws;
            Assert.Equal(1, verify.Contents.Count(c => c.BrandId == brand));
        }
    }

    [Fact]
    public async Task Caminho_tema_e_igual_em_tudo_exceto_pauta_id()
    {
        using var db = new TestDb();
        var (ws, brand, pautaId) = SeedComplete(db);
        db.Current.WorkspaceId = ws;

        // Geração real por TEMA: captura o payload (Pauta.Id = Guid.NewGuid() não-determinístico).
        var handler = new CapturingHandler();
        using (var ctx = db.NewContext())
        {
            var ctrl = Controller(db, ctx, brand, Agents(handler));
            var r = await ctrl.GenerateAsyncStart(
                new ContentController.GenerateAsyncRequest(null, "tema livre de teste", ContentType.Post));
            Assert.IsType<OkObjectResult>(r.Result);
        }
        var gen = JsonSerializer.Deserialize<JsonElement>(handler.CapturedBody!, Web);

        AgentsGenerateRequest previewReq;
        using (var ctx = db.NewContext())
        {
            var ctrl = Controller(db, ctx, brand, Agents(new CapturingHandler()));
            var r = await ctrl.BriefingPreview(null, "tema livre de teste", ContentType.Post);
            var ok = Assert.IsType<OkObjectResult>(r.Result);
            previewReq = Assert.IsType<AgentsGenerateRequest>(ok.Value);
        }
        var preview = JsonSerializer.Deserialize<JsonElement>(
            JsonSerializer.Serialize(previewReq, Web), Web);

        // Pauta.Id difere por design: geração usa Guid novo; preview usa "preview".
        Assert.Equal("preview", previewReq.Pauta.Id);
        Assert.NotEqual("preview", gen.GetProperty("pauta").GetProperty("id").GetString());

        // Tudo o mais é igual: brandContext idêntico, format idêntico, e os demais campos da pauta.
        Assert.Equal(gen.GetProperty("brandContext").GetRawText(),
            preview.GetProperty("brandContext").GetRawText());
        Assert.Equal(gen.GetProperty("format").GetString(),
            preview.GetProperty("format").GetString());
        var genPauta = gen.GetProperty("pauta");
        var prevPauta = preview.GetProperty("pauta");
        foreach (var prop in new[] { "title", "objective", "context", "category", "attachments", "marketingObjective" })
            Assert.Equal(genPauta.GetProperty(prop).GetRawText(), prevPauta.GetProperty(prop).GetRawText());
    }

    [Fact]
    public async Task Degradado_sem_kit_sem_ig_e_sem_metricas_retorna_200_com_nulls()
    {
        using var db = new TestDb();
        // Workspace mínimo: 1 marca, SEM BrandKit, SEM conta IG, SEM métricas.
        var ws = Guid.NewGuid();
        var brand = Guid.NewGuid();
        var pautaId = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using (var seed = db.NewContext())
        {
            seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
            seed.Brands.Add(new Brand { Id = brand, WorkspaceId = ws, Name = "Marca" });
            seed.Pautas.Add(new Pauta { Id = pautaId, WorkspaceId = ws, BrandId = brand, Title = "Ideia" });
            seed.SaveChanges();
        }
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var ctrl = Controller(db, ctx, brand, Agents(new CapturingHandler()));
        var r = await ctrl.BriefingPreview(pautaId, null, ContentType.Post);
        var ok = Assert.IsType<OkObjectResult>(r.Result);
        var req = Assert.IsType<AgentsGenerateRequest>(ok.Value);

        // Degradado honesto: nada inventado.
        Assert.Null(req.BrandContext.VisualIdentity);
        Assert.Null(req.BrandContext.Handle);
        Assert.Null(req.BrandContext.LearningSummary); // <3 métricas → null
        Assert.Equal("Ideia", req.Pauta.Title);
    }

    [Fact]
    public async Task Pauta_de_outra_marca_retorna_404()
    {
        using var db = new TestDb();
        var ws = Guid.NewGuid();
        var brandA = Guid.NewGuid();
        var brandB = Guid.NewGuid();
        var pautaA = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using (var seed = db.NewContext())
        {
            seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
            seed.Brands.Add(new Brand { Id = brandA, WorkspaceId = ws, Name = "A" });
            seed.Brands.Add(new Brand { Id = brandB, WorkspaceId = ws, Name = "B" });
            seed.Pautas.Add(new Pauta { Id = pautaA, WorkspaceId = ws, BrandId = brandA, Title = "Da A" });
            seed.SaveChanges();
        }
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        // No contexto da marca B, prever o briefing da pauta da marca A → 404 (não vaza).
        var ctrl = Controller(db, ctx, brandB, Agents(new CapturingHandler()));
        var r = await ctrl.BriefingPreview(pautaA, null, ContentType.Post);
        Assert.IsType<NotFoundObjectResult>(r.Result);
    }

    [Fact]
    public async Task Sem_pauta_nem_tema_retorna_400()
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
        var ctrl = Controller(db, ctx, brand, Agents(new CapturingHandler()));
        var r = await ctrl.BriefingPreview(null, null, ContentType.Post);
        var obj = Assert.IsType<ObjectResult>(r.Result);
        Assert.Equal(400, obj.StatusCode);
    }
}
