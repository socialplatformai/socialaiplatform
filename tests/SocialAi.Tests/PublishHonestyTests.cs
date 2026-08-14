using SocialAi.Api.Domain;
using SocialAi.Worker.Jobs;
using SocialAi.Worker.Publishing;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace SocialAi.Tests;

// Publish honesto — a regra que impede a "falsa publicação": em modo 'graph', cair no Mock
// significa conta desconectada / token expirado, NÃO uma demo. O PublishJob deve RECUSAR (Failed
// honesto) em vez de marcar Published com um id fake do MockPublisher.
//
// Cobrimos: (1) a tabela-verdade da decisão pura IsUnintendedMockFallback; (2) a prova de POR QUE o
// fallback silencioso era perigoso — o MockPublisher retorna Success fake, que o loop usava para
// marcar Published. Antes do fix, modo graph + conta desconectada virava Published sem estar no IG.
public class PublishHonestyTests
{
    [Theory]
    // modo graph + caiu no Mock (conta desconectada) → fallback NÃO-intencional → recusa honesta.
    [InlineData("graph", PublisherKind.Mock, true)]
    // modo graph + Graph de verdade → publicação real, não é fallback.
    [InlineData("graph", PublisherKind.InstagramGraph, false)]
    // modo mock legítimo (demo) → a simulação é o comportamento desejado (badge "Simulado").
    [InlineData("mock", PublisherKind.Mock, false)]
    // modo mock + Graph (não acontece na prática, mas a regra é só sobre 'graph caiu no mock').
    [InlineData("mock", PublisherKind.InstagramGraph, false)]
    public void IsUnintendedMockFallback_DistingueDemoLegitima_De_ContaDesconectada(
        string mode, PublisherKind selected, bool esperado)
    {
        Assert.Equal(esperado, PublishJob.IsUnintendedMockFallback(mode, selected));
    }

    [Fact]
    public async Task ModoGraph_ContaDesconectada_NaoViraPublished()
    {
        // Prova a perigosidade do caminho antigo: o MockPublisher SEMPRE devolve Success fake.
        // Era esse Success que fazia o conteúdo virar Published sem estar no Instagram.
        var mock = new MockPublisher(NullLogger<MockPublisher>.Instance);
        var outcome = await mock.PublishAsync(
            new PublishRequest(ContentType.Post, "cap", new[] { "https://x/y.jpg" }, "ig", ""));
        Assert.True(outcome.Success);                 // mock mente "deu certo"…
        Assert.StartsWith("mock_", outcome.RemoteId); // …com um id fake.

        // Com o fix, esse Success NÃO é consumido em modo graph: a decisão recusa ANTES de publicar.
        // Em modo graph + Mock selecionado → recusa (Failed), o conteúdo nunca chega a Published.
        Assert.True(PublishJob.IsUnintendedMockFallback("graph", PublisherKind.Mock));

        // Em modo mock legítimo, o mesmo Success É consumido (demo) e o conteúdo pode virar Published
        // — mas sinalizado como "demonstração" no histórico (publisher == Mock).
        Assert.False(PublishJob.IsUnintendedMockFallback("mock", PublisherKind.Mock));
    }
}
