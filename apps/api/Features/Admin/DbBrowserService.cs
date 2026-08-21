using System.Data;
using System.Data.Common;
using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using SocialAi.Api.Data;

namespace SocialAi.Api.Features.Admin;

// DTOs do browser de Postgres (Admin). Nenhum secret/connection string aqui.
public record DbTableInfo(string Name, long ApproxRows);
public record DbForeignKeyInfo(string Column, string ReferencedTable, string ReferencedColumn);
public record DbColumnInfo(
    string Name,
    string DataType,
    string? UdtName,
    bool IsNullable,
    bool IsPrimaryKey,
    bool IsIdentity,
    string? DefaultValue,
    DbForeignKeyInfo? ForeignKey,
    bool IsSensitive);
public record DbTableSchema(string Table, IReadOnlyList<DbColumnInfo> Columns, bool CanMutate, string? MutateBlockReason);
public record DbRowsPage(
    string Table,
    IReadOnlyList<string> Columns,
    IReadOnlyList<IReadOnlyDictionary<string, object?>> Rows,
    int Page,
    int PageSize,
    long Total,
    string? Sort,
    string SortDir);
public record DbWriteResult(bool Ok, string? Message = null);

/// <summary>Definição de coluna para CREATE TABLE / ADD COLUMN (tipo da allowlist).</summary>
public record DbColumnDef(
    string Name,
    string Type,
    bool Nullable = true,
    bool PrimaryKey = false,
    bool Identity = false);

/// <summary>
/// Browser dinâmico do schema public via a MESMA conexão do AppDbContext (ConnectionStrings:Postgres).
/// Sem SQL arbitrário: só operações estruturadas; identifiers allowlisted via information_schema.
/// </summary>
public sealed class DbBrowserService(AppDbContext db)
{
    private static readonly Regex SafeIdent = new(@"^[A-Za-z_][A-Za-z0-9_]*$", RegexOptions.Compiled);
    private static readonly string[] SensitiveNameParts =
        ["password", "secret", "encrypted", "apikey", "api_key", "token", "credential"];

    /// <summary>Tipos PostgreSQL permitidos na UI (sem SQL livre).</summary>
    public static IReadOnlyList<string> AllowedColumnTypes { get; } =
    [
        "uuid", "text", "varchar(255)", "boolean",
        "smallint", "integer", "bigint", "numeric", "real", "double precision",
        "date", "timestamp", "timestamptz",
        "jsonb", "json", "bytea",
    ];

    private static readonly HashSet<string> AllowedTypesSet =
        new(AllowedColumnTypes, StringComparer.OrdinalIgnoreCase);

    public async Task<IReadOnlyList<DbTableInfo>> ListTablesAsync(CancellationToken ct)
    {
        var conn = await OpenSharedAsync(ct);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT c.relname AS name,
                   GREATEST(c.reltuples::bigint, 0) AS approx_rows
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relkind = 'r'
            ORDER BY c.relname;
            """;
        var list = new List<DbTableInfo>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
            list.Add(new DbTableInfo(r.GetString(0), r.GetInt64(1)));
        return list;
    }

    public async Task<DbTableSchema> GetSchemaAsync(string table, CancellationToken ct)
    {
        var tableName = await RequireTableAsync(table, ct);
        var conn = await OpenSharedAsync(ct);

        var pkCols = await LoadPrimaryKeysAsync(conn, tableName, ct);
        var fks = await LoadForeignKeysAsync(conn, tableName, ct);

        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT column_name, data_type, udt_name, is_nullable, column_default,
                   COALESCE(is_identity, 'NO') AS is_identity
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = @t
            ORDER BY ordinal_position;
            """;
        AddParam(cmd, "t", tableName);

        var cols = new List<DbColumnInfo>();
        await using (var r = await cmd.ExecuteReaderAsync(ct))
        {
            while (await r.ReadAsync(ct))
            {
                var name = r.GetString(0);
                var dataType = r.GetString(1);
                var udt = r.IsDBNull(2) ? null : r.GetString(2);
                var nullable = string.Equals(r.GetString(3), "YES", StringComparison.OrdinalIgnoreCase);
                var def = r.IsDBNull(4) ? null : r.GetString(4);
                var identity = string.Equals(r.GetString(5), "YES", StringComparison.OrdinalIgnoreCase)
                               || (def?.Contains("nextval", StringComparison.OrdinalIgnoreCase) ?? false);
                fks.TryGetValue(name, out var fk);
                cols.Add(new DbColumnInfo(
                    name, dataType, udt, nullable, pkCols.Contains(name), identity, def, fk,
                    IsSensitiveColumn(name)));
            }
        }

        var canMutate = pkCols.Count > 0;
        return new DbTableSchema(
            tableName, cols, canMutate,
            canMutate ? null : "Esta tabela não tem PRIMARY KEY — edição e exclusão estão desabilitadas.");
    }

