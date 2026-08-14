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
using SocialAi.Api.Features.Settings;
using SocialAi.Api.Infrastructure;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// ADR-0013 — emissão .NET do override de prompt ponta-a-ponta.
/// Prova:
///  (a) com PromptOverride(s) salvos, o brandContext.promptOverrides é emitido com as chaves;
///  (b) sem nenhum override, o campo é OMITIDO no JSON (payload byte-equivalente — o gate do
///      contrato do BriefingPreview continua intacto);
///  (c) isolamento: override do workspace A NÃO vaza para o B (3 camadas via query filter);
///  (d) controller: chave de agente inválida → 400; upsert e reset funcionam.
/// A emissão é INCONDICIONAL (a API não conhece a flag); quem decide ler é o agents.
/// Exercita via BriefingPreview (read-only, mesmo BuildAgentRequestAsync da geração real).
/// </summary>
public class PromptOverrideTests
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

    private static ContentController Controller(TestDb db, AppDbContext ctx, Guid brand)
    {
        var agents = new AgentsClient(new HttpClient(new StubHandler()) { BaseAddress = new Uri("http://agents") });
        return new ContentController(
            ctx, db.Current, agents, new PerformanceAnalyzer(ctx),
            new BrandResolver(ctx, new FakeCurrentBrand { BrandId = brand }), TestSecrets.Protector(),
            TestGeneration.Costs(), TestGeneration.Completion(), new RejectFeedbackService(ctx))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
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

    private static void SeedOverride(TestDb db, Guid ws, string agentKey, string text)
    {
        db.Current.WorkspaceId = null;
        using var seed = db.NewContext();
        seed.PromptOverrides.Add(new PromptOverride { WorkspaceId = ws, AgentKey = agentKey, PromptText = text });
        seed.SaveChanges();
    }

    [Fact]
    public async Task Com_overrides_o_promptOverrides_e_emitido_com_as_chaves()
    {
        using var db = new TestDb();
        var (ws, brand, pautaId) = Seed(db);
        SeedOverride(db, ws, "copywriter", "Escreva em tom irreverente.");
        SeedOverride(db, ws, "brand-strategist", "Priorize prova social.");
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var r = await Controller(db, ctx, brand).BriefingPreview(pautaId, null, ContentType.Post);
        var ok = Assert.IsType<OkObjectResult>(r.Result);
        var req = Assert.IsType<AgentsGenerateRequest>(ok.Value);

        Assert.NotNull(req.BrandContext.PromptOverrides);
        Assert.Equal(2, req.BrandContext.PromptOverrides!.Count);
        Assert.Equal("Escreva em tom irreverente.", req.BrandContext.PromptOverrides["copywriter"]);
        Assert.Equal("Priorize prova social.", req.BrandContext.PromptOverrides["brand-strategist"]);

        // Serializa como "promptOverrides" (camelCase) no payload ao agents.
        var json = JsonSerializer.Serialize(req, Web);
        Assert.Contains("promptOverrides", json);
        Assert.Contains("copywriter", json);
    }

    [Fact]
    public async Task Sem_override_o_campo_e_omitido_no_json_byte_equivalente()
    {
        using var db = new TestDb();
        var (ws, brand, pautaId) = Seed(db);
        // NÃO semeia nenhum override.
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var r = await Controller(db, ctx, brand).BriefingPreview(pautaId, null, ContentType.Post);
        var ok = Assert.IsType<OkObjectResult>(r.Result);
        var req = Assert.IsType<AgentsGenerateRequest>(ok.Value);

        Assert.Null(req.BrandContext.PromptOverrides); // nenhum → null

        // OMITIDO no JSON (não "promptOverrides":null) — preserva a byte-equivalência do contrato.
        var json = JsonSerializer.Serialize(req, Web);
        Assert.DoesNotContain("promptOverrides", json);
    }

    [Fact]
    public async Task Override_do_workspace_A_nao_vaza_para_o_B()
    {
        using var db = new TestDb();
        var wsA = Guid.NewGuid();
        var wsB = Guid.NewGuid();
        var brandA = Guid.NewGuid();
        var brandB = Guid.NewGuid();
        var pautaB = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using (var seed = db.NewContext())
        {
            seed.Workspaces.Add(new Workspace { Id = wsA, Name = "A" });
            seed.Workspaces.Add(new Workspace { Id = wsB, Name = "B" });
            seed.Brands.Add(new Brand { Id = brandA, WorkspaceId = wsA, Name = "MA" });
            seed.Brands.Add(new Brand { Id = brandB, WorkspaceId = wsB, Name = "MB" });
            seed.Pautas.Add(new Pauta { Id = pautaB, WorkspaceId = wsB, BrandId = brandB, Title = "Da B" });
            // Override SÓ no workspace A.
            seed.PromptOverrides.Add(new PromptOverride { WorkspaceId = wsA, AgentKey = "copywriter", PromptText = "Segredo da A" });
            seed.SaveChanges();
        }

        // No contexto do workspace B, o briefing NÃO deve conter o override da A.
        db.Current.WorkspaceId = wsB;
        using var ctx = db.NewContext();
        var r = await Controller(db, ctx, brandB).BriefingPreview(pautaB, null, ContentType.Post);
        var ok = Assert.IsType<OkObjectResult>(r.Result);
        var req = Assert.IsType<AgentsGenerateRequest>(ok.Value);

        Assert.Null(req.BrandContext.PromptOverrides); // o filtro de tenant escondeu o da A
        var json = JsonSerializer.Serialize(req, Web);
        Assert.DoesNotContain("Segredo da A", json);
    }

    // ── PromptOverridesController (borda HTTP) ──────────────────────────────────
    private static PromptOverridesController SettingsController(TestDb db, AppDbContext ctx)
    {
        _ = db;
        return new PromptOverridesController(ctx)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
    }

    [Fact]
    public async Task Put_com_chave_de_agente_invalida_retorna_400()
    {
        using var db = new TestDb();
        var (ws, _, _) = Seed(db);
        db.Current.WorkspaceId = ws;

        using var ctx = db.NewContext();
        var r = await SettingsController(db, ctx).Save("nao-existe", new SavePromptOverrideRequest("texto"));
        var obj = Assert.IsType<ObjectResult>(r);
        Assert.Equal(400, obj.StatusCode);
    }

    [Fact]
    public async Task Put_vazio_retorna_400_e_chave_valida_faz_upsert()
    {
        using var db = new TestDb();
        var (ws, _, _) = Seed(db);
        db.Current.WorkspaceId = ws;

        using (var ctx = db.NewContext())
        {
            var ctrl = SettingsController(db, ctx);
            // Texto em branco → 400 (use "voltar ao padrão" para limpar).
            var bad = await ctrl.Save("copywriter", new SavePromptOverrideRequest("   "));
            Assert.Equal(400, Assert.IsType<ObjectResult>(bad).StatusCode);

            // Chave válida → upsert (cria).
            var okCreate = await ctrl.Save("copywriter", new SavePromptOverrideRequest("Tom direto."));
            Assert.IsType<OkObjectResult>(okCreate);
        }

        // Upsert (atualiza, não duplica) — o índice único garante 1 linha por (ws, agente).
        using (var ctx = db.NewContext())
        {
            var ctrl = SettingsController(db, ctx);
            await ctrl.Save("copywriter", new SavePromptOverrideRequest("Tom mais formal."));
        }
        using (var verify = db.NewContext())
        {
            db.Current.WorkspaceId = ws;
            var rows = verify.PromptOverrides.Where(p => p.AgentKey == "copywriter").ToList();
            Assert.Single(rows);
            Assert.Equal("Tom mais formal.", rows[0].PromptText);
        }
    }

    [Fact]
    public async Task Delete_reseta_ao_padrao()
    {
        using var db = new TestDb();
        var (ws, _, _) = Seed(db);
        SeedOverride(db, ws, "copywriter", "Personalizado.");
        db.Current.WorkspaceId = ws;

        using (var ctx = db.NewContext())
        {
            var r = await SettingsController(db, ctx).Delete("copywriter");
            Assert.IsType<NoContentResult>(r);
        }
        using (var verify = db.NewContext())
        {
            db.Current.WorkspaceId = ws;
            Assert.Empty(verify.PromptOverrides.Where(p => p.AgentKey == "copywriter"));
        }
    }
}
