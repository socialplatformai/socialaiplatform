using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.History;

// C1 (ADR-0010): histórico legível, brand-scoped e paginado — duas vistas distintas:
//  - "publications": o que saiu (ou tentou sair) para o Instagram, a partir dos PublishLogs.
//  - "generations":  o que o pipeline produziu, a partir dos Contents (todos os status).
// Isolamento: o filtro global por WorkspaceId (AppDbContext) + o Where por BrandId garantem
// que só vemos linhas da marca/workspace corrente. O cross-brand/cross-workspace é provado
// no teste de outra fatia; aqui confiamos nas duas camadas e não revalidamos.

public record PublicationHistoryDto(
    Guid ContentId, string? Caption, string? AccountUsername, string Result,
    DateTimeOffset When, string? Error,
    // Auditoria final: expõe o publisher (Mock vs InstagramGraph) para o operador distinguir
    // publicação em demonstração de publicação real no histórico — torna observável a queda
    // silenciosa para Mock (ex.: todas as contas desconectadas). Não polui o filtro Result==Error.
    string Publisher);

public record GenerationHistoryDto(
    Guid ContentId, Guid? PautaId, string? PautaTitle, string Status,
    string? JobId, int? QualityScore, DateTimeOffset When,
    // Imagem do 1º slide (capa) p/ o histórico mostrar a peça gerada — URL do proxy autenticado
    // (/api/content/{id}/slides/{idx}/image), não o base64 (mantém o JSON leve). null se a geração
    // não produziu slide com imagem. A UI anexa ?access_token= (o <img> não manda header).
    string? CoverImageUrl);

// 'PageNumber' (não 'Page') p/ não colidir com o nome do próprio tipo (CS0542).
public record Page<T>(IReadOnlyList<T> Items, int PageNumber, int PageSize, int Total);

[ApiController]
[Authorize]
[Route("api/history")]
public class HistoryController(AppDbContext db, ICurrentWorkspace current, BrandResolver brands)
    : ControllerBase
{
    private Guid Ws => current.WorkspaceId!.Value;

    [HttpGet("publications")]
    public async Task<ActionResult<Page<PublicationHistoryDto>>> Publications(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken ct = default)
    {
        (page, pageSize) = Clamp(page, pageSize);
        var brandId = await brands.ResolveAsync(ct);

        // O Where por Guid (BrandId) roda no SQL sem problema; o que NÃO pode é ordenar
        // DateTimeOffset no SQL sob o filtro de tenant (GOTCHA 4: SQLite ≠ Postgres).
        // Por isso materializamos com ToListAsync ANTES de qualquer OrderBy/Skip/Take.
        var logs = await db.PublishLogs
            .Include(l => l.ScheduledPost!).ThenInclude(p => p.Content)
            .Where(l => l.ScheduledPost!.Content!.BrandId == brandId)
            .ToListAsync(ct);

        // Conta-alvo da marca p/ exibir o @ — carregada uma vez (KISS). A escolha por
        // conteúdo segue a precedência: override explícito → IsPrimary → 1ª conectada.
        var accounts = await db.InstagramAccounts
            .Where(a => a.BrandId == brandId)
            .ToListAsync(ct);

        var ordered = logs.OrderByDescending(l => l.CreatedAt).ToList();
        var total = ordered.Count;

        var items = ordered
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(l =>
            {
                var content = l.ScheduledPost!.Content!;
                // Username pode ser null (degrade honesto) se nenhuma conta resolve/tem @.
                var account = accounts.FirstOrDefault(a => a.Id == content.TargetInstagramAccountId)
                    ?? accounts.FirstOrDefault(a => a.IsPrimary)
                    ?? accounts.FirstOrDefault();
                return new PublicationHistoryDto(
                    content.Id, content.Caption, account?.Username,
                    l.Result.ToString(), l.CreatedAt, l.Error, l.Publisher.ToString());
            })
            .ToList();

        return Ok(new Page<PublicationHistoryDto>(items, page, pageSize, total));
    }

    [HttpGet("generations")]
    public async Task<ActionResult<Page<GenerationHistoryDto>>> Generations(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken ct = default)
    {
        (page, pageSize) = Clamp(page, pageSize);
        var brandId = await brands.ResolveAsync(ct);

        // Mesmo motivo do GOTCHA 4: materializa antes de ordenar por CreatedAt.
        // Inclui Slides p/ derivar a imagem de capa (1º slide com imagem) no DTO.
        var contents = await db.Contents
            .Include(c => c.Pauta)
            .Include(c => c.Slides)
            .Where(c => c.BrandId == brandId)
            .ToListAsync(ct);

        var ordered = contents.OrderByDescending(c => c.CreatedAt).ToList();
        var total = ordered.Count;

        var items = ordered
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(c => new GenerationHistoryDto(
                c.Id, c.PautaId, c.Pauta?.Title, c.Status.ToString(),
                c.JobId, c.QualityScore, c.CreatedAt,
                CoverUrl(c)))
            .ToList();

        return Ok(new Page<GenerationHistoryDto>(items, page, pageSize, total));
    }

    // Teto de página: evita varredura/serialização desproporcional via querystring hostil.
    private static (int page, int pageSize) Clamp(int page, int pageSize)
        => (Math.Max(1, page), Math.Clamp(pageSize, 1, 100));

    // URL do proxy da imagem do 1º slide que TEM imagem (a "capa" da peça). Relativa — o web prepende
    // sua base e anexa ?access_token=. null quando a geração não produziu slide com imagem (ainda
    // gerando, falhou, ou peça só-texto). Não serializa base64 aqui (mantém o JSON do histórico leve).
    private static string? CoverUrl(Domain.Content c)
    {
        var slide = c.Slides
            .Where(s => !string.IsNullOrEmpty(s.ImageUrl))
            .OrderBy(s => s.Index)
            .FirstOrDefault();
        return slide is null ? null : $"/api/content/{c.Id}/slides/{slide.Index}/image";
    }
}
