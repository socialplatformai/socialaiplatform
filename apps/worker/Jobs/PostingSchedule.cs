using SocialAi.Api.Domain;

namespace SocialAi.Worker.Jobs;

/// <summary>
/// Fase 2 (task 2.3/2.6) — LÓGICA PURA da agenda do robô, separada do BackgroundService p/ ser
/// testável sem DB/relógio. Parseia a agenda CSV do Workspace (dias 0=Dom..6=Sáb + horas HH:mm
/// LOCAIS) e responde "é hora de postar agora?" e "qual o próximo slot livre?".
///
/// TUDO em hora LOCAL do workspace (o chamador converte UTC↔local na borda, como o resto do sistema
/// — A5/ADR-0010). Funções puras, determinísticas, fail-safe (CSV inválido → ignora o token ruim).
/// </summary>
public static class PostingSchedule
{
    /// <summary>Dias válidos parseados do CSV (0=Dom..6=Sáb). Tokens fora de [0,6] ou não-numéricos
    /// são IGNORADOS (tolerante). Vazio → conjunto vazio (robô sem janela → não posta).</summary>
    public static HashSet<int> ParseDays(string? csv)
    {
        var set = new HashSet<int>();
        if (string.IsNullOrWhiteSpace(csv)) return set;
        foreach (var tok in csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            if (int.TryParse(tok, out var d) && d is >= 0 and <= 6)
                set.Add(d);
        return set;
    }

    /// <summary>Horas válidas parseadas do CSV ("HH:mm"). Tokens malformados são ignorados. Ordenadas
    /// e sem duplicatas p/ o cálculo de slot determinístico.</summary>
    public static List<TimeOnly> ParseTimes(string? csv)
    {
        var list = new List<TimeOnly>();
        if (string.IsNullOrWhiteSpace(csv)) return list;
        foreach (var tok in csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            if (TimeOnly.TryParse(tok, out var t))
                list.Add(t);
        return list.Distinct().OrderBy(t => t).ToList();
    }

    /// <summary>
    /// É hora de postar em <paramref name="nowLocal"/>? true se o dia-da-semana está na agenda E existe
    /// um horário agendado dentro dos últimos <paramref name="toleranceMinutes"/> (o tick do robô é ~1h;
    /// a tolerância evita perder o slot se o tick não cair exatamente no minuto). Agenda vazia → false.
    /// </summary>
    public static bool IsDuePostingTime(
        DateTime nowLocal, string? daysCsv, string? timesCsv, int toleranceMinutes = 60)
    {
        var days = ParseDays(daysCsv);
        if (!days.Contains((int)nowLocal.DayOfWeek)) return false;
        var times = ParseTimes(timesCsv);
        if (times.Count == 0) return false;

        var now = TimeOnly.FromDateTime(nowLocal);
        foreach (var t in times)
        {
            // minutos decorridos desde o horário agendado (negativo = ainda não chegou → não conta).
            var delta = (now.ToTimeSpan() - t.ToTimeSpan()).TotalMinutes;
            if (delta >= 0 && delta <= toleranceMinutes) return true;
        }
        return false;
    }

    /// <summary>
    /// Quantos horários da agenda JÁ PASSARAM hoje (dia local)? 0 se o dia não está na agenda.
    /// Base da semântica de CATCH-UP do robô: em vez de uma janela de tolerância (que perde o slot
    /// quando nenhum tick cai dentro dela — free-tier dorme, cron externo atrasa horas), o tick
    /// compara este número com as gerações já feitas hoje e RECUPERA slots perdidos no mesmo dia.
    /// Idempotente por contagem: N ticks no mesmo estado dão a mesma resposta (não gera em dobro).
    /// </summary>
    public static int CountSlotsPassedToday(DateTime nowLocal, string? daysCsv, string? timesCsv)
    {
        var days = ParseDays(daysCsv);
        if (!days.Contains((int)nowLocal.DayOfWeek)) return 0;
        var now = TimeOnly.FromDateTime(nowLocal);
        return ParseTimes(timesCsv).Count(t => t <= now);
    }

    /// <summary>
    /// task 2.6 — próximo SLOT LIVRE (hora local) a partir de <paramref name="fromLocal"/>, respeitando
    /// a agenda (dias+horas) e a janela do workspace, e PULANDO horários já ocupados por um agendamento
    /// existente (anti-colisão). Varre até <paramref name="horizonDays"/> dias à frente; null se a agenda
    /// é vazia ou tudo está ocupado no horizonte. Determinístico (sem relógio próprio).
    /// </summary>
    /// <param name="occupiedLocal">horários locais já ocupados (agendamentos existentes) — comparação
    /// por igualdade de minuto (o slot é HH:mm; segundos são zerados).</param>
    public static DateTime? NextFreeSlot(
        DateTime fromLocal,
        string? daysCsv,
        string? timesCsv,
        IReadOnlyCollection<DateTime> occupiedLocal,
        int horizonDays = 14)
    {
        var days = ParseDays(daysCsv);
        var times = ParseTimes(timesCsv);
        if (days.Count == 0 || times.Count == 0) return null;

        var occupied = new HashSet<DateTime>(occupiedLocal.Select(TruncateToMinute));
        var cursorDay = fromLocal.Date;
        for (var d = 0; d <= horizonDays; d++, cursorDay = cursorDay.AddDays(1))
        {
            if (!days.Contains((int)cursorDay.DayOfWeek)) continue;
            foreach (var t in times) // já ordenadas
            {
                var candidate = cursorDay.Add(t.ToTimeSpan());
                if (candidate <= fromLocal) continue;          // no passado (ou agora) → pula
                if (occupied.Contains(TruncateToMinute(candidate))) continue; // colisão → pula
                return candidate;
            }
        }
        return null;
    }

    private static DateTime TruncateToMinute(DateTime dt) =>
        new(dt.Year, dt.Month, dt.Day, dt.Hour, dt.Minute, 0, dt.Kind);
}
