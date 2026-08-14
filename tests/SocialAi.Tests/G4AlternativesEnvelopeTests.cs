using Microsoft.AspNetCore.Mvc;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Features.Content;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// G4 (A/B barato) — as alternativas (2 headlines + 2 CTAs) que o copywriter já gera são persistidas
/// DENTRO do envelope Content.ReasoningJson (decisão do operador: sem coluna/migração nova) e
/// re-separadas no GET p/ ContentDto.Alternatives, deixando o painel de Raciocínio limpo. Estes
/// testes travam o contrato de LEITURA (SplitReasoningEnvelope via ToDto, exercitado pelo Get real).
/// </summary>
public class G4AlternativesEnvelopeTests
{
    private static (TestDb db, Guid ws, Guid brand) SeedMarca()
    {
        var db = new TestDb();
        var ws = Guid.NewGuid();
        var brand = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using var seed = db.NewContext();
        seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
        seed.Brands.Add(new Brand { Id = brand, WorkspaceId = ws, Name = "Marca" });
        seed.SaveChanges();
        return (db, ws, brand);
    }

    private static ContentController ContentCtrl(TestDb db, AppDbContext ctx, Guid brand) =>
        new(ctx, db.Current, agents: null!, analyzer: null!,
            brands: new BrandResolver(ctx, new FakeCurrentBrand { BrandId = brand }),
            protector: TestSecrets.Protector(), costs: TestGeneration.Costs(), completion: TestGeneration.Completion(),
            rejectFeedback: new SocialAi.Api.Features.Learning.RejectFeedbackService(ctx));

    private static Guid SeedContent(TestDb db, Guid ws, Guid brand, string? reasoningJson)
    {
        var id = Guid.NewGuid();
        using var ctx = db.NewContext();
        db.Current.WorkspaceId = null;
        ctx.Contents.Add(new Content
        {
            Id = id, WorkspaceId = ws, BrandId = brand, Type = ContentType.Post,
            Status = ContentStatus.Draft, Caption = "c", Cta = "cta", Hashtags = "#h",
            ReasoningJson = reasoningJson,
            Slides = { new ContentSlide { WorkspaceId = ws, Index = 0, Copy = "copy" } },
        });
        ctx.SaveChanges();
        return id;
    }

    private static async Task<ContentDto> GetDto(TestDb db, Guid brand, Guid id)
    {
        using var ctx = db.NewContext();
        var r = await ContentCtrl(db, ctx, brand).Get(id);
        var ok = Assert.IsType<OkObjectResult>(r.Result);
        return Assert.IsType<ContentDto>(ok.Value);
    }

    [Fact]
    public async Task Envelope_com_raciocinio_e_alternatives_separa_nos_dois_campos()
    {
        var (db, ws, brand) = SeedMarca();
        using (db)
        {
            // Envelope como o BuildReasoningEnvelope monta: raciocínio no topo + alternatives irmã.
            var json = """
            {"whyTemplate":"porque X","keyInsights":["a","b"],
             "alternatives":{"headlines":["Ousado","Direto"],"ctas":["Saiba mais","Comece agora"]}}
            """;
            var id = SeedContent(db, ws, brand, json);
            db.Current.WorkspaceId = ws;
            var dto = await GetDto(db, brand, id);

            // Alternatives saem no campo próprio.
            Assert.NotNull(dto.Alternatives);
            Assert.Equal(new[] { "Ousado", "Direto" }, dto.Alternatives!.Headlines);
            Assert.Equal(new[] { "Saiba mais", "Comece agora" }, dto.Alternatives!.Ctas);

            // E o painel de Raciocínio NÃO carrega a chave alternatives (separação de responsabilidades).
            Assert.NotNull(dto.Reasoning);
            Assert.False(dto.Reasoning!.Value.TryGetProperty("alternatives", out _));
            Assert.True(dto.Reasoning!.Value.TryGetProperty("whyTemplate", out _));
        }
    }

    [Fact]
    public async Task Envelope_legado_so_com_raciocinio_da_alternatives_null()
    {
        var (db, ws, brand) = SeedMarca();
        using (db)
        {
            var id = SeedContent(db, ws, brand, """{"whyTemplate":"só raciocínio"}""");
            db.Current.WorkspaceId = ws;
            var dto = await GetDto(db, brand, id);
            Assert.Null(dto.Alternatives);
            Assert.NotNull(dto.Reasoning);
        }
    }

    [Fact]
    public async Task Envelope_so_com_alternatives_da_raciocinio_null()
    {
        var (db, ws, brand) = SeedMarca();
        using (db)
        {
            // Sem campos de raciocínio (mock que só trouxe alternatives) → reasoning vira null (objeto vazio).
            var id = SeedContent(db, ws, brand, """{"alternatives":{"headlines":["X"],"ctas":[]}}""");
            db.Current.WorkspaceId = ws;
            var dto = await GetDto(db, brand, id);
            Assert.NotNull(dto.Alternatives);
            Assert.Equal(new[] { "X" }, dto.Alternatives!.Headlines);
            Assert.Empty(dto.Alternatives!.Ctas);
            Assert.Null(dto.Reasoning); // só tinha a chave irmã → objeto fica vazio → omite o painel
        }
    }

