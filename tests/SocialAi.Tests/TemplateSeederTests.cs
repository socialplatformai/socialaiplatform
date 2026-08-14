using System.Text.Json;
using SocialAi.Api.Data.Seed;
using SocialAi.Api.Domain;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// Testes de aceite D1 (ADR-0008): seed dos 4 templates built-in por workspace, idempotente.
/// Cada teste exercita o caminho real (EnsureAsync → SaveChanges → leitura via novo contexto)
/// e assere o efeito concreto — sem teatro.
/// </summary>
public sealed class TemplateSeederTests
{
    // ─────────────────────────────────────────────────────────────────────────
    // Aceite D1 — item 1: seed cria os 4 built-in no workspace
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Seed_cria_os_4_builtin_no_workspace()
    {
        // Arrange: workspace novo (seed sistêmico com WorkspaceId = null)
        using var db = new TestDb();
        var ws = Guid.NewGuid();

        db.Current.WorkspaceId = null;
        using (var seed = db.NewContext())
        {
            seed.Workspaces.Add(new Workspace { Id = ws, Name = "Ws-1" });
            await seed.SaveChangesAsync();
        }

        // Act: EnsureAsync sem tenant logado (seed sistêmico usa IgnoreQueryFilters internamente)
        db.Current.WorkspaceId = null;
        using (var ctx = db.NewContext())
        {
            await TemplateSeeder.EnsureAsync(ctx, ws);
            await ctx.SaveChangesAsync();
        }

        // Assert: leitura via contexto tenant-scoped do workspace
        db.Current.WorkspaceId = ws;
        using (var ctx = db.NewContext())
        {
            var templates = ctx.Templates.ToList();

            // D1: exatamente 9 templates (4 originais + 5 arquétipos v2 dramaturgia-driven)
            Assert.Equal(9, templates.Count);

            // D1: todos marcados como built-in
            Assert.All(templates, t => Assert.True(t.BuiltIn));

            // D1: as keys esperadas (order-independent) — 4 originais + 5 v2
            var keys = templates.Select(t => t.Key).ToHashSet();
            Assert.Contains("announcement", keys);
            Assert.Contains("educational", keys);
            Assert.Contains("product-launch", keys);
            Assert.Contains("social-proof", keys);
            Assert.Contains("listicle", keys);
            Assert.Contains("comparison", keys);
            Assert.Contains("myth-busting", keys);
            Assert.Contains("step-by-step", keys);
            Assert.Contains("storytelling", keys);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Aceite D1 — item 2: seed é idempotente, não duplica registros
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Seed_e_idempotente_nao_duplica()
    {
        // Arrange
        using var db = new TestDb();
        var ws = Guid.NewGuid();

        db.Current.WorkspaceId = null;
        using (var seed = db.NewContext())
        {
            seed.Workspaces.Add(new Workspace { Id = ws, Name = "Ws-2" });
            await seed.SaveChangesAsync();
        }

        // Act: EnsureAsync + SaveChanges rodado DUAS vezes no mesmo workspace
        for (var rodada = 0; rodada < 2; rodada++)
        {
            db.Current.WorkspaceId = null;
            using var ctx = db.NewContext();
            await TemplateSeeder.EnsureAsync(ctx, ws);
            await ctx.SaveChangesAsync();
        }

        // Assert: ainda 9, não 18 (idempotente)
        db.Current.WorkspaceId = ws;
        using (var ctx = db.NewContext())
        {
            var count = ctx.Templates.Count();
            Assert.Equal(9, count);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Aceite D1 — item 3: SpecJson de cada template é JSON válido com "id" e "slides"
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Seed_SpecJson_nao_vazio_e_parseavel()
    {
        // Arrange
        using var db = new TestDb();
        var ws = Guid.NewGuid();

        db.Current.WorkspaceId = null;
        using (var seed = db.NewContext())
        {
            seed.Workspaces.Add(new Workspace { Id = ws, Name = "Ws-3" });
            await seed.SaveChangesAsync();
        }

        db.Current.WorkspaceId = null;
        using (var ctx = db.NewContext())
        {
            await TemplateSeeder.EnsureAsync(ctx, ws);
            await ctx.SaveChangesAsync();
        }

        // Assert: cada SpecJson é JSON válido e contém as propriedades mínimas do CarouselTemplate
        db.Current.WorkspaceId = ws;
        using (var ctx = db.NewContext())
        {
            var templates = ctx.Templates.ToList();
            Assert.Equal(9, templates.Count);

            foreach (var t in templates)
            {
                Assert.False(string.IsNullOrWhiteSpace(t.SpecJson),
                    $"SpecJson do template '{t.Key}' não deve ser vazio.");

                // JsonDocument.Parse lança JsonException se o JSON for inválido
                using var doc = JsonDocument.Parse(t.SpecJson);
                var root = doc.RootElement;

                Assert.True(root.TryGetProperty("id", out _),
                    $"SpecJson do template '{t.Key}' deve conter a propriedade 'id'.");
                Assert.True(root.TryGetProperty("slides", out _),
                    $"SpecJson do template '{t.Key}' deve conter a propriedade 'slides'.");
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Aceite D1 — item 4: LoadBuiltins retorna 4 com Key não-vazio e SpecJson contendo o id
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void LoadBuiltins_retorna_9_com_Key_e_SpecJson()
    {
        // Act: método estático puro, sem banco
        var builtins = TemplateSeeder.LoadBuiltins();

        // Assert: contagem (4 originais + 5 arquétipos v2)
        Assert.Equal(9, builtins.Count);

        foreach (var b in builtins)
        {
            // Key não-vazio
            Assert.False(string.IsNullOrWhiteSpace(b.Key),
                "Cada BuiltinTemplate deve ter Key não-vazio.");

            // SpecJson não-vazio
            Assert.False(string.IsNullOrWhiteSpace(b.SpecJson),
                $"BuiltinTemplate '{b.Key}' deve ter SpecJson não-vazio.");

            // SpecJson contém o próprio id (Key)
            using var doc = JsonDocument.Parse(b.SpecJson);
            Assert.True(doc.RootElement.TryGetProperty("id", out var idProp),
                $"SpecJson de '{b.Key}' deve conter 'id'.");
            Assert.Equal(b.Key, idProp.GetString());
        }
    }
}
