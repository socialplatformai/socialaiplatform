using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.JsonWebTokens;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Audit;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Features.Pautas;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Ideas;

public record IdeaDto(Guid Id, string Title, string? Rationale, ContentType SuggestedType, Guid? BrandId);

/// <summary>
/// E4.4 (ADR-0006) — porta de saída do loop autônomo. O AutonomousLoopJob cria
/// IdeaCandidate quando a fila de pautas esvazia; aqui o humano as lista e PROMOVE a
/// uma Pauta (moderação: ideias nunca viram conteúdo sem aprovação humana). A promoção
/// usa a MARCA ATUAL do request (X-Brand-Id), nunca infere — ideias nascem sem marca.
/// </summary>
[ApiController]
[Authorize]
[Route("api/ideas")]
public class IdeasController(
    AppDbContext db, ICurrentWorkspace current, BrandResolver brands, AuditService audit) : ControllerBase
{
    private Guid Ws => current.WorkspaceId!.Value;
    private Guid ActorId => User.ActorId();
    private string ActorEmail => User.ActorEmail();

    [HttpGet]
    public async Task<ActionResult<IEnumerable<IdeaDto>>> List()
    {
        // Não-promovidas do workspace (filtro global por WorkspaceId já restringe ao tenant).
        var ideas = await db.IdeaCandidates.AsNoTracking()
            .Where(i => !i.Promoted)
            .ToListAsync();
        return Ok(ideas
            .OrderByDescending(i => i.CreatedAt).ThenBy(i => i.Id)
            .Select(i => new IdeaDto(i.Id, i.Title, i.Rationale, i.SuggestedType, i.BrandId)));
    }

    /// <summary>Promove a ideia a uma Pauta (Backlog) na marca atual do request.</summary>
    [HttpPost("{id:guid}/promote")]
    public async Task<ActionResult<PautaDto>> Promote(Guid id)
    {
        var brandId = await brands.ResolveAsync();
        var idea = await db.IdeaCandidates.FirstOrDefaultAsync(i => i.Id == id);
        if (idea is null) return NotFound();
        if (idea.Promoted) return Problem("Esta ideia já foi promovida.", statusCode: 409);

        var pauta = new Pauta
        {
            WorkspaceId = Ws,
            BrandId = brandId, // marca ATUAL do request (X-Brand-Id), não a da ideia
            Title = idea.Title,
            Objective = idea.Rationale,
            Context = idea.Rationale,
            DesiredType = idea.SuggestedType,
            Status = PautaStatus.Backlog,
        };
        db.Pautas.Add(pauta);
        idea.Promoted = true;
        await db.SaveChangesAsync();

        // C2: promover ideia do loop autônomo é ação sensível (moderação humana → conteúdo).
        await audit.LogAsync(Ws, ActorId, ActorEmail, "idea.promote", idea.Id.ToString(), brandId);

        return Ok(new PautaDto(
            pauta.Id, pauta.Title, pauta.Objective, pauta.Context, pauta.Priority, pauta.Category,
            pauta.DesiredType, pauta.SuggestedDate, pauta.Status,
            Enumerable.Empty<AttachmentDto>(), pauta.MarketingObjective));
    }
}
