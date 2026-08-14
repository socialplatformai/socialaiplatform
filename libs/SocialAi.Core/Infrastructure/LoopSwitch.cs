using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;

namespace SocialAi.Api.Infrastructure;

/// <summary>
/// Freio-mestre do robô (kill-switch GLOBAL, soberano — acima de qualquer workspace). Ponto ÚNICO de
/// leitura, usado pelos dois jobs autônomos (AutonomousLoopJob + PostingScheduleJob) e pela API que
/// o expõe na tela.
///
/// Fonte da verdade: a chave "Loop:Enabled" na tabela SystemSetting (config global, controlável por
/// TELA — o operador não deve mexer em variável de servidor). FALLBACK para a config de env quando a
/// chave ainda não existe no banco (compat total: deploys que configuram por env seguem funcionando;
/// o banco VENCE quando presente). DEFAULT FALSE — autonomia é opt-in explícito (salvaguarda).
/// </summary>
public static class LoopSwitch
{
    public const string Key = "Loop:Enabled";

    /// <summary>
    /// true se o robô pode agir globalmente. Ordem: SystemSetting["Loop:Enabled"] (banco) → env
    /// "Loop:Enabled" → false. Uma linha inválida no banco (Value não-booleano) cai no fallback env.
    /// </summary>
    public static async Task<bool> IsEnabledAsync(AppDbContext db, IConfiguration cfg, CancellationToken ct = default)
    {
        var row = await db.SystemSettings.AsNoTracking().FirstOrDefaultAsync(s => s.Key == Key, ct);
        if (row is not null && bool.TryParse(row.Value, out var fromDb))
            return fromDb;
        // Sem linha no banco (ou valor corrompido) → mantém o comportamento por env (default false).
        // Indexador + TryParse (o Core não referencia o ConfigurationBinder que traz GetValue<T>).
        return bool.TryParse(cfg[Key], out var fromEnv) && fromEnv;
    }

    /// <summary>Lê o estado atual para a UI. Mesma precedência do IsEnabledAsync.</summary>
    public static Task<bool> GetAsync(AppDbContext db, IConfiguration cfg, CancellationToken ct = default)
        => IsEnabledAsync(db, cfg, ct);

    /// <summary>
    /// Grava o freio no banco (upsert da linha "Loop:Enabled"). A partir daqui o banco é soberano
    /// sobre o env. NÃO faz SaveChanges — o chamador controla a transação.
    /// </summary>
    public static async Task SetAsync(AppDbContext db, bool enabled, CancellationToken ct = default)
    {
        var row = await db.SystemSettings.FirstOrDefaultAsync(s => s.Key == Key, ct);
        if (row is null)
        {
            row = new SystemSetting { Key = Key };
            db.SystemSettings.Add(row);
        }
        row.Value = enabled ? "true" : "false";
        row.UpdatedAt = DateTimeOffset.UtcNow;
    }

    // ── Máximo de gerações por dia (rate-limit do robô, task 4.3) ──────────────────────────────────
    // Mesma mecânica do freio: SystemSetting no banco (editável por TELA) → fallback env
    // "Loop:MaxPostsPerDay" → default 1. Sem migração (reusa a tabela SystemSetting). Global ao
    // deploy (coerente com o single-tenant por cliente). Piso de 1 — 0/negativo pausaria o robô sem querer.
    public const string MaxPostsPerDayKey = "Loop:MaxPostsPerDay";

    /// <summary>Máximo de gerações do robô por dia. Banco → env → 1. Sempre ≥ 1.</summary>
    public static async Task<int> GetMaxPostsPerDayAsync(AppDbContext db, IConfiguration cfg, CancellationToken ct = default)
    {
        var row = await db.SystemSettings.AsNoTracking().FirstOrDefaultAsync(s => s.Key == MaxPostsPerDayKey, ct);
        if (row is not null && int.TryParse(row.Value, out var fromDb))
            return Math.Max(1, fromDb);
        return Math.Max(1, int.TryParse(cfg[MaxPostsPerDayKey], out var fromEnv) ? fromEnv : 1);
    }

    /// <summary>Grava o limite (upsert, piso de 1). NÃO faz SaveChanges — o chamador controla a transação.</summary>
    public static async Task SetMaxPostsPerDayAsync(AppDbContext db, int value, CancellationToken ct = default)
    {
        var row = await db.SystemSettings.FirstOrDefaultAsync(s => s.Key == MaxPostsPerDayKey, ct);
        if (row is null)
        {
            row = new SystemSetting { Key = MaxPostsPerDayKey };
            db.SystemSettings.Add(row);
        }
        row.Value = Math.Max(1, value).ToString();
        row.UpdatedAt = DateTimeOffset.UtcNow;
    }
}
