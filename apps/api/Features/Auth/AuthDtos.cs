namespace SocialAi.Api.Features.Auth;

public record RegisterRequest(string Email, string Password, string? Name, string? WorkspaceName);
public record LoginRequest(string Email, string Password);
public record RefreshRequest(string RefreshToken);

public record AuthResponse(
    string AccessToken,
    DateTimeOffset ExpiresAt,
    string RefreshToken,
    Guid WorkspaceId,
    Guid UserId,
    string Role);
