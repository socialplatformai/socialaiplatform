using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.JsonWebTokens;
using SocialAi.Api.Data;
using SocialAi.Api.Domain;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Auth;

/// <summary>
/// B1/B2 (ADR-0010): gestão de usuários do workspace por convite. Todas as rotas são Admin-only —
/// o gate é o atributo [Authorize(Roles="Admin")] (não checagem no corpo). Member → 403 pelo pipeline.
/// </summary>
[ApiController]
[Authorize]
[Route("api/users")]
public class UsersController(
    AppDbContext db,
    ICurrentWorkspace current,
    Audit.AuditService audit,
    IConfiguration cfg) : ControllerBase
{
    private Guid Ws => current.WorkspaceId!.Value;
    private Guid ActorId => User.ActorId();
    private string ActorEmail => User.ActorEmail();

    /// <summary>Convida um e-mail para o workspace. O convidado vira User só ao aceitar (accept-invite).</summary>
    [HttpPost("invite")]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<InviteResponse>> Invite(InviteRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Email))
            return Problem("E-mail obrigatório.", statusCode: 400);

        var email = req.Email.Trim().ToLowerInvariant();

        // O filtro global de tenant já restringe ao Ws atual — sem IgnoreQueryFilters aqui de propósito:
        // só importa duplicata DENTRO deste workspace (o mesmo e-mail pode existir em outro tenant).
        if (await db.Users.AnyAsync(u => u.Email == email))
            return Problem("Usuário já existe no workspace.", statusCode: 409);

        // Token base64url (uso único, consumido atomicamente no accept) — mesmo padrão do OAuthState.
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

        db.UserInvites.Add(new UserInvite
        {
            WorkspaceId = Ws,
            Token = token,
            Email = email,
            Role = req.Role,
            ExpiresAt = DateTimeOffset.UtcNow.AddDays(7), // janela de aceite curta (anti-stale).
            Consumed = false,
        });
        await db.SaveChangesAsync();

        var webOrigin = cfg["Cors:WebOrigin"] ?? "http://localhost:3000";
        var link = $"{webOrigin}/accept-invite?token={token}";

        // C2: ação sensível auditada explicitamente. Target = e-mail convidado (não o token — invariante 6).
        await audit.LogAsync(Ws, ActorId, ActorEmail, "user.invite", email);

        return Ok(new InviteResponse(token, link));
    }

    /// <summary>Lista os usuários do workspace.</summary>
    [HttpGet("")]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<IReadOnlyList<UserDto>>> List()
    {
        // GOTCHA 4: materializa antes de ordenar — ordenação em memória (SQLite de teste ≠ Postgres).
        var users = await db.Users.ToListAsync();
        var dto = users
            .OrderBy(u => u.Email, StringComparer.OrdinalIgnoreCase)
            .Select(u => new UserDto(u.Id, u.Email, u.Name, u.Role.ToString()))
            .ToList();
        return Ok(dto);
    }

    /// <summary>Remove um usuário do workspace. Protege contra remover o último Admin.</summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == id);
        if (user is null) return NotFound(); // recurso de outro tenant também cai aqui (não vaza existência).

        // Guard: o workspace não pode ficar sem Admin (caso contrário ninguém configura/convida).
        if (user.Role == UserRole.Admin)
        {
            var admins = await db.Users.CountAsync(u => u.Role == UserRole.Admin);
            if (admins == 1)
                return Problem("Não é possível remover o último Admin.", statusCode: 409);
        }

        db.Users.Remove(user);
        await db.SaveChangesAsync();

        await audit.LogAsync(Ws, ActorId, ActorEmail, "user.remove", user.Email);
        return NoContent();
    }
}
