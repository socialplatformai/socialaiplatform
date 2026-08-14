using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Brand;

[ApiController]
[Authorize]
[Route("api/brand")]
public class BrandController(AppDbContext db, ICurrentWorkspace current, BrandResolver brands) : ControllerBase
{
    private Guid Ws => current.WorkspaceId!.Value; // RequireWorkspaceFilter garante não-null

    // E1: o brand-kit/competidores/refs agora pertencem à MARCA atual (X-Brand-Id),
    // não mais ao workspace inteiro. Resolve a marca uma vez por request.
    private Task<Guid> CurrentBrandAsync() => brands.ResolveAsync();

    // ── Brand Kit (§2.1 + E2/ADR-0005) ───────────────────────────────────────
    [HttpGet("kit")]
    public async Task<ActionResult<BrandKitDto>> GetKit()
    {
        var brandId = await CurrentBrandAsync();
        var kit = await db.BrandKits.AsNoTracking().FirstOrDefaultAsync(k => k.BrandId == brandId);
        return Ok(kit is null ? new BrandKitDto(null, null, null, null, null) : ToKitDto(kit));
    }

    /// <summary>Upsert idempotente do brand-kit da marca atual.</summary>
    [HttpPut("kit")]
    public async Task<ActionResult<BrandKitDto>> PutKit(BrandKitDto dto)
    {
        // E2: valida cores (hex) e preset ANTES de gravar — entrada inválida → 400 claro.
        foreach (var (hex, campo) in new[] {
            (dto.PrimaryColorHex, "primária"), (dto.SecondaryColorHex, "secundária"),
            (dto.AccentColorHex, "de destaque"), (dto.BackgroundColorHex, "de fundo"),
            (dto.TextColorHex, "de texto") })
        {
            if (!IsValidHexOrEmpty(hex)) return Problem($"Cor {campo} inválida: use formato hex (ex.: #1B1F2E).", statusCode: 400);
        }
        // E2 (achado adversarial): o logo é renderizado nos slides e pode ser buscado pelo
        // worker — aceitar só http(s) fecha XSS (javascript:/data:) e reduz SSRF.
        if (!IsValidLogoUrlOrEmpty(dto.LogoUrl)) return Problem("URL do logo inválida: use http(s)://", statusCode: 400);

        var brandId = await CurrentBrandAsync();
        var kit = await db.BrandKits.FirstOrDefaultAsync(k => k.BrandId == brandId);
        if (kit is null)
        {
            kit = new BrandKit { WorkspaceId = Ws, BrandId = brandId };
            db.BrandKits.Add(kit);
        }
        kit.Branding = dto.Branding;
        kit.Tone = dto.Tone;
        kit.EditorialGuidelines = dto.EditorialGuidelines;
        kit.PositioningRules = dto.PositioningRules;
        kit.DesiredContentTypes = dto.DesiredContentTypes;
        // E2: identidade visual & texto. Preset desconhecido NÃO é erro (o adapter cai no
        // APEX, fail-safe) — normalizamos p/ minúsculo p/ casar com o catálogo dos agents.
        kit.VisualPreset = NormalizeOrNull(dto.VisualPreset)?.ToLowerInvariant();
        kit.PrimaryColorHex = NormalizeOrNull(dto.PrimaryColorHex);
        kit.SecondaryColorHex = NormalizeOrNull(dto.SecondaryColorHex);
        kit.AccentColorHex = NormalizeOrNull(dto.AccentColorHex);
        kit.BackgroundColorHex = NormalizeOrNull(dto.BackgroundColorHex);
        kit.TextColorHex = NormalizeOrNull(dto.TextColorHex);
        kit.HeadingFont = NormalizeOrNull(dto.HeadingFont);
        kit.BodyFont = NormalizeOrNull(dto.BodyFont);
        kit.LogoUrl = NormalizeOrNull(dto.LogoUrl);
        kit.TargetAudience = NormalizeOrNull(dto.TargetAudience);
        // CopyExamples: lista → JSON array (descarta vazios); lista vazia → null.
        var examples = (dto.CopyExamples ?? Enumerable.Empty<string>())
            .Select(s => s?.Trim()).Where(s => !string.IsNullOrEmpty(s)).ToList();
        kit.CopyExamples = examples.Count > 0
            ? System.Text.Json.JsonSerializer.Serialize(examples)
            : null;
        await db.SaveChangesAsync();
        return Ok(ToKitDto(kit));
    }

    private static BrandKitDto ToKitDto(BrandKit kit) => new(
        kit.Branding, kit.Tone, kit.EditorialGuidelines, kit.PositioningRules, kit.DesiredContentTypes,
        kit.VisualPreset, kit.PrimaryColorHex, kit.SecondaryColorHex, kit.AccentColorHex,
        kit.BackgroundColorHex, kit.TextColorHex, kit.HeadingFont, kit.BodyFont, kit.LogoUrl,
        kit.TargetAudience, DeserializeCopyExamples(kit.CopyExamples));

