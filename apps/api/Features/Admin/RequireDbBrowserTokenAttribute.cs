using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace SocialAi.Api.Features.Admin;

/// <summary>
/// Segunda trava do painel DB: além de Role=Admin, exige header X-Db-Browser-Token
/// com valor hardcoded (mesmo do front). Não substitui o JWT — só reforça o gate.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class RequireDbBrowserTokenAttribute : Attribute, IAuthorizationFilter
{
    public const string HeaderName = "X-Db-Browser-Token";

    /// <summary>Token hardcoded compartilhado com o front (apps/web/lib/db-browser.ts).</summary>
    public const string ExpectedToken = "SapDbBrowser-2026-HardGate";

    public void OnAuthorization(AuthorizationFilterContext context)
    {
        var provided = context.HttpContext.Request.Headers[HeaderName].ToString();
        if (!TokenEquals(provided, ExpectedToken))
        {
            context.Result = new ObjectResult(new ProblemDetails
            {
                Title = "Token do painel DB inválido",
                Detail = "Informe o token de acesso do painel de banco de dados.",
                Status = StatusCodes.Status401Unauthorized,
            })
            { StatusCode = StatusCodes.Status401Unauthorized };
        }
    }

    public static bool TokenEquals(string? provided, string expected)
    {
        provided ??= "";
        var a = Encoding.UTF8.GetBytes(provided);
        var b = Encoding.UTF8.GetBytes(expected);
        if (a.Length != b.Length) return false;
        return CryptographicOperations.FixedTimeEquals(a, b);
    }
}
