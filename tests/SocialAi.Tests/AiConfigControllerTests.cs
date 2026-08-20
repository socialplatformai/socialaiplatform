using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Settings;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// B (ADR-0008) — chave/modelo de IA POR WORKSPACE. Ponto de MAIOR risco de segurança:
/// a apiKey NÃO pode vazar em GET, log ou erro. Estes testes provam:
///  - B1: salva cifrado em Secret{AiProviderKey} do workspace;
///  - B2: o GET devolve só metadados — NUNCA a apiKey (nem como campo, nem como valor);
///  - B3: /test cobre os 4 casos (chave inválida / provider sem teste / rede / sucesso),
///        SEMPRE HTTP 200, e o detail nunca contém a apiKey;
///  - B6: endpoints restritos a Admin (atributo [Authorize(Roles="Admin")]).
/// </summary>
public class AiConfigControllerTests
{
    private const string ChaveSecreta = "sk-NUNCA-DEVE-VAZAR-1234567890";

    /// <summary>Fake do testador — não bate rede; devolve o resultado canônico de cada caso.</summary>
    private sealed class FakeTester(AiTestResult result) : IAiKeyTester
    {
        public string? VistoApiKey { get; private set; }
        public Task<AiTestResult> TestAsync(string provider, string apiKey, string? textModel, CancellationToken ct = default)
        {
            VistoApiKey = apiKey; // prova que a chave decifrada chega ao tester (mas não ao detail)
            return Task.FromResult(result);
        }
    }

    private static AiConfigController Controller(TestDb db, IAiKeyTester tester)
    {
        var ctx = db.NewContext();
        var ctrl = new AiConfigController(ctx, TestSecrets.Protector(), tester)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
        return ctrl;
    }

    private static Guid SeedWorkspace(TestDb db)
    {
        var ws = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using var seed = db.NewContext();
        seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
        seed.SaveChanges();
        return ws;
    }

    // ── B1 + B2: salva cifrado; o GET devolve metadados e NUNCA a chave ──────────
    [Fact]
    public async Task Salva_e_le_config_sem_jamais_devolver_a_apiKey()
    {
        using var db = new TestDb();
        var ws = SeedWorkspace(db);
        db.Current.WorkspaceId = ws;

        var save = await Controller(db, new FakeTester(new AiTestResult(true, "ok")))
            .Save(new SaveAiConfigRequest("openai", "gpt-4.1", null, ChaveSecreta));
        Assert.IsType<OkObjectResult>(save);

        // B1: persistiu cifrado (não em claro) em Secret{AiProviderKey}.
        using (var verify = db.NewContext())
        {
            var secret = verify.Secrets.Single(s => s.Kind == SecretKind.AiProviderKey);
            Assert.NotEqual(ChaveSecreta, secret.EncryptedValue);
            Assert.DoesNotContain(ChaveSecreta, secret.EncryptedValue);
        }

        // B2: o GET devolve provider/modelos, configured=true — e NENHUM traço da chave.
        var get = await Controller(db, new FakeTester(new AiTestResult(true, "ok"))).Get();
        var ok = Assert.IsType<OkObjectResult>(get.Result);
        var dto = Assert.IsType<AiConfigDto>(ok.Value);
        Assert.True(dto.Configured);
        Assert.Equal("openai", dto.Provider);
        Assert.Equal("gpt-4.1", dto.TextModel);

        // O DTO não tem campo apiKey (por construção) e nenhum valor seu é a chave.
        var props = typeof(AiConfigDto).GetProperties();
        Assert.DoesNotContain(props, p => p.Name.Contains("apiKey", StringComparison.OrdinalIgnoreCase)
            || p.Name.Equals("key", StringComparison.OrdinalIgnoreCase));
        foreach (var p in props)
            Assert.NotEqual(ChaveSecreta, p.GetValue(dto) as string);
    }

    [Fact]
    public async Task Get_sem_config_retorna_configured_false()
    {
        using var db = new TestDb();
        db.Current.WorkspaceId = SeedWorkspace(db);
        var get = await Controller(db, new FakeTester(new AiTestResult(true, "ok"))).Get();
        var ok = Assert.IsType<OkObjectResult>(get.Result);
        var dto = Assert.IsType<AiConfigDto>(ok.Value);
        Assert.False(dto.Configured);
        Assert.Null(dto.Provider);
    }

