using Minio;
using Minio.DataModel.Args;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;

namespace SocialAi.Worker.Publishing;

/// <summary>
/// Prepara mídia para a Graph API: converte PNG/data-url → JPEG e sobe no MinIO, devolvendo
/// uma URL PRESIGNED de leitura (TTL curto), em vez de deixar o bucket público (D3/S-19).
/// A Graph API só aceita JPEG via URL HTTP que ela mesma baixa (não upload binário, AM-5/R-6);
/// presign atende isso sem expor o bucket inteiro — a URL é assinada, temporária e por-objeto.
/// </summary>
public class MediaService(IConfiguration cfg, ILogger<MediaService> logger)
{
    private readonly string _endpoint = cfg["Minio:Endpoint"] ?? "minio:9000";
    private readonly string _accessKey = cfg["Minio:AccessKey"] ?? "minioadmin";
    private readonly string _secretKey = cfg["Minio:SecretKey"] ?? "minioadmin";
    private readonly string _bucket = cfg["Minio:Bucket"] ?? "media";
    private readonly string _publicBase = cfg["Minio:PublicBaseUrl"] ?? "";

    // TTL da URL presigned. Curto por segurança (a URL assinada vaza menos que um bucket público),
    // mas longo o bastante para a Meta baixar a imagem durante o publish.
    // RISCO (S-06 ↔ S-19): a Meta precisa baixar a imagem DENTRO desta janela; se o publish
    // demorar (polling de container etc.) e estourar 1h, o download falha com 403. 1h é a folga
    // padrão; revisar se aparecerem falhas de download por expiração.
    private static readonly TimeSpan PresignTtl = TimeSpan.FromHours(1);
    private static int PresignTtlSeconds => (int)PresignTtl.TotalSeconds;

    // Client de OPERAÇÕES (bucket/put): fala com o endpoint interno do MinIO (rede Docker).
    private IMinioClient OpsClient() => new MinioClient()
        .WithEndpoint(_endpoint)
        .WithCredentials(_accessKey, _secretKey)
        .WithSSL(false)
        .Build();

    /// <summary>
    /// Client de PRESIGN. A assinatura presigned é calculada sobre o host/porta/esquema do
    /// endpoint configurado no client — então a URL gerada aponta para o host desse client.
    /// Em prod, Minio:PublicBaseUrl DEVE ser o host público alcançável pela internet (a Meta
    /// baixa de lá). Quando definido, presignamos sobre ele; senão caímos no endpoint interno
    /// (útil só em dev, onde a Meta não entra — modo mock). Mudar o host quebra a assinatura,
    /// por isso o presign tem que ser feito já com o host final.
    /// </summary>
    private IMinioClient PresignClient()
    {
        if (string.IsNullOrEmpty(_publicBase))
            return OpsClient();

        // Parseia PublicBaseUrl em host[:porta] + SSL. O SDK do MinIO quer endpoint sem esquema.
        var uri = new Uri(_publicBase);
        var host = uri.IsDefaultPort ? uri.Host : $"{uri.Host}:{uri.Port}";
        var useSsl = uri.Scheme == Uri.UriSchemeHttps;
        return new MinioClient()
            .WithEndpoint(host)
            .WithCredentials(_accessKey, _secretKey)
            .WithSSL(useSsl)
            .Build();
    }

