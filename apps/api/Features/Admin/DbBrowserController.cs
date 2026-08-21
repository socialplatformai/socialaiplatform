using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SocialAi.Api.Infrastructure;

namespace SocialAi.Api.Features.Admin;

public record DbInsertRequest(Dictionary<string, JsonElement?> Values);
public record DbUpdateRequest(
    Dictionary<string, JsonElement?> PrimaryKey,
    Dictionary<string, JsonElement?> Changes);
public record DbDeleteRequest(Dictionary<string, JsonElement?> PrimaryKey);
public record DbCreateTableRequest(string Name, List<DbColumnDef> Columns);
public record DbAddColumnRequest(DbColumnDef Column);
public record DbRenameColumnRequest(string From, string To);
public record DbDropColumnRequest(string Column);

/// <summary>
/// Painel Admin de visualização/edição do Postgres (schema public).
/// Reusa ConnectionStrings:Postgres via DbBrowserService/AppDbContext.
/// Sem SQL arbitrário. Somente Admin.
/// </summary>
[ApiController]
[Authorize(Roles = "Admin")]
[RequireDbBrowserToken]
[Route("api/admin/database")]
public class DbBrowserController(
    DbBrowserService browser,
    Audit.AuditService audit,
    ICurrentWorkspace current) : ControllerBase
{
    private Guid Ws => current.WorkspaceId!.Value;
    private Guid ActorId => User.ActorId();
    private string ActorEmail => User.ActorEmail();

    [HttpGet("column-types")]
    public ActionResult<IReadOnlyList<string>> ColumnTypes() => Ok(browser.ListColumnTypes());

    [HttpGet("tables")]
    public async Task<ActionResult<IReadOnlyList<DbTableInfo>>> Tables(CancellationToken ct)
    {
        try { return Ok(await browser.ListTablesAsync(ct)); }
        catch (Exception ex) { return Problem(ex.Message, statusCode: 500); }
    }

    [HttpPost("tables")]
    public async Task<ActionResult<DbWriteResult>> CreateTable(DbCreateTableRequest req, CancellationToken ct)
    {
        try
        {
            var result = await browser.CreateTableAsync(req.Name, req.Columns ?? [], ct);
            if (!result.Ok) return Problem(result.Message ?? "Falha ao criar tabela.", statusCode: 400);
            var cols = string.Join(",", (req.Columns ?? []).Select(c => c.Name));
            await audit.LogAsync(Ws, ActorId, ActorEmail, "db.create-table", $"{req.Name}|cols={cols}");
            return Ok(result);
        }
        catch (DbBrowserException ex) { return Problem(ex.Message, statusCode: 400); }
    }

    [HttpDelete("tables/{table}")]
    public async Task<ActionResult<DbWriteResult>> DropTable(string table, CancellationToken ct)
    {
        try
        {
            var result = await browser.DropTableAsync(table, ct);
            if (!result.Ok) return Problem(result.Message ?? "Falha ao remover tabela.", statusCode: 400);
            await audit.LogAsync(Ws, ActorId, ActorEmail, "db.drop-table", table);
            return Ok(result);
        }
        catch (DbBrowserException ex) { return Problem(ex.Message, statusCode: 400); }
    }

    [HttpGet("tables/{table}/schema")]
    public async Task<ActionResult<DbTableSchema>> Schema(string table, CancellationToken ct)
    {
        try { return Ok(await browser.GetSchemaAsync(table, ct)); }
        catch (DbBrowserException ex) { return Problem(ex.Message, statusCode: 400); }
    }

    [HttpPost("tables/{table}/columns")]
    public async Task<ActionResult<DbWriteResult>> AddColumn(string table, DbAddColumnRequest req, CancellationToken ct)
    {
        try
        {
            if (req.Column is null) return Problem("Coluna obrigatória.", statusCode: 400);
            var result = await browser.AddColumnAsync(table, req.Column, ct);
            if (!result.Ok) return Problem(result.Message ?? "Falha ao adicionar coluna.", statusCode: 400);
            await audit.LogAsync(Ws, ActorId, ActorEmail, "db.add-column", $"{table}|{req.Column.Name}|{req.Column.Type}");
            return Ok(result);
        }
        catch (DbBrowserException ex) { return Problem(ex.Message, statusCode: 400); }
    }

    [HttpPatch("tables/{table}/columns")]
    public async Task<ActionResult<DbWriteResult>> RenameColumn(string table, DbRenameColumnRequest req, CancellationToken ct)
    {
        try
        {
            var result = await browser.RenameColumnAsync(table, req.From, req.To, ct);
            if (!result.Ok) return Problem(result.Message ?? "Falha ao renomear coluna.", statusCode: 400);
            await audit.LogAsync(Ws, ActorId, ActorEmail, "db.rename-column", $"{table}|{req.From}→{req.To}");
            return Ok(result);
        }
        catch (DbBrowserException ex) { return Problem(ex.Message, statusCode: 400); }
    }

    [HttpDelete("tables/{table}/columns")]
    public async Task<ActionResult<DbWriteResult>> DropColumn(string table, [FromBody] DbDropColumnRequest req, CancellationToken ct)
    {
        try
        {
            var result = await browser.DropColumnAsync(table, req.Column, ct);
            if (!result.Ok) return Problem(result.Message ?? "Falha ao remover coluna.", statusCode: 400);
            await audit.LogAsync(Ws, ActorId, ActorEmail, "db.drop-column", $"{table}|{req.Column}");
            return Ok(result);
        }
        catch (DbBrowserException ex) { return Problem(ex.Message, statusCode: 400); }
    }

    [HttpGet("tables/{table}/rows")]
    public async Task<ActionResult<DbRowsPage>> Rows(
        string table,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] string? sort = null,
        [FromQuery] string? sortDir = "asc",
        [FromQuery] string? q = null,
        CancellationToken ct = default)
    {
        try
        {
            return Ok(await browser.GetRowsAsync(table, page, pageSize, sort, sortDir, q, ct));
        }
        catch (DbBrowserException ex) { return Problem(ex.Message, statusCode: 400); }
    }

    [HttpPost("tables/{table}/rows")]
    public async Task<ActionResult<DbWriteResult>> Insert(string table, DbInsertRequest req, CancellationToken ct)
    {
        try
        {
            var result = await browser.InsertAsync(table, req.Values ?? [], ct);
            if (!result.Ok) return Problem(result.Message ?? "Falha ao inserir.", statusCode: 400);
            await audit.LogAsync(Ws, ActorId, ActorEmail, "db.insert", table);
            return Ok(result);
        }
        catch (DbBrowserException ex) { return Problem(ex.Message, statusCode: 400); }
    }

    [HttpPatch("tables/{table}/rows")]
    public async Task<ActionResult<DbWriteResult>> Update(string table, DbUpdateRequest req, CancellationToken ct)
    {
        try
        {
            var changes = req.Changes ?? [];
            // Auditoria: só nomes de campos alterados (nunca valores — podem ser sensíveis).
            var changedNames = string.Join(",", changes.Keys.Where(k => !DbBrowserService.IsSensitiveColumn(k)));
            var result = await browser.UpdateAsync(table, req.PrimaryKey ?? [], changes, ct);
            if (!result.Ok) return Problem(result.Message ?? "Falha ao atualizar.", statusCode: 400);
            var pkSummary = string.Join(",", (req.PrimaryKey ?? []).Select(kv => $"{kv.Key}={JsonPreview(kv.Value)}"));
            await audit.LogAsync(Ws, ActorId, ActorEmail, "db.update",
                $"{table}|pk={pkSummary}|fields={changedNames}");
            return Ok(result);
        }
        catch (DbBrowserException ex) { return Problem(ex.Message, statusCode: 400); }
    }

    [HttpDelete("tables/{table}/rows")]
    public async Task<ActionResult<DbWriteResult>> Delete(string table, [FromBody] DbDeleteRequest req, CancellationToken ct)
    {
        try
        {
            var result = await browser.DeleteAsync(table, req.PrimaryKey ?? [], ct);
            if (!result.Ok) return Problem(result.Message ?? "Falha ao excluir.", statusCode: 400);
            var pkSummary = string.Join(",", (req.PrimaryKey ?? []).Select(kv => $"{kv.Key}={JsonPreview(kv.Value)}"));
            await audit.LogAsync(Ws, ActorId, ActorEmail, "db.delete", $"{table}|pk={pkSummary}");
            return Ok(result);
        }
        catch (DbBrowserException ex) { return Problem(ex.Message, statusCode: 400); }
    }

    private static string JsonPreview(JsonElement? el)
    {
        if (el is null || el.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) return "null";
        if (el.Value.ValueKind == JsonValueKind.String)
        {
            var s = el.Value.GetString() ?? "";
            return s.Length > 64 ? s[..64] + "…" : s;
        }
        var raw = el.Value.GetRawText();
        return raw.Length > 64 ? raw[..64] + "…" : raw;
    }
}