    private static string? NormalizeOrNull(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    /// <summary>Aceita vazio/null (campo opcional) ou hex #RGB/#RRGGBB.</summary>
    private static bool IsValidHexOrEmpty(string? hex)
    {
        if (string.IsNullOrWhiteSpace(hex)) return true;
        return System.Text.RegularExpressions.Regex.IsMatch(hex.Trim(), "^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$");
    }

    /// <summary>Aceita vazio (campo opcional) ou URL http(s) absoluta. Rejeita
    /// javascript:/data:/file: e relativos — o logo vai ao render e pode ser buscado.</summary>
    private static bool IsValidLogoUrlOrEmpty(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return true;
        return Uri.TryCreate(url.Trim(), UriKind.Absolute, out var u)
            && (u.Scheme == Uri.UriSchemeHttp || u.Scheme == Uri.UriSchemeHttps);
    }

    private static IEnumerable<string>? DeserializeCopyExamples(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return System.Text.Json.JsonSerializer.Deserialize<List<string>>(json); }
        catch (System.Text.Json.JsonException) { return null; }
    }

    // ── Competitors ──────────────────────────────────────────────────────────
    [HttpGet("competitors")]
    public async Task<ActionResult<IEnumerable<CompetitorDto>>> GetCompetitors()
    {
        var brandId = await CurrentBrandAsync();
        return Ok(await db.Competitors.AsNoTracking().Where(c => c.BrandId == brandId)
            .Select(c => new CompetitorDto(c.Id, c.Handle, c.Notes)).ToListAsync());
    }

    [HttpPost("competitors")]
    public async Task<ActionResult<CompetitorDto>> AddCompetitor(CompetitorInput input)
    {
        if (string.IsNullOrWhiteSpace(input.Handle)) return Problem("Handle obrigatório.", statusCode: 400);
        var brandId = await CurrentBrandAsync();
        var c = new Competitor { WorkspaceId = Ws, BrandId = brandId, Handle = input.Handle, Notes = input.Notes };
        db.Competitors.Add(c);
        await db.SaveChangesAsync();
        return Ok(new CompetitorDto(c.Id, c.Handle, c.Notes));
    }

    [HttpDelete("competitors/{id:guid}")]
    public async Task<IActionResult> DeleteCompetitor(Guid id)
    {
        var brandId = await CurrentBrandAsync();
        var c = await db.Competitors.FirstOrDefaultAsync(x => x.Id == id && x.BrandId == brandId);
        if (c is null) return NotFound();
        db.Competitors.Remove(c);
        await db.SaveChangesAsync();
        return NoContent();
    }

    // ── Visual references ────────────────────────────────────────────────────
    [HttpGet("visual-references")]
    public async Task<ActionResult<IEnumerable<VisualReferenceDto>>> GetRefs()
    {
        // VisualReference pendura em BrandKit; escopo de marca via o kit da marca atual.
        var brandId = await CurrentBrandAsync();
        return Ok(await db.VisualReferences.AsNoTracking()
            .Where(v => v.BrandKit!.BrandId == brandId)
            .Select(v => new VisualReferenceDto(v.Id, v.Url, v.Description)).ToListAsync());
    }

    [HttpPost("visual-references")]
    public async Task<ActionResult<VisualReferenceDto>> AddRef(VisualReferenceInput input)
    {
        var brandId = await CurrentBrandAsync();
        var kit = await db.BrandKits.FirstOrDefaultAsync(k => k.BrandId == brandId);
        if (kit is null)
        {
            kit = new BrandKit { WorkspaceId = Ws, BrandId = brandId };
            db.BrandKits.Add(kit);
            await db.SaveChangesAsync();
        }
        var v = new VisualReference { WorkspaceId = Ws, BrandKitId = kit.Id, Url = input.Url, Description = input.Description };
        db.VisualReferences.Add(v);
        await db.SaveChangesAsync();
        return Ok(new VisualReferenceDto(v.Id, v.Url, v.Description));
    }

    [HttpDelete("visual-references/{id:guid}")]
    public async Task<IActionResult> DeleteRef(Guid id)
    {
        var brandId = await CurrentBrandAsync();
        var v = await db.VisualReferences.FirstOrDefaultAsync(x => x.Id == id && x.BrandKit!.BrandId == brandId);
        if (v is null) return NotFound();
        db.VisualReferences.Remove(v);
        await db.SaveChangesAsync();
        return NoContent();
    }

    // ── Brand context p/ os agentes (E-5) ────────────────────────────────────
    /// <summary>Serializa a marca no shape BrandContext (alinhado a agents/types.ts).</summary>
    [HttpGet("context")]
    public async Task<ActionResult<BrandContextDto>> GetContext()
    {
        var brandId = await CurrentBrandAsync();
        var kit = await db.BrandKits.AsNoTracking().FirstOrDefaultAsync(k => k.BrandId == brandId);
        var competitors = await db.Competitors.AsNoTracking().Where(c => c.BrandId == brandId).Select(c => c.Handle).ToListAsync();
        var refs = await db.VisualReferences.AsNoTracking().Where(v => v.BrandKit!.BrandId == brandId).Select(v => v.Url).ToListAsync();
        return Ok(new BrandContextDto(
            WorkspaceId: Ws.ToString(),
            Branding: kit?.Branding,
            Tone: kit?.Tone,
            Guidelines: kit?.EditorialGuidelines,
            Competitors: competitors,
            VisualReferences: refs,
            LearningSummary: null));
    }
}
