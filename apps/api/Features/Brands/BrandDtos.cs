namespace SocialAi.Api.Features.Brands;

public record BrandDto(Guid Id, string Name, DateTimeOffset CreatedAt);

public record BrandInput(string Name);
