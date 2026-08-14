using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Learning;

// Fase 3 (task 3.1/3.2) — "o que é um bom post": pesos configuráveis por sinal (saves, alcance,
// curtidas, comentários) que definem sucesso. UMA linha por workspace (índice único). GET sempre
// devolve algo: se não há linha, os DEFAULTS do código (comportamento atual). PUT faz upsert.
public record MetricWeightsDto(int SavesWeight, int ReachWeight, int LikesWeight, int CommentsWeight);

/// <summary>
/// GET/PUT dos pesos de performance do workspace. Consumidos pelo PerformanceAnalyzer (task 3.3) e
/// pelo robô (task 3.4). [Authorize] simples — é config operacional (a UI decide a "régua"); o
/// isolamento é pelo próprio workspace do JWT via TenantSaveInterceptor + query filter.
/// </summary>
[ApiController]
[Authorize]
[Route("api/learning/weights")]
public class MetricWeightsController(AppDbContext db, ICurrentWorkspace current) : ControllerBase
{
    private Guid Ws => current.WorkspaceId!.Value;

    private static MetricWeightsDto ToDto(MetricWeightConfig c) =>
        new(c.SavesWeight, c.ReachWeight, c.LikesWeight, c.CommentsWeight);

    [HttpGet]
    public async Task<ActionResult<MetricWeightsDto>> Get(CancellationToken ct)
    {
        var cfg = await db.MetricWeightConfigs.FirstOrDefaultAsync(c => c.WorkspaceId == Ws, ct);
        // Sem config → os defaults da entidade (comportamento atual preservado — nunca 404).
        return Ok(ToDto(cfg ?? new MetricWeightConfig()));
    }

    [HttpPut]
    public async Task<ActionResult<MetricWeightsDto>> Update(MetricWeightsDto req, CancellationToken ct)
    {
        // Pesos ∈ [0,10]. Fora disso é erro do cliente (a UI é um slider 0-10).
        foreach (var (name, w) in new[] {
            ("saves", req.SavesWeight), ("reach", req.ReachWeight),
            ("likes", req.LikesWeight), ("comments", req.CommentsWeight) })
        {
            if (w is < 0 or > 10)
                return Problem($"Peso '{name}' deve estar entre 0 e 10.", statusCode: 400);
        }

        var cfg = await db.MetricWeightConfigs.FirstOrDefaultAsync(c => c.WorkspaceId == Ws, ct);
        if (cfg is null)
        {
            // Upsert: primeira gravação cria a linha (WorkspaceId carimbado pelo interceptor).
            cfg = new MetricWeightConfig { WorkspaceId = Ws };
            db.MetricWeightConfigs.Add(cfg);
        }
        cfg.SavesWeight = req.SavesWeight;
        cfg.ReachWeight = req.ReachWeight;
        cfg.LikesWeight = req.LikesWeight;
        cfg.CommentsWeight = req.CommentsWeight;
        await db.SaveChangesAsync(ct);

        return Ok(ToDto(cfg));
    }
}
