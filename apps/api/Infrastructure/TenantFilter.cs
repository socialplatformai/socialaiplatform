using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace SocialAi.Api.Infrastructure;

/// <summary>
/// Garante que requests autenticados carreguem um workspace válido no JWT.
/// Aplicado globalmente; endpoints anônimos (auth) passam por não estarem autenticados.
/// Combina com o global query filter (leitura) e o stamping no SaveChanges (escrita)
/// para isolamento por tenant em três camadas.
/// </summary>
public class RequireWorkspaceFilter(ICurrentWorkspace current) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext ctx, ActionExecutionDelegate next)
    {
        var user = ctx.HttpContext.User;
        var isAuthenticated = user?.Identity?.IsAuthenticated == true;

        if (isAuthenticated && current.WorkspaceId is null)
        {
            ctx.Result = new ObjectResult(new ProblemDetails
            {
                Title = "Workspace ausente",
                Detail = "O token não contém um workspace_id válido.",
                Status = StatusCodes.Status403Forbidden,
            })
            { StatusCode = StatusCodes.Status403Forbidden };
            return;
        }

        await next();
    }
}