    [Fact]
    public async Task Alternatives_todas_vazias_nao_expoe_a_faixa()
    {
        var (db, ws, brand) = SeedMarca();
        using (db)
        {
            var id = SeedContent(db, ws, brand, """{"alternatives":{"headlines":["  ",""],"ctas":[]}}""");
            db.Current.WorkspaceId = ws;
            var dto = await GetDto(db, brand, id);
            Assert.Null(dto.Alternatives); // filtra strings vazias → nada real → sem faixa
        }
    }

    [Fact]
    public async Task ReasoningJson_null_nao_quebra_e_omite_os_dois()
    {
        var (db, ws, brand) = SeedMarca();
        using (db)
        {
            var id = SeedContent(db, ws, brand, null);
            db.Current.WorkspaceId = ws;
            var dto = await GetDto(db, brand, id);
            Assert.Null(dto.Alternatives);
            Assert.Null(dto.Reasoning);
        }
    }

    [Fact]
    public async Task Envelope_malformado_degrada_sem_quebrar_o_get()
    {
        var (db, ws, brand) = SeedMarca();
        using (db)
        {
            var id = SeedContent(db, ws, brand, "{ isto não é json válido ");
            db.Current.WorkspaceId = ws;
            var dto = await GetDto(db, brand, id); // não lança
            Assert.Null(dto.Alternatives);
            Assert.Null(dto.Reasoning);
        }
    }

    // ── Edge case: array de alternatives com TIPO ERRADO não pode quebrar o GET ──
    // GetValue<string>() sobre número/bool/objeto lança InvalidOperationException (NÃO JsonException),
    // que escaparia do catch → GET 500. O worker grava o JSON CRU dos agents (sem tipo forte no fio),
    // então `headlines:[null,123]` é alcançável. Este teste TRAVA a leitura tolerante (TryGetValue).
    [Theory]
    [InlineData("""{"alternatives":{"headlines":["Ok",123,null,true],"ctas":[]}}""")]   // número/bool/null no meio
    [InlineData("""{"alternatives":{"headlines":[{"x":1},"Ok"],"ctas":[]}}""")]          // objeto no array
    [InlineData("""{"alternatives":{"headlines":"não é array","ctas":[]}}""")]           // headlines não-array
    public async Task Alternatives_com_tipo_errado_no_array_NAO_quebra_o_get(string envelope)
    {
        var (db, ws, brand) = SeedMarca();
        using (db)
        {
            var id = SeedContent(db, ws, brand, envelope);
            db.Current.WorkspaceId = ws;
            // O que importa: NÃO lança (antes do fix, dava InvalidOperationException → 500).
            var dto = await GetDto(db, brand, id);
            // As strings válidas que sobraram são preservadas; o lixo é ignorado.
            if (dto.Alternatives is { } a)
                Assert.All(a.Headlines, h => Assert.False(string.IsNullOrWhiteSpace(h)));
        }
    }

    // ── Round-trip COMPLETO Build → persistência → Split, testado JUNTO ──
    // Os testes acima seedavam o envelope à mão. Este prova que o que ReasoningEnvelope.Build PRODUZ é
    // exatamente o que SplitReasoningEnvelope (via GET) RECUPERA — o caminho hot write→read é reversível.
    [Fact]
    public async Task RoundTrip_Build_e_Split_sao_reversiveis()
    {
        var web = new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web);
        var reasoningJson = System.Text.Json.JsonSerializer.Serialize(new { whyTemplate = "porque Y", keyInsights = new[] { "i1" } }, web);
        var alternativesJson = System.Text.Json.JsonSerializer.Serialize(new { headlines = new[] { "H1", "H2" }, ctas = new[] { "C1" } }, web);
        // EXATAMENTE como a API/worker montam o que vai pra coluna ReasoningJson.
        var envelope = SocialAi.Api.Generation.ReasoningEnvelope.Build(reasoningJson, alternativesJson);

        var (db, ws, brand) = SeedMarca();
        using (db)
        {
            var id = SeedContent(db, ws, brand, envelope);
            db.Current.WorkspaceId = ws;
            var dto = await GetDto(db, brand, id);

            Assert.NotNull(dto.Alternatives);
            Assert.Equal(new[] { "H1", "H2" }, dto.Alternatives!.Headlines);
            Assert.Equal(new[] { "C1" }, dto.Alternatives!.Ctas);
            Assert.NotNull(dto.Reasoning);
            Assert.Equal("porque Y", dto.Reasoning!.Value.GetProperty("whyTemplate").GetString());
            Assert.False(dto.Reasoning!.Value.TryGetProperty("alternatives", out _));
        }
    }

    // ── QA: unicode/acentos/aspas/emoji sobrevivem ao round-trip (copy PT-BR real) ──
    [Fact]
    public async Task RoundTrip_preserva_unicode_acentos_e_aspas()
    {
        var web = new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web);
        var headline = "Você \"merece\" — evolução 🚀 à frente";
        var alternativesJson = System.Text.Json.JsonSerializer.Serialize(new { headlines = new[] { headline }, ctas = new string[0] }, web);
        var envelope = SocialAi.Api.Generation.ReasoningEnvelope.Build(null, alternativesJson);

        var (db, ws, brand) = SeedMarca();
        using (db)
        {
            var id = SeedContent(db, ws, brand, envelope);
            db.Current.WorkspaceId = ws;
            var dto = await GetDto(db, brand, id);
            Assert.NotNull(dto.Alternatives);
            Assert.Equal(headline, dto.Alternatives!.Headlines.Single());
        }
    }
}
