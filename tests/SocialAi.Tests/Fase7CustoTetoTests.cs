using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using SocialAi.Api.Domain;
using SocialAi.Api.Generation;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// FASE 7 Bloco B (ADR-0009): custo por formato (B2 fail-safe), teto/saldo, e o DEDUPE de gasto
/// (B4 — índice único filtrado (ContentId,Reason) é a rede final; poll + reconciliador convergem).
/// Testes do GenerationCostService (puro) + GenerationCompletionService (transição/idempotência).
/// </summary>
public class Fase7CustoTetoTests
{
    // ── B2: custo por formato, fail-safe não-zero ───────────────────────────────
    [Fact]
    public void UnitCost_usa_config_quando_presente()
    {
        var cfg = TestGeneration.Config(new Dictionary<string, string?>
        {
            ["Generation:UnitCostUsd:Carousel"] = "0.40",
        });
        var costs = TestGeneration.Costs(cfg);
        Assert.Equal(0.40m, costs.UnitCostUsd(ContentType.Carousel));
    }

    [Fact]
    public void UnitCost_fail_safe_nao_zero_quando_config_ausente_ou_invalida()
    {
        // Sem config → default versionado não-zero (B2: custo zero furaria o teto de B3).
        var costs = TestGeneration.Costs();
        Assert.True(costs.UnitCostUsd(ContentType.Post) > 0m);
        Assert.True(costs.UnitCostUsd(ContentType.Carousel) > 0m);
        Assert.True(costs.UnitCostUsd(ContentType.Story) > 0m);

        // Config <= 0 → fail-safe (não aceita zero).
        var cfgZero = TestGeneration.Config(new Dictionary<string, string?> { ["Generation:UnitCostUsd:Post"] = "0" });
        Assert.True(TestGeneration.Costs(cfgZero).UnitCostUsd(ContentType.Post) > 0m);
    }

    [Fact]
    public void ClampCount_respeita_MaxVariations()
    {
        var cfg = TestGeneration.Config(new Dictionary<string, string?> { ["Generation:MaxVariations"] = "3" });
        var costs = TestGeneration.Costs(cfg);
        Assert.Equal(3, costs.ClampCount(10)); // acima do teto → teto
        Assert.Equal(1, costs.ClampCount(0));  // abaixo de 1 → 1
        Assert.Equal(2, costs.ClampCount(2));  // dentro → mantém
    }

    [Fact]
    public void ReasonFor_e_generate_formato_minusculo()
    {
        Assert.Equal("generate:carousel", GenerationCostService.ReasonFor(ContentType.Carousel));
        Assert.Equal("generate:post", GenerationCostService.ReasonFor(ContentType.Post));
    }

    // ── B4: dedupe de gasto — o índice único barra a 2ª inserção (poll + reconciliador) ──
    [Fact]
    public async Task Gasto_de_geracao_e_unico_por_content_e_reason()
    {
        using var db = new TestDb();
        var (ws, brand, contentId) = SeedContent(db);
        db.Current.WorkspaceId = ws;

        var completion = TestGeneration.Completion();

        // 1ª gravação (ex.: pelo poll).
        using (var ctx = db.NewContext())
        {
            var c = await ctx.Contents.FirstAsync(x => x.Id == contentId);
            await completion.RegistrarGastoAsync(ctx, c);
            await ctx.SaveChangesAsync();
        }
        // 2ª gravação (ex.: pelo reconciliador) — idempotente, NÃO duplica.
        using (var ctx = db.NewContext())
        {
            var c = await ctx.Contents.FirstAsync(x => x.Id == contentId);
            await completion.RegistrarGastoAsync(ctx, c);
            await ctx.SaveChangesAsync();
        }

        db.Current.WorkspaceId = ws;
        using (var ctx = db.NewContext())
        {
            var entries = await ctx.SpendEntries.Where(s => s.ContentId == contentId).ToListAsync();
            Assert.Single(entries); // B4: exatamente 1, não 2
            Assert.Equal("generate:post", entries[0].Reason);
            Assert.Equal(brand, entries[0].BrandId);
        }
    }

    // ── B4: a transição Generating→Draft é atômica — só um caminho vence ─────────
    [Fact]
    public async Task TryComplete_transiciona_uma_vez_e_grava_gasto()
    {
        using var db = new TestDb();
        var (ws, brand, contentId) = SeedContent(db, ContentStatus.Generating);
        db.Current.WorkspaceId = ws;

        var completion = TestGeneration.Completion();
        var outcome = new GenerationOutcome("legenda", "cta", new[] { "x" }, 80,
            new[] { new OutcomeSlide(0, "copy 0", null, null) });

        bool venceu1, venceu2;
        using (var ctx = db.NewContext())
        {
            var c = await ctx.Contents.Include(x => x.Slides).FirstAsync(x => x.Id == contentId);
            venceu1 = await completion.TryCompleteAsync(ctx, c, outcome);
            await ctx.SaveChangesAsync();
        }
        // 2ª tentativa (outro caminho) — o Content já não está Generating → não vence.
        using (var ctx = db.NewContext())
        {
            var c = await ctx.Contents.Include(x => x.Slides).FirstAsync(x => x.Id == contentId);
            venceu2 = await completion.TryCompleteAsync(ctx, c, outcome);
            await ctx.SaveChangesAsync();
        }

        Assert.True(venceu1);
        Assert.False(venceu2); // idempotente: a 2ª não re-processa
        using (var ctx = db.NewContext())
        {
            var c = await ctx.Contents.Include(x => x.Slides).FirstAsync(x => x.Id == contentId);
            Assert.Equal(ContentStatus.Draft, c.Status);
            Assert.Equal("legenda", c.Caption);
            Assert.Single(c.Slides);
            var entries = await ctx.SpendEntries.Where(s => s.ContentId == contentId).ToListAsync();
            Assert.Single(entries); // 1 só gasto, mesmo com 2 tentativas
        }
    }

    // helpers
    private static (Guid ws, Guid brand, Guid contentId) SeedContent(TestDb db, ContentStatus status = ContentStatus.Draft)
    {
        var ws = Guid.NewGuid();
        var brand = Guid.NewGuid();
        var contentId = Guid.NewGuid();
        db.Current.WorkspaceId = null;
        using var seed = db.NewContext();
        seed.Workspaces.Add(new Workspace { Id = ws, Name = "WS" });
        seed.Brands.Add(new Brand { Id = brand, WorkspaceId = ws, Name = "Marca" });
        seed.Contents.Add(new Content { Id = contentId, WorkspaceId = ws, BrandId = brand, Type = ContentType.Post, Status = status });
        seed.SaveChanges();
        return (ws, brand, contentId);
    }
}
