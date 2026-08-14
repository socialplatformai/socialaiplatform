using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;
using SocialAi.Api.Data;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Content;

/// <summary>
/// Imagem de slide (MinIO): PROXY estável da imagem de slide. O DTO devolve a URL desta rota (não o blob nem uma
/// presigned que expira); aqui resolvemos a referência <c>minio:{key}</c> e redirecionamos (302) p/
/// uma presigned FRESCA a cada request — então o link nunca morre no editor, e o JSON fica leve.
///
/// Tenant-safe: o filtro global de workspace já restringe o Content ao tenant do JWT; só servimos a
/// imagem de um slide cujo Content pertence ao workspace atual. Sem MinIO (degraded-mode), a rota não
/// é registrada (o store é null) e o DTO mantém o base64 — esta rota nunca é chamada.
/// </summary>
[ApiController]
[Authorize]
[Route("api/content/{contentId:guid}/slides/{index:int}/image")]
public sealed class ContentSlideImageController(AppDbContext db, MinioImageStore? store = null) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Get(Guid contentId, int index, CancellationToken ct)
    {
        // Lê só o ImageUrl do slide do Content (o filtro de tenant garante o isolamento).
        var imageUrl = await db.ContentSlides.AsNoTracking()
            .Where(s => s.ContentId == contentId && s.Index == index)
            .Select(s => s.ImageUrl)
            .FirstOrDefaultAsync(ct);

        if (string.IsNullOrEmpty(imageUrl)) return NotFound();

        // Caminho MinIO: referência minio:{key} → 302 p/ presigned fresca (a API não streama bytes).
        if (store is not null)
        {
            var key = MinioImageStore.KeyOf(imageUrl);
            if (key is not null)
            {
                var presigned = await store.PresignAsync(key, ct);
                return Redirect(presigned);
            }
        }

        // Degraded-mode (sem MinIO) ou geração antiga: a imagem é base64/data-url no Postgres.
        // Antes isto era 404 (o JSON trazia o base64 verbatim e a UI o usava direto). Agora servimos
        // a imagem AQUI também — assim a UI (editor, histórico) referencia sempre esta URL estável,
        // sem inflar o JSON com ~1MB de base64 por slide. http(s) → redireciona; base64 → streama JPEG.
        if (imageUrl.StartsWith("http", StringComparison.Ordinal))
            return Redirect(imageUrl);

        byte[] bytes;
        try { bytes = DecodeInline(imageUrl); }
        catch { return NotFound(); } // não é base64 inline reconhecível.

        using var image = Image.Load(bytes);
        var outStream = new MemoryStream();
        await image.SaveAsync(outStream, new JpegEncoder { Quality = 90 }, ct);
        outStream.Position = 0;
        Response.Headers.CacheControl = "private, max-age=300";
        return File(outStream, "image/jpeg");
    }

    private static byte[] DecodeInline(string source)
    {
        if (source.StartsWith("data:", StringComparison.Ordinal))
        {
            var comma = source.IndexOf(',');
            return Convert.FromBase64String(source[(comma + 1)..]);
        }
        return Convert.FromBase64String(source);
    }
}
