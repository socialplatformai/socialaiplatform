using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using SocialAi.Api.Infrastructure;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// S-30 / A2 — fail-fast de segredo. Em Production o SecretProtector NÃO pode cair em
/// fallback inseguro: sem Secrets:EncryptionKey, ele recusa ser construído. Em Development
/// o fallback de conveniência é permitido. (O boot do Program.cs reforça isso no startup.)
/// </summary>
public class SecretFailFastTests
{
    private static IConfiguration Cfg(params (string key, string? val)[] pairs) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(pairs.Select(p => new KeyValuePair<string, string?>(p.key, p.val)))
            .Build();

    private sealed class FakeEnv(string name) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;
        public string ApplicationName { get; set; } = "tests";
        public string ContentRootPath { get; set; } = ".";
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = null!;
    }

    [Fact]
    public void Production_sem_EncryptionKey_recusa_construir()
    {
        var cfg = Cfg(("Jwt:Secret", "qualquer-coisa")); // sem Secrets:EncryptionKey
        Assert.Throws<InvalidOperationException>(() => new SecretProtector(cfg, new FakeEnv(Environments.Production)));
    }

    [Fact]
    public void Production_com_EncryptionKey_constroi_e_faz_round_trip()
    {
        var cfg = Cfg(("Secrets:EncryptionKey", "chave-de-cifra-forte-para-teste-com-mais-de-32-bytes-aqui"));
        var protector = new SecretProtector(cfg, new FakeEnv(Environments.Production));
        var original = "token-secreto-do-instagram";
        var cifrado = protector.Encrypt(original);
        Assert.NotEqual(original, cifrado);
        Assert.Equal(original, protector.Decrypt(cifrado)); // decifra de volta (worker reusa a mesma chave)
    }

    [Fact]
    public void Development_sem_EncryptionKey_usa_fallback_de_conveniencia()
    {
        var cfg = Cfg(("Jwt:Secret", "dev-jwt-secret-suficientemente-grande-32b"));
        // Não lança em Development (fallback Jwt:Secret → literal dev).
        var protector = new SecretProtector(cfg, new FakeEnv(Environments.Development));
        var cifrado = protector.Encrypt("x");
        Assert.Equal("x", protector.Decrypt(cifrado));
    }
}
