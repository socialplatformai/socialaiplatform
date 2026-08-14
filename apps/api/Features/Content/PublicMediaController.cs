using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;
using SocialAi.Api.Data;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Content;

/// <summary>
/// Rota PÚBLICA e ANÔNIMA da imagem de um slide — a superfície que a Graph API da Meta usa para
/// BAIXAR a imagem na publicação real (a Meta acessa por HTTP, sem JWT). É o substituto self-hosted
/// do presigned do MinIO quando NÃO há storage externo: a imagem vive como base64 no Postgres e a
/// própria API a entrega como JPEG.
///
/// SEGURANÇA: anônima, mas NÃO aberta. Exige uma assinatura HMAC válida e não expirada
/// (<see cref="MediaUrlSigner"/>) — sem ela, 403. O token é gerado no publish (worker) e leva
/// content+índice+expiração; não é enumerável nem forjável. Como a Meta não tem tenant, a leitura
/// IGNORA o filtro global de workspace (IgnoreQueryFilters): o isolamento aqui é a própria
/// assinatura (só quem tem a URL assinada do publish chega ao slide daquele content).
///
/// Só faz sentido em modo degradado de storage (sem MinIO). Com MinIO, o publish usa presigned do
/// bucket e esta rota não é exercida pela Meta.
/// </summary>
[ApiController]
[AllowAnonymous]
[Route("public/media")]
public sealed class PublicMediaController(AppDbContext db, MediaUrlSigner signer, ILogger<PublicMediaController> logger)
    : ControllerBase
{
    [HttpGet("{contentId:guid}/{index:int}.jpg")]
    public async Task<IActionResult> Get(
        Guid contentId, int index,
        [FromQuery] long exp, [FromQuery] string? sig,
        CancellationToken ct)
    {
        // 1. Autorização por assinatura (não por JWT). Inválida/expirada → 403, sem tocar no banco.
        if (!signer.Validate(contentId, index, exp, sig))
        {
            logger.LogWarning("Mídia pública RECUSADA (assinatura inválida/expirada): content={Id} idx={Idx}.",
                contentId, index);
            return Forbid();
        }

        // 2. Lê o ImageUrl do slide IGNORANDO o filtro de tenant (a Meta é anônima; a posse já foi
        // provada pela assinatura HMAC, que só o publish do tenant dono consegue gerar).
        var imageUrl = await db.ContentSlides.IgnoreQueryFilters().AsNoTracking()
            .Where(s => s.ContentId == contentId && s.Index == index)
            .Select(s => s.ImageUrl)
            .FirstOrDefaultAsync(ct);

        if (string.IsNullOrEmpty(imageUrl)) return NotFound();

        // 3. Esta rota só serve imagem EMBUTIDA (base64/data-url). Referência minio: ou http já têm
        // URL própria — não passam por aqui. Evita servir o que não é nosso por esta superfície.
        byte[] sourceBytes;
        try
        {
            sourceBytes = DecodeInline(imageUrl);
        }
        catch
        {
            return NotFound(); // não é base64 inline (minio:/http) — nada a servir aqui.
        }

        // 4. Converte p/ JPEG (a Graph API exige JPEG) e streama. Mesma conversão do MediaService,
        // mas sem MinIO no caminho — bytes direto na resposta.
        using var image = Image.Load(sourceBytes);
        var outStream = new MemoryStream();
        await image.SaveAsync(outStream, new JpegEncoder { Quality = 90 }, ct);
        outStream.Position = 0;

        // Cache curto: a URL é assinada e temporária; permite a Meta re-baixar dentro da janela.
        Response.Headers.CacheControl = "private, max-age=300";
        return File(outStream, "image/jpeg");
    }

    /// <summary>Decodifica data-url (<c>data:image/png;base64,...</c>) ou base64 puro → bytes.
    /// Lança se não for base64 (sinal de que é minio:/http e não pertence a esta rota).</summary>
    private static byte[] DecodeInline(string source)
    {
        if (source.StartsWith("minio:", StringComparison.Ordinal)
            || source.StartsWith("http", StringComparison.Ordinal))
            throw new FormatException("não é imagem inline");

        if (source.StartsWith("data:", StringComparison.Ordinal))
        {
            var comma = source.IndexOf(',');
            return Convert.FromBase64String(source[(comma + 1)..]);
        }
        return Convert.FromBase64String(source);
    }
}
