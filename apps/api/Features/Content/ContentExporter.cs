using System.IO.Compression;
using System.Text;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;

namespace SocialAi.Api.Features.Content;

/// <summary>
/// E11.5 (ADR-0006) — monta o ZIP de export de um conteúdo: imagens dos slides como
/// JPEG (slide-{index}.jpg) + legenda.txt (caption + CTA + hashtags). Usa BCL
/// (ZipArchive) e só o snippet de conversão do ImageSharp — NÃO o MediaService (que
/// depende de MinIO, ausente na API). Slides sem imagem são omitidos sem quebrar.
/// </summary>
public static class ContentExporter
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(15) };

    /// <param name="resolveRef">Imagem de slide (MinIO): resolve uma referência <c>minio:{key}</c> → URL presigned
    /// (a API injeta isto do MinioImageStore). Null/ausente → refs minio: são ignoradas (degradado).</param>
    public static async Task<byte[]> BuildZipAsync(
        Domain.Content content,
        Func<string, CancellationToken, Task<string>>? resolveRef = null,
        CancellationToken ct = default)
    {
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var slide in content.Slides.OrderBy(s => s.Index))
            {
                if (string.IsNullOrWhiteSpace(slide.ImageUrl)) continue; // sem imagem → omite
                // minio:{key} → presigned http (depois carrega como qualquer URL). Sem resolver → pula.
                var src = slide.ImageUrl!;
                if (MinioImageStore.IsRef(src))
                {
                    if (resolveRef is null) continue;
                    src = await resolveRef(MinioImageStore.KeyOf(src)!, ct);
                }
                byte[]? raw = await LoadImageBytesAsync(src, ct);
                if (raw is null || raw.Length == 0) continue;

                byte[] jpeg = ToJpeg(raw);
                var entry = zip.CreateEntry($"slide-{slide.Index}.jpg", CompressionLevel.Fastest);
                await using var es = entry.Open();
                await es.WriteAsync(jpeg, ct);
            }

            // legenda.txt — caption + CTA + hashtags (o que o operador cola ao postar à mão).
            var legenda = BuildCaption(content);
            var txt = zip.CreateEntry("legenda.txt", CompressionLevel.Fastest);
            await using (var ts = txt.Open())
            {
                var data = Encoding.UTF8.GetBytes(legenda);
                await ts.WriteAsync(data, ct);
            }
        }
        return ms.ToArray();
    }

    /// <summary>data-url (base64) ou URL http(s). Retorna null se não decodificável.</summary>
    private static async Task<byte[]?> LoadImageBytesAsync(string url, CancellationToken ct)
    {
        if (url.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            var comma = url.IndexOf(',');
            if (comma < 0) return null;
            var b64 = url[(comma + 1)..];
            try { return Convert.FromBase64String(b64); } catch (FormatException) { return null; }
        }
        if (url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
            url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            try { return await Http.GetByteArrayAsync(url, ct); }
            catch (HttpRequestException) { return null; }
            catch (TaskCanceledException) { return null; }
        }
        return null;
    }

    /// <summary>Converte qualquer formato suportado (PNG/JPEG/…) para JPEG q=90.
    /// Se já for JPEG, o re-encode é idempotente o bastante (custo aceitável no export).</summary>
    private static byte[] ToJpeg(byte[] raw)
    {
        using var image = Image.Load(raw);
        using var outMs = new MemoryStream();
        image.Save(outMs, new JpegEncoder { Quality = 90 });
        return outMs.ToArray();
    }

    public static string BuildCaption(Domain.Content content)
    {
        var sb = new StringBuilder();
        if (!string.IsNullOrWhiteSpace(content.Caption)) sb.AppendLine(content.Caption!.Trim());
        if (!string.IsNullOrWhiteSpace(content.Cta)) { sb.AppendLine(); sb.AppendLine(content.Cta!.Trim()); }
        if (!string.IsNullOrWhiteSpace(content.Hashtags)) { sb.AppendLine(); sb.AppendLine(content.Hashtags!.Trim()); }
        return sb.ToString();
    }
}
