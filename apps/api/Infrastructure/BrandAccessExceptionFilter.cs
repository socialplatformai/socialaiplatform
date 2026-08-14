using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using SocialAi.Api.Features.Brands;

namespace SocialAi.Api.Infrastructure;

/// <summary>
/// Mapeia o acesso a uma marca de outro workspace (X-Brand-Id inválido) para 403,
/// em vez de 500. Defense-in-depth do isolamento de marca (E1/ADR-0002): o filtro
/// global de workspace já impede VER a marca; este transforma a tentativa explícita
/// num erro de autorização claro e não vaza detalhe.
/// </summary>
public sealed class BrandAccessExceptionFilter : IExceptionFilter
{
    public void OnException(ExceptionContext context)
    {
        if (context.Exception is BrandResolver.CrossWorkspaceBrandException)
        {
            context.Result = new ObjectResult(new ProblemDetails
            {
                // CONTRATO COM A UI: este Title é o sinal que apps/web/lib/api.ts usa
                // (INVALID_BRAND_TITLE) p/ distinguir "marca inválida" de "ação sem
                // permissão" e auto-recuperar (limpa sap_brand + retry). Mudar aqui
                // exige mudar lá — senão a recuperação silenciosamente para de funcionar.
                Title = "Marca inválida para o workspace atual.",
                Status = StatusCodes.Status403Forbidden,
            })
            { StatusCode = StatusCodes.Status403Forbidden };
            context.ExceptionHandled = true;
        }
    }
}
