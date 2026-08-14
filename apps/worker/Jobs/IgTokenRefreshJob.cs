using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Worker.Jobs;

/// <summary>
/// B3/S-09: refresh dos long-lived tokens do Instagram (validade 60d). A Graph API
/// permite renovar (ig_refresh_token) um token que já tenha pelo menos 24h de vida e
/// ainda não tenha expirado — o resultado é um NOVO token de 60d. Se deixarmos vencer,
/// a conta cai e o publish para silenciosamente; por isso renovamos proativamente na
/// janela 24h..~50d antes do vencimento.
///
/// Sistêmico (SystemWorkspace → WorkspaceId=null desliga o read filter): varre todos os
/// workspaces numa só query, igual aos demais jobs. Em modo degradado (nenhuma conta
/// conectada) o tick não faz nada — degradado é estado de 1ª classe.
/// </summary>
public sealed class IgTokenRefreshJob(
    IServiceProvider services,
    IHttpClientFactory httpFactory,
    SocialAi.Worker.Publishing.GraphApiConfig graphCfg,
    ILogger<IgTokenRefreshJob> logger) : BackgroundService
{
    // Tick diário: o refresh tem janela de dias, não precisa ser frequente. Um pulso/dia
    // basta para nunca chegar perto do vencimento (a janela inferior é de 24h).
    private static readonly TimeSpan Tick = TimeSpan.FromHours(24);

    // Só renova contas cujo token vence dentro de ~50d. Como o token IG dura 60d, esse teto
    // evita renovar diariamente um token recém-emitido — a conta só entra na janela perto do
    // fim da validade. (O piso de "24h de idade mínima" exigido pela Meta sempre é satisfeito
    // aqui: um token na janela de renovação já tem semanas de vida.)
    private static readonly TimeSpan RefreshWindow = TimeSpan.FromDays(50);

    // F6/E1: versão da Graph API de config (fonte única GraphApiConfig), não mais hardcoded.
    private string Graph => graphCfg.BaseUrl;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("IgTokenRefreshJob iniciado (tick 24h).");
        using var timer = new PeriodicTimer(Tick);
        do
        {
            try { await RefreshAllAsync(stoppingToken); }
            catch (OperationCanceledException) { break; }
            catch (Exception ex) { logger.LogError(ex, "Falha no tick do IgTokenRefreshJob."); }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task RefreshAllAsync(CancellationToken ct)
    {
        using var scope = services.CreateScope();
        var sp = scope.ServiceProvider;
        var db = sp.GetRequiredService<AppDbContext>();
        var protector = sp.GetRequiredService<SecretProtector>();

        var now = DateTimeOffset.UtcNow;
        var renewBefore = now + RefreshWindow; // só contas entrando na janela de renovação

        // Contas conectadas COM expiração conhecida, ordenadas por urgência. Filtramos no banco
        // pelo teto da janela; o piso (24h) e o vencimento são tratados por conta no loop.
        var accounts = await db.InstagramAccounts
            .Where(a => a.IsConnected
                        && a.TokenExpiresAt != null
                        && a.TokenExpiresAt <= renewBefore)
            .OrderBy(a => a.TokenExpiresAt)
            .ToListAsync(ct);

        if (accounts.Count == 0) return; // degradado: nada conectado/na janela → no-op
        logger.LogInformation("Avaliando {Count} conta(s) IG para refresh de token.", accounts.Count);

        var http = httpFactory.CreateClient();
        var dirty = false;

        foreach (var account in accounts)
        {
            // Já vencido: não dá pra renovar (a Meta exige token vivo). Derruba a conta e ALERTA —
            // não é Mock mudo: o operador precisa reconectar o IG manualmente.
            if (account.TokenExpiresAt < now)
            {
                account.IsConnected = false;
                dirty = true;
                logger.LogWarning(
                    "Token IG VENCIDO p/ conta {IgUserId} (workspace {Workspace}, expirou em {ExpiresAt:o}). " +
                    "Conta marcada como desconectada — reconectar o Instagram manualmente.",
                    account.IgUserId, account.WorkspaceId, account.TokenExpiresAt);
                continue;
            }

            // Token ainda vivo e dentro da janela → tenta renovar. O requisito de "24h" da Meta
            // é de IDADE MÍNIMA do token (não de vida restante); um token na janela de renovação
            // já tem semanas de vida, então sempre satisfaz esse piso.
            if (await TryRefreshAsync(http, protector, account, now, ct))
                dirty = true;
        }

        if (dirty) await db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Renova um token via GET refresh_access_token. Sucesso: re-cifra o novo token e empurra
    /// TokenExpiresAt para now+expires_in. Falha: ALERTA (LogWarning) e deixa a conta como está
    /// — o próximo tick tenta de novo até vencer (aí cai no caminho de "vencido").
    /// </summary>
    private async Task<bool> TryRefreshAsync(
        HttpClient http, SecretProtector protector, Api.Domain.InstagramAccount account,
        DateTimeOffset now, CancellationToken ct)
    {
        try
        {
            var token = protector.Decrypt(account.EncryptedAccessToken);
            var url = $"{Graph}/refresh_access_token?grant_type=ig_refresh_token" +
                      $"&access_token={Uri.EscapeDataString(token)}";

            var res = await http.GetAsync(url, ct);
            var body = await res.Content.ReadAsStringAsync(ct);
            if (!res.IsSuccessStatusCode)
            {
                logger.LogWarning(
                    "Refresh de token IG FALHOU p/ conta {IgUserId} (workspace {Workspace}): {Status} {Body}",
                    account.IgUserId, account.WorkspaceId, (int)res.StatusCode, body);
                return false;
            }

            var json = JsonSerializer.Deserialize<JsonElement>(body);
            var newToken = json.TryGetProperty("access_token", out var atEl) ? atEl.GetString() : null;
            var expiresIn = json.TryGetProperty("expires_in", out var exEl) ? exEl.GetInt64() : 0;
            if (string.IsNullOrEmpty(newToken) || expiresIn <= 0)
            {
                logger.LogWarning(
                    "Resposta de refresh IG sem access_token/expires_in p/ conta {IgUserId}: {Body}",
                    account.IgUserId, body);
                return false;
            }

            // R-9: token só vive cifrado em repouso. Re-cifra o NOVO token e renova a expiração.
            account.EncryptedAccessToken = protector.Encrypt(newToken);
            account.TokenExpiresAt = now.AddSeconds(expiresIn);
            logger.LogInformation(
                "Token IG renovado p/ conta {IgUserId} (workspace {Workspace}), novo vencimento {ExpiresAt:o}.",
                account.IgUserId, account.WorkspaceId, account.TokenExpiresAt);
            return true;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex,
                "Erro ao renovar token IG da conta {IgUserId} (workspace {Workspace}).",
                account.IgUserId, account.WorkspaceId);
            return false;
        }
    }
}
