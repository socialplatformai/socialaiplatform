using Microsoft.AspNetCore.Mvc;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Usage;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// C (ADR-0008) — agregação do painel de uso. Prova:
///  - total/por-marca/por-motivo agregam corretamente no período;
///  - gasto sem marca (loop:idea, BrandId null) aparece como marca nula;
///  - ISOLAMENTO por WorkspaceId: o gasto de OUTRO workspace NUNCA entra no agregado
///    (o global query filter já escopa — o teste seta o workspace atual e confirma);
///  - cap mensal vem do Budget do workspace.
/// </summary>
public class UsageControllerTests
{
    // Semeia 2 workspaces. WS1 tem marcas A/B + 3 gastos (A, B, sem-marca). WS2 tem 1 gasto
    // que NÃO pode vazar para o agregado de WS1.
    private static (Guid ws1, Guid brandA, Guid brandB, Guid ws2) Seed(TestDb db)
    {
        var ws1 = Guid.NewGuid();
        var ws2 = Guid.NewGuid();
        var brandA = Guid.NewGuid();
        var brandB = Guid.NewGuid();
        var budget1 = Guid.NewGuid();
        var budget2 = Guid.NewGuid();

        db.Current.WorkspaceId = null; // semeia sem o filtro de tenant
        using var seed = db.NewContext();
        seed.Workspaces.Add(new Workspace { Id = ws1, Name = "WS1" });
        seed.Workspaces.Add(new Workspace { Id = ws2, Name = "WS2" });
        seed.Brands.Add(new Brand { Id = brandA, WorkspaceId = ws1, Name = "Marca A" });
        seed.Brands.Add(new Brand { Id = brandB, WorkspaceId = ws1, Name = "Marca B" });
        seed.Budgets.Add(new Budget { Id = budget1, WorkspaceId = ws1, MonthlyCapUsd = 10m });
        seed.Budgets.Add(new Budget { Id = budget2, WorkspaceId = ws2, MonthlyCapUsd = 5m });

        var now = DateTimeOffset.UtcNow;
        // WS1: marca A 2 USD (geracao:openai), marca B 3 USD (geracao:gemini), sem marca 1 USD (loop:idea).
        seed.SpendEntries.Add(new SpendEntry { WorkspaceId = ws1, BudgetId = budget1, BrandId = brandA, AmountUsd = 2m, Reason = "geracao:openai", OccurredAt = now });
        seed.SpendEntries.Add(new SpendEntry { WorkspaceId = ws1, BudgetId = budget1, BrandId = brandB, AmountUsd = 3m, Reason = "geracao:gemini", OccurredAt = now });
        seed.SpendEntries.Add(new SpendEntry { WorkspaceId = ws1, BudgetId = budget1, BrandId = null, AmountUsd = 1m, Reason = "loop:idea", OccurredAt = now });
        // WS2: 99 USD — NÃO pode aparecer no agregado de WS1.
        seed.SpendEntries.Add(new SpendEntry { WorkspaceId = ws2, BudgetId = budget2, BrandId = null, AmountUsd = 99m, Reason = "geracao:openai", OccurredAt = now });
        seed.SaveChanges();

        return (ws1, brandA, brandB, ws2);
    }

    private static UsageController Controller(AppDbContext ctx, FakeCurrentWorkspace current) =>
        new(ctx, current);

    [Fact]
    public async Task Agrega_total_por_marca_e_por_motivo_no_workspace_atual()
    {
        using var db = new TestDb();
        var (ws1, brandA, brandB, _) = Seed(db);
        db.Current.WorkspaceId = ws1;

        using var ctx = db.NewContext();
        var res = await Controller(ctx, db.Current).Get(null, null);
        var ok = Assert.IsType<OkObjectResult>(res.Result);
        var dto = Assert.IsType<UsageSummaryDto>(ok.Value);

        // Total do período = 2 + 3 + 1 = 6 (NÃO inclui os 99 de WS2).
        Assert.Equal(6m, dto.TotalUsd);

        // Por marca: A=2, B=3, sem-marca=1.
        Assert.Equal(2m, dto.ByBrand.Single(b => b.BrandId == brandA).TotalUsd);
        Assert.Equal("Marca A", dto.ByBrand.Single(b => b.BrandId == brandA).BrandName);
        Assert.Equal(3m, dto.ByBrand.Single(b => b.BrandId == brandB).TotalUsd);
        Assert.Equal(1m, dto.ByBrand.Single(b => b.BrandId == null).TotalUsd);
        Assert.Null(dto.ByBrand.Single(b => b.BrandId == null).BrandName);

        // Por motivo.
        Assert.Equal(2m, dto.ByReason.Single(r => r.Reason == "geracao:openai").TotalUsd);
        Assert.Equal(3m, dto.ByReason.Single(r => r.Reason == "geracao:gemini").TotalUsd);
        Assert.Equal(1m, dto.ByReason.Single(r => r.Reason == "loop:idea").TotalUsd);

        // Cap mensal vem do Budget de WS1.
        Assert.Equal(10m, dto.MonthlyCapUsd);
        Assert.Equal(6m, dto.SpentThisMonthUsd); // mês corrente
    }

    [Fact]
    public async Task Gasto_de_outro_workspace_nunca_vaza_no_agregado()
    {
        using var db = new TestDb();
        var (_, _, _, ws2) = Seed(db);
        db.Current.WorkspaceId = ws2;

        using var ctx = db.NewContext();
        var res = await Controller(ctx, db.Current).Get(null, null);
        var ok = Assert.IsType<OkObjectResult>(res.Result);
        var dto = Assert.IsType<UsageSummaryDto>(ok.Value);

        // WS2 só enxerga os próprios 99 — NUNCA os 6 de WS1 (isolamento por WorkspaceId).
        Assert.Equal(99m, dto.TotalUsd);
        Assert.Equal(5m, dto.MonthlyCapUsd);
        Assert.DoesNotContain(dto.ByReason, r => r.Reason == "geracao:gemini"); // motivo só de WS1
    }

    [Fact]
    public async Task Periodo_filtra_por_data_de_ocorrencia()
    {
        using var db = new TestDb();
        var (ws1, _, _, _) = Seed(db);
        db.Current.WorkspaceId = ws1;

        // Janela toda no passado (antes de qualquer gasto) → total 0, listas vazias.
        var from = DateTimeOffset.UtcNow.AddDays(-10);
        var to = DateTimeOffset.UtcNow.AddDays(-5);
        using var ctx = db.NewContext();
        var res = await Controller(ctx, db.Current).Get(from, to);
        var ok = Assert.IsType<OkObjectResult>(res.Result);
        var dto = Assert.IsType<UsageSummaryDto>(ok.Value);

        Assert.Equal(0m, dto.TotalUsd);
        Assert.Empty(dto.ByBrand);
        Assert.Empty(dto.ByReason);
    }
}
