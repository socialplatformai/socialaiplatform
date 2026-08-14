using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;

namespace SocialAi.Api.Infrastructure;

/// <summary>
/// Cifra/decifra segredos em repouso (token IG, chaves). AES-GCM com chave derivada
/// do env (decisão dia-2: segredos via .env cifrado no host). R-9: token vazado = sequestro.
/// Formato persistido: base64(nonce | tag | ciphertext).
/// </summary>
public class SecretProtector
{
    private readonly byte[] _key;

    public SecretProtector(IConfiguration cfg, IHostEnvironment env)
    {
        // A2: a chave de cifra é Secrets:EncryptionKey. Em Production NÃO há fallback
        // para Jwt:Secret nem para o literal de dev — o boot (Program.cs) já recusa
        // subir sem uma chave forte, então aqui ela existe. Em Development mantemos o
        // fallback por conveniência (sem .env completo). Trocar a chave invalida
        // segredos já cifrados — definir SECRETS_ENCRYPTION_KEY antes do 1º deploy.
        var configured = cfg["Secrets:EncryptionKey"];
        var effective = env.IsProduction()
            ? configured
            : configured ?? cfg["Jwt:Secret"] ?? "dev-insecure-secret-change-me-min-32-bytes!!";

        if (string.IsNullOrWhiteSpace(effective))
            throw new InvalidOperationException(
                "Secrets:EncryptionKey ausente em Production. Defina SECRETS_ENCRYPTION_KEY.");

        _key = DeriveKey(effective);
    }

    private static byte[] DeriveKey(string secret)
    {
        // 32 bytes p/ AES-256 a partir do segredo do env.
        return SHA256.HashData(Encoding.UTF8.GetBytes(secret));
    }

    public string Encrypt(string plaintext)
    {
        var nonce = RandomNumberGenerator.GetBytes(AesGcm.NonceByteSizes.MaxSize);
        var plain = Encoding.UTF8.GetBytes(plaintext);
        var cipher = new byte[plain.Length];
        var tag = new byte[AesGcm.TagByteSizes.MaxSize];

        using var aes = new AesGcm(_key, AesGcm.TagByteSizes.MaxSize);
        aes.Encrypt(nonce, plain, cipher, tag);

        var combined = new byte[nonce.Length + tag.Length + cipher.Length];
        Buffer.BlockCopy(nonce, 0, combined, 0, nonce.Length);
        Buffer.BlockCopy(tag, 0, combined, nonce.Length, tag.Length);
        Buffer.BlockCopy(cipher, 0, combined, nonce.Length + tag.Length, cipher.Length);
        return Convert.ToBase64String(combined);
    }

    public string Decrypt(string protectedValue)
    {
        var combined = Convert.FromBase64String(protectedValue);
        var nonceLen = AesGcm.NonceByteSizes.MaxSize;
        var tagLen = AesGcm.TagByteSizes.MaxSize;

        var nonce = combined.AsSpan(0, nonceLen);
        var tag = combined.AsSpan(nonceLen, tagLen);
        var cipher = combined.AsSpan(nonceLen + tagLen);
        var plain = new byte[cipher.Length];

        using var aes = new AesGcm(_key, AesGcm.TagByteSizes.MaxSize);
        aes.Decrypt(nonce, cipher, tag, plain);
        return Encoding.UTF8.GetString(plain);
    }
}
