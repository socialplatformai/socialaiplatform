using SocialAi.Api.Domain;
using SocialAi.Worker.Jobs;
using Xunit;

namespace SocialAi.Tests;

// C3 — parse de métricas REAIS do /insights da Graph (MetricsCollectorJob.ParseInsights).
// O invariante-joia aqui: a plataforma só aprende com métrica real OU mock rotulado — nunca
// com uma métrica zerada disfarçada de real. Por isso payload sem métrica conhecida / inválido
// retorna null (o chamador cai no MockMetric, Source=Mock).
//
// WIRING (pendência p/ o orquestrador resolver no main): ParseInsights é `internal static` no
// assembly SocialAi.Worker, e SocialAi.Tests.csproj NÃO referencia o Worker (só apps/api/Api.csproj).
// Este arquivo assume o método alcançável. Solução mais barata recomendada: adicionar no Worker
//   [assembly: System.Runtime.CompilerServices.InternalsVisibleTo("SocialAi.Tests")]
// + um <ProjectReference> do Worker no csproj de teste. (Alternativa de mover o parser p/ Core é
// mais invasiva e desnecessária — o método já está bem isolado e é puro.)
public class Fase8MetricsTests
{
    // Content mínimo só com as chaves que o parser copia p/ a métrica (Workspace/Content).
    private static Content NewContent() => new()
    {
        Id = Guid.NewGuid(),
        WorkspaceId = Guid.NewGuid(),
        BrandId = Guid.NewGuid(),
        Type = ContentType.Post,
        Status = ContentStatus.Published,
    };

    [Fact]
    public void ParseInsights_parseia_reach_likes_saved()
    {
        var content = NewContent();
        var json = """
            {"data":[
              {"name":"reach","values":[{"value":1234}]},
              {"name":"likes","values":[{"value":56}]},
              {"name":"saved","values":[{"value":7}]}
            ]}
            """;

        var metric = MetricsCollectorJob.ParseInsights(json, content);

        Assert.NotNull(metric);
        Assert.Equal(1234, metric!.Reach);
        Assert.Equal(56, metric.Likes);
        Assert.Equal(7, metric.Saves);
        Assert.Equal(63, metric.Engagement); // Engagement = Likes + Saves (D6).
        Assert.Equal(MetricSource.Real, metric.Source);
        Assert.Equal(content.Id, metric.ContentId);
        Assert.Equal(content.WorkspaceId, metric.WorkspaceId);
    }

    [Fact]
    public void ParseInsights_parseia_total_value()
    {
        var content = NewContent();
        // Formato agregado v22+: total_value.value em vez de values[].value.
        var json = """{"data":[{"name":"reach","total_value":{"value":999}}]}""";

        var metric = MetricsCollectorJob.ParseInsights(json, content);

        Assert.NotNull(metric);
        Assert.Equal(999, metric!.Reach);
        Assert.Equal(0, metric.Likes);
        Assert.Equal(0, metric.Saves);
        Assert.Equal(0, metric.Engagement);
        Assert.Equal(MetricSource.Real, metric.Source);
    }

    [Fact]
    public void ParseInsights_payload_sem_metricas_conhecidas_retorna_null()
    {
        // profile_visits não é reconhecida → null (não inventa zero; cairia no mock rotulado).
        var json = """{"data":[{"name":"profile_visits","values":[{"value":10}]}]}""";

        var metric = MetricsCollectorJob.ParseInsights(json, NewContent());

        Assert.Null(metric);
    }

    [Theory]
    [InlineData("{}")]            // sem data[]
    [InlineData("não-é-json")]    // JSON inválido (defensivo: Meta versiona a Graph).
    public void ParseInsights_payload_invalido_retorna_null(string json)
    {
        var metric = MetricsCollectorJob.ParseInsights(json, NewContent());

        Assert.Null(metric);
    }

    // C3 (rótulo mock): MockMetric é `private static` no MetricsCollectorJob — NÃO é acessível
    // sem refletir/expandir visibilidade, e o briefing manda não forçar acesso a private. PULADO
    // e declarado: o rótulo Source=Mock está provado por inspeção no código (linha `Source =
    // MetricSource.Mock` em MockMetric). Se o orquestrador quiser cobertura, basta promover
    // MockMetric a `internal static` (mesmo InternalsVisibleTo já cobriria).
}
