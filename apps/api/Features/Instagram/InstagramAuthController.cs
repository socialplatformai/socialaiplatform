using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.JsonWebTokens;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Features.Audit;
using SocialAi.Api.Features.Brands;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Instagram;

public record InstagramStatusDto(bool Connected, string? Username, DateTimeOffset? TokenExpiresAt);
public record ConnectUrlDto(string Url);
// A2 (ADR-0010): item da lista de contas de uma marca (N contas/marca, DP2).
public record InstagramAccountDto(
    Guid Id, string? Username, bool IsConnected, DateTimeOffset? TokenExpiresAt, bool IsPrimary);

/// <summary>
/// OAuth Instagram Login (AM-5: graph.instagram.com, NÃO Facebook Login).
/// Cliente clica "Conectar" → consente → callback troca code por long-lived token,
/// descobre o IG user, persiste cifrado. App Meta é config do cliente (META_*).
///
/// FASE 8 (ADR-0010): a marca é FIXADA no início (connect-url exige X-Brand-Id, grava no
/// OAuthState); o callback deriva a marca do state consumido e INSERE N contas por marca
/// (dedupe por IgUserId dentro da marca). Conta/status/disconnect passam a ser por conta+marca.
/// </summary>
[ApiController]
[Route("api/instagram")]
public class InstagramAuthController(
    AppDbContext db, ICurrentWorkspace current, IConfiguration cfg,
    SecretProtector protector, IHttpClientFactory httpFactory, BrandResolver brands,
    ICurrentBrand currentBrand, AuditService audit, IWebHostEnvironment env,
    ILogger<InstagramAuthController> logger) : ControllerBase
{
    private Guid Ws => current.WorkspaceId!.Value;
    // Meta:RedirectUri deve bater BYTE A BYTE com a URI cadastrada no App Meta (senão o OAuth é
    // rejeitado no /authorize). O fallback localhost é só conveniência de dev — em Produção o
    // silêncio dele mandava 'http://localhost:5080/...' pra Meta e quebrava o connect real. Em
    // Production, exigimos a var explícita (fail-fast no 1º connect, com mensagem clara).
    private string RedirectUri =>
        cfg["Meta:RedirectUri"]
        ?? (env.IsProduction()
            ? throw new InvalidOperationException(
                "META_REDIRECT_URI não configurada — obrigatória em Produção para o OAuth do Instagram.")
            : "http://localhost:5080/api/instagram/callback");

    private record StoredMetaApp(string AppId, string AppSecret);

    /// <summary>
    /// Resolve as credenciais do App Meta: banco (cadastrado na UI, cifrado) primeiro;
    /// .env (Meta:AppId/AppSecret) como fallback. workspaceId explícito p/ o callback
    /// (anônimo, sem ICurrentWorkspace).
    /// </summary>
    private async Task<(string AppId, string AppSecret)> ResolveMetaAppAsync(Guid? workspaceId = null)
    {
        var query = db.Secrets.IgnoreQueryFilters().Where(s => s.Kind == SecretKind.MetaAppSecret);
        if (workspaceId is { } wid) query = query.Where(s => s.WorkspaceId == wid);
        var secret = await query.FirstOrDefaultAsync();

        if (secret is not null && !string.IsNullOrEmpty(secret.EncryptedValue))
        {
            var stored = JsonSerializer.Deserialize<StoredMetaApp>(protector.Decrypt(secret.EncryptedValue));
            if (stored is not null && !string.IsNullOrWhiteSpace(stored.AppId))
                return (stored.AppId, stored.AppSecret);
        }
        // Fallback: .env (compatibilidade com deploy antigo).
        return (cfg["Meta:AppId"] ?? "", cfg["Meta:AppSecret"] ?? "");
    }

    /// <summary>A1: URL de início do OAuth. EXIGE X-Brand-Id (a marca-alvo é fixada AQUI,
    /// no OAuthState, não derivada no callback). Só Admin — coerente com a config de App Meta.</summary>
    [Authorize(Roles = "Admin")]
    [HttpGet("connect-url")]
    public async Task<ActionResult<ConnectUrlDto>> ConnectUrl()
    {
        // A1: marca-alvo OBRIGATÓRIA no início do fluxo. Sem X-Brand-Id não há como saber em qual
        // marca conectar → 400 (o callback não recebe header e não pode adivinhar). NÃO caímos na
        // marca-default aqui (ao contrário de leitura/listagem): fixar a marca errada no OAuthState
        // conectaria a conta na marca errada (aceite A1).
        if (currentBrand.BrandId is null)
            return Problem("Selecione uma marca (X-Brand-Id) antes de conectar uma conta Instagram.", statusCode: 400);
        var brandId = await brands.ResolveAsync();

        var (appId, _) = await ResolveMetaAppAsync(Ws);
        if (string.IsNullOrEmpty(appId))
            return Problem("App Meta não configurado. Cadastre App ID/Secret em Configurações.", statusCode: 503);

        // D1: state ALEATÓRIO (32 bytes), uso único, TTL curto, mapeado server-side a
        // {workspace, usuário, MARCA}. O callback nunca confia no query param como workspace/marca;
        // deriva tudo do store consumindo o state.
        var userId = Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var uid) ? uid : Guid.Empty;
        var state = Base64Url(RandomNumberGenerator.GetBytes(32));
        db.OAuthStates.Add(new OAuthState
        {
            State = state,
            WorkspaceId = Ws,
            UserId = userId,
            BrandId = brandId, // A1: marca fixada no início
            ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(10),
        });
        await db.SaveChangesAsync();

        var scopes = "instagram_business_basic,instagram_business_content_publish";
        var url =
            $"https://www.instagram.com/oauth/authorize?client_id={appId}" +
            $"&redirect_uri={Uri.EscapeDataString(RedirectUri)}" +
            $"&response_type=code&scope={Uri.EscapeDataString(scopes)}&state={Uri.EscapeDataString(state)}";
        return Ok(new ConnectUrlDto(url));
    }

    /// <summary>Callback do OAuth: troca code por long-lived token e persiste cifrado.</summary>
    [AllowAnonymous]
    [HttpGet("callback")]
    public async Task<IActionResult> Callback([FromQuery] string? code, [FromQuery] string? state, [FromQuery] string? error)
    {
        // Sec: não reflete o param de erro cru (evita XSS refletido / vazamento); mapeia para texto fixo.
        if (!string.IsNullOrEmpty(error))
            return BadRequest(error == "access_denied"
                ? "Permissão negada no Instagram."
                : "Falha na autorização do Instagram.");
        if (string.IsNullOrEmpty(code) || string.IsNullOrEmpty(state))
            return BadRequest("code/state inválidos.");

        // D1/A1: consome o state ATOMICAMENTE (uso único). O workspace E a marca vêm DAQUI,
        // nunca do query param. State ausente/expirado/já usado → rejeitado.
        var resolved = await ConsumeStateAsync(state);
        if (resolved is null)
            return BadRequest("state inválido, expirado ou já utilizado.");
        var (workspaceId, stateBrandId, userId, userEmail) = resolved.Value;

        // Credenciais do workspace que iniciou o OAuth (derivado do state). Banco → .env.
        var (appId, appSecret) = await ResolveMetaAppAsync(workspaceId);
        if (string.IsNullOrEmpty(appId) || string.IsNullOrEmpty(appSecret))
            return BadRequest("App Meta não configurado para este workspace.");

        var http = httpFactory.CreateClient();

        // 1. code -> short-lived token
        var form = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["client_id"] = appId,
            ["client_secret"] = appSecret,
            ["grant_type"] = "authorization_code",
            ["redirect_uri"] = RedirectUri,
            ["code"] = code,
        });
        var shortRes = await http.PostAsync("https://api.instagram.com/oauth/access_token", form);
        if (!shortRes.IsSuccessStatusCode)
        {
            // Sec: não ecoa o corpo bruto da Meta ao cliente (pode conter detalhes sensíveis);
            // o detalhe vai só para o log do servidor.
            logger.LogWarning("Falha na troca de code IG (ws {Ws}): {Status}", workspaceId, shortRes.StatusCode);
            return BadRequest("Falha ao conectar com o Instagram. Tente novamente.");
        }
        var shortJson = JsonSerializer.Deserialize<ShortToken>(await shortRes.Content.ReadAsStringAsync(), Web)!;

        // 2. short-lived -> long-lived (60 dias)
        var longUrl =
            $"https://graph.instagram.com/access_token?grant_type=ig_exchange_token" +
            $"&client_secret={appSecret}&access_token={shortJson.AccessToken}";
        var longRes = await http.GetAsync(longUrl);
        var longJson = longRes.IsSuccessStatusCode
            ? JsonSerializer.Deserialize<LongToken>(await longRes.Content.ReadAsStringAsync(), Web)
            : null;
        var accessToken = longJson?.AccessToken ?? shortJson.AccessToken;
        var expiresIn = longJson?.ExpiresIn ?? 3600;

        // 3. descobrir o usuário IG
        var meRes = await http.GetAsync(
            $"https://graph.instagram.com/me?fields=user_id,username&access_token={accessToken}");
        var me = meRes.IsSuccessStatusCode
            ? JsonSerializer.Deserialize<IgUser>(await meRes.Content.ReadAsStringAsync(), Web)
            : null;
        var igUserId = me?.UserId ?? shortJson.UserId?.ToString() ?? "";

        // 4. resolver a marca-alvo. A1: a marca vem do state; states em voo no deploy (BrandId
        // null) caem na marca-default (mais antiga) — degradação conhecida e temporária (TTL 10min).
        var brandId = stateBrandId ?? await DefaultBrandAsync(workspaceId);

        // A1: INSERE uma nova conta por conexão. Dedup só quando o MESMO IgUserId já existe NA
        // MARCA do state (reconectar a mesma conta = renovar token, não duplicar). Filtro global
        // bypassado (callback anônimo, sem ICurrentWorkspace): predicado explícito ws+marca+igUser.
        var acct = await db.InstagramAccounts.IgnoreQueryFilters()
            .FirstOrDefaultAsync(a => a.WorkspaceId == workspaceId
                                      && a.BrandId == brandId
                                      && a.IgUserId == igUserId
                                      && igUserId != "");
        var novaConta = acct is null;
        if (novaConta)
        {
            acct = new InstagramAccount { WorkspaceId = workspaceId, BrandId = brandId };
            db.InstagramAccounts.Add(acct);
        }
        acct!.IgUserId = igUserId;
        acct.Username = me?.Username;
        acct.EncryptedAccessToken = protector.Encrypt(accessToken);
        acct.TokenExpiresAt = DateTimeOffset.UtcNow.AddSeconds(expiresIn);
        acct.IsConnected = true;

        // A4: a 1ª conta CONECTADA da marca nasce principal (fallback default da conta-alvo).
        if (novaConta)
        {
            var jaTemPrincipal = await db.InstagramAccounts.IgnoreQueryFilters()
                .AnyAsync(a => a.BrandId == brandId && a.IsPrimary);
            acct.IsPrimary = !jaTemPrincipal;
        }
        await db.SaveChangesAsync();

        // C2: trilha de auditoria da conexão (autor do state que iniciou o OAuth).
        await audit.LogAsync(workspaceId, userId, userEmail, "instagram.connect",
            acct.Username ?? igUserId, brandId);

        // Redireciona de volta à UI.
        var web = cfg["Cors:WebOrigin"] ?? "http://localhost:3000";
        return Redirect($"{web}/settings/instagram?connected=1");
    }

    /// <summary>A2: lista as contas IG da marca corrente (X-Brand-Id). N contas/marca (DP2).</summary>
    [Authorize]
    [HttpGet("accounts")]
    public async Task<ActionResult<IEnumerable<InstagramAccountDto>>> Accounts()
    {
        var brandId = await brands.ResolveAsync();
        var accounts = (await db.InstagramAccounts.AsNoTracking()
                .Where(a => a.BrandId == brandId)
                .ToListAsync())
            .OrderByDescending(a => a.IsPrimary).ThenBy(a => a.CreatedAt).ThenBy(a => a.Id)
            .Select(a => new InstagramAccountDto(a.Id, a.Username, a.IsConnected, a.TokenExpiresAt, a.IsPrimary));
        return Ok(accounts);
    }

    /// <summary>A2: desconecta UMA conta da marca corrente. Conta de outra marca/workspace → 404
    /// (resolvida via X-Brand-Id + filtro de tenant), nunca afeta conta alheia.</summary>
    [Authorize(Roles = "Admin")] // destrutivo (zera token) + altera roteamento — coerente com connect-url
    [HttpPost("accounts/{id:guid}/disconnect")]
    public async Task<IActionResult> Disconnect(Guid id)
    {
        var brandId = await brands.ResolveAsync();
        var acct = await db.InstagramAccounts.FirstOrDefaultAsync(a => a.Id == id && a.BrandId == brandId);
        if (acct is null) return NotFound();
        acct.IsConnected = false;
        acct.EncryptedAccessToken = "";

        // Se desconectamos a PRINCIPAL, transfere a primazia p/ a conta conectada mais antiga
        // restante (se houver) — senão a marca ficaria com a principal morta e o resolver cairia
        // no Mock mesmo havendo outra conta viva (furo pego na auditoria adversarial).
        if (acct.IsPrimary)
        {
            acct.IsPrimary = false;
            var sucessora = (await db.InstagramAccounts
                    .Where(a => a.BrandId == brandId && a.IsConnected && a.Id != acct.Id)
                    .ToListAsync())
                .OrderBy(a => a.CreatedAt).ThenBy(a => a.Id)
                .FirstOrDefault();
            if (sucessora is not null) sucessora.IsPrimary = true;
        }
        await db.SaveChangesAsync();

        await audit.LogAsync(Ws, ActorId, ActorEmail, "instagram.disconnect",
            acct.Username ?? acct.IgUserId, brandId);
        return NoContent();
    }

    /// <summary>A4: marca UMA conta como principal da marca (flip transacional: desmarca a
    /// anterior e marca esta). ≤1 principal/marca. Conta de outra marca → 404.</summary>
    [Authorize(Roles = "Admin")] // altera o destino padrão de publicação — restrito a Admin
    [HttpPost("accounts/{id:guid}/primary")]
    public async Task<IActionResult> SetPrimary(Guid id)
    {
        var brandId = await brands.ResolveAsync();
        var alvo = await db.InstagramAccounts.FirstOrDefaultAsync(a => a.Id == id && a.BrandId == brandId);
        if (alvo is null) return NotFound();

        // Flip transacional: zera todas as principais da marca, depois marca a alvo. Tudo num
        // SaveChanges (transação implícita) — nunca deixa 0 nem 2 principais na janela.
        var atuais = await db.InstagramAccounts.Where(a => a.BrandId == brandId && a.IsPrimary).ToListAsync();
        foreach (var a in atuais) a.IsPrimary = false;
        alvo.IsPrimary = true;
        await db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Status resumido da marca corrente (conta principal, ou a 1ª conectada). Conveniência
    /// para o badge "conectado?"; a gestão multi-conta é via /accounts (A2).</summary>
    [Authorize]
    [HttpGet("status")]
    public async Task<ActionResult<InstagramStatusDto>> Status()
    {
        var brandId = await brands.ResolveAsync();
        var account = (await db.InstagramAccounts.AsNoTracking()
                .Where(a => a.BrandId == brandId && a.IsConnected)
                .ToListAsync())
            .OrderByDescending(a => a.IsPrimary).ThenBy(a => a.CreatedAt).ThenBy(a => a.Id)
            .FirstOrDefault();
        return Ok(account is null
            ? new InstagramStatusDto(false, null, null)
            : new InstagramStatusDto(account.IsConnected, account.Username, account.TokenExpiresAt));
    }

    /// <summary>D1/A1: consome o state de forma atômica e de uso único. Marca Consumed=true com
    /// ExecuteUpdate condicional — se 0 linhas afetadas, o state não existe, expirou ou já foi usado
    /// (proteção contra replay). Retorna {workspace, marca, autor} mapeados, ou null.</summary>
    private async Task<(Guid WorkspaceId, Guid? BrandId, Guid UserId, string ActorEmail)?> ConsumeStateAsync(string state)
    {
        var now = DateTimeOffset.UtcNow;
        var row = await db.OAuthStates.FirstOrDefaultAsync(s => s.State == state);
        if (row is null) return null;

        var affected = await db.OAuthStates
            .Where(s => s.State == state && !s.Consumed && s.ExpiresAt > now)
            .ExecuteUpdateAsync(set => set.SetProperty(s => s.Consumed, true));
        if (affected != 1) return null;

        // Autor (e-mail) p/ a trilha de auditoria — derivado do usuário que iniciou o OAuth.
        var email = await db.Users.IgnoreQueryFilters()
            .Where(u => u.Id == row.UserId).Select(u => u.Email).FirstOrDefaultAsync() ?? "";
        return (row.WorkspaceId, row.BrandId, row.UserId, email);
    }

    /// <summary>Marca-default do workspace (mais antiga) — fallback do callback quando o state
    /// não tem BrandId (states em voo durante o deploy). Filtro global bypassado (callback anônimo).</summary>
    private async Task<Guid> DefaultBrandAsync(Guid workspaceId)
    {
        var brandsList = await db.Brands.IgnoreQueryFilters()
            .Where(b => b.WorkspaceId == workspaceId)
            .Select(b => new { b.Id, b.CreatedAt })
            .ToListAsync();
        return brandsList.OrderBy(b => b.CreatedAt).ThenBy(b => b.Id).Select(b => b.Id).FirstOrDefault() is var id && id != Guid.Empty
            ? id
            : throw new InvalidOperationException("Workspace sem marca-default ao conectar Instagram.");
    }

    private Guid ActorId => User.ActorId();
    private string ActorEmail => User.ActorEmail();

    private static string Base64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    // A Graph/IG devolve JSON snake_case (access_token, user_id, expires_in). JsonSerializerDefaults.Web
    // é case-INSENSITIVE mas NÃO converte snake_case→PascalCase ('user_id' ≠ 'UserId') — sem o
    // SnakeCaseLower abaixo, AccessToken/UserId/ExpiresIn ficavam SEMPRE null e o connect real
    // (PUBLISHER_MODE=graph) quebrava silenciosamente (latente: mock é o default até App Review).
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
    };
    // UserId do short-token vem como NÚMERO (long); o /me devolve como string. Lemos como long? aqui
    // (preferimos me.UserId no callback) e convertemos a string só quando usado.
    private record ShortToken(string AccessToken, long? UserId);
    private record LongToken(string AccessToken, long ExpiresIn);
    private record IgUser(string? UserId, string? Username);
}
