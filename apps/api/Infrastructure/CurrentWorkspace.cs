using System.Security.Claims;

namespace SocialAi.Api.Infrastructure;

/// <summary>Resolve o WorkspaceId do claim JWT do request. (Detalhe completo em T-2.2.2.)</summary>
public class CurrentWorkspace(IHttpContextAccessor accessor) : ICurrentWorkspace
{
    public const string WorkspaceClaim = "workspace_id";

    public Guid? WorkspaceId
    {
        get
        {
            var raw = accessor.HttpContext?.User?.FindFirstValue(WorkspaceClaim);
            return Guid.TryParse(raw, out var id) ? id : null;
        }
    }
}
