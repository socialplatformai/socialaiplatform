namespace SocialAi.Api.Infrastructure;

/// <summary>
/// Resolve o workspace do request atual (do claim JWT). Implementação concreta
/// (JWT-based) chega em T-2.2.2; o DbContext depende apenas desta abstração para
/// aplicar o global query filter por WorkspaceId.
/// </summary>
public interface ICurrentWorkspace
{
    /// <summary>WorkspaceId do request, ou null fora de um contexto autenticado (ex.: migrations).</summary>
    Guid? WorkspaceId { get; }
}