    public async Task<DbRowsPage> GetRowsAsync(
        string table, int page, int pageSize, string? sort, string? sortDir, string? q, CancellationToken ct)
    {
        var tableName = await RequireTableAsync(table, ct);
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);
        var dir = string.Equals(sortDir, "desc", StringComparison.OrdinalIgnoreCase) ? "DESC" : "ASC";

        var conn = await OpenSharedAsync(ct);
        var columns = await LoadColumnNamesAsync(conn, tableName, ct);
        if (columns.Count == 0)
            return new DbRowsPage(tableName, columns, [], page, pageSize, 0, null, dir);

        string sortCol;
        if (!string.IsNullOrWhiteSpace(sort) && columns.Contains(sort, StringComparer.Ordinal))
            sortCol = sort;
        else if (columns.Contains("Id", StringComparer.Ordinal))
            sortCol = columns.First(c => c.Equals("Id", StringComparison.Ordinal));
        else
            sortCol = columns[0];

        var searchable = columns.Where(c => !IsSensitiveColumn(c)).ToList();
        var where = "";
        await using var countCmd = conn.CreateCommand();
        await using var dataCmd = conn.CreateCommand();
        if (!string.IsNullOrWhiteSpace(q) && searchable.Count > 0)
        {
            var parts = searchable.Select(c => $"CAST({Q(c)} AS text) ILIKE @q").ToList();
            where = " WHERE " + string.Join(" OR ", parts);
            AddParam(countCmd, "q", "%" + q.Trim() + "%");
            AddParam(dataCmd, "q", "%" + q.Trim() + "%");
        }

        countCmd.CommandText = $"SELECT COUNT(*) FROM {Q(tableName)}{where};";
        var total = Convert.ToInt64(await countCmd.ExecuteScalarAsync(ct), CultureInfo.InvariantCulture);

        var offset = (page - 1) * pageSize;
        var selectList = string.Join(", ", columns.Select(Q));
        dataCmd.CommandText =
            $"SELECT {selectList} FROM {Q(tableName)}{where} ORDER BY {Q(sortCol)} {dir} LIMIT @lim OFFSET @off;";
        AddParam(dataCmd, "lim", pageSize);
        AddParam(dataCmd, "off", offset);

        var rows = new List<IReadOnlyDictionary<string, object?>>();
        await using var r = await dataCmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
        {
            var dict = new Dictionary<string, object?>(StringComparer.Ordinal);
            for (var i = 0; i < columns.Count; i++)
            {
                var col = columns[i];
                if (r.IsDBNull(i))
                    dict[col] = null;
                else if (IsSensitiveColumn(col))
                    dict[col] = "***";
                else
                    dict[col] = NormalizeCell(r.GetValue(i));
            }
            rows.Add(dict);
        }

