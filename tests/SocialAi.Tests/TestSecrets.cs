using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Tests;

/// <summary>
/// Helper de teste: constrói um SecretProtector real (AES-GCM) em modo Development, com uma
/// chave de cifra forte e fixa. Round-trip Encrypt/Decrypt funciona — é o mesmo protector que
/// os controllers usam (B/ADR-0008). Centralizado aqui para os testes de IA/secrets reusarem.
/// </summary>
public static class TestSecrets
{
    private sealed class FakeEnv : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Development;
        public string ApplicationName { get; set; } = "tests";
        public string ContentRootPath { get; set; } = ".";
        public IFileProvider ContentRootFileProvider { get; set; } = null!;
    }

    public static SecretProtector Protector()
    {
        var cfg = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Secrets:EncryptionKey"] = "chave-de-cifra-forte-para-teste-com-mais-de-32-bytes-aqui",
            })
            .Build();
        return new SecretProtector(cfg, new FakeEnv());
    }
}
