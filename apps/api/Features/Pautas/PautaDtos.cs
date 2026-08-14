using SocialAi.Api.Domain;

namespace SocialAi.Api.Features.Pautas;

public record AttachmentDto(Guid Id, string Url, string? FileName, string? ContentType);
public record AttachmentInput(string Url, string? FileName, string? ContentType);

public record PautaInput(
    string Title,
    string? Objective,
    string? Context,
    Priority Priority,
    string? Category,
    ContentType DesiredType,
    DateTimeOffset? SuggestedDate,
    IEnumerable<AttachmentInput>? Attachments,
    string? MarketingObjective = null, // E3.2
    Guid? ForcedTemplateId = null);    // D3 (ADR-0008): template forçado (null = seleção automática)

public record PautaDto(
    Guid Id,
    string Title,
    string? Objective,
    string? Context,
    Priority Priority,
    string? Category,
    ContentType DesiredType,
    DateTimeOffset? SuggestedDate,
    PautaStatus Status,
    IEnumerable<AttachmentDto> Attachments,
    string? MarketingObjective = null, // E3.2
    Guid? ForcedTemplateId = null);    // D3

public record PautaStatusUpdate(PautaStatus Status);
