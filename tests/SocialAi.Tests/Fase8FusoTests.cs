using SocialAi.Api.Features.Settings;
using Xunit;

namespace SocialAi.Tests;

/// <summary>
/// FASE 8 / A5 (ADR-0010) — conversão de fuso na borda. O invariante: a hora de PAREDE local
/// que o operador digita vira o instante UTC correto (ScheduledFor é sempre UTC). O teste-âncora
/// do ADR: 09:00 no fuso −03:00 (America/Sao_Paulo) → 12:00Z.
/// </summary>
public class Fase8FusoTests
{
    [Fact]
    public void ToUtc_0900_local_Sao_Paulo_vira_1200Z()
    {
        // 09:00 hora de parede, sem fuso embutido (Kind=Unspecified).
        var local = new DateTime(2026, 6, 20, 9, 0, 0, DateTimeKind.Unspecified);

        var utc = TimeZoneConversion.ToUtc(local, "America/Sao_Paulo");

        // America/Sao_Paulo em junho = −03:00 (sem horário de verão desde 2019) → 12:00Z.
        Assert.Equal(new DateTimeOffset(2026, 6, 20, 12, 0, 0, TimeSpan.Zero), utc);
        Assert.Equal(TimeSpan.Zero, utc.Offset); // o instante persistido é UTC puro
    }

    [Fact]
    public void ToLocal_inverte_ToUtc_roundtrip()
    {
        var local = new DateTime(2026, 6, 20, 9, 0, 0, DateTimeKind.Unspecified);
        var utc = TimeZoneConversion.ToUtc(local, "America/Sao_Paulo");

        var backToLocal = TimeZoneConversion.ToLocal(utc, "America/Sao_Paulo");

        Assert.Equal(local, backToLocal); // ida-e-volta preserva a hora de parede
    }

    [Theory]
    [InlineData("America/Sao_Paulo", true)]
    [InlineData("UTC", true)]
    [InlineData("Europe/Lisbon", true)]
    [InlineData("Fuso/Inexistente", false)]
    [InlineData("", false)]
    public void IsValid_distingue_fuso_IANA_valido(string id, bool esperado)
    {
        Assert.Equal(esperado, TimeZoneConversion.IsValid(id));
    }
}