    // ── B3: /test — 4 casos, sempre HTTP 200, detail nunca contém a chave ────────
    [Theory]
    [InlineData(false, "Chave da OpenAI inválida ou sem permissão (HTTP 401/403).")] // (i) chave inválida
    [InlineData(false, "Provider 'x' não tem teste de conexão disponível.")]          // (ii) sem suporte
    [InlineData(false, "Erro de rede ao contatar o provider de IA.")]                 // (iii) rede/timeout
    [InlineData(true, "Conexão com a OpenAI validada com sucesso.")]                  // (iv) sucesso
    public async Task Test_cobre_os_quatro_casos_sempre_200_e_sem_a_chave(bool ok, string detail)
    {
        using var db = new TestDb();
        db.Current.WorkspaceId = SeedWorkspace(db);

        // pré-condição: existe uma chave salva (senão o /test responde "nenhuma chave").
        await Controller(db, new FakeTester(new AiTestResult(true, "ok")))
            .Save(new SaveAiConfigRequest("openai", null, null, ChaveSecreta));

        var tester = new FakeTester(new AiTestResult(ok, detail));
        var ctrl = Controller(db, tester);
        var res = await ctrl.Test();

        // SEMPRE HTTP 200 (mesmo em falha) — o ok do corpo distingue.
        var objOk = Assert.IsType<OkObjectResult>(res.Result);
        var body = Assert.IsType<AiTestResponse>(objOk.Value);
        Assert.Equal(ok, body.Ok);
        Assert.Equal(detail, body.Detail);
        // 🔴 o detail NUNCA inclui a apiKey.
        Assert.DoesNotContain(ChaveSecreta, body.Detail);
        // a chave decifrada chegou ao tester (prova que o /test usa a chave salva)...
        Assert.Equal(ChaveSecreta, tester.VistoApiKey);
        // ...mas não vazou para o corpo da resposta.
    }

    [Fact]
    public async Task Test_sem_chave_salva_retorna_ok_false_sem_500()
    {
        using var db = new TestDb();
        db.Current.WorkspaceId = SeedWorkspace(db);
        var res = await Controller(db, new FakeTester(new AiTestResult(true, "nunca chamado"))).Test();
        var objOk = Assert.IsType<OkObjectResult>(res.Result);
        var body = Assert.IsType<AiTestResponse>(objOk.Value);
        Assert.False(body.Ok);
    }

    // ── B6: endpoints restritos a Admin (atributo no controller) ─────────────────
    [Fact]
    public void Controller_e_restrito_a_Admin()
    {
        var attr = (AuthorizeAttribute?)Attribute.GetCustomAttribute(
            typeof(AiConfigController), typeof(AuthorizeAttribute));
        Assert.NotNull(attr);
        Assert.Equal("Admin", attr!.Roles); // Member (sem o papel) → 403, como MetaAppConfigController
    }

    // ── Atualização sem reenviar a chave (UI podia editar provider/modelo) ───────
    [Fact]
    public async Task Salva_provider_modelo_sem_reenviar_chave_quando_ja_configurado()
    {
        using var db = new TestDb();
        db.Current.WorkspaceId = SeedWorkspace(db);

        await Controller(db, new FakeTester(new AiTestResult(true, "ok")))
            .Save(new SaveAiConfigRequest("gemini", "models/old-text", "models/old-image", ChaveSecreta));

        // Atualiza só os modelos — ApiKey null/vazia → reusa a chave cifrada.
        var save = await Controller(db, new FakeTester(new AiTestResult(true, "ok")))
            .Save(new SaveAiConfigRequest("gemini", "models/gemini-3.5-flash", "models/gemini-3.1-flash-image", null));
        Assert.IsType<OkObjectResult>(save);

        var get = await Controller(db, new FakeTester(new AiTestResult(true, "ok"))).Get();
        var ok = Assert.IsType<OkObjectResult>(get.Result);
        var dto = Assert.IsType<AiConfigDto>(ok.Value);
        Assert.True(dto.Configured);
        Assert.Equal("models/gemini-3.5-flash", dto.TextModel);
        Assert.Equal("models/gemini-3.1-flash-image", dto.ImageModel);

        // A chave antiga continua válida (teste de conexão ainda a enxerga).
        var tester = new FakeTester(new AiTestResult(true, "ok"));
        await Controller(db, tester).Test();
        Assert.Equal(ChaveSecreta, tester.VistoApiKey);
    }

