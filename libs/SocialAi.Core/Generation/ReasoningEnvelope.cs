using System.Text.Json;
using System.Text.Json.Nodes;

namespace SocialAi.Api.Generation;

/// <summary>
/// Ponto único da serialização do envelope Content.ReasoningJson. Co-localiza o raciocínio da IA e
/// as alternativas A/B (headlines/CTAs) numa mesma coluna text (sem migração):
/// `{ ...raciocínio, alternatives }`. O GET re-separa (ContentController.SplitReasoningEnvelope) em
/// campos distintos do DTO, mantendo o painel "Raciocínio da IA" limpo.
///
/// Havia dois builders espelhados — um na API (poll) e outro no worker (reaper). Eles produziam o
/// mesmo JSON, mas divergiriam silenciosamente no 1º campo novo do envelope. Ambos os caminhos
/// persistem o mesmo conteúdo conforme quem vence a corrida Generating→Draft, então o layout do
/// metadado não pode depender do caminho. Esta função é o contrato compartilhado; o
/// ReasoningEnvelopeParityTests trava a paridade.
///
/// Forma OPACA (string→string) de propósito: a API serializa seus tipos fortes (AgentsReasoning/
/// AgentsAlternatives) p/ JSON e chama; o worker já tem JsonElement opaco e chama. Nenhum dos dois
/// reimplementa a montagem.
/// </summary>
public static class ReasoningEnvelope
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    /// <summary>
    /// Monta o envelope a partir do raciocínio (objeto JSON) e das alternativas (objeto JSON), ambos
    /// JÁ serializados em string (camelCase web) pelos callers. null/vazio em qualquer um = ausente.
    /// Retorna null quando AMBOS ausentes (→ coluna ReasoningJson null → a UI omite os dois painéis).
    /// Raciocínio ausente mas alternativas presentes → `{ "alternatives": {...} }` (objeto sem campos
    /// de raciocínio; o GET devolve reasoning=null nesse caso). JSON malformado num dos dois → tratado
    /// como ausente (degradado honesto: nunca lança ao persistir).
    /// </summary>
    public static string? Build(string? reasoningJson, string? alternativesJson)
    {
        var reasoning = TryParseObject(reasoningJson);
        var alternatives = TryParseObject(alternativesJson);
        if (reasoning is null && alternatives is null) return null;

        var node = reasoning ?? new JsonObject();
        if (alternatives is not null) node["alternatives"] = alternatives;
        return node.ToJsonString(Web);
    }

    /// <summary>Parseia uma string JSON p/ JsonObject; null/vazio/não-objeto/malformado → null (tolerante).</summary>
    private static JsonObject? TryParseObject(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonNode.Parse(json)?.AsObject(); }
        catch (JsonException) { return null; }
    }
}
