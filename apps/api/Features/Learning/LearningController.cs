using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Learning;

/// <summary>
/// C3/A4: Expõe sinais de aprendizado à UI.
///  - GET /api/learning/insights — agrega PerformanceMetrics por WORKSPACE (cross-brand);
///  - GET /api/learning/reject-feedback?pautaId= — último motivo de rejeição, escopado por MARCA.
/// O regime de isolamento difere por endpoint: insights é workspace-wide; reject-feedback usa
/// BrandResolver (A4 é um sinal da marca, não do workspace) — daí a injeção explícita.
/// </summary>
[ApiController]
[Authorize]
[Route("api/learning")]
public class LearningController(
    ICurrentWorkspace current, PerformanceAnalyzer analyzer,
    BrandResolver brands, RejectFeedbackService rejectFeedback)
    : ControllerBase
{
    private Guid Ws => current.WorkspaceId!.Value;

    /// <summary>
    /// C3: Retorna insights estruturados de engajamento (melhor formato, melhor janela,
    /// tamanho da amostra). Retorna InsufficientData=true quando há menos de 3 métricas.
    /// </summary>
    [HttpGet("insights")]
    public async Task<IActionResult> Insights(CancellationToken ct)
        => Ok(await analyzer.BuildInsightsAsync(Ws, ct));

    /// <summary>
    /// SoT "Desempenho" (Fatia 3): tabela densa de posts — métricas por publicação
    /// (reach/engajamento/likes/saves/qualidade/janela), workspace-scoped, com Source rotulado
    /// (mock vs real). Lista bruta ordenada por engajamento; a UI monta a tabela + small-multiples
    /// e o medidor de amostra honesto (&lt;3 = sem padrão). Read-only.
    /// </summary>
    [HttpGet("posts")]
    public async Task<IActionResult> Posts(CancellationToken ct)
        => Ok(await analyzer.BuildPostMetricsAsync(Ws, ct));

    public record RejectFeedbackDto(Guid PautaId, string? Comments);

    /// <summary>
    /// A4 (ADR-0009): último motivo de rejeição da pauta para a MARCA atual (X-Brand-Id).
    /// Serve a UI ("a versão anterior foi rejeitada porque: …") com a mesma regra que o
    /// briefing da regeneração já consome (RejectFeedbackService = dono único). Comments=null
    /// quando não houve rejeição com comentário. Sempre brand-scoped: pauta/feedback de outra
    /// marca nunca vaza (o filtro brandId não acha → Comments=null, sem 404 porque a pauta pode
    /// nem existir para a marca atual e o contrato é "qual o último feedback?", não "leia a pauta X").
    /// </summary>
    [HttpGet("reject-feedback")]
    public async Task<ActionResult<RejectFeedbackDto>> RejectFeedback([FromQuery] Guid pautaId, CancellationToken ct)
    {
        var brandId = await brands.ResolveAsync(ct);
        var comments = await rejectFeedback.UltimoMotivoAsync(pautaId, brandId, ct);
        return Ok(new RejectFeedbackDto(pautaId, comments));
    }
}
