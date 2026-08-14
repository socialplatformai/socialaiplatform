using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using SocialAi.Api.Domain;

namespace SocialAi.Api.Data.Seed;

/// <summary>
/// Semeia os 4 templates built-in (D1/ADR-0008) num workspace, de forma IDEMPOTENTE:
/// só insere o que falta (compara por Key). Fonte da verdade = o JSON embutido
/// (Data/Seed/builtin-templates.json), gerado de services/agents/src/templates por
/// scripts/export-templates.mjs — assim o SpecJson é FIEL ao CarouselTemplate que o
/// agents recebe e valida (D5). O seed é por-workspace (como a marca-default/budget no
/// Register), não na migration (que não conhece workspaces).
///
/// SpecJson é o elemento JSON BRUTO de cada template (sem reserializar via POCO) — preserva
/// o shape exato; o teste de contrato (.NET ⇄ agents) trava qualquer drift.
/// </summary>
public static class TemplateSeeder
{
    private const string ResourceName = "SocialAi.Core.Data.Seed.builtin-templates.json";

    /// <summary>Modelo cru de um template built-in lido do JSON (id/name/description + spec bruto).</summary>
    public readonly record struct BuiltinTemplate(string Key, string Name, string? Description, string SpecJson);

    private static IReadOnlyList<BuiltinTemplate>? _cache;

    /// <summary>Lê e parseia os built-in do recurso embutido (uma vez; cacheado).</summary>
    public static IReadOnlyList<BuiltinTemplate> LoadBuiltins()
    {
        if (_cache is not null) return _cache;

        var asm = typeof(TemplateSeeder).Assembly;
        using var stream = asm.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"Recurso embutido ausente: {ResourceName}");
        using var reader = new StreamReader(stream);
        var raw = reader.ReadToEnd();

        var arr = JsonNode.Parse(raw)?.AsArray()
            ?? throw new InvalidOperationException("builtin-templates.json: esperado um array JSON.");

        var list = new List<BuiltinTemplate>(arr.Count);
        foreach (var node in arr)
        {
            if (node is null) continue;
            var obj = node.AsObject();
            var key = obj["id"]?.GetValue<string>()
                ?? throw new InvalidOperationException("template built-in sem 'id'.");
            var name = obj["name"]?.GetValue<string>() ?? key;
            var description = obj["description"]?.GetValue<string>();
            // SpecJson = o objeto inteiro do template, bruto (camelCase) — o que o agents espera.
            var specJson = obj.ToJsonString();
            list.Add(new BuiltinTemplate(key, name, description, specJson));
        }
        _cache = list;
        return list;
    }

    /// <summary>
    /// Garante que o workspace tenha os 4 templates built-in. Idempotente: insere só os Keys
    /// ausentes (não duplica, não sobrescreve curadoria nem edições). NÃO chama SaveChanges —
    /// o chamador controla a transação (no Register, junto do resto do tenant).
    /// </summary>
    public static async Task EnsureAsync(AppDbContext db, Guid workspaceId, CancellationToken ct = default)
    {
        var builtins = LoadBuiltins();

        // Keys já presentes neste workspace (IgnoreQueryFilters: o seed sistêmico do startup
        // roda sem workspace atual; filtramos explicitamente por workspaceId — isolamento manual).
        var existingKeys = await db.Templates
            .IgnoreQueryFilters()
            .Where(t => t.WorkspaceId == workspaceId)
            .Select(t => t.Key)
            .ToListAsync(ct);
        var present = existingKeys.ToHashSet();

        foreach (var b in builtins)
        {
            if (present.Contains(b.Key)) continue;
            db.Templates.Add(new Template
            {
                WorkspaceId = workspaceId,
                Key = b.Key,
                Name = b.Name,
                Description = b.Description,
                SpecJson = b.SpecJson,
                BuiltIn = true,
            });
        }
    }
}
