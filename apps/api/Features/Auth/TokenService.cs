using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;
using SocialAi.Api.Domain;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Auth;

public class TokenService(IConfiguration cfg)
{
    // appsettings define Jwt:Secret = "" de propósito (vem da env JWT_SECRET). String
    // vazia NÃO é null, então um `?? fallback` não dispararia e a emissão quebraria com
    // IDX10703 (chave de tamanho zero) num boot Dev sem env. Espelha a mesma regra do
    // Program.cs (A2): vazio/branco => fallback de Dev. Em Production o boot já recusa
    // subir com este literal (guarda A2 no Program.cs), então isto fica restrito a Dev.
    private readonly string _secret = string.IsNullOrWhiteSpace(cfg["Jwt:Secret"])
        ? "dev-insecure-secret-change-me-min-32-bytes!!"
        : cfg["Jwt:Secret"]!;
    private readonly string _issuer = cfg["Jwt:Issuer"] ?? "social-ai-platform";

    public (string token, DateTimeOffset expiresAt) IssueAccessToken(User user)
    {
        var expires = DateTimeOffset.UtcNow.AddHours(2);
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim(JwtRegisteredClaimNames.Email, user.Email),
            new Claim(CurrentWorkspace.WorkspaceClaim, user.WorkspaceId.ToString()),
            // ClaimTypes.Role => habilita [Authorize(Roles = "Admin")] nativamente.
            new Claim(ClaimTypes.Role, user.Role.ToString()),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
        };

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_secret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var jwt = new JwtSecurityToken(
            issuer: _issuer,
            // D6: audiência = issuer (mesmo serviço emite e consome). Validada no Program.cs.
            audience: _issuer,
            claims: claims,
            expires: expires.UtcDateTime,
            signingCredentials: creds);

        return (new JwtSecurityTokenHandler().WriteToken(jwt), expires);
    }

    /// <summary>Refresh token opaco. Persistido como hash (nunca em claro).</summary>
    public static (string token, string hash) IssueRefreshToken()
    {
        var raw = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
        return (raw, Hash(raw));
    }

    public static string Hash(string value)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return Convert.ToHexString(bytes);
    }
}