        return new DbRowsPage(tableName, columns, rows, page, pageSize, total, sortCol, dir);
    }

    public async Task<DbWriteResult> InsertAsync(
        string table, IReadOnlyDictionary<string, JsonElement?> values, CancellationToken ct)
    {
        var tableName = await RequireTableAsync(table, ct);
        var conn = await OpenSharedAsync(ct);
        var schema = await LoadColumnMetaAsync(conn, tableName, ct);

        var insertable = schema
            .Where(c => !c.IsIdentity && !IsSensitiveColumn(c.Name))
            .Select(c => c.Name)
            .ToHashSet(StringComparer.Ordinal);

        var cols = new List<string>();
        var parms = new List<string>();
        await using var cmd = conn.CreateCommand();
        var i = 0;
        foreach (var (key, el) in values)
        {
            if (!insertable.Contains(key)) continue;
            if (el is null || el.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined) continue;
            cols.Add(Q(key));
            var p = "p" + i++;
            parms.Add("@" + p);
            AddParam(cmd, p, JsonToDb(el.Value, schema.First(c => c.Name == key)));
        }

        if (cols.Count == 0)
            return new DbWriteResult(false, "Nenhum campo válido para inserir.");

        cmd.CommandText = $"INSERT INTO {Q(tableName)} ({string.Join(", ", cols)}) VALUES ({string.Join(", ", parms)});";
        try
        {
            await cmd.ExecuteNonQueryAsync(ct);
            return new DbWriteResult(true);
        }
        catch (PostgresException ex)
        {
            return new DbWriteResult(false, FriendlyPg(ex));
        }
    }

    public async Task<DbWriteResult> UpdateAsync(
        string table,
        IReadOnlyDictionary<string, JsonElement?> primaryKey,
        IReadOnlyDictionary<string, JsonElement?> changes,
        CancellationToken ct)
    {
        var tableName = await RequireTableAsync(table, ct);
        var conn = await OpenSharedAsync(ct);
        var schema = await LoadColumnMetaAsync(conn, tableName, ct);
        var pk = schema.Where(c => c.IsPrimaryKey).Select(c => c.Name).ToList();
        if (pk.Count == 0)
            return new DbWriteResult(false, "Tabela sem PRIMARY KEY — UPDATE bloqueado.");

        foreach (var k in pk)
            if (!primaryKey.ContainsKey(k))
                return new DbWriteResult(false, $"PRIMARY KEY incompleta: falta '{k}'.");

        var updatable = schema
            .Where(c => !c.IsPrimaryKey && !c.IsIdentity && !IsSensitiveColumn(c.Name))
            .Select(c => c.Name)
            .ToHashSet(StringComparer.Ordinal);

        var sets = new List<string>();
        await using var cmd = conn.CreateCommand();
        var i = 0;
        foreach (var (key, el) in changes)
        {
            if (!updatable.Contains(key)) continue;
            if (IsSensitiveColumn(key))
                return new DbWriteResult(false, $"Coluna sensível '{key}' não pode ser alterada por este painel.");
            var p = "s" + i++;
            sets.Add($"{Q(key)} = @{p}");
            AddParam(cmd, p, el is null || el.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined
                ? DBNull.Value
                : JsonToDb(el.Value, schema.First(c => c.Name == key)));
        }

        if (sets.Count == 0)
            return new DbWriteResult(false, "Nenhuma alteração válida.");

        var wheres = new List<string>();
        foreach (var k in pk)
        {
            var p = "k" + i++;
            wheres.Add($"{Q(k)} = @{p}");
            var el = primaryKey[k];
            if (el is null || el.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
                return new DbWriteResult(false, "PRIMARY KEY não pode ser nula.");
            AddParam(cmd, p, JsonToDb(el.Value, schema.First(c => c.Name == k)));
        }

        cmd.CommandText =
            $"UPDATE {Q(tableName)} SET {string.Join(", ", sets)} WHERE {string.Join(" AND ", wheres)};";
        try
        {
            var n = await cmd.ExecuteNonQueryAsync(ct);
            return n == 0
                ? new DbWriteResult(false, "Nenhum registro atualizado (chave não encontrada).")
                : new DbWriteResult(true);
        }
        catch (PostgresException ex)
        {
            return new DbWriteResult(false, FriendlyPg(ex));
        }
    }

    public async Task<DbWriteResult> DeleteAsync(
        string table, IReadOnlyDictionary<string, JsonElement?> primaryKey, CancellationToken ct)
    {
        var tableName = await RequireTableAsync(table, ct);
        var conn = await OpenSharedAsync(ct);
        var schema = await LoadColumnMetaAsync(conn, tableName, ct);
        var pk = schema.Where(c => c.IsPrimaryKey).Select(c => c.Name).ToList();
        if (pk.Count == 0)
            return new DbWriteResult(false, "Tabela sem PRIMARY KEY — DELETE bloqueado.");

        await using var cmd = conn.CreateCommand();
        var wheres = new List<string>();
        var i = 0;
        foreach (var k in pk)
        {
            if (!primaryKey.TryGetValue(k, out var el) || el is null
                || el.Value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
                return new DbWriteResult(false, $"PRIMARY KEY incompleta: falta '{k}'.");
            var p = "k" + i++;
            wheres.Add($"{Q(k)} = @{p}");
            AddParam(cmd, p, JsonToDb(el.Value, schema.First(c => c.Name == k)));
        }

        cmd.CommandText = $"DELETE FROM {Q(tableName)} WHERE {string.Join(" AND ", wheres)};";
        try
        {
            var n = await cmd.ExecuteNonQueryAsync(ct);
            return n == 0
                ? new DbWriteResult(false, "Nenhum registro excluído (chave não encontrada).")
                : new DbWriteResult(true);
        }
        catch (PostgresException ex)
        {
            return new DbWriteResult(false, FriendlyPg(ex));
        }
    }

    // ── DDL estruturado (sem SQL livre) ──────────────────────────────────────

    public IReadOnlyList<string> ListColumnTypes() => AllowedColumnTypes;

    public async Task<DbWriteResult> CreateTableAsync(string name, IReadOnlyList<DbColumnDef> columns, CancellationToken ct)
    {
        RequireIdent(name, "tabela");
        if (columns is null || columns.Count == 0)
            return new DbWriteResult(false, "Informe ao menos uma coluna.");

        if (await TableExistsAsync(name, ct))
            return new DbWriteResult(false, $"Tabela '{name}' já existe.");

        var defs = new List<string>();
        var pks = new List<string>();
        foreach (var col in columns)
        {
            RequireIdent(col.Name, "coluna");
            var pgType = ResolveType(col.Type);
            if (col.Identity && pgType is not ("integer" or "bigint" or "smallint"))
                return new DbWriteResult(false, $"Identity só é permitido em integer/bigint/smallint (coluna '{col.Name}').");

            var parts = new List<string> { Q(col.Name), pgType };
            if (col.Identity) parts.Add("GENERATED BY DEFAULT AS IDENTITY");
            if (!col.Nullable && !col.PrimaryKey) parts.Add("NOT NULL");
            if (col.PrimaryKey) pks.Add(Q(col.Name));
            defs.Add(string.Join(" ", parts));
        }

        if (pks.Count > 0)
            defs.Add($"PRIMARY KEY ({string.Join(", ", pks)})");

        var conn = await OpenSharedAsync(ct);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"CREATE TABLE {Q(name)} ({string.Join(", ", defs)});";
        try
        {
            await cmd.ExecuteNonQueryAsync(ct);
            return new DbWriteResult(true);
        }
        catch (PostgresException ex) { return new DbWriteResult(false, FriendlyPg(ex)); }
    }

    public async Task<DbWriteResult> AddColumnAsync(string table, DbColumnDef column, CancellationToken ct)
    {
        var tableName = await RequireTableAsync(table, ct);
        RequireIdent(column.Name, "coluna");
        var pgType = ResolveType(column.Type);
        if (column.Identity && pgType is not ("integer" or "bigint" or "smallint"))
            return new DbWriteResult(false, "Identity só é permitido em integer/bigint/smallint.");

        var parts = new List<string> { "ADD COLUMN", Q(column.Name), pgType };
        if (column.Identity) parts.Add("GENERATED BY DEFAULT AS IDENTITY");
        if (!column.Nullable) parts.Add("NOT NULL");
        if (column.PrimaryKey) parts.Add("PRIMARY KEY");

        var conn = await OpenSharedAsync(ct);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"ALTER TABLE {Q(tableName)} {string.Join(" ", parts)};";
        try
        {
            await cmd.ExecuteNonQueryAsync(ct);
            return new DbWriteResult(true);
        }
        catch (PostgresException ex) { return new DbWriteResult(false, FriendlyPg(ex)); }
    }

    public async Task<DbWriteResult> RenameColumnAsync(string table, string from, string to, CancellationToken ct)
    {
        var tableName = await RequireTableAsync(table, ct);
        RequireIdent(from, "coluna");
        RequireIdent(to, "coluna");
        var cols = await LoadColumnNamesAsync(await OpenSharedAsync(ct), tableName, ct);
        if (!cols.Contains(from, StringComparer.Ordinal))
            return new DbWriteResult(false, $"Coluna '{from}' não existe.");
        if (cols.Contains(to, StringComparer.Ordinal))
            return new DbWriteResult(false, $"Coluna '{to}' já existe.");

        var conn = await OpenSharedAsync(ct);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"ALTER TABLE {Q(tableName)} RENAME COLUMN {Q(from)} TO {Q(to)};";
        try
        {
            await cmd.ExecuteNonQueryAsync(ct);
            return new DbWriteResult(true);
        }
        catch (PostgresException ex) { return new DbWriteResult(false, FriendlyPg(ex)); }
    }

    public async Task<DbWriteResult> DropColumnAsync(string table, string column, CancellationToken ct)
    {
        var tableName = await RequireTableAsync(table, ct);
        RequireIdent(column, "coluna");
        var cols = await LoadColumnNamesAsync(await OpenSharedAsync(ct), tableName, ct);
        if (!cols.Contains(column, StringComparer.Ordinal))
            return new DbWriteResult(false, $"Coluna '{column}' não existe.");
        if (cols.Count <= 1)
            return new DbWriteResult(false, "Não é possível remover a última coluna da tabela.");

        var conn = await OpenSharedAsync(ct);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"ALTER TABLE {Q(tableName)} DROP COLUMN {Q(column)};";
        try
        {
            await cmd.ExecuteNonQueryAsync(ct);
            return new DbWriteResult(true);
        }
        catch (PostgresException ex) { return new DbWriteResult(false, FriendlyPg(ex)); }
    }

    public async Task<DbWriteResult> DropTableAsync(string table, CancellationToken ct)
    {
        var tableName = await RequireTableAsync(table, ct);
        var conn = await OpenSharedAsync(ct);
        await using var cmd = conn.CreateCommand();
        // Só DROP TABLE — sem CASCADE (protege FKs). Sem TRUNCATE/DROP DATABASE.
        cmd.CommandText = $"DROP TABLE {Q(tableName)};";
        try
        {
            await cmd.ExecuteNonQueryAsync(ct);
            return new DbWriteResult(true);
        }
        catch (PostgresException ex) { return new DbWriteResult(false, FriendlyPg(ex)); }
    }

    private async Task<bool> TableExistsAsync(string table, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(table) || !SafeIdent.IsMatch(table)) return false;
        var conn = await OpenSharedAsync(ct);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name = @t
            LIMIT 1;
            """;
        AddParam(cmd, "t", table);
        return await cmd.ExecuteScalarAsync(ct) is not null;
    }

    private static void RequireIdent(string name, string kind)
    {
        if (string.IsNullOrWhiteSpace(name) || !SafeIdent.IsMatch(name))
            throw new DbBrowserException($"Nome de {kind} inválido (use letras/números/_).");
    }

    private static string ResolveType(string type)
    {
        var t = (type ?? "").Trim();
        if (!AllowedTypesSet.Contains(t))
            throw new DbBrowserException($"Tipo '{type}' não permitido. Use um tipo da lista.");
        return AllowedColumnTypes.First(a => a.Equals(t, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>Conexão compartilhada do EF — NÃO fazer Dispose/Close.</summary>
    private async Task<DbConnection> OpenSharedAsync(CancellationToken ct)
    {
        var conn = db.Database.GetDbConnection();
        if (conn.State != ConnectionState.Open)
            await conn.OpenAsync(ct);
        return conn;
    }

    private async Task<string> RequireTableAsync(string table, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(table) || !SafeIdent.IsMatch(table))
            throw new DbBrowserException("Nome de tabela inválido.");
        var conn = await OpenSharedAsync(ct);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name = @t
            LIMIT 1;
            """;
        AddParam(cmd, "t", table);
        var exists = await cmd.ExecuteScalarAsync(ct);
        if (exists is null)
            throw new DbBrowserException($"Tabela '{table}' não existe no schema public.");
        return table;
    }

    private static async Task<HashSet<string>> LoadPrimaryKeysAsync(DbConnection conn, string table, CancellationToken ct)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            WHERE tc.table_schema = 'public' AND tc.table_name = @t AND tc.constraint_type = 'PRIMARY KEY'
            ORDER BY kcu.ordinal_position;
            """;
        AddParam(cmd, "t", table);
        var set = new HashSet<string>(StringComparer.Ordinal);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) set.Add(r.GetString(0));
        return set;
    }

    private static async Task<Dictionary<string, DbForeignKeyInfo>> LoadForeignKeysAsync(
        DbConnection conn, string table, CancellationToken ct)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
            WHERE tc.table_schema = 'public' AND tc.table_name = @t AND tc.constraint_type = 'FOREIGN KEY';
            """;
        AddParam(cmd, "t", table);
        var map = new Dictionary<string, DbForeignKeyInfo>(StringComparer.Ordinal);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
            map[r.GetString(0)] = new DbForeignKeyInfo(r.GetString(0), r.GetString(1), r.GetString(2));
        return map;
    }

    private static async Task<List<string>> LoadColumnNamesAsync(DbConnection conn, string table, CancellationToken ct)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = @t
            ORDER BY ordinal_position;
            """;
        AddParam(cmd, "t", table);
        var list = new List<string>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) list.Add(r.GetString(0));
        return list;
    }

    private sealed record ColMeta(string Name, string DataType, string? Udt, bool IsPrimaryKey, bool IsIdentity, bool IsNullable);

    private async Task<List<ColMeta>> LoadColumnMetaAsync(DbConnection conn, string table, CancellationToken ct)
    {
        var pks = await LoadPrimaryKeysAsync(conn, table, ct);
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT column_name, data_type, udt_name, is_nullable, column_default,
                   COALESCE(is_identity, 'NO') AS is_identity
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = @t
            ORDER BY ordinal_position;
            """;
        AddParam(cmd, "t", table);
        var list = new List<ColMeta>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
        {
            var name = r.GetString(0);
            var def = r.IsDBNull(4) ? null : r.GetString(4);
            var identity = string.Equals(r.GetString(5), "YES", StringComparison.OrdinalIgnoreCase)
                           || (def?.Contains("nextval", StringComparison.OrdinalIgnoreCase) ?? false);
            list.Add(new ColMeta(
                name, r.GetString(1), r.IsDBNull(2) ? null : r.GetString(2),
                pks.Contains(name), identity,
                string.Equals(r.GetString(3), "YES", StringComparison.OrdinalIgnoreCase)));
        }
        return list;
    }

    private static string Q(string ident)
    {
        if (!SafeIdent.IsMatch(ident))
            throw new DbBrowserException("Identificador inválido.");
        return "\"" + ident.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
    }

    private static void AddParam(DbCommand cmd, string name, object? value)
    {
        var p = cmd.CreateParameter();
        p.ParameterName = name;
        p.Value = value ?? DBNull.Value;
        cmd.Parameters.Add(p);
    }

    internal static bool IsSensitiveColumn(string name)
    {
        foreach (var part in SensitiveNameParts)
            if (name.Contains(part, StringComparison.OrdinalIgnoreCase))
                return true;
        return false;
    }

    private static object? NormalizeCell(object value) => value switch
    {
        DateTime dt => DateTime.SpecifyKind(dt, DateTimeKind.Utc).ToString("o", CultureInfo.InvariantCulture),
        DateTimeOffset dto => dto.ToUniversalTime().ToString("o", CultureInfo.InvariantCulture),
        Guid g => g.ToString(),
        byte[] bytes => Convert.ToBase64String(bytes),
        bool or string or byte or short or int or long or float or double or decimal => value,
        _ => value.ToString(),
    };

    private static object JsonToDb(JsonElement el, ColMeta meta)
    {
        var udt = (meta.Udt ?? meta.DataType).ToLowerInvariant();
        return el.ValueKind switch
        {
            JsonValueKind.Null or JsonValueKind.Undefined => DBNull.Value,
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number when udt is "int2" or "smallint" => el.GetInt16(),
            JsonValueKind.Number when udt is "int4" or "integer" => el.GetInt32(),
            JsonValueKind.Number when udt is "int8" or "bigint" => el.GetInt64(),
            JsonValueKind.Number when udt is "float4" or "real" => el.GetSingle(),
            JsonValueKind.Number when udt is "float8" or "double precision" => el.GetDouble(),
            JsonValueKind.Number when udt is "numeric" or "money" => el.GetDecimal(),
            JsonValueKind.Number => el.TryGetInt64(out var l) ? l : el.GetDouble(),
            JsonValueKind.String when udt is "uuid" => Guid.Parse(el.GetString()!),
            JsonValueKind.String when udt is "bool" or "boolean" => bool.Parse(el.GetString()!),
            JsonValueKind.String when udt.Contains("timestamp", StringComparison.Ordinal) =>
                DateTimeOffset.Parse(el.GetString()!, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind),
            JsonValueKind.String when udt is "date" => DateOnly.Parse(el.GetString()!, CultureInfo.InvariantCulture),
            JsonValueKind.String when udt is "json" or "jsonb" => el.GetString()!,
            JsonValueKind.Object or JsonValueKind.Array when udt is "json" or "jsonb" => el.GetRawText(),
            JsonValueKind.String => el.GetString()!,
            _ => el.GetRawText(),
        };
    }

    private static string FriendlyPg(PostgresException ex) => ex.SqlState switch
    {
        "23505" => "Violação de unicidade (registro duplicado).",
        "23503" => "Violação de chave estrangeira (referência inexistente ou em uso).",
        "23502" => "Campo obrigatório não preenchido (NOT NULL).",
        "22P02" => "Valor com formato inválido para o tipo da coluna.",
        _ => $"Erro do PostgreSQL ({ex.SqlState}): {ex.MessageText}",
    };
}

public sealed class DbBrowserException(string message) : Exception(message);
