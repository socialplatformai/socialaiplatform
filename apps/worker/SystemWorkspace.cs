using SocialAi.Api.Infrastructure;

namespace SocialAi.Worker;

/// <summary>
/// Jobs do worker são SISTÊMICOS (sem usuário/tenant). WorkspaceId=null faz o
/// global query filter do AppDbContext deixar passar todos os workspaces — o job
/// opera sobre todos os tenants. O isolamento por workspace é gravado nas próprias
/// entidades (WorkspaceId já vem preenchido nos registros agendados).
/// </summary>
public sealed class SystemWorkspace : ICurrentWorkspace
{
    public Guid? WorkspaceId => null;
}
