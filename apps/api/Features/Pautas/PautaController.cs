using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Pautas;

[ApiController]
[Authorize]
[Route("api/pautas")]
public class PautaController(AppDbContext db, ICurrentWorkspace current, BrandResolver brands) : ControllerBase
{
    private Guid Ws => current.WorkspaceId!.Value;

    // Resolve a marca atual (X-Brand-Id, validada contra o workspace; default se ausente).
    // Lança CrossWorkspaceBrandException → tratada como 403 nas actions.
    private Task<Guid> CurrentBrandAsync() => brands.ResolveAsync();

    // E12.1: escapa os curingas do LIKE (% _ \) no termo de busca para que sejam
    // tratados como LITERAIS pelo ILike (e não como wildcards). A barra invertida é
    // o escape char passado ao EF.Functions.ILike(..., "\\"). Função pura/estática
    // (testável sem Postgres; SQLite não tem ILike). Ordem importa: escapa '\' antes.
    // public p/ o teste de contrato (PautaSearchTests) — é função pura sem risco.
    public static string EscapeLike(string term) => term
        .Replace("\\", "\\\\")
        .Replace("%", "\\%")
        .Replace("_", "\\_");

    private static PautaDto ToDto(Pauta p) => new(
        p.Id, p.Title, p.Objective, p.Context, p.Priority, p.Category,
        p.DesiredType, p.SuggestedDate, p.Status,
        p.Attachments.Select(a => new AttachmentDto(a.Id, a.Url, a.FileName, a.ContentType)),
        p.MarketingObjective, p.ForcedTemplateId);

    /// <summary>D3: valida que o template forçado (se houver) existe no workspace atual. O filtro
    /// global por WorkspaceId já restringe Templates ao tenant — um id de outro workspace não é
    /// encontrado e vira erro (não vaza, não força template alheio). null → sem validação.</summary>
    private async Task<bool> TemplateForcadoValidoAsync(Guid? templateId)
    {
        if (templateId is not { } tid) return true;
        return await db.Templates.AsNoTracking().AnyAsync(t => t.Id == tid);
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<PautaDto>>> List(
        [FromQuery] PautaStatus? status, [FromQuery] Priority? priority, [FromQuery] string? category,
        [FromQuery] string? search)
    {
        // E1: além do isolamento por workspace (filtro global), filtra pela MARCA atual.
        var brandId = await CurrentBrandAsync();
        var q = db.Pautas.AsNoTracking().Include(p => p.Attachments).Where(p => p.BrandId == brandId);
        if (status is not null) q = q.Where(p => p.Status == status);
        if (priority is not null) q = q.Where(p => p.Priority == priority);
        // E3.5: filtra a lista por categoria (igualdade exata; vazio = todas).
        if (!string.IsNullOrWhiteSpace(category)) q = q.Where(p => p.Category == category);
        // E12.1: busca por título (case/acento-insensível via Postgres ILike), convive
        // com os filtros acima. %/_/\ no termo viram literais (EscapeLike), não curingas.
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = "%" + EscapeLike(search) + "%";
            q = q.Where(p => EF.Functions.ILike(p.Title, term, "\\"));
        }
        var list = await q.OrderByDescending(p => p.Priority).ThenBy(p => p.SuggestedDate).ToListAsync();
        return Ok(list.Select(ToDto));
    }

    /// <summary>E3.5: categorias distintas da marca atual (p/ popular o filtro na UI).</summary>
    [HttpGet("categories")]
    public async Task<ActionResult<IEnumerable<string>>> Categories()
    {
        var brandId = await CurrentBrandAsync();
        var cats = await db.Pautas.AsNoTracking()
            .Where(p => p.BrandId == brandId && p.Category != null && p.Category != "")
            .Select(p => p.Category!).Distinct().ToListAsync();
        return Ok(cats.OrderBy(c => c));
    }

