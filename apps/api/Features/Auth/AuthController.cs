using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;

namespace SocialAi.Api.Features.Auth;

[ApiController]
[Route("api/auth")]
[EnableRateLimiting("auth")] // D4: limita brute-force em login/register/refresh (10/min por IP → 429).
public class AuthController(AppDbContext db, TokenService tokens, IConfiguration cfg) : ControllerBase
{
    /// <summary>Registro: cria User + Workspace + Budget (raiz do tenant). 1º usuário = dono.</summary>
    /// <summary>Normaliza e-mail para comparação/persistência: sem espaços, minúsculo.
    /// Casa com o índice único global em lower(Email) (D2) e evita duplicata por caixa.</summary>
    private static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

    [HttpPost("register")]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Email) || req.Password.Length < 8)
            return Problem("Email obrigatório e senha com >= 8 caracteres.", statusCode: 400);

        var email = NormalizeEmail(req.Email);

        // IgnoreQueryFilters: o filtro de tenant esconderia o e-mail de outro workspace;
        // para unicidade global de registro consultamos sem filtro. O índice único em
        // lower(Email) (D2) é a rede final contra corrida entre dois registros simultâneos.
        var exists = await db.Users.IgnoreQueryFilters().AnyAsync(u => u.Email == email);
        if (exists) return Problem("E-mail já cadastrado.", statusCode: 409);

        var workspace = new Workspace { Name = req.WorkspaceName ?? $"Workspace de {req.Name ?? email}" };
        db.Workspaces.Add(workspace);

        // E1/DEC-1: todo workspace nasce com 1 marca-default (idempotência garantida pelo
        // backfill p/ os antigos; aqui p/ os novos). Nome = nome do workspace, ou 'Marca
        // principal' se vazio. Sem isto, o BrandResolver não acharia marca e tudo quebraria.
        var brandName = string.IsNullOrWhiteSpace(workspace.Name) ? "Marca principal" : workspace.Name;
        db.Brands.Add(new Domain.Brand { WorkspaceId = workspace.Id, Name = brandName });

        // D1 (ADR-0008): todo workspace nasce com os 4 templates built-in (idempotente).
        // O TemplatesController re-semeia sob demanda os workspaces anteriores a esta migration.
        await Data.Seed.TemplateSeeder.EnsureAsync(db, workspace.Id);

        // F1/S-18: todo workspace nasce com Budget de defaults SEGUROS. Sem isto o loop autônomo
        // ficava estruturalmente inalcançável (o gate exige um Budget que ninguém criava). Loop
        // desligado por default (AutonomousLoopEnabled=false) — opt-in explícito por um Admin.
        var monthlyCap = cfg.GetValue<decimal?>("Loop:DefaultMonthlyCapUsd") ?? 0m;
        db.Budgets.Add(new Budget
        {
            WorkspaceId = workspace.Id,
            AutonomousLoopEnabled = false,
            MonthlyCapUsd = monthlyCap,
        });

        var (refresh, refreshHash) = TokenService.IssueRefreshToken();
        var user = new User
        {
            WorkspaceId = workspace.Id,
            Email = email,
            Name = req.Name,
            // Registro sempre cria um workspace novo → este é o 1º usuário = Admin (dono).
            Role = UserRole.Admin,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.Password),
            RefreshTokenHash = refreshHash,
            RefreshTokenExpiresAt = DateTimeOffset.UtcNow.AddDays(30),
        };
        db.Users.Add(user);
        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException) // corrida: índice único lower(Email) violado entre o AnyAsync e o insert.
        {
            return Problem("E-mail já cadastrado.", statusCode: 409);
        }

        var (access, expires) = tokens.IssueAccessToken(user);
        return Ok(new AuthResponse(access, expires, refresh, workspace.Id, user.Id, user.Role.ToString()));
    }

    /// <summary>
    /// B1/B2 (ADR-0010): aceite de convite. O convidado ainda não tem conta → AllowAnonymous.
    /// NÃO há rota que adicione user a workspace EXISTENTE fora daqui: o Register sempre cria
    /// workspace novo (1º user = Admin), então o único caminho para o 2º+ usuário é via convite.
    /// </summary>
    [HttpPost("accept-invite")]
    [AllowAnonymous]
    public async Task<ActionResult<AuthResponse>> AcceptInvite(AcceptInviteRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Password) || req.Password.Length < 8)
            return Problem("Senha com >= 8 caracteres.", statusCode: 400);

        var now = DateTimeOffset.UtcNow;

        // IgnoreQueryFilters: o callback é anônimo (sem claim workspace_id), então o filtro de
        // tenant esconderia o convite. Leitura solta só para distinguir "inexistente" de "já usado".
        var invite = await db.UserInvites.IgnoreQueryFilters()
            .FirstOrDefaultAsync(i => i.Token == req.Token);
        if (invite is null) return Problem("Convite inválido.", statusCode: 400);

        // Expiração é monotônica (não é corrida) → checada na linha já lida. O GUARD ATÔMICO
        // anti-replay fica só sobre Consumed: comparar DateTimeOffset (ExpiresAt) dentro do
        // ExecuteUpdate não traduz no SQLite (GOTCHA 4); tirá-lo de lá mantém a corrida coberta
        // pelo único campo que importa (Consumed) e funciona nos dois providers.
        if (invite.ExpiresAt <= now)
            return Problem("Convite expirado.", statusCode: 400);

        // Consumo ATÔMICO (uso único, anti-replay): só 1 update vence a corrida. ExecuteUpdateAsync
        // roda direto no banco — sem race entre ler-e-marcar. affected != 1 ⇒ já consumido.
        var affected = await db.UserInvites.IgnoreQueryFilters()
            .Where(i => i.Token == req.Token && !i.Consumed)
            .ExecuteUpdateAsync(set => set.SetProperty(i => i.Consumed, true));
        if (affected != 1)
            return Problem("Convite inválido ou já utilizado.", statusCode: 400);

        var email = NormalizeEmail(invite.Email);

        // Duplicata DENTRO do workspace do convite: o callback é anônimo, então filtramos
        // explicitamente por WorkspaceId E Email (sem confiar no filtro de tenant ausente).
        var dup = await db.Users.IgnoreQueryFilters()
            .AnyAsync(u => u.WorkspaceId == invite.WorkspaceId && u.Email == email);
        if (dup) return Problem("Usuário já existe no workspace.", statusCode: 409);

        var (refresh, refreshHash) = TokenService.IssueRefreshToken();
        var user = new User
        {
            WorkspaceId = invite.WorkspaceId, // entra no workspace do convite, com o papel convidado.
            Email = email,
            Name = req.Name,
            Role = invite.Role,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.Password),
            RefreshTokenHash = refreshHash,
            RefreshTokenExpiresAt = DateTimeOffset.UtcNow.AddDays(30),
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();

        var (access, expires) = tokens.IssueAccessToken(user);
        return Ok(new AuthResponse(access, expires, refresh, user.WorkspaceId, user.Id, user.Role.ToString()));
    }

    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest req)
    {
        var email = NormalizeEmail(req.Email ?? "");
        var user = await db.Users.IgnoreQueryFilters().FirstOrDefaultAsync(u => u.Email == email);
        if (user is null || !BCrypt.Net.BCrypt.Verify(req.Password, user.PasswordHash))
            return Problem("Credenciais inválidas.", statusCode: 401);

        var (refresh, refreshHash) = TokenService.IssueRefreshToken();
        user.RefreshTokenHash = refreshHash;
        user.RefreshTokenExpiresAt = DateTimeOffset.UtcNow.AddDays(30);
        await db.SaveChangesAsync();

        var (access, expires) = tokens.IssueAccessToken(user);
        return Ok(new AuthResponse(access, expires, refresh, user.WorkspaceId, user.Id, user.Role.ToString()));
    }

    [HttpPost("refresh")]
    public async Task<ActionResult<AuthResponse>> Refresh(RefreshRequest req)
    {
        var hash = TokenService.Hash(req.RefreshToken);
        var user = await db.Users.IgnoreQueryFilters()
            .FirstOrDefaultAsync(u => u.RefreshTokenHash == hash);

        if (user is null || user.RefreshTokenExpiresAt is null || user.RefreshTokenExpiresAt < DateTimeOffset.UtcNow)
            return Problem("Refresh token inválido ou expirado.", statusCode: 401);

        // Rotaciona o refresh token a cada uso.
        var (refresh, refreshHash) = TokenService.IssueRefreshToken();
        user.RefreshTokenHash = refreshHash;
        user.RefreshTokenExpiresAt = DateTimeOffset.UtcNow.AddDays(30);
        await db.SaveChangesAsync();

        var (access, expires) = tokens.IssueAccessToken(user);
        return Ok(new AuthResponse(access, expires, refresh, user.WorkspaceId, user.Id, user.Role.ToString()));
    }
}
