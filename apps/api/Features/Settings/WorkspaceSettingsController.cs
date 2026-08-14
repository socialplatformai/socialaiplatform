using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Settings;

// A5 (ADR-0010): fuso + janela de publicação do Workspace. A janela é hora LOCAL e é só AVISO
// (soft) para a UI — não trava agendamento; por isso start/end nulos são aceitos sem validação.
// Fase 2 (task 2.1): estende com as flags de automação (o "volante") — o robô lê AutoPostEnabled +
// agenda + estratégia + threshold. Backward-compat: os campos novos têm default seguro (robô OFF).
public record WorkspaceSettingsDto(
    string TimeZoneId,
    TimeOnly? PublishWindowStart,
    TimeOnly? PublishWindowEnd,
    bool AutoPostEnabled,
    string PostingScheduleDays,
    string PostingScheduleTimes,
    CreativeStrategyMode CreativeStrategy,
    int AutoApprovalThreshold);

public record UpdateWorkspaceSettingsRequest(
    string TimeZoneId,
    TimeOnly? PublishWindowStart,
    TimeOnly? PublishWindowEnd,
    // Fase 2: opcionais (nullable) — um PUT que não os envia PRESERVA o valor atual (patch-friendly).
    bool? AutoPostEnabled = null,
    string? PostingScheduleDays = null,
    string? PostingScheduleTimes = null,
    CreativeStrategyMode? CreativeStrategy = null,
    int? AutoApprovalThreshold = null);

/// <summary>
/// A5 (ADR-0010): config de operação do Workspace — fuso (IANA) + janela de publicação (aviso).
/// Escopo é o próprio workspace do request (um deploy/um cliente), então filtra por Id == Ws.
/// [Authorize] simples: é config operacional, o aceite NÃO exige Admin.
/// </summary>
[ApiController]
[Authorize]
[Route("api/workspace/settings")]
public class WorkspaceSettingsController(AppDbContext db, ICurrentWorkspace current) : ControllerBase
{
    private Guid Ws => current.WorkspaceId!.Value;

    private static WorkspaceSettingsDto ToDto(Workspace ws) => new(
        ws.TimeZoneId, ws.PublishWindowStart, ws.PublishWindowEnd,
        ws.AutoPostEnabled, ws.PostingScheduleDays, ws.PostingScheduleTimes,
        ws.CreativeStrategy, ws.AutoApprovalThreshold);

    [HttpGet]
    public async Task<ActionResult<WorkspaceSettingsDto>> Get()
    {
        // Workspace NÃO é TenantEntity (não tem coluna WorkspaceId), logo o filtro global de tenant
        // não o cobre — o escopo é garantido aqui pelo predicado Id == Ws (o próprio workspace do JWT).
        var ws = await db.Workspaces.FirstAsync(w => w.Id == Ws);
        return Ok(ToDto(ws));
    }

    [HttpPut]
    public async Task<ActionResult<WorkspaceSettingsDto>> Update(UpdateWorkspaceSettingsRequest req)
    {
        // Fuso é a única validação dura: um ID inválido quebraria a conversão local↔UTC na borda.
        if (!TimeZoneConversion.IsValid(req.TimeZoneId))
            return Problem("Fuso horário inválido.", statusCode: 400);

        // Fase 2: threshold fora de [0,100] é erro do cliente (a nota do validador é 0-100).
        if (req.AutoApprovalThreshold is < 0 or > 100)
            return Problem("Nota de auto-aprovação deve estar entre 0 e 100.", statusCode: 400);

        var ws = await db.Workspaces.FirstAsync(w => w.Id == Ws);
        ws.TimeZoneId = req.TimeZoneId;
        // Janela é AVISO (soft): aceita nulos e não valida ordem start/end — a UI orienta, não trava.
        ws.PublishWindowStart = req.PublishWindowStart;
        ws.PublishWindowEnd = req.PublishWindowEnd;
        // Fase 2 (patch-friendly): só sobrescreve o que veio no request (?? preserva o atual).
        ws.AutoPostEnabled = req.AutoPostEnabled ?? ws.AutoPostEnabled;
        ws.PostingScheduleDays = req.PostingScheduleDays ?? ws.PostingScheduleDays;
        ws.PostingScheduleTimes = req.PostingScheduleTimes ?? ws.PostingScheduleTimes;
        ws.CreativeStrategy = req.CreativeStrategy ?? ws.CreativeStrategy;
        ws.AutoApprovalThreshold = req.AutoApprovalThreshold ?? ws.AutoApprovalThreshold;
        await db.SaveChangesAsync();

        return Ok(ToDto(ws));
    }
}
