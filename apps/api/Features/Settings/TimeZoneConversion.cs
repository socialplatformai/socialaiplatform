namespace SocialAi.Api.Features.Settings;

/// <summary>
/// A5 (ADR-0010) — conversão de fuso local↔UTC na BORDA (API/UI), helper PURO e determinístico
/// (sem rede/DB), portanto testável isolado.
///
/// INVARIANTE: <c>ScheduledPost.ScheduledFor</c> permanece SEMPRE em UTC. O worker
/// (PublishSchedulerJob) compara <c>ScheduledFor &lt;= now</c> em UTC e NÃO muda — quem traduz
/// hora local do cliente ↔ instante UTC é esta classe, na borda, ao agendar/exibir.
///
/// .NET 8 fala IDs IANA via ICU tanto no Windows quanto no Linux, então "America/Sao_Paulo"
/// é válido nos dois — não usamos os IDs legados do Windows ("E. South America Standard Time").
/// </summary>
public static class TimeZoneConversion
{
    /// <summary>True se <paramref name="timeZoneId"/> é um fuso IANA resolvível neste runtime.</summary>
    public static bool IsValid(string timeZoneId)
    {
        if (string.IsNullOrWhiteSpace(timeZoneId)) return false;
        try
        {
            TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
            return true;
        }
        // IDs desconhecidos/corrompidos não devem derrubar a validação — viram "inválido".
        catch (TimeZoneNotFoundException) { return false; }
        catch (InvalidTimeZoneException) { return false; }
        catch { return false; }
    }

    /// <summary>
    /// Interpreta <paramref name="localNaive"/> (sem fuso, Kind=Unspecified) como hora LOCAL no
    /// fuso informado e devolve o instante correspondente em UTC. É o que persiste em ScheduledFor.
    /// </summary>
    public static DateTimeOffset ToUtc(DateTime localNaive, string timeZoneId)
    {
        var tz = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        // SpecifyKind(Unspecified) é obrigatório: ConvertTimeToUtc rejeita um DateTime já marcado
        // como Utc/Local — queremos tratá-lo como "parede" local do fuso de destino.
        var utc = TimeZoneInfo.ConvertTimeToUtc(
            DateTime.SpecifyKind(localNaive, DateTimeKind.Unspecified), tz);
        return new DateTimeOffset(utc, TimeSpan.Zero);
    }

    /// <summary>
    /// Converte um instante UTC para a hora de parede (local) do fuso — para EXIBIR ao operador.
    /// O .DateTime resultante vem com Kind=Unspecified (hora de parede, sem offset embutido).
    /// </summary>
    public static DateTime ToLocal(DateTimeOffset utc, string timeZoneId)
    {
        var tz = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        return TimeZoneInfo.ConvertTime(utc, tz).DateTime;
    }
}
