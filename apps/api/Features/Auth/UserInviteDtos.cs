using SocialAi.Api.Domain;

namespace SocialAi.Api.Features.Auth;

// B1/B2 (ADR-0010): contratos de convite + gestão de usuários.
public record InviteRequest(string Email, UserRole Role);
public record InviteResponse(string Token, string Link);
public record AcceptInviteRequest(string Token, string Password, string? Name);
public record UserDto(Guid Id, string Email, string? Name, string Role);