    [Fact]
    public async Task Salva_sem_modelos_grava_defaults_explicitos_do_provedor()
    {
        using var db = new TestDb();
        db.Current.WorkspaceId = SeedWorkspace(db);

        var save = await Controller(db, new FakeTester(new AiTestResult(true, "ok")))
            .Save(new SaveAiConfigRequest("gemini", null, null, ChaveSecreta));
        Assert.IsType<OkObjectResult>(save);

        var get = await Controller(db, new FakeTester(new AiTestResult(true, "ok"))).Get();
        var ok = Assert.IsType<OkObjectResult>(get.Result);
        var dto = Assert.IsType<AiConfigDto>(ok.Value);
        Assert.Equal("models/gemini-3.5-flash", dto.TextModel);
        Assert.Equal("models/gemini-3.1-flash-image", dto.ImageModel);
    }

    [Fact]
    public async Task Get_omite_modelo_que_parece_email()
    {
        using var db = new TestDb();
        db.Current.WorkspaceId = SeedWorkspace(db);

        // Grava direto no secret um imageModel inválido (simula o bug de produção).
        await Controller(db, new FakeTester(new AiTestResult(true, "ok")))
            .Save(new SaveAiConfigRequest("gemini", "models/gemini-3.5-flash", "models/gemini-3.1-flash-image", ChaveSecreta));

        using (var ctx = db.NewContext())
        {
            var secret = ctx.Secrets.Single(s => s.Kind == SecretKind.AiProviderKey);
            var protector = TestSecrets.Protector();
            // Regrava payload com e-mail no imageModel (estado corrompido).
            var bad = System.Text.Json.JsonSerializer.Serialize(new
            {
                Provider = "gemini",
                TextModel = "models/gemini-3.5-flash",
                ImageModel = "socialaiplatform2026@gmail.com",
                ApiKey = ChaveSecreta,
            });
            secret.EncryptedValue = protector.Encrypt(bad);
            ctx.SaveChanges();
        }

        var get = await Controller(db, new FakeTester(new AiTestResult(true, "ok"))).Get();
        var ok = Assert.IsType<OkObjectResult>(get.Result);
        var dto = Assert.IsType<AiConfigDto>(ok.Value);
        Assert.Equal("models/gemini-3.5-flash", dto.TextModel);
        Assert.Null(dto.ImageModel); // e-mail sanitizado → UI pode escolher de novo
    }

    [Fact]
    public async Task Rejeita_modelo_que_parece_email()
    {
        using var db = new TestDb();
        db.Current.WorkspaceId = SeedWorkspace(db);

        var save = await Controller(db, new FakeTester(new AiTestResult(true, "ok")))
            .Save(new SaveAiConfigRequest("gemini", null, "socialaiplatform2026@gmail.com", ChaveSecreta));
        var problem = Assert.IsType<ObjectResult>(save);
        Assert.Equal(400, problem.StatusCode);
    }

    // ── Multi-provider ampliado (ADR-0008+): grok e anthropic salvam e round-trip ────
    [Theory]
    [InlineData("grok", "grok-4.3")]
    [InlineData("anthropic", "claude-opus-4-8")]
    public async Task Salva_e_le_providers_novos_grok_e_anthropic(string provider, string textModel)
    {
        using var db = new TestDb();
        db.Current.WorkspaceId = SeedWorkspace(db);

        var save = await Controller(db, new FakeTester(new AiTestResult(true, "ok")))
            .Save(new SaveAiConfigRequest(provider, textModel, null, ChaveSecreta));
        Assert.IsType<OkObjectResult>(save);

        var get = await Controller(db, new FakeTester(new AiTestResult(true, "ok"))).Get();
        var ok = Assert.IsType<OkObjectResult>(get.Result);
        var dto = Assert.IsType<AiConfigDto>(ok.Value);
        Assert.True(dto.Configured);
        Assert.Equal(provider, dto.Provider);
        Assert.Equal(textModel, dto.TextModel);
    }

    // ── Whitelist de provedor: provider desconhecido → 400 claro (não falha silenciosa) ──
    [Fact]
    public async Task Save_provider_desconhecido_retorna_400()
    {
        using var db = new TestDb();
        db.Current.WorkspaceId = SeedWorkspace(db);

        var res = await Controller(db, new FakeTester(new AiTestResult(true, "ok")))
            .Save(new SaveAiConfigRequest("provedor-inexistente", null, null, ChaveSecreta));

        // Problem(...) com 400 — ObjectResult com ProblemDetails de status 400.
        var obj = Assert.IsType<ObjectResult>(res);
        Assert.Equal(400, obj.StatusCode);
    }
}
