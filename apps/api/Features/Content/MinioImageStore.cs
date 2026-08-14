using Minio;
using Minio.DataModel.Args;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;
using SocialAi.Api.Generation;

namespace SocialAi.Api.Features.Content;

/// <summary>
/// Imagem de slide (MinIO): materializa a imagem de slide (base64 da geração) no MinIO e devolve uma
/// REFERÊNCIA ESTÁVEL <c>minio:{key}</c> — não uma URL presigned (que expiraria; o editor reabre a
/// peça depois). O proxy (<see cref="ContentSlideImageController"/>) resolve a referência presignando
/// FRESCO a cada request, então a URL nunca morre. O DTO de /content/{id} reescreve <c>minio:{key}</c>
/// → URL absoluta do proxy (<see cref="ToProxyUrl"/>), deixando o JSON leve (URL curta, não 10MB).
///
/// Degraded-mode (first-class): registrado SÓ quando há config de MinIO. Sem MinIO (dev), o
/// GenerationCompletionService recebe ISlideImageStore=null e mantém o base64 — honesto, sem regressão.
/// Espelha o MediaService do worker (bucket privado; presign curto), mas para imagens PERSISTIDAS,
/// não efêmeras de publish.
/// </summary>
public sealed class MinioImageStore(IConfiguration cfg, ILogger<MinioImageStore> logger) : ISlideImageStore
{
    private const string Scheme = "minio:";
    private readonly string _endpoint = cfg["Minio:Endpoint"] ?? "minio:9000";
    private readonly string _accessKey = cfg["Minio:AccessKey"] ?? "minioadmin";
    private readonly string _secretKey = cfg["Minio:SecretKey"] ?? "minioadmin";
    private readonly string _bucket = cfg["Minio:Bucket"] ?? "media";
    private readonly string _publicBase = cfg["Minio:PublicBaseUrl"] ?? "";
    // Base pública da PRÓPRIA API (p/ montar a URL absoluta do proxy no DTO). Vazio → relativo
    // (mesma origem; o web prepende sua BASE). Em prod, setar p/ a API alcançável pelo browser.
    private readonly string _apiBase = (cfg["Api:PublicBaseUrl"] ?? "").TrimEnd('/');

    // TTL do presign servido pelo proxy: curto (o browser baixa na hora). Fresco a cada request.
    private static readonly TimeSpan PresignTtl = TimeSpan.FromMinutes(15);

    /// <summary>Há config de MinIO suficiente p/ ligar o store? (decide o registro no Program.cs).</summary>
    public static bool IsConfigured(IConfiguration cfg) =>
        !string.IsNullOrWhiteSpace(cfg["Minio:Endpoint"]) || !string.IsNullOrWhiteSpace(cfg["Minio:PublicBaseUrl"]);

    private IMinioClient OpsClient() => new MinioClient()
        .WithEndpoint(_endpoint).WithCredentials(_accessKey, _secretKey).WithSSL(false).Build();

    private IMinioClient PresignClient()
    {
        if (string.IsNullOrWhiteSpace(_publicBase))
            return new MinioClient().WithEndpoint(_endpoint).WithCredentials(_accessKey, _secretKey).WithSSL(false).Build();
        var uri = new Uri(_publicBase);
        return new MinioClient()
            .WithEndpoint(uri.Host, uri.Port > 0 ? uri.Port : (uri.Scheme == "https" ? 443 : 80))
            .WithCredentials(_accessKey, _secretKey)
            .WithSSL(uri.Scheme == "https")
            .Build();
    }

    /// <inheritdoc/>
    public async Task<string?> StoreAsync(string? source, string objectKey, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(source)) return null;
        // Idempotente: já-referência (minio:) ou já-URL → não re-sobe.
        if (source.StartsWith(Scheme) || source.StartsWith("http")) return source;

