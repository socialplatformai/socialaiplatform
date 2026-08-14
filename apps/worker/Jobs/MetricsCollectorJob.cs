using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Worker.Jobs;

/// <summary>
/// Coleta métricas de performance dos posts publicados (§2.4). Para Content Published
/// sem métrica recente, busca insights via Graph API (alcance/engajamento/likes/saves).
/// Mock quando não há token válido (gera métricas plausíveis p/ o loop funcionar end-to-end).
/// </summary>
public sealed class MetricsCollectorJob(
    IServiceProvider services,
    IConfiguration cfg,
    IHttpClientFactory httpFactory,
    SocialAi.Worker.Publishing.GraphApiConfig graphCfg,
    ILogger<MetricsCollectorJob> logger) : BackgroundService
{
    private readonly bool _mock = (cfg["Publisher:Mode"] ?? "mock") == "mock";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("MetricsCollectorJob iniciado (tick 5min, mock={Mock}).", _mock);
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(5));
        do
        {
            try { await CollectAsync(stoppingToken); }
            catch (OperationCanceledException) { break; }
            catch (Exception ex) { logger.LogError(ex, "Falha no tick do MetricsCollectorJob."); }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task CollectAsync(CancellationToken ct)
    {
        using var scope = services.CreateScope();
        var sp = scope.ServiceProvider;
        var db = sp.GetRequiredService<AppDbContext>();
        var protector = sp.GetRequiredService<SecretProtector>();

        // Posts publicados sem métrica coletada na última hora.
        var since = DateTimeOffset.UtcNow.AddHours(-1);
        var published = await db.Contents
            .Where(c => (c.Status == ContentStatus.Published || c.Status == ContentStatus.EphemeralPublished)
                        && !db.PerformanceMetrics.Any(m => m.ContentId == c.Id && m.CollectedAt > since))
            .Take(50)
            .ToListAsync(ct);

        if (published.Count == 0) return;
        logger.LogInformation("Coletando métricas de {Count} post(s).", published.Count);

        foreach (var content in published)
        {
            var metric = _mock
                ? MockMetric(content)
                : await FetchRealMetricAsync(db, protector, content, ct) ?? MockMetric(content);
            db.PerformanceMetrics.Add(metric);
        }
        await db.SaveChangesAsync(ct);
    }

    private static PerformanceMetric MockMetric(Content content)
    {
        // Determinístico a partir do Id (sem random — reprodutível). Plausível p/ o analyzer.
        // C3: rotulado Source=Mock (default do enum, explícito aqui p/ legibilidade).
        var seed = Math.Abs(content.Id.GetHashCode());
        return new PerformanceMetric
        {
            WorkspaceId = content.WorkspaceId,
            ContentId = content.Id,
            Reach = 500 + seed % 4500,
            Engagement = 20 + seed % 380,
            Likes = 15 + seed % 300,
            Saves = seed % 80,
            Comments = seed % 40, // task 3.5: comentários simulados (plausíveis) no modo mock
            Source = MetricSource.Mock,
            CollectedAt = DateTimeOffset.UtcNow,
        };
    }

    private async Task<PerformanceMetric?> FetchRealMetricAsync(
        AppDbContext db, SecretProtector protector, Content content, CancellationToken ct)
    {
        // A3 (ADR-0010): a métrica usa a conta-alvo do conteúdo (mesma precedência da publicação),
        // não a 1ª conta do workspace — senão um conteúdo publicado pela conta B teria insights
        // buscados com o token da conta A (errado/poison no learning multi-conta).
        var account = await TargetAccountResolver.ResolveAsync(db, content, ct);
        if (account?.EncryptedAccessToken is null or "") return null;

        try
        {
            var token = protector.Decrypt(account.EncryptedAccessToken);

            // E1/S-10: media id resolvido a partir do PublishLog DESTE conteúdo e workspace.
            // ANTES o lookup pegava o PublishLog Success mais recente de TODO o sistema
            // (cross-tenant) — envenenava o learning de um workspace com a métrica de outro.
            // Filtramos por WorkspaceId E pelo ContentId via ScheduledPost.ContentId, e lemos
            // o RemoteId (campo novo) em vez de extrair do GraphResponse.
            var mediaId = await db.PublishLogs
                .Where(l => l.Result == PublishResult.Success
                            && l.WorkspaceId == content.WorkspaceId
                            && l.ScheduledPost!.ContentId == content.Id
                            && l.RemoteId != null)
                .OrderByDescending(l => l.CreatedAt)
                .Select(l => l.RemoteId)
                .FirstOrDefaultAsync(ct);
            if (mediaId is null) return null;

            var http = httpFactory.CreateClient();
            // F6/E1: base versionada de config (GraphApiConfig), não mais hardcoded.
            var url = $"{graphCfg.BaseUrl}/{mediaId}/insights" +
                      $"?metric=reach,likes,saved,comments&access_token={token}";
            var res = await http.GetAsync(url, ct);
            if (!res.IsSuccessStatusCode) return null;

            // C3 (DEC-5): parse REAL de data[].values[0].value por métrica. Parse vazio/falho →
            // null → o chamador cai no MockMetric rotulado (degrada honesto, nunca métrica zerada).
            var body = await res.Content.ReadAsStringAsync(ct);
            return ParseInsights(body, content);
        }
        catch { return null; }
    }

    /// <summary>
    /// C3: parseia o payload de /insights da Graph API em uma PerformanceMetric REAL (Source=Real).
    /// Defensivo (Meta versiona a Graph): payload sem nenhuma das métricas conhecidas → null (cai no
    /// mock rotulado). Engagement = Likes + Saves enquanto a Graph não expõe um agregado estável —
    /// preserva o contrato atual do PerformanceAnalyzer (D6).
    /// </summary>
    internal static PerformanceMetric? ParseInsights(string json, Content content)
    {
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("data", out var data) ||
                data.ValueKind != System.Text.Json.JsonValueKind.Array)
                return null;

            int? reach = null, likes = null, saved = null, comments = null;
            foreach (var item in data.EnumerateArray())
            {
                var name = item.TryGetProperty("name", out var n) ? n.GetString() : null;
                if (name is null) continue;
                // O valor pode vir em values[].value (séries) OU total_value.value (agregado).
                int? value = ExtractValue(item);
                if (value is null) continue;
                switch (name)
                {
                    case "reach": reach = value; break;
                    case "likes": likes = value; break;
                    case "saved": saved = value; break;
                    case "comments": comments = value; break; // task 3.5
                }
            }

            // Nenhuma métrica conhecida no payload → trata como falha de parse (não inventa zero).
            if (reach is null && likes is null && saved is null && comments is null) return null;

            var l = likes ?? 0;
            var s = saved ?? 0;
            var cm = comments ?? 0;
            return new PerformanceMetric
            {
                WorkspaceId = content.WorkspaceId,
                ContentId = content.Id,
                Reach = reach ?? 0,
                Likes = l,
                Saves = s,
                Comments = cm, // task 3.5: coletado dos insights (comments_count)
                Engagement = l + s, // D6: agregado derivado, preserva o contrato do analyzer.
                Source = MetricSource.Real,
                CollectedAt = DateTimeOffset.UtcNow,
            };
        }
        catch { return null; }
    }

    /// <summary>Extrai o inteiro de uma entrada de insight: values[0].value (séries) ou
    /// total_value.value (agregado v22+). Tolera ausência → null.</summary>
    private static int? ExtractValue(System.Text.Json.JsonElement item)
    {
        if (item.TryGetProperty("values", out var values) &&
            values.ValueKind == System.Text.Json.JsonValueKind.Array &&
            values.GetArrayLength() > 0 &&
            values[0].TryGetProperty("value", out var v) &&
            v.TryGetInt32(out var iv))
            return iv;

        if (item.TryGetProperty("total_value", out var total) &&
            total.TryGetProperty("value", out var tv) &&
            tv.TryGetInt32(out var itv))
            return itv;

        return null;
    }
}
