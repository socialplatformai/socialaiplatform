using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Usage;

// C (ADR-0008): agregados do painel de uso/custo. Valores em USD, ESTIMADOS (a UI rotula).
public record UsageByBrandDto(Guid? BrandId, string? BrandName, decimal TotalUsd);
public record UsageByReasonDto(string Reason, decimal TotalUsd);
public record UsageSummaryDto(
    DateTimeOffset From, DateTimeOffset To,
    decimal TotalUsd,
    decimal MonthlyCapUsd,
    decimal SpentThisMonthUsd,
    IEnumerable<UsageByBrandDto> ByBrand,
    IEnumerable<UsageByReasonDto> ByReason);

/// <summary>
/// C (ADR-0008): painel de uso/custo do WORKSPACE. Agrega os SpendEntry por período em:
/// total USD, quebra por marca (BrandId) e por motivo (Reason). Inclui o status do cap mensal
/// (Budget.MonthlyCapUsd vs gasto do mês corrente) p/ a UI mostrar quanto resta.
///
/// Isolamento por WorkspaceId INTACTO: o global query filter (AppDbContext) já restringe os
/// SpendEntry ao workspace do JWT; aqui não há predicado cross-workspace algum. [Authorize]
/// + RequireWorkspaceFilter (global) garantem request autenticada com workspace válido.
/// Custo é ESTIMADO — nunca billing real (ver UsageCostEstimator).
/// </summary>
[ApiController]
[Authorize]
[Route("api/usage")]
public class UsageController(AppDbContext db, ICurrentWorkspace current) : ControllerBase
{
    private Guid Ws => current.WorkspaceId!.Value;

    [HttpGet]
    public async Task<ActionResult<UsageSummaryDto>> Get(
        [FromQuery] DateTimeOffset? from, [FromQuery] DateTimeOffset? to)
    {
        // Default: últimos 30 dias até agora. `to` é exclusivo no fim do dia informado se vier
        // só a data; aqui tratamos como instante (a UI manda ISO). Janela inválida (from > to)
        // → resultado vazio (não 500): consulta degrada honesta.
        var until = to ?? DateTimeOffset.UtcNow;
        var since = from ?? until.AddDays(-30);

        // O global query filter já escopa ao workspace do JWT — não repetimos o predicado de
        // WorkspaceId. Materializamos os SpendEntry do workspace UMA vez e agregamos EM MEMÓRIA
        // (mesmo padrão do PerformanceAnalyzer). Motivo: a comparação de DateTimeOffset e o
        // SUM/GROUP BY sobre decimal COMBINADOS com o filtro global de tenant não traduzem no
        // SQLite dos testes (GOTCHA conhecido). O volume de spend por workspace é pequeno (1 linha
        // por geração), então o filtro de período em memória é simples, correto e portável.
        var all = await db.SpendEntries.AsNoTracking()
            .Select(s => new { s.BrandId, s.Reason, s.AmountUsd, s.OccurredAt })
            .ToListAsync();

        var entries = all.Where(s => s.OccurredAt >= since && s.OccurredAt <= until).ToList();
        var total = entries.Sum(s => s.AmountUsd);

        // Quebra por marca: agrupa por BrandId (null = gasto sem marca, ex.: loop:idea) e junta
        // o nome da marca. Marca nula vira "Sem marca" na UI.
        var byBrandRaw = entries
            .GroupBy(s => s.BrandId)
            .Select(g => new { BrandId = g.Key, Total = g.Sum(x => x.AmountUsd) })
            .ToList();

        var brandIds = byBrandRaw.Where(x => x.BrandId != null).Select(x => x.BrandId!.Value).ToList();
        var brandNames = await db.Brands.AsNoTracking()
            .Where(b => brandIds.Contains(b.Id))
            .ToDictionaryAsync(b => b.Id, b => b.Name);

        var byBrand = byBrandRaw
            .Select(x => new UsageByBrandDto(
                x.BrandId,
                x.BrandId is { } id && brandNames.TryGetValue(id, out var name) ? name : null,
                x.Total))
            .OrderByDescending(x => x.TotalUsd)
            .ToList();

        // Quebra por motivo (Reason). Reason nulo vira "(sem motivo)" — agrupado consistente.
        var byReason = entries
            .GroupBy(s => s.Reason)
            .Select(g => new UsageByReasonDto(g.Key ?? "(sem motivo)", g.Sum(x => x.AmountUsd)))
            .OrderByDescending(x => x.TotalUsd)
            .ToList();

        // Cap mensal + gasto do mês corrente (mesma regra do AutonomousLoopJob: soma do mês).
        // Reusa `all` (já materializado e escopado ao workspace) — filtro do mês em memória.
        var budget = await db.Budgets.AsNoTracking().FirstOrDefaultAsync(b => b.WorkspaceId == Ws);
        var cap = budget?.MonthlyCapUsd ?? 0m;
        var monthStart = new DateTimeOffset(
            DateTimeOffset.UtcNow.Year, DateTimeOffset.UtcNow.Month, 1, 0, 0, 0, TimeSpan.Zero);
        var spentThisMonth = all.Where(s => s.OccurredAt >= monthStart).Sum(s => s.AmountUsd);

        return Ok(new UsageSummaryDto(since, until, total, cap, spentThisMonth, byBrand, byReason));
    }
}
