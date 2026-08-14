namespace SocialAi.Api.Infrastructure;

/// <summary>
/// Resolve a marca atual do request (E1/ADR-0002). Vem do header X-Brand-Id — NÃO
/// de claim do JWT, para que trocar de marca não exija reemitir token (espelha o
/// padrão de workspace sem inflá-lo). Brand é sub-chave DENTRO do workspace; a
/// validação de que a marca pertence ao workspace do JWT é feita no controller
/// (defense-in-depth). null quando o header está ausente ou inválido.
/// </summary>
public interface ICurrentBrand
{
    Guid? BrandId { get; }
}

public class CurrentBrand(IHttpContextAccessor accessor) : ICurrentBrand
{
    public const string BrandHeader = "X-Brand-Id";

    public Guid? BrandId
    {
        get
        {
            var raw = accessor.HttpContext?.Request.Headers[BrandHeader].ToString();
            return Guid.TryParse(raw, out var id) ? id : null;
        }
    }
}
