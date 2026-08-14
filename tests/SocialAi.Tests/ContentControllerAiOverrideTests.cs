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
using SocialAi.Api.Infrastructure;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// B4 (ADR-0008) — a geração injeta provider/modelo/chave do workspace no AgentsGenerateRequest.
/// Prova: (a) com Secret{AiProviderKey} salvo, o aiOverride é preenchido com provider/modelos
/// e a chave decifrada; (b) sem Secret, aiOverride é null E o campo é OMITIDO no JSON enviado
/// ao agents (preserva o payload byte-equivalente do contrato do BriefingPreview).
/// Exercita via BriefingPreview (read-only, mesmo BuildAgentRequestAsync da geração real).
/// </summary>
public class ContentControllerAiOverrideTests
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private sealed class StubHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"jobId\":\"job-1\",\"status\":\"queued\"}",
                    Encoding.UTF8, "application/json"),
            });
    }

    private static ContentController Controller(TestDb db, AppDbContext ctx, Guid brand, SecretProtector protector)
    {
        var agents = new AgentsClient(new HttpClient(new StubHandler()) { BaseAddress = new Uri("http://agents") });
        var ctrl = new ContentController(
            ctx, db.Current, agents, new PerformanceAnalyzer(ctx),
            new BrandResolver(ctx, new FakeCurrentBrand { BrandId = brand }), protector,
            TestGeneration.Costs(), TestGeneration.Completion(),
            new RejectFeedbackService(ctx))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
        return ctrl;
    }

    private static (Guid ws, Guid brand, Guid pautaId) Seed(TestDb db)
    {
        var ws = Guid.NewGuid();
        var brand = Guid.NewGuid();
        var pautaId = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using var seed = db.NewContext();
        seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
        seed.Brands.Add(new Brand { Id = brand, WorkspaceId = ws, Name = "Marca" });
        seed.Pautas.Add(new Pauta { Id = pautaId, WorkspaceId = ws, BrandId = brand, Title = "Pauta" });
        seed.SaveChanges();
        return (ws, brand, pautaId);
    }

    // Salva o Secret{AiProviderKey} com a MESMA forma do AiConfigController.Stored: o
    // ContentController desserializa com opções DEFAULT (case-sensitive, PascalCase), então
    // as chaves do JSON precisam ser PascalCase — espelhando o que o AiConfigController grava.
    private static void SeedAiSecret(TestDb db, Guid ws, SecretProtector protector,
        string provider, string? textModel, string apiKey)
    {
        var payload = JsonSerializer.Serialize(new
        {
            Provider = provider, TextModel = textModel, ImageModel = (string?)null, ApiKey = apiKey,
        });
        db.Current.WorkspaceId = null;
        using var seed = db.NewContext();
        seed.Secrets.Add(new Secret
        {
            WorkspaceId = ws, Kind = SecretKind.AiProviderKey, EncryptedValue = protector.Encrypt(payload),
        });
        seed.SaveChanges();
    }

    [Fact]
    public async Task Com_Secret_de_IA_o_aiOverride_e_injetado_com_a_chave_do_workspace()
    {
        using var db = new TestDb();
        var protector = TestSecrets.Protector();
        var (ws, brand, pautaId) = Seed(db);
        SeedAiSecret(db, ws, protector, "openai", "gpt-4.1", "sk-DO-WORKSPACE");
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var r = await Controller(db, ctx, brand, protector).BriefingPreview(pautaId, null, ContentType.Post);
        var ok = Assert.IsType<OkObjectResult>(r.Result);
        var req = Assert.IsType<AgentsGenerateRequest>(ok.Value);

        Assert.NotNull(req.AiOverride);
        Assert.Equal("openai", req.AiOverride!.Provider);
        Assert.Equal("gpt-4.1", req.AiOverride.TextModel);
        Assert.Equal("sk-DO-WORKSPACE", req.AiOverride.ApiKey);

        // O payload serializado AO AGENTS carrega o aiOverride (a chave vai no fio interno).
        var json = JsonSerializer.Serialize(req, Web);
        Assert.Contains("aiOverride", json);
    }

    [Fact]
    public async Task Sem_Secret_de_IA_o_aiOverride_e_null_e_omitido_no_json()
    {
        using var db = new TestDb();
        var protector = TestSecrets.Protector();
        var (ws, brand, pautaId) = Seed(db);
        // NÃO semeia Secret de IA.
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var r = await Controller(db, ctx, brand, protector).BriefingPreview(pautaId, null, ContentType.Post);
        var ok = Assert.IsType<OkObjectResult>(r.Result);
        var req = Assert.IsType<AgentsGenerateRequest>(ok.Value);

        Assert.Null(req.AiOverride); // sem Secret → agents cai no .env

        // OMITIDO no JSON (não "aiOverride":null) — preserva o payload byte-equivalente.
        var json = JsonSerializer.Serialize(req, Web);
        Assert.DoesNotContain("aiOverride", json);
    }
}