    /// <summary>Fila ordenada: prioridade (alta→baixa), depois data sugerida (§2.6).</summary>
    [HttpGet("queue")]
    public async Task<ActionResult<IEnumerable<PautaDto>>> Queue()
    {
        var brandId = await CurrentBrandAsync();
        var list = await db.Pautas.AsNoTracking().Include(p => p.Attachments)
            .Where(p => p.BrandId == brandId)
            .Where(p => p.Status == PautaStatus.Backlog || p.Status == PautaStatus.Queued)
            .OrderByDescending(p => p.Priority)
            .ThenBy(p => p.SuggestedDate)
            .ThenBy(p => p.CreatedAt)
            .ToListAsync();
        return Ok(list.Select(ToDto));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<PautaDto>> Get(Guid id)
    {
        // Restringe à marca atual (além do workspace): pauta de outra marca → 404.
        var brandId = await CurrentBrandAsync();
        var p = await db.Pautas.AsNoTracking().Include(x => x.Attachments)
            .FirstOrDefaultAsync(x => x.Id == id && x.BrandId == brandId);
        return p is null ? NotFound() : Ok(ToDto(p));
    }

    [HttpPost]
    public async Task<ActionResult<PautaDto>> Create(PautaInput input)
    {
        if (string.IsNullOrWhiteSpace(input.Title)) return Problem("Título obrigatório.", statusCode: 400);

        var brandId = await CurrentBrandAsync();
        // D3: template forçado precisa existir no workspace (defense-in-depth — não força alheio).
        if (!await TemplateForcadoValidoAsync(input.ForcedTemplateId))
            return Problem("Template forçado inexistente neste workspace.", statusCode: 400);
        var pauta = new Pauta
        {
            WorkspaceId = Ws,
            BrandId = brandId,
            Title = input.Title,
            Objective = input.Objective,
            Context = input.Context,
            Priority = input.Priority,
            Category = input.Category,
            MarketingObjective = input.MarketingObjective,
            DesiredType = input.DesiredType,
            SuggestedDate = input.SuggestedDate,
            ForcedTemplateId = input.ForcedTemplateId, // D3
            Status = PautaStatus.Backlog,
        };
        foreach (var a in input.Attachments ?? [])
            pauta.Attachments.Add(new Attachment
            {
                WorkspaceId = Ws, Url = a.Url, FileName = a.FileName, ContentType = a.ContentType,
            });

        db.Pautas.Add(pauta);
        await db.SaveChangesAsync();
        return Ok(ToDto(pauta));
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<PautaDto>> Update(Guid id, PautaInput input)
    {
        var brandId = await CurrentBrandAsync();
        var p = await db.Pautas.Include(x => x.Attachments).FirstOrDefaultAsync(x => x.Id == id && x.BrandId == brandId);
        if (p is null) return NotFound();
        // D3: template forçado precisa existir no workspace (defense-in-depth).
        if (!await TemplateForcadoValidoAsync(input.ForcedTemplateId))
            return Problem("Template forçado inexistente neste workspace.", statusCode: 400);
        p.Title = input.Title;
        p.Objective = input.Objective;
        p.Context = input.Context;
        p.Priority = input.Priority;
        p.Category = input.Category;
        p.MarketingObjective = input.MarketingObjective;
        p.DesiredType = input.DesiredType;
        p.SuggestedDate = input.SuggestedDate;
        p.ForcedTemplateId = input.ForcedTemplateId; // D3
        await db.SaveChangesAsync();
        return Ok(ToDto(p));
    }

    [HttpPatch("{id:guid}/status")]
    public async Task<IActionResult> SetStatus(Guid id, PautaStatusUpdate body)
    {
        var brandId = await CurrentBrandAsync();
        var p = await db.Pautas.FirstOrDefaultAsync(x => x.Id == id && x.BrandId == brandId);
        if (p is null) return NotFound();
        p.Status = body.Status;
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var brandId = await CurrentBrandAsync();
        var p = await db.Pautas.FirstOrDefaultAsync(x => x.Id == id && x.BrandId == brandId);
        if (p is null) return NotFound();
        db.Pautas.Remove(p);
        await db.SaveChangesAsync();
        return NoContent();
    }
}
