using System.Globalization;
using System.Text.RegularExpressions;

namespace SocialAi.Worker.Publishing;

/// <summary>
/// F6/E1: fonte ÚNICA da versão da Graph API (antes hardcoded em 3 lugares: Publishers,
/// IgTokenRefreshJob, MetricsCollectorJob). A Meta versiona ~trimestralmente e mantém cada versão
/// por ≥2 anos (doc oficial: developers.facebook.com/docs/graph-api/guides/versioning) — quando a
/// versão configurada fica para trás, o publish quebra SEM aviso. Aqui a versão vem de config
/// (`Instagram:GraphVersion`, default v22.0 = comportamento atual) e emitimos TELEMETRIA de versão
/// obsoleta no boot: se a configurada &lt; piso conhecido (`Instagram:GraphMinVersion`, default v22),
/// loga um aviso acionável em vez de falhar em runtime silenciosamente.
///
/// Determinístico, sem rede: só resolve a string da versão e a base URL. NÃO chama a Meta.
/// </summary>
public sealed class GraphApiConfig
{
    private static readonly Regex VersionPattern = new(@"^v(\d+)\.(\d+)$", RegexOptions.Compiled);

    /// <summary>Versão efetiva (ex.: "v22.0"). Validada no construtor (formato vX.Y); inválida → default.</summary>
    public string Version { get; }

    /// <summary>Base URL versionada (ex.: "https://graph.instagram.com/v22.0"). Usada por todas as chamadas.</summary>
    public string BaseUrl => $"https://graph.instagram.com/{Version}";

    public GraphApiConfig(IConfiguration cfg, ILogger<GraphApiConfig> logger)
    {
        const string DefaultVersion = "v22.0";   // preserva o comportamento atual (não-regressão)
        const string DefaultMinVersion = "v22";  // piso de obsolescência (aviso se a config ficar atrás)

        var configured = (cfg["Instagram:GraphVersion"] ?? "").Trim();
        if (configured.Length == 0)
        {
            Version = DefaultVersion;
        }
        else if (VersionPattern.IsMatch(configured))
        {
            Version = configured;
        }
        else
        {
            logger.LogWarning(
                "[Graph] Instagram:GraphVersion inválida ('{Cfg}', esperado formato vX.Y). Usando default {Default}.",
                configured, DefaultVersion);
            Version = DefaultVersion;
        }

        // E1: telemetria de versão obsoleta — avisa (não quebra) se a versão efetiva está abaixo do
        // piso conhecido. Operável: o cliente vê no log que precisa migrar antes de a Meta expirar.
        var minMajor = ParseMajor(cfg["Instagram:GraphMinVersion"]) ?? ParseMajor(DefaultMinVersion) ?? 22;
        var currentMajor = ParseMajor(Version) ?? 0;
        if (currentMajor < minMajor)
        {
            logger.LogWarning(
                "[Graph] Versão da Graph API ({Version}) abaixo do piso recomendado (v{Min}). " +
                "A Meta expira versões antigas (~2 anos); migre via Instagram:GraphVersion antes que o publish quebre.",
                Version, minMajor);
        }
        else
        {
            logger.LogInformation("[Graph] Graph API {Version} (de config).", Version);
        }
    }

    /// <summary>Major de "vX.Y" ou "vX" → X. Null se não casar (input inválido/ausente).</summary>
    private static int? ParseMajor(string? v)
    {
        if (string.IsNullOrWhiteSpace(v)) return null;
        var t = v.Trim().TrimStart('v', 'V');
        var dot = t.IndexOf('.');
        if (dot >= 0) t = t[..dot];
        return int.TryParse(t, NumberStyles.Integer, CultureInfo.InvariantCulture, out var m) ? m : null;
    }
}
