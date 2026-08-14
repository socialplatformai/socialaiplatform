using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Domain;
using Xunit;

namespace SocialAi.Tests;

// F4/C1 (ADR-0014) — máquina de estado de ContentStatus: transições válidas passam, inválidas
// são rejeitadas (gate §6: "transições inválidas rejeitadas por teste").
public class ContentStatusMachineTests
{
    [Theory]
    // Caminho feliz do ciclo de vida (verificado nos fluxos reais).
    [InlineData(ContentStatus.Generating, ContentStatus.Draft)]
    [InlineData(ContentStatus.Generating, ContentStatus.Failed)]
    [InlineData(ContentStatus.Draft, ContentStatus.PendingApproval)]
    [InlineData(ContentStatus.Draft, ContentStatus.Approved)]
    [InlineData(ContentStatus.Draft, ContentStatus.Rejected)]
    [InlineData(ContentStatus.Draft, ContentStatus.Scheduled)]
    [InlineData(ContentStatus.PendingApproval, ContentStatus.Approved)]
    [InlineData(ContentStatus.PendingApproval, ContentStatus.Rejected)]
    [InlineData(ContentStatus.Approved, ContentStatus.Scheduled)]
    [InlineData(ContentStatus.Approved, ContentStatus.Published)]
    [InlineData(ContentStatus.Approved, ContentStatus.Failed)]
    [InlineData(ContentStatus.Scheduled, ContentStatus.Approved)]   // desagendar
    [InlineData(ContentStatus.Scheduled, ContentStatus.Published)]
    [InlineData(ContentStatus.Scheduled, ContentStatus.Failed)]
    [InlineData(ContentStatus.Failed, ContentStatus.Approved)]      // re-tentativa de publish
    public void TransicoesValidas_SaoPermitidas(ContentStatus from, ContentStatus to)
    {
        Assert.True(ContentStatusMachine.CanTransition(from, to));
        var c = new Content { Status = from };
        c.TransitionTo(to); // não lança
        Assert.Equal(to, c.Status);
    }

    [Theory]
    // Transições que NÃO podem acontecer (regressões/saltos).
    [InlineData(ContentStatus.Published, ContentStatus.Draft)]      // publicado não volta
    [InlineData(ContentStatus.Published, ContentStatus.Approved)]
    [InlineData(ContentStatus.Rejected, ContentStatus.Approved)]    // rejeitado é terminal (regen cria novo)
    [InlineData(ContentStatus.Draft, ContentStatus.Published)]      // não pula a aprovação/agendamento
    [InlineData(ContentStatus.Generating, ContentStatus.Published)]
    [InlineData(ContentStatus.Generating, ContentStatus.Approved)]
    [InlineData(ContentStatus.Scheduled, ContentStatus.Draft)]
    [InlineData(ContentStatus.EphemeralPublished, ContentStatus.Approved)]
    public void TransicoesInvalidas_SaoRejeitadas(ContentStatus from, ContentStatus to)
    {
        Assert.False(ContentStatusMachine.CanTransition(from, to));
        var c = new Content { Status = from };
        var ex = Assert.Throws<InvalidContentTransitionException>(() => c.TransitionTo(to));
        Assert.Equal(from, ex.From);
        Assert.Equal(to, ex.To);
        Assert.Equal(from, c.Status); // status NÃO mudou
    }

    [Theory]
    [InlineData(ContentStatus.Published)]
    [InlineData(ContentStatus.Draft)]
    [InlineData(ContentStatus.Approved)]
    public void MesmoEstado_EhNoOpIdempotente(ContentStatus s)
    {
        Assert.True(ContentStatusMachine.CanTransition(s, s));
        var c = new Content { Status = s };
        c.TransitionTo(s); // no-op, não lança
        Assert.Equal(s, c.Status);
    }
}
