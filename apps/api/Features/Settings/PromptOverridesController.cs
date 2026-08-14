using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;

namespace SocialAi.Api.Features.Settings;

// ADR-0013: ao contrário do Secret (chave de IA), o PromptText VOLTA no GET — é asset de edição,
// não segredo. Por isso tabela própria (PromptOverride), texto em claro.
public record PromptOverrideDto(string AgentKey, string PromptText);
public record PromptOverridesDto(IEnumerable<PromptOverrideDto> Overrides, int MaxLength);
public record SavePromptOverrideRequest(string PromptText);

/// <summary>
/// Editor de system-prompt por agente, POR WORKSPACE (ADR-0013, complementa a FASE 9/ADR-0011).
/// Restrito a Admin (poder perigoso). A API persiste e EMITE o override no brandContext
/// incondicionalmente; quem decide aplicá-lo (ou cair no prompt-base versionado) é o serviço de
/// agentes, atrás da flag PROMPT_OVERRIDES_ENABLED — por isso a UI avisa "requer ativação pelo
/// operador". O isolamento por workspace é o das 3 camadas (PromptOverride é TenantEntity).
/// </summary>
[ApiController]
[Route("api/settings/prompts")]
[Authorize(Roles = "Admin")]
public class PromptOverridesController(AppDbContext db) : ControllerBase
{
    // Espelha services/agents/src/types/agent-keys.ts (PROMPT_AGENT_KEYS) — fonte única do outro
    // lado. Sem contrato compartilhado (mesma natureza dos enums .NET↔TS): comentário-âncora + a
    // validação rejeita chave fora desta lista (uma chave nova no agents sem atualizar aqui falha
    // visível no PUT, nunca silenciosa).
    private static readonly HashSet<string> ValidAgentKeys = new(StringComparer.Ordinal)
    {
        "brand-strategist",
        "story-architect",
        "copywriter",
        "visual-compositor",
        "quality-validator",
    };

    // Teto de tamanho: um system-prompt cabe folgado em 20k chars; o limite evita payload abusivo
    // (o briefing inteiro viaja por run) e dá uma mensagem clara ao operador.
    private const int MaxPromptLength = 20_000;

    [HttpGet]
    public async Task<ActionResult<PromptOverridesDto>> Get()
    {
        var rows = await db.PromptOverrides.AsNoTracking()
            .Select(p => new PromptOverrideDto(p.AgentKey, p.PromptText))
            .ToListAsync();
        return Ok(new PromptOverridesDto(rows, MaxPromptLength));
    }

    [HttpPut("{agentKey}")]
    public async Task<IActionResult> Save(string agentKey, SavePromptOverrideRequest req)
    {
        if (!ValidAgentKeys.Contains(agentKey))
            return Problem("Agente desconhecido.", statusCode: 400);

        var text = req.PromptText?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(text))
            return Problem("A instrução do agente não pode ficar vazia. Para voltar ao padrão, use \"Voltar ao padrão\".", statusCode: 400);
        if (text.Length > MaxPromptLength)
            return Problem($"A instrução do agente é longa demais (máximo {MaxPromptLength} caracteres).", statusCode: 400);

        // Upsert por (workspace, agentKey) — o índice único garante 1 linha. WorkspaceId é
        // carimbado pelo TenantSaveInterceptor (não preencher à mão).
        var existing = await db.PromptOverrides.FirstOrDefaultAsync(p => p.AgentKey == agentKey);
        if (existing is null)
        {
            db.PromptOverrides.Add(new PromptOverride { AgentKey = agentKey, PromptText = text });
        }
        else
        {
            existing.PromptText = text;
            existing.UpdatedAt = DateTimeOffset.UtcNow;
        }
        await db.SaveChangesAsync();
        return Ok(new PromptOverrideDto(agentKey, text));
    }

    [HttpDelete("{agentKey}")]
    public async Task<IActionResult> Delete(string agentKey)
    {
        if (!ValidAgentKeys.Contains(agentKey))
            return Problem("Agente desconhecido.", statusCode: 400);

        var existing = await db.PromptOverrides.FirstOrDefaultAsync(p => p.AgentKey == agentKey);
        if (existing is null) return NoContent(); // já está no padrão — idempotente.
        db.PromptOverrides.Remove(existing);
        await db.SaveChangesAsync();
        return NoContent();
    }
}