    /// <summary>
    /// Recebe data-url ou bytes PNG, devolve URL PRESIGNED (GET, TTL curto) de um JPEG no MinIO.
    /// O presign é gerado no momento do publish — a expiração começa a contar agora.
    /// </summary>
    public async Task<string> ToPublicJpegUrlAsync(string source, string objectName, CancellationToken ct = default)
    {
        var bytes = DecodeSource(source);

        // PNG/qualquer → JPEG (a Graph API exige JPEG; a conversão segue valendo com destino real).
        using var image = Image.Load(bytes);
        using var jpegStream = new MemoryStream();
        await image.SaveAsync(jpegStream, new JpegEncoder { Quality = 90 }, ct);
        jpegStream.Position = 0;

        var ops = OpsClient();
        await EnsureBucketAsync(ops, ct);

        var key = $"{objectName}.jpg";
        await ops.PutObjectAsync(new PutObjectArgs()
            .WithBucket(_bucket)
            .WithObject(key)
            .WithStreamData(jpegStream)
            .WithObjectSize(jpegStream.Length)
            .WithContentType("image/jpeg"), ct);

        // Presigned GET sobre o host público (sem expor o bucket). PresignedGetObjectAsync é async
        // e devolve a URL assinada como string.
        var presign = PresignClient();
        var url = await presign.PresignedGetObjectAsync(new PresignedGetObjectArgs()
            .WithBucket(_bucket)
            .WithObject(key)
            .WithExpiry(PresignTtlSeconds));

        logger.LogInformation("Mídia publicada (URL presigned, TTL {Ttl}min): {Key}",
            PresignTtl.TotalMinutes, key);
        return url;
    }

    // ── Imagem de slide (MinIO): store ESTÁVEL de imagem de slide (referência minio:{key}, não presign) ──
    // O publish acima é efêmero (presign curto, a Meta baixa na hora). Aqui guardamos a imagem
    // PERSISTIDA da geração e devolvemos uma referência que o proxy/publish resolvem fresco.
    public const string RefScheme = "minio:";

    /// <summary>Sobe o JPEG e devolve a referência estável <c>minio:slides/{key}.jpg</c> (não presign).</summary>
    public async Task<string> StoreStableAsync(string source, string objectName, CancellationToken ct = default)
    {
        var bytes = DecodeSource(source);
        using var image = Image.Load(bytes);
        using var jpegStream = new MemoryStream();
        await image.SaveAsync(jpegStream, new JpegEncoder { Quality = 88 }, ct);
        jpegStream.Position = 0;

        var key = $"slides/{objectName}.jpg";
        var ops = OpsClient();
        await EnsureBucketAsync(ops, ct);
        await ops.PutObjectAsync(new PutObjectArgs()
            .WithBucket(_bucket).WithObject(key)
            .WithStreamData(jpegStream).WithObjectSize(jpegStream.Length)
            .WithContentType("image/jpeg"), ct);

        logger.LogInformation("Slide materializado no MinIO (ref estável): {Key}", key);
        return $"{RefScheme}{key}";
    }

    /// <summary>Resolve <c>minio:{key}</c> → URL presigned fresca (p/ o publish baixar). Outros valores
    /// (data-url/http legado) passam verbatim.</summary>
    public async Task<string> ResolveForPublishAsync(string imageUrl, CancellationToken ct = default)
    {
        if (!imageUrl.StartsWith(RefScheme)) return imageUrl;
        var key = imageUrl[RefScheme.Length..];
        var presign = PresignClient();
        return await presign.PresignedGetObjectAsync(new PresignedGetObjectArgs()
            .WithBucket(_bucket).WithObject(key).WithExpiry(PresignTtlSeconds));
    }

    private static byte[] DecodeSource(string source)
    {
        if (source.StartsWith("data:"))
        {
            var comma = source.IndexOf(',');
            return Convert.FromBase64String(source[(comma + 1)..]);
        }
        // bytes em base64 puro
        return Convert.FromBase64String(source);
    }

    private async Task EnsureBucketAsync(IMinioClient client, CancellationToken ct)
    {
        var exists = await client.BucketExistsAsync(new BucketExistsArgs().WithBucket(_bucket), ct);
        if (!exists)
        {
            await client.MakeBucketAsync(new MakeBucketArgs().WithBucket(_bucket), ct);
            // D3/S-19: NÃO setamos mais policy de leitura pública. O acesso à mídia é por URL
            // presigned temporária (ToPublicJpegUrlAsync) — o bucket permanece privado.
        }
    }
}
