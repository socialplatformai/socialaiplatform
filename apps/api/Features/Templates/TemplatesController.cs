using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Data.Seed;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Templates;

// D1 (ADR-0008): DTO de listagem — sem SpecJson (grande; a UI só precisa escolher).
// F6/B1+B3: enriquecido com metadados que a galeria do wizard usa (nº de slides, casos de uso,
// objetivos recomendados) — extraídos do SpecJson no servidor p/ a UI não baixar/parsear o spec
// inteiro. bestFor/recommendedFor podem vir vazios (template sem esses campos) — UI degrada honesto.
public record TemplateDto(
    Guid Id, string Key, string Name, string? Description, bool BuiltIn,
    int SlideCount, IReadOnlyList<string> BestFor, IReadOnlyList<string> RecommendedFor,
    // CUS/templates-SOTA: a JORNADA do template (sequência de tipos de slide — cover, problem,
    // solution, social-proof, cta…). A galeria mostra a ESTRUTURA, não só o nome (reconhecer > lembrar,
    // Nielsen H6). Extraída de slides[].type no SpecJson; vazia = template sem slides estruturados.
    IReadOnlyList<string> Journey);

// D1 (ADR-0008): DTO de detalhe — inclui SpecJson p/ quem precisar do spec completo.
public record TemplateDetailDto(Guid Id, string Key, string Name, string? Description, bool BuiltIn, string SpecJson);

// D2 (ADR-0008): estado de curadoria de template por marca.
public record BrandTemplateStateDto(Guid TemplateId, string Key, string Name, bool Enabled);

// D2 (ADR-0008): request de curadoria em lote.
public record SetBrandTemplatesRequest(IEnumerable<BrandTemplateToggle> Items);
public record BrandTemplateToggle(Guid TemplateId, bool Enabled);

/// <summary>D1 (ADR-0008): lista e descreve os templates disponíveis no workspace.</summary>
[ApiController]
[Authorize]
[Route("api/templates")]
public class TemplatesController(AppDbContext db, ICurrentWorkspace current) : ControllerBase
{
    private Guid Ws => current.WorkspaceId!.Value;

    /// <summary>
    /// D1: lista os templates do workspace. Realiza lazy seed antes de listar —
    /// garante que workspaces criados antes da migration tenham os 4 built-in (idempotente).
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<IEnumerable<TemplateDto>>> List(CancellationToken ct)
    {
        // Lazy seed: insere built-in ausentes antes de retornar a lista.
        await TemplateSeeder.EnsureAsync(db, Ws, ct);
        await db.SaveChangesAsync(ct);

        // F6/B1: materializa (precisa do SpecJson p/ extrair metadados) e projeta em memória.
        var rows = await db.Templates
            .AsNoTracking()
            .OrderBy(t => t.Name)
            .Select(t => new { t.Id, t.Key, t.Name, t.Description, t.BuiltIn, t.SpecJson })
            .ToListAsync(ct);

        var templates = rows.Select(t =>
        {
            var (slideCount, bestFor, recommendedFor, journey) = ParseSpecMeta(t.SpecJson);
            return new TemplateDto(t.Id, t.Key, t.Name, t.Description, t.BuiltIn, slideCount, bestFor, recommendedFor, journey);
        }).ToList();

        return Ok(templates);
    }

    /// <summary>
    /// F6/B1+B3: extrai do SpecJson os metadados que a galeria usa (slideCount, bestFor,
    /// recommendedFor). Tolerante: spec ausente/inválido → (0, [], []) — a UI degrada (mostra o
    /// card sem esses detalhes), nunca lança. slideCount cai no tamanho de `slides` se ausente.
    /// </summary>
    private static (int SlideCount, List<string> BestFor, List<string> RecommendedFor, List<string> Journey) ParseSpecMeta(string? specJson)
    {
        if (string.IsNullOrWhiteSpace(specJson)) return (0, [], [], []);
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(specJson);
            var root = doc.RootElement;

            var hasSlides = root.TryGetProperty("slides", out var slides) && slides.ValueKind == System.Text.Json.JsonValueKind.Array;
            var slideCount = root.TryGetProperty("slideCount", out var sc) && sc.TryGetInt32(out var n)
                ? n
                : (hasSlides ? slides.GetArrayLength() : 0);

            // Jornada: sequência de slides[].type (cover, problem, solution, cta…). É o que torna o
            // preview do template inteligível (a estrutura, não o nome). Tolerante: sem slides → [].
            var journey = new List<string>();
            if (hasSlides)
                foreach (var s in slides.EnumerateArray())
                    if (s.ValueKind == System.Text.Json.JsonValueKind.Object
                        && s.TryGetProperty("type", out var ty)
                        && ty.ValueKind == System.Text.Json.JsonValueKind.String
                        && ty.GetString() is { } typeStr)
                        journey.Add(typeStr);

            return (slideCount, StringArray(root, "bestFor"), StringArray(root, "recommendedFor"), journey);
        }
        catch (System.Text.Json.JsonException)
        {
            return (0, [], [], []); // spec corrompido → degrada honesto (sem metadados).
        }
    }

    private static List<string> StringArray(System.Text.Json.JsonElement root, string prop)
    {
        var list = new List<string>();
        if (root.TryGetProperty(prop, out var arr) && arr.ValueKind == System.Text.Json.JsonValueKind.Array)
            foreach (var el in arr.EnumerateArray())
                if (el.ValueKind == System.Text.Json.JsonValueKind.String && el.GetString() is { } s)
                    list.Add(s);
        return list;
    }

    /// <summary>D1: detalhe de um template com SpecJson (p/ debug/administração).</summary>
    [HttpGet("{id:guid}")]
    public async Task<ActionResult<TemplateDetailDto>> Get(Guid id, CancellationToken ct)
    {
        var t = await db.Templates
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == id, ct);

        if (t is null) return NotFound();

        return Ok(new TemplateDetailDto(t.Id, t.Key, t.Name, t.Description, t.BuiltIn, t.SpecJson));
    }
}

