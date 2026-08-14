namespace SocialAi.Api.Features.Brand;

// Espelha apps/api/Domain.BrandKit (§2.1 + E2/ADR-0005). PUT idempotente do brand-kit da marca.
public record BrandKitDto(
    string? Branding,
    string? Tone,
    string? EditorialGuidelines,
    string? PositioningRules,
    string? DesiredContentTypes,
    // E2: identidade visual & texto de marca. Todos opcionais (default = preset/fallback).
    string? VisualPreset = null,
    string? PrimaryColorHex = null,
    string? SecondaryColorHex = null,
    string? AccentColorHex = null,
    string? BackgroundColorHex = null,
    string? TextColorHex = null,
    string? HeadingFont = null,
    string? BodyFont = null,
    string? LogoUrl = null,
    string? TargetAudience = null,
    IEnumerable<string>? CopyExamples = null);

public record CompetitorDto(Guid Id, string Handle, string? Notes);
public record CompetitorInput(string Handle, string? Notes);

public record VisualReferenceDto(Guid Id, string Url, string? Description);
public record VisualReferenceInput(string Url, string? Description);

/// <summary>
/// Payload consumido pelo microserviço agents (E-5). DEVE alinhar com
/// services/agents/src/types.ts > BrandContext. learningSummary é injetado pelo
/// loop de aprendizado (E-8); aqui sai vazio.
/// </summary>
public record BrandContextDto(
    string WorkspaceId,
    string? Branding,
    string? Tone,
    string? Guidelines,
    IEnumerable<string> Competitors,
    IEnumerable<string> VisualReferences,
    string? LearningSummary);