        try
        {
            var bytes = DecodeSource(source);
            using var image = Image.Load(bytes);
            using var jpeg = new MemoryStream();
            await image.SaveAsync(jpeg, new JpegEncoder { Quality = 88 }, ct);
            jpeg.Position = 0;

            var key = $"slides/{objectKey}.jpg";
            var ops = OpsClient();
            await EnsureBucketAsync(ops, ct);
            await ops.PutObjectAsync(new PutObjectArgs()
                .WithBucket(_bucket).WithObject(key)
                .WithStreamData(jpeg).WithObjectSize(jpeg.Length)
                .WithContentType("image/jpeg"), ct);

            logger.LogInformation("Slide materializado no MinIO: {Key}", key);
            return $"{Scheme}{key}"; // referência estável (resolvida no proxy/DTO)
        }
        catch (Exception ex)
        {
            // Degrada honesto: falha de upload NÃO perde a imagem — mantém o base64 original.
            logger.LogWarning(ex, "Falha ao materializar slide no MinIO; mantendo base64 inline.");
            return source;
        }
    }

    /// <summary>É uma referência <c>minio:</c>? (DTO/proxy decidem como tratar).</summary>
    public static bool IsRef(string? value) => value is not null && value.StartsWith(Scheme);

    /// <summary>Extrai a object-key de uma referência <c>minio:{key}</c> (null se não for ref).</summary>
    public static string? KeyOf(string? value) => IsRef(value) ? value![Scheme.Length..] : null;

    /// <summary>
    /// Reescreve <c>minio:{key}</c> → URL ABSOLUTA do proxy desta API. Outros valores (data-url/http
    /// de gerações antigas, ou base64 em degraded-mode) passam verbatim. É o ponto que deixa o DTO leve.
    /// O <paramref name="accessToken"/> (token da sessão atual) vai na query — <c>&lt;img&gt;</c>/CSS não
    /// mandam header Authorization (ver JwtBearerEvents em Program.cs). Null → URL sem token (degradado).
    /// </summary>
    public string? ToProxyUrl(Guid contentId, int index, string? imageUrl, string? accessToken = null)
    {
        if (!IsRef(imageUrl)) return imageUrl; // legado base64/http → inalterado (compat + degraded)
        return ProxyUrlOf(contentId, index, accessToken);
    }

    /// <summary>A URL ABSOLUTA do proxy deste slide (sem condição de ref): usada p/ reescrever a imagem
    /// DUPLICADA dentro do LayersJson (a imagem do layer É a mesma do slide). O token vai na query p/ o
    /// browser carregar o recurso (header Authorization não viaja em <c>&lt;img&gt;</c>/CSS).</summary>
    public string ProxyUrlOf(Guid contentId, int index, string? accessToken = null)
    {
        var url = $"{_apiBase}/api/content/{contentId}/slides/{index}/image";
        return string.IsNullOrEmpty(accessToken) ? url : $"{url}?access_token={Uri.EscapeDataString(accessToken)}";
    }

    /// <summary>É um valor de IMAGEM pesada (base64 inline ou ref minio:)? — distingue do texto puro
    /// que também vive em elements[].content (headline, body…). Usado p/ saber o que reescrever no layer.</summary>
    public static bool IsHeavyImage(string? value) =>
        value is not null && (value.StartsWith("data:image", StringComparison.OrdinalIgnoreCase) || value.StartsWith(Scheme));

    /// <summary>
    /// Imagem de slide (MinIO) — duplicata no layer: a imagem do slide é DUPLICADA dentro do LayersJson
    /// (<c>background.value</c> e/ou o elemento <c>role:background/image</c> em <c>elements[].content</c>) —
    /// o pipeline emite as duas cópias e o LayersJson é persistido verbatim (ADR-0014). O DTO já reescreve
    /// <c>slide.ImageUrl</c>; aqui reescrevemos a cópia DENTRO do layer p/ a MESMA URL do proxy, deixando
    /// o JSON leve sem perder a composição. Só toca strings que são IMAGEM (base64/minio:); texto passa
    /// intacto. Função pura sobre o JsonElement (não muta o persistido). Null/sem-imagem → devolve igual.
    /// </summary>
    public static System.Text.Json.JsonElement? RewriteLayersImages(System.Text.Json.JsonElement? layers, string proxyUrl)
    {
        if (layers is not { } root || root.ValueKind != System.Text.Json.JsonValueKind.Object) return layers;

        var node = System.Text.Json.Nodes.JsonNode.Parse(root.GetRawText());
        if (node is not System.Text.Json.Nodes.JsonObject obj) return layers;

        var changed = false;

        // background.value (quando o fundo é imagem inline/ref)
        if (obj["background"] is System.Text.Json.Nodes.JsonObject bg
            && bg["value"] is System.Text.Json.Nodes.JsonValue bv
            && bv.TryGetValue<string>(out var bgVal) && IsHeavyImage(bgVal))
        {
            bg["value"] = proxyUrl;
            changed = true;
        }

        // elements[].content — só os que são IMAGEM (role background/image); texto fica intacto.
        if (obj["elements"] is System.Text.Json.Nodes.JsonArray els)
            foreach (var el in els)
                if (el is System.Text.Json.Nodes.JsonObject eo
                    && eo["content"] is System.Text.Json.Nodes.JsonValue cv
                    && cv.TryGetValue<string>(out var content) && IsHeavyImage(content))
                {
                    eo["content"] = proxyUrl;
                    changed = true;
                }

        if (!changed) return layers; // nada pesado no layer → devolve o original (sem custo de re-parse)

        using var doc = System.Text.Json.JsonDocument.Parse(obj.ToJsonString());
        return doc.RootElement.Clone();
    }

    /// <summary>Presigna FRESCO a object-key p/ o proxy redirecionar (TTL curto, nunca expira no DB).</summary>
    public async Task<string> PresignAsync(string key, CancellationToken ct = default)
    {
        var presign = PresignClient();
        return await presign.PresignedGetObjectAsync(new PresignedGetObjectArgs()
            .WithBucket(_bucket).WithObject(key).WithExpiry((int)PresignTtl.TotalSeconds));
    }

    private static byte[] DecodeSource(string source)
    {
        if (source.StartsWith("data:"))
        {
            var comma = source.IndexOf(',');
            return Convert.FromBase64String(source[(comma + 1)..]);
        }
        return Convert.FromBase64String(source);
    }

    private async Task EnsureBucketAsync(IMinioClient client, CancellationToken ct)
    {
        var exists = await client.BucketExistsAsync(new BucketExistsArgs().WithBucket(_bucket), ct);
        if (!exists) await client.MakeBucketAsync(new MakeBucketArgs().WithBucket(_bucket), ct);
    }
}
