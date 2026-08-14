using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace SocialAi.Api.Infrastructure;

/// <summary>
/// Assina/valida URLs PÚBLICAS e TEMPORÁRIAS de imagem de slide — o equivalente "self-hosted"
/// ao presigned do S3/MinIO, sem depender de storage externo. Usado quando NÃO há MinIO: a
/// própria API serve os bytes JPEG do slide (base64 no Postgres) por uma rota anônima, mas só
/// para quem traz uma assinatura HMAC válida e não expirada.
///
/// POR QUE existe: a Graph API da Meta BAIXA a imagem de uma URL HTTP pública (não faz upload nem
/// manda JWT). Sem MinIO, a única superfície pública que temos é a própria API. Esta classe torna
/// a rota pública segura: o token é HMAC-SHA256 sobre (contentId|index|exp), então não é
/// enumerável nem forjável, e expira. Mesma filosofia do presign (assinado, temporário, por-objeto).
///
/// STATELESS: nada no banco. A assinatura carrega tudo (content, índice do slide, expiração) e é
/// verificável só com a chave derivada de Secrets:EncryptionKey — a MESMA fonte do SecretProtector,
/// compartilhada entre API e worker (que assina a URL no publish; a API a valida na entrega).
/// Chave de assinatura é DERIVADA (HMAC com rótulo distinto), não a chave de cifra crua — separar
/// domínios criptográficos evita reuso da mesma chave para fins diferentes.
/// </summary>
public sealed class MediaUrlSigner
{
    private readonly byte[] _signingKey;

    // Janela de validade da URL assinada. Folga p/ a Meta processar o container e baixar a mídia
    // (polling de container pode levar dezenas de segundos); curto o bastante p/ uma URL vazada
    // morrer rápido. Espelha a folga do presign do MediaService (1h).
    private static readonly TimeSpan Ttl = TimeSpan.FromHours(1);

    public MediaUrlSigner(IConfiguration cfg, IHostEnvironment env)
    {
        // Mesma fonte do SecretProtector: Secrets:EncryptionKey (em Production é mandatório; o boot
        // já recusa subir sem ela). Em Development cai p/ Jwt:Secret/literal de dev por conveniência.
        var configured = cfg["Secrets:EncryptionKey"];
        var effective = env.IsProduction()
            ? configured
            : configured ?? cfg["Jwt:Secret"] ?? "dev-insecure-secret-change-me-min-32-bytes!!";

        if (string.IsNullOrWhiteSpace(effective))
            throw new InvalidOperationException(
                "Secrets:EncryptionKey ausente em Production. Defina SECRETS_ENCRYPTION_KEY.");

        // Deriva uma chave de ASSINATURA distinta da chave de cifra (rótulo no material), para não
        // reusar a mesma chave em dois domínios criptográficos (cifra AES-GCM vs HMAC de URL).
        _signingKey = SHA256.HashData(Encoding.UTF8.GetBytes("media-url-sign|" + effective));
    }

    /// <summary>
    /// Gera o caminho relativo assinado da imagem de um slide:
    /// <c>/public/media/{contentId}/{index}.jpg?exp={unix}&amp;sig={base64url}</c>.
    /// Prefixe com a base pública da API (Api:PublicBaseUrl) para a URL absoluta que vai à Meta.
    /// </summary>
    public string SignSlidePath(Guid contentId, int index, DateTimeOffset? now = null)
    {
        var exp = ((now ?? DateTimeOffset.UtcNow) + Ttl).ToUnixTimeSeconds();
        var sig = Compute(contentId, index, exp);
        return $"/public/media/{contentId}/{index}.jpg?exp={exp}&sig={sig}";
    }

    /// <summary>
    /// Valida a assinatura e a expiração de um pedido à rota pública. TRUE só quando a assinatura
    /// confere (comparação em tempo constante) E exp ainda não passou. Não toca no banco.
    /// </summary>
    public bool Validate(Guid contentId, int index, long exp, string? sig, DateTimeOffset? now = null)
    {
        if (string.IsNullOrEmpty(sig)) return false;
        if ((now ?? DateTimeOffset.UtcNow).ToUnixTimeSeconds() > exp) return false; // expirada

        var expected = Compute(contentId, index, exp);
        // Comparação em tempo constante: evita timing-oracle na verificação do HMAC.
        return CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(expected), Encoding.ASCII.GetBytes(sig));
    }

    private string Compute(Guid contentId, int index, long exp)
    {
        var payload = $"{contentId:N}|{index}|{exp}";
        var mac = HMACSHA256.HashData(_signingKey, Encoding.UTF8.GetBytes(payload));
        return Base64Url(mac);
    }

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
