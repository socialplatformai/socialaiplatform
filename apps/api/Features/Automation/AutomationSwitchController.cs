using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SocialAi.Api.Data;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Automation;

// Freio-mestre GLOBAL do robô (SystemSetting["Loop:Enabled"]). Não é tenant-scoped: vale para o
// deploy inteiro. Traz o kill-switch do env-var para a TELA — o operador (admin) liga/desliga sem
// mexer em variável de servidor.
public record MasterSwitchDto(bool Enabled);
public record UpdateMasterSwitchRequest(bool Enabled);
public record MaxPostsPerDayDto(int Value);
public record UpdateMaxPostsPerDayRequest(int Value);

/// <summary>
/// GET/PUT do freio-mestre do robô. Admin-only: ligar a autonomia global é a ação mais sensível do
/// sistema (destrava geração + publicação automáticas em todos os workspaces do deploy). O estado
/// vem do banco (SystemSetting) com fallback env — ver <see cref="LoopSwitch"/>. Sem WorkspaceId
/// (config global), então este controller NÃO passa pelo RequireWorkspaceFilter? Passa — é MVC — mas
/// não lê workspace: a config é do deploy. O filtro só exige um workspace válido no JWT (que o admin tem).
/// </summary>
[ApiController]
[Authorize(Roles = "Admin")]
[Route("api/automation/master-switch")]
public class AutomationSwitchController(AppDbContext db, IConfiguration cfg) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<MasterSwitchDto>> Get()
    {
        var enabled = await LoopSwitch.GetAsync(db, cfg, HttpContext.RequestAborted);
        return Ok(new MasterSwitchDto(enabled));
    }

    [HttpPut]
    public async Task<ActionResult<MasterSwitchDto>> Update(UpdateMasterSwitchRequest req)
    {
        await LoopSwitch.SetAsync(db, req.Enabled, HttpContext.RequestAborted);
        await db.SaveChangesAsync(HttpContext.RequestAborted);
        return Ok(new MasterSwitchDto(req.Enabled));
    }

    /// <summary>GET do máximo de gerações/dia do robô (SystemSetting → env → 1). Admin-only.</summary>
    [HttpGet("/api/automation/max-posts-per-day")]
    public async Task<ActionResult<MaxPostsPerDayDto>> GetMaxPostsPerDay()
    {
        var v = await LoopSwitch.GetMaxPostsPerDayAsync(db, cfg, HttpContext.RequestAborted);
        return Ok(new MaxPostsPerDayDto(v));
    }

    /// <summary>PUT do máximo de gerações/dia (piso 1). Governa quanto o robô gasta/dia — Admin-only.</summary>
    [HttpPut("/api/automation/max-posts-per-day")]
    public async Task<ActionResult<MaxPostsPerDayDto>> UpdateMaxPostsPerDay(UpdateMaxPostsPerDayRequest req)
    {
        if (req.Value < 1)
            return Problem("O máximo de gerações por dia deve ser pelo menos 1.", statusCode: 400);
        await LoopSwitch.SetMaxPostsPerDayAsync(db, req.Value, HttpContext.RequestAborted);
        await db.SaveChangesAsync(HttpContext.RequestAborted);
        return Ok(new MaxPostsPerDayDto(req.Value));
    }
}