/// <summary>D2 (ADR-0008): curadoria de templates habilitados por marca.</summary>
[ApiController]
[Authorize]
[Route("api/brands/{brandId:guid}/templates")]
public class BrandTemplatesController(AppDbContext db, ICurrentWorkspace current) : ControllerBase
{
    private Guid Ws => current.WorkspaceId!.Value;

    /// <summary>
    /// Valida que a marca do path existe no workspace atual. O filtro global já restringe
    /// ao tenant; esta checagem devolve 404 explícito se a marca não existir.
    /// </summary>
    private async Task<bool> BrandExistsAsync(Guid brandId, CancellationToken ct) =>
        await db.Brands.AsNoTracking().AnyAsync(b => b.Id == brandId, ct);

    /// <summary>
    /// Monta o estado de curadoria: para cada template do workspace, retorna enabled=true
    /// se não há linha BrandTemplate (ausência = ativo por padrão para built-in).
    /// </summary>
    private async Task<List<BrandTemplateStateDto>> GetStateAsync(Guid brandId, CancellationToken ct)
    {
        var templates = await db.Templates
            .AsNoTracking()
            .OrderBy(t => t.Name)
            .Select(t => new { t.Id, t.Key, t.Name })
            .ToListAsync(ct);

        // Carrega as linhas de curadoria existentes para esta marca.
        var curated = await db.BrandTemplates
            .AsNoTracking()
            .Where(bt => bt.BrandId == brandId)
            .Select(bt => new { bt.TemplateId, bt.Enabled })
            .ToListAsync(ct);

        var curatedMap = curated.ToDictionary(bt => bt.TemplateId, bt => bt.Enabled);

        return templates
            .Select(t => new BrandTemplateStateDto(
                t.Id,
                t.Key,
                t.Name,
                // Ausência de linha = habilitado (built-in ativo por padrão).
                curatedMap.TryGetValue(t.Id, out var enabled) ? enabled : true))
            .ToList();
    }

    /// <summary>D2: estado curado — um item por template do workspace com flag enabled.</summary>
    [HttpGet]
    public async Task<ActionResult<IEnumerable<BrandTemplateStateDto>>> Get(Guid brandId, CancellationToken ct)
    {
        if (!await BrandExistsAsync(brandId, ct)) return NotFound();

        return Ok(await GetStateAsync(brandId, ct));
    }

    /// <summary>
    /// D2: upsert em lote da curadoria por marca. Cada item liga um TemplateId à marca com
    /// Enabled. TemplateId que não pertence ao workspace retorna 400 com mensagem em PT-BR.
    /// Devolve o mesmo shape do GET após salvar.
    /// </summary>
    [HttpPut]
    public async Task<ActionResult<IEnumerable<BrandTemplateStateDto>>> Set(
        Guid brandId,
        [FromBody] SetBrandTemplatesRequest request,
        CancellationToken ct)
    {
        if (!await BrandExistsAsync(brandId, ct)) return NotFound();

        var items = request.Items?.ToList() ?? [];
        if (items.Count == 0)
            return Ok(await GetStateAsync(brandId, ct));

        // Valida que todos os TemplateIds pertencem ao workspace (filtro global já restringe).
        var requestedIds = items.Select(i => i.TemplateId).ToHashSet();
        var validIds = (await db.Templates
            .AsNoTracking()
            .Where(t => requestedIds.Contains(t.Id))
            .Select(t => t.Id)
            .ToListAsync(ct)).ToHashSet();

        var invalid = requestedIds.Except(validIds).ToList();
        if (invalid.Count > 0)
            return Problem(
                $"Template(s) não encontrado(s) neste workspace: {string.Join(", ", invalid)}.",
                statusCode: 400);

        // Carrega linhas existentes para fazer upsert.
        var existing = await db.BrandTemplates
            .Where(bt => bt.BrandId == brandId && requestedIds.Contains(bt.TemplateId))
            .ToListAsync(ct);

        var existingMap = existing.ToDictionary(bt => bt.TemplateId);

        foreach (var item in items)
        {
            if (existingMap.TryGetValue(item.TemplateId, out var row))
            {
                // Atualiza linha existente.
                row.Enabled = item.Enabled;
            }
            else
            {
                // Cria nova linha de curadoria.
                db.BrandTemplates.Add(new Domain.BrandTemplate
                {
                    WorkspaceId = Ws,
                    BrandId = brandId,
                    TemplateId = item.TemplateId,
                    Enabled = item.Enabled,
                });
            }
        }

        await db.SaveChangesAsync(ct);

        return Ok(await GetStateAsync(brandId, ct));
    }
}
