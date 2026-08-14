using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Budgets;

// B1 (ADR-0009): saldo de budget do workspace atual. spentThisMonth soma SpendEntry do mês corrente.
public record BudgetDto(decimal MonthlyCapUsd, decimal SpentThisMonthUsd, decimal RemainingUsd, bool AutonomousLoopEnabled);

// ADR-0010/§2.4: config editável do budget — teto mensal + flag "inventar pauta sozinho" (o loop).
// Patch-friendly (nullable): um PUT que não envia um campo PRESERVA o valor atual. Admin-only no
// controller — ligar o loop autônomo é ação sensível (gasto de IA + moderação).
public record UpdateBudgetRequest(decimal? MonthlyCapUsd = null, bool? AutonomousLoopEnabled = null);

/// <summary>
/// B1 (ADR-0009): expõe o saldo de budget do workspace (cap, gasto do mês, restante, flag do loop).
/// Sem Budget configurado → cap=0 e remaining=0 (NÃO 500/valor inventado — DEC-5/L4). Isolado por
/// WorkspaceId (filtro global). Soma em memória (SQLite não agrega decimal sob o filtro de tenant).
/// </summary>
[ApiController]
[Authorize]
[Route("api/budget")]
public class BudgetController(AppDbContext db, ICurrentWorkspace current) : ControllerBase
{
    private Guid Ws => current.WorkspaceId!.Value;

    [HttpGet]
    public async Task<ActionResult<BudgetDto>> Get()
    {
        var budget = await db.Budgets.AsNoTracking().FirstOrDefaultAsync(b => b.WorkspaceId == Ws);
        var cap = budget?.MonthlyCapUsd ?? 0m;
        var loopEnabled = budget?.AutonomousLoopEnabled ?? false;

        var now = DateTimeOffset.UtcNow;
        var inicioMes = new DateTimeOffset(now.Year, now.Month, 1, 0, 0, 0, TimeSpan.Zero);
        // GOTCHA 4: SQLite não traduz comparação de DateTimeOffset (nem SUM/decimal) sob o filtro
        // global de tenant — materializa (valor + data) e filtra/soma em memória (mesmo padrão de
        // ContentController.SaldoRestanteDoMesAsync e PerformanceAnalyzer). Portável Postgres↔SQLite.
        var entries = await db.SpendEntries.AsNoTracking()
            .Select(s => new { s.AmountUsd, s.OccurredAt })
            .ToListAsync();
        var gasto = entries.Where(s => s.OccurredAt >= inicioMes).Sum(s => s.AmountUsd);
        var restante = cap - gasto;
        if (restante < 0m) restante = 0m;

        return Ok(new BudgetDto(cap, gasto, restante, loopEnabled));
    }

    /// <summary>
    /// ADR-0010/§2.4: liga/desliga "inventar pauta sozinho" (o loop) e ajusta o teto mensal. Admin-only
    /// — ação sensível (gasto de IA + moderação). Patch-friendly: só sobrescreve o que veio. Cria o
    /// Budget se ainda não existir (o operador pode configurar antes do 1º gasto). O kill-switch GLOBAL
    /// (Loop:Enabled, config de deploy) continua soberano — esta flag não o contorna.
    /// </summary>
    [HttpPut]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<BudgetDto>> Update(UpdateBudgetRequest req)
    {
        if (req.MonthlyCapUsd is < 0m)
            return Problem("Teto mensal não pode ser negativo.", statusCode: 400);

        var budget = await db.Budgets.FirstOrDefaultAsync(b => b.WorkspaceId == Ws);
        if (budget is null)
        {
            budget = new Domain.Budget { WorkspaceId = Ws, MonthlyCapUsd = 0m, AutonomousLoopEnabled = false };
            db.Budgets.Add(budget);
        }
        budget.MonthlyCapUsd = req.MonthlyCapUsd ?? budget.MonthlyCapUsd;
        budget.AutonomousLoopEnabled = req.AutonomousLoopEnabled ?? budget.AutonomousLoopEnabled;
        await db.SaveChangesAsync();

        // Recalcula o restante para devolver o estado consistente (mesma soma do GET).
        var now = DateTimeOffset.UtcNow;
        var inicioMes = new DateTimeOffset(now.Year, now.Month, 1, 0, 0, 0, TimeSpan.Zero);
        var entries = await db.SpendEntries.AsNoTracking()
            .Select(s => new { s.AmountUsd, s.OccurredAt }).ToListAsync();
        var gasto = entries.Where(s => s.OccurredAt >= inicioMes).Sum(s => s.AmountUsd);
        var restante = budget.MonthlyCapUsd - gasto;
        if (restante < 0m) restante = 0m;

        return Ok(new BudgetDto(budget.MonthlyCapUsd, gasto, restante, budget.AutonomousLoopEnabled));
    }
}
