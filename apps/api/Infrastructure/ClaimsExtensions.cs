using System.Security.Claims;
using Microsoft.IdentityModel.JsonWebTokens;

namespace SocialAi.Api.Infrastructure;

/// <summary>
/// Ator da requisição derivado do JWT (claim sub/email) — dono único da leitura desses claims.
/// Extraído da repetição verbatim em 5 controllers (Approval/Ideas/MetaAppConfig/Users/Instagram),
/// C2/ADR-0010: a trilha de auditoria precisa de (quem, e-mail) em todo ponto sensível.
/// </summary>
public static class ClaimsExtensions
{
    public static Guid ActorId(this ClaimsPrincipal user) =>
        Guid.TryParse(user.FindFirstValue(JwtRegisteredClaimNames.Sub), out var id) ? id : Guid.Empty;

    public static string ActorEmail(this ClaimsPrincipal user) =>
        user.FindFirstValue(JwtRegisteredClaimNames.Email) ?? "";
}
