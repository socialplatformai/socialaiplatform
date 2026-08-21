"use client";

import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, isAdmin } from "@/lib/api";
import {
  clearStoredDbBrowserToken,
  dbBrowserApi,
  getStoredDbBrowserToken,
  isDbBrowserTokenValid,
  setStoredDbBrowserToken,
  type DbColumnDef,
  type DbColumnInfo,
  type DbRowsPage,
  type DbTableSchema,
} from "@/lib/db-browser";
import { Badge, Button, Card, Field, Input, PageHeader, PageShell, Select } from "@/components/ui";

type Tab = "dados" | "estrutura";

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export default function AdminDatabasePage() {
  if (!isAdmin()) {
    return (
      <PageShell width="full">
        <PageHeader
          eyebrow="Administração"
          title="Banco de dados"
          description="Gerenciador visual do PostgreSQL da aplicação."
        />
        <Card>
          <p role="alert" className="text-sm text-ink/70">
            Apenas administradores podem acessar o painel do banco de dados.
          </p>
        </Card>
      </PageShell>
    );
  }

  return <DbBrowserGate />;
}

function DbBrowserGate() {
  const [unlocked, setUnlocked] = useState(() => isDbBrowserTokenValid(getStoredDbBrowserToken()));
  const [draft, setDraft] = useState("");
  const [gateError, setGateError] = useState<string | null>(null);

  if (!unlocked) {
    return (
      <PageShell width="full">
        <PageHeader
          eyebrow="Administração"
          title="Banco de dados"
          description="Esta área exige um token de acesso além do login Admin."
        />
        <Card className="max-w-md">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!isDbBrowserTokenValid(draft.trim())) {
                setGateError("Token inválido.");
                return;
              }
              setStoredDbBrowserToken(draft.trim());
              setGateError(null);
              setUnlocked(true);
            }}
          >
            <Field label="Token de acesso" hint="Informe o token do painel DB">
              <Input
                type="password"
                autoComplete="off"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Cole o token"
              />
            </Field>
            {gateError && (
              <p role="alert" className="text-sm text-danger">
                {gateError}
              </p>
            )}
            <Button type="submit">Entrar</Button>
          </form>
        </Card>
      </PageShell>
    );
  }

  return (
    <DbBrowser
      onLock={() => {
        clearStoredDbBrowserToken();
        setUnlocked(false);
        setDraft("");
      }}
    />
  );
}

function DbBrowser({ onLock }: { onLock: () => void }) {
  const qc = useQueryClient();
  const [table, setTable] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("dados");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<string | undefined>();
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [q, setQ] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [editRow, setEditRow] = useState<Record<string, unknown> | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTableOpen, setCreateTableOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tablesQ = useQuery({
    queryKey: ["admin-db", "tables"],
    queryFn: () => dbBrowserApi.tables(),
  });

  const typesQ = useQuery({
    queryKey: ["admin-db", "column-types"],
    queryFn: () => dbBrowserApi.columnTypes(),
  });

  const schemaQ = useQuery({
    queryKey: ["admin-db", "schema", table],
    queryFn: () => dbBrowserApi.schema(table!),
    enabled: !!table,
  });

  const rowsQ = useQuery({
    queryKey: ["admin-db", "rows", table, page, pageSize, sort, sortDir, q],
    queryFn: () =>
      dbBrowserApi.rows(table!, { page, pageSize, sort, sortDir, q: q || undefined }),
    enabled: !!table && tab === "dados",
    placeholderData: keepPreviousData,
  });

  const selectTable = (name: string) => {
    setTable(name);
    setTab("dados");
    setPage(1);
    setSort(undefined);
    setSortDir("asc");
    setQ("");
    setQDraft("");
    setEditRow(null);
    setCreateOpen(false);
    setError(null);
  };

  const toggleSort = (col: string) => {
    if (sort === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(col);
      setSortDir("asc");
    }
    setPage(1);
  };

  const refreshSchema = () => {
    void qc.invalidateQueries({ queryKey: ["admin-db", "schema", table] });
    void qc.invalidateQueries({ queryKey: ["admin-db", "tables"] });
    void qc.invalidateQueries({ queryKey: ["admin-db", "rows"] });
  };

  const dropTable = useMutation({
    mutationFn: (name: string) => dbBrowserApi.dropTable(name),
    onSuccess: () => {
      setError(null);
      setTable(null);
      void qc.invalidateQueries({ queryKey: ["admin-db", "tables"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Falha ao remover tabela."),
  });

  return (
    <PageShell width="full">
      <PageHeader
        eyebrow="Administração"
        title="Banco de dados"
        description="Visualize, edite e estruture tabelas do PostgreSQL (conexão interna). Criar/alterar/remover tabela e colunas via botões — sem digitar SQL. Operações destrutivas exigem confirmação e são auditadas."
        actions={
          <Button type="button" variant="ghost" onClick={onLock}>
            Bloquear painel
          </Button>
        }
      />

      {error && (
        <p role="alert" className="mb-3 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex min-h-[70vh] overflow-hidden rounded-lg border border-ink/10 bg-canvas">
        <aside className="w-56 shrink-0 border-r border-ink/10 bg-canvas-2/40">
          <div className="flex items-center justify-between border-b border-ink/10 px-3 py-2">
            <span className="text-xs font-medium uppercase tracking-wide text-ink/55">Tabelas</span>
            <button
              type="button"
              className="text-[11px] font-medium text-ink/70 underline-offset-2 hover:underline"
              onClick={() => setCreateTableOpen(true)}
            >
              + Nova
            </button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto p-1">
            {tablesQ.isLoading && <p className="px-2 py-3 text-xs text-ink/55">Carregando…</p>}
            {tablesQ.isError && (
              <p className="px-2 py-3 text-xs text-danger">Falha ao listar tabelas.</p>
            )}
            {(tablesQ.data ?? []).map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => selectTable(t.name)}
                className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm ${
                  table === t.name ? "bg-ink text-canvas" : "text-ink/80 hover:bg-ink/5"
                }`}
              >
                <span className="truncate font-medium">{t.name}</span>
                <span
                  className={`ml-2 shrink-0 text-[10px] tabular-nums ${table === t.name ? "text-canvas/70" : "text-ink/40"}`}
                >
                  ~{t.approxRows}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {!table ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-sm text-ink/55">
              <p>Selecione uma tabela à esquerda ou crie uma nova.</p>
              <Button type="button" onClick={() => setCreateTableOpen(true)}>
                + Nova tabela
              </Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-ink/10 px-4 py-2">
                <h2 className="mr-2 text-sm font-semibold text-ink">{table}</h2>
                <button
                  type="button"
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${tab === "dados" ? "bg-ink text-canvas" : "text-ink/65 hover:bg-ink/5"}`}
                  onClick={() => setTab("dados")}
                >
                  Dados
                </button>
                <button
                  type="button"
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${tab === "estrutura" ? "bg-ink text-canvas" : "text-ink/65 hover:bg-ink/5"}`}
                  onClick={() => setTab("estrutura")}
                >
                  Estrutura
                </button>
                <div className="ml-auto">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={dropTable.isPending}
                    onClick={() => {
                      const typed = window.prompt(
                        `Digite o nome da tabela "${table}" para confirmar a exclusão permanente:`,
                      );
                      if (typed !== table) {
                        if (typed != null) setError("Nome não confere — tabela não removida.");
                        return;
                      }
                      dropTable.mutate(table);
                    }}
                  >
                    Remover tabela
                  </Button>
                </div>
              </div>

              {tab === "estrutura" && (
                <StructurePane
                  schema={schemaQ.data}
                  loading={schemaQ.isLoading}
                  types={typesQ.data ?? []}
                  onChanged={refreshSchema}
                  onError={setError}
                />
              )}

              {tab === "dados" && (
                <DataPane
                  schema={schemaQ.data}
                  page={rowsQ.data}
                  loading={rowsQ.isLoading}
                  pageSize={pageSize}
                  qDraft={qDraft}
                  onQDraft={setQDraft}
                  onSearch={() => {
                    setQ(qDraft);
                    setPage(1);
                  }}
                  onRefresh={() => void rowsQ.refetch()}
                  onPageSize={(n) => {
                    setPageSize(n);
                    setPage(1);
                  }}
                  onPage={setPage}
                  onSort={toggleSort}
                  sort={sort}
                  sortDir={sortDir}
                  canMutate={!!schemaQ.data?.canMutate}
                  mutateBlock={schemaQ.data?.mutateBlockReason}
                  onEdit={(row) => {
                    setCreateOpen(false);
                    setEditRow(row);
                  }}
                  onCreate={() => {
                    setEditRow(null);
                    setCreateOpen(true);
                  }}
                  onError={setError}
                />
              )}
            </>
          )}
        </main>
      </div>

      {(editRow || createOpen) && schemaQ.data && (
        <RecordModal
          mode={createOpen ? "create" : "edit"}
          schema={schemaQ.data}
          initial={editRow}
          onClose={() => {
            setEditRow(null);
            setCreateOpen(false);
          }}
          onDone={() => {
            setEditRow(null);
            setCreateOpen(false);
            void rowsQ.refetch();
            void tablesQ.refetch();
          }}
          onError={setError}
        />
      )}

      {createTableOpen && (
        <CreateTableModal
          types={typesQ.data ?? []}
          onClose={() => setCreateTableOpen(false)}
          onDone={(name) => {
            setCreateTableOpen(false);
            void tablesQ.refetch();
            selectTable(name);
            setTab("estrutura");
          }}
          onError={setError}
        />
      )}
    </PageShell>
  );
}

function StructurePane({
  schema,
  loading,
  types,
  onChanged,
  onError,
}: {
  schema?: DbTableSchema;
  loading: boolean;
  types: string[];
  onChanged: () => void;
  onError: (m: string | null) => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [renameFrom, setRenameFrom] = useState<string | null>(null);

  const dropCol = useMutation({
    mutationFn: (col: string) => dbBrowserApi.dropColumn(schema!.table, col),
    onSuccess: () => {
      onError(null);
      onChanged();
    },
    onError: (e) => onError(e instanceof ApiError ? e.message : "Falha ao remover coluna."),
  });

  if (loading) return <p className="p-4 text-sm text-ink/55">Carregando estrutura…</p>;
  if (!schema) return null;

  return (
    <div className="overflow-auto p-3">
      {!schema.canMutate && schema.mutateBlockReason && (
        <p className="mb-3 rounded-md bg-ink/5 px-3 py-2 text-xs text-ink/70">{schema.mutateBlockReason}</p>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        <Button type="button" onClick={() => setAddOpen(true)}>
          + Adicionar coluna
        </Button>
      </div>
      <table className="w-full min-w-[800px] border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-ink/10 text-ink/55">
            <th className="px-2 py-2 font-medium">Coluna</th>
            <th className="px-2 py-2 font-medium">Tipo</th>
            <th className="px-2 py-2 font-medium">Null</th>
            <th className="px-2 py-2 font-medium">PK</th>
            <th className="px-2 py-2 font-medium">Identity</th>
            <th className="px-2 py-2 font-medium">Default</th>
            <th className="px-2 py-2 font-medium">FK</th>
            <th className="px-2 py-2 font-medium">Ações</th>
          </tr>
        </thead>
        <tbody>
          {schema.columns.map((c) => (
            <tr key={c.name} className="border-b border-ink/5">
              <td className="px-2 py-1.5 font-medium text-ink">
                {c.name}
                {c.isSensitive && (
                  <span className="ml-2">
                    <Badge tone="high">sensível</Badge>
                  </span>
                )}
              </td>
              <td className="px-2 py-1.5 font-mono text-ink/70">{c.udtName ?? c.dataType}</td>
              <td className="px-2 py-1.5">{c.isNullable ? "sim" : "não"}</td>
              <td className="px-2 py-1.5">{c.isPrimaryKey ? "●" : ""}</td>
              <td className="px-2 py-1.5">{c.isIdentity ? "●" : ""}</td>
              <td
                className="max-w-[200px] truncate px-2 py-1.5 font-mono text-ink/55"
                title={c.defaultValue ?? undefined}
              >
                {c.defaultValue ?? "—"}
              </td>
              <td className="px-2 py-1.5 text-ink/70">
                {c.foreignKey
                  ? `${c.foreignKey.referencedTable}.${c.foreignKey.referencedColumn}`
                  : "—"}
              </td>
              <td className="whitespace-nowrap px-2 py-1.5">
                <button
                  type="button"
                  className="mr-2 text-ink/70 underline-offset-2 hover:underline"
                  onClick={() => setRenameFrom(c.name)}
                >
                  Renomear
                </button>
                <button
                  type="button"
                  className="text-danger underline-offset-2 hover:underline"
                  disabled={dropCol.isPending || schema.columns.length <= 1}
                  onClick={() => {
                    const typed = window.prompt(
                      `Digite o nome da coluna "${c.name}" para confirmar a remoção:`,
                    );
                    if (typed !== c.name) {
                      if (typed != null) onError("Nome não confere — coluna não removida.");
                      return;
                    }
                    dropCol.mutate(c.name);
                  }}
                >
                  Remover
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {addOpen && (
        <ColumnEditorModal
          title={`Nova coluna — ${schema.table}`}
          types={types}
          onClose={() => setAddOpen(false)}
          onSubmit={async (col) => {
            await dbBrowserApi.addColumn(schema.table, col);
          }}
          onDone={() => {
            setAddOpen(false);
            onChanged();
          }}
          onError={onError}
        />
      )}

      {renameFrom && (
        <RenameColumnModal
          table={schema.table}
          from={renameFrom}
          onClose={() => setRenameFrom(null)}
          onDone={() => {
            setRenameFrom(null);
            onChanged();
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

function emptyCol(type: string): DbColumnDef {
  return { name: "", type, nullable: true, primaryKey: false, identity: false };
}

function CreateTableModal({
  types,
  onClose,
  onDone,
  onError,
}: {
  types: string[];
  onClose: () => void;
  onDone: (name: string) => void;
  onError: (m: string | null) => void;
}) {
  const defaultType = types[0] ?? "text";
  const [name, setName] = useState("");
  const [cols, setCols] = useState<DbColumnDef[]>([
    { name: "id", type: types.includes("uuid") ? "uuid" : defaultType, nullable: false, primaryKey: true, identity: false },
    emptyCol(defaultType),
  ]);

  const save = useMutation({
    mutationFn: async () => {
      if (!IDENT_RE.test(name)) throw new ApiError(400, "Nome de tabela inválido (letras/números/_).");
      const cleaned = cols.filter((c) => c.name.trim());
      if (cleaned.length === 0) throw new ApiError(400, "Informe ao menos uma coluna.");
      for (const c of cleaned) {
        if (!IDENT_RE.test(c.name)) throw new ApiError(400, `Coluna inválida: ${c.name}`);
      }
      return dbBrowserApi.createTable(name, cleaned);
    },
    onSuccess: () => {
      onError(null);
      onDone(name);
    },
    onError: (e) => onError(e instanceof ApiError ? e.message : "Falha ao criar tabela."),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog">
      <Card className="max-h-[90vh] w-full max-w-2xl overflow-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Nova tabela</h3>
          <button type="button" className="text-xs text-ink/55 hover:text-ink" onClick={onClose}>
            Fechar
          </button>
        </div>
        <Field label="Nome da tabela" hint="Apenas letras, números e _">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="minha_tabela" />
        </Field>
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-ink/55">Colunas</p>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCols((c) => [...c, emptyCol(defaultType)])}
            >
              + Coluna
            </Button>
          </div>
          {cols.map((col, i) => (
            <ColumnDefRow
              key={i}
              col={col}
              types={types}
              onChange={(next) => setCols((all) => all.map((c, j) => (j === i ? next : c)))}
              onRemove={() => setCols((all) => (all.length <= 1 ? all : all.filter((_, j) => j !== i)))}
              canRemove={cols.length > 1}
            />
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Criando…" : "Criar tabela"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function ColumnEditorModal({
  title,
  types,
  onClose,
  onSubmit,
  onDone,
  onError,
}: {
  title: string;
  types: string[];
  onClose: () => void;
  onSubmit: (col: DbColumnDef) => Promise<unknown>;
  onDone: () => void;
  onError: (m: string | null) => void;
}) {
  const [col, setCol] = useState<DbColumnDef>(emptyCol(types[0] ?? "text"));
  const save = useMutation({
    mutationFn: async () => {
      if (!IDENT_RE.test(col.name)) throw new ApiError(400, "Nome de coluna inválido.");
      return onSubmit(col);
    },
    onSuccess: () => {
      onError(null);
      onDone();
    },
    onError: (e) => onError(e instanceof ApiError ? e.message : "Falha ao salvar coluna."),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog">
      <Card className="w-full max-w-lg">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <button type="button" className="text-xs text-ink/55 hover:text-ink" onClick={onClose}>
            Fechar
          </button>
        </div>
        <ColumnDefRow col={col} types={types} onChange={setCol} />
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Salvando…" : "Adicionar"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function RenameColumnModal({
  table,
  from,
  onClose,
  onDone,
  onError,
}: {
  table: string;
  from: string;
  onClose: () => void;
  onDone: () => void;
  onError: (m: string | null) => void;
}) {
  const [to, setTo] = useState(from);
  const save = useMutation({
    mutationFn: async () => {
      if (!IDENT_RE.test(to)) throw new ApiError(400, "Novo nome inválido.");
      return dbBrowserApi.renameColumn(table, from, to);
    },
    onSuccess: () => {
      onError(null);
      onDone();
    },
    onError: (e) => onError(e instanceof ApiError ? e.message : "Falha ao renomear."),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog">
      <Card className="w-full max-w-md">
        <h3 className="mb-3 text-sm font-semibold text-ink">
          Renomear coluna — {table}.{from}
        </h3>
        <Field label="Novo nome">
          <Input value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" disabled={save.isPending || to === from} onClick={() => save.mutate()}>
            {save.isPending ? "Salvando…" : "Renomear"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function ColumnDefRow({
  col,
  types,
  onChange,
  onRemove,
  canRemove,
}: {
  col: DbColumnDef;
  types: string[];
  onChange: (c: DbColumnDef) => void;
  onRemove?: () => void;
  canRemove?: boolean;
}) {
  const intLike = ["integer", "bigint", "smallint"].includes(col.type);
  return (
    <div className="grid grid-cols-1 gap-2 rounded-md border border-ink/10 p-3 sm:grid-cols-2">
      <Field label="Nome">
        <Input
          value={col.name}
          onChange={(e) => onChange({ ...col, name: e.target.value })}
          placeholder="nome_coluna"
        />
      </Field>
      <Field label="Tipo">
        <Select
          value={col.type}
          onChange={(e) => {
            const type = e.target.value;
            onChange({
              ...col,
              type,
              identity: ["integer", "bigint", "smallint"].includes(type) ? col.identity : false,
            });
          }}
        >
          {(types.length ? types : [col.type || "text"]).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </Field>
      <label className="flex items-center gap-2 text-xs text-ink/80">
        <input
          type="checkbox"
          checked={col.nullable !== false}
          onChange={(e) => onChange({ ...col, nullable: e.target.checked })}
        />
        Permite NULL
      </label>
      <label className="flex items-center gap-2 text-xs text-ink/80">
        <input
          type="checkbox"
          checked={!!col.primaryKey}
          onChange={(e) =>
            onChange({
              ...col,
              primaryKey: e.target.checked,
              nullable: e.target.checked ? false : col.nullable,
            })
          }
        />
        Chave primária
      </label>
      <label className={`flex items-center gap-2 text-xs ${intLike ? "text-ink/80" : "text-ink/35"}`}>
        <input
          type="checkbox"
          disabled={!intLike}
          checked={!!col.identity}
          onChange={(e) => onChange({ ...col, identity: e.target.checked })}
        />
        Identity (auto-increment)
      </label>
      {onRemove && (
        <div className="flex items-end">
          <Button type="button" variant="ghost" disabled={!canRemove} onClick={onRemove}>
            Remover linha
          </Button>
        </div>
      )}
    </div>
  );
}

function DataPane({
  schema,
  page,
  loading,
  pageSize,
  qDraft,
  onQDraft,
  onSearch,
  onRefresh,
  onPageSize,
  onPage,
  onSort,
  sort,
  sortDir,
  canMutate,
  mutateBlock,
  onEdit,
  onCreate,
  onError,
}: {
  schema?: DbTableSchema;
  page?: DbRowsPage;
  loading: boolean;
  pageSize: number;
  qDraft: string;
  onQDraft: (v: string) => void;
  onSearch: () => void;
  onRefresh: () => void;
  onPageSize: (n: number) => void;
  onPage: (p: number) => void;
  onSort: (col: string) => void;
  sort?: string;
  sortDir: "asc" | "desc";
  canMutate: boolean;
  mutateBlock?: string | null;
  onEdit: (row: Record<string, unknown>) => void;
  onCreate: () => void;
  onError: (m: string | null) => void;
}) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: (pk: Record<string, unknown | null>) => dbBrowserApi.delete(page!.table, pk),
    onSuccess: () => {
      onError(null);
      void qc.invalidateQueries({ queryKey: ["admin-db", "rows"] });
      void qc.invalidateQueries({ queryKey: ["admin-db", "tables"] });
    },
    onError: (e) => onError(e instanceof ApiError ? e.message : "Falha ao excluir."),
  });

  const pkCols = useMemo(
    () => (schema?.columns ?? []).filter((c) => c.isPrimaryKey).map((c) => c.name),
    [schema],
  );

  const totalPages = page ? Math.max(1, Math.ceil(page.total / page.pageSize)) : 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-ink/10 px-3 py-2">
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onSearch();
          }}
        >
          <Input
            value={qDraft}
            onChange={(e) => onQDraft(e.target.value)}
            placeholder="Pesquisar…"
            className="max-w-xs"
          />
          <Button type="submit" variant="ghost">
            Buscar
          </Button>
        </form>
        <Select
          value={String(pageSize)}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="w-24"
        >
          {[25, 50, 100].map((n) => (
            <option key={n} value={n}>
              {n}/pág
            </option>
          ))}
        </Select>
        <Button type="button" variant="ghost" onClick={onRefresh}>
          Atualizar
        </Button>
        <Button type="button" disabled={!canMutate} onClick={onCreate} title={mutateBlock ?? undefined}>
          + Novo registro
        </Button>
      </div>

      {!canMutate && mutateBlock && (
        <p className="border-b border-ink/10 bg-ink/5 px-3 py-2 text-xs text-ink/70">{mutateBlock}</p>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {loading && !page && <p className="p-4 text-sm text-ink/55">Carregando…</p>}
        {page && (
          <table className="w-max min-w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-canvas-2">
              <tr className="border-b border-ink/10 text-ink/55">
                {canMutate && <th className="px-2 py-2 font-medium">Ações</th>}
                {page.columns.map((c) => (
                  <th key={c} className="px-2 py-2 font-medium">
                    <button type="button" className="hover:text-ink" onClick={() => onSort(c)}>
                      {c}
                      {sort === c ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.rows.map((row, idx) => (
                <tr key={idx} className="border-b border-ink/5 hover:bg-ink/[0.03]">
                  {canMutate && (
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <button
                        type="button"
                        className="mr-2 text-ink/70 underline-offset-2 hover:underline"
                        onClick={() => onEdit(row)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="text-danger underline-offset-2 hover:underline"
                        disabled={del.isPending}
                        onClick={() => {
                          const ok = window.confirm(
                            "Tem certeza que deseja excluir este registro? Esta ação não pode ser desfeita.",
                          );
                          if (!ok) return;
                          const pk: Record<string, unknown | null> = {};
                          for (const k of pkCols) pk[k] = (row[k] as unknown) ?? null;
                          del.mutate(pk);
                        }}
                      >
                        Excluir
                      </button>
                    </td>
                  )}
                  {page.columns.map((c) => (
                    <td
                      key={c}
                      className="max-w-[280px] truncate px-2 py-1.5 font-mono text-ink/80"
                      title={formatCell(row[c])}
                    >
                      {renderCell(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
              {page.rows.length === 0 && (
                <tr>
                  <td
                    colSpan={page.columns.length + (canMutate ? 1 : 0)}
                    className="px-3 py-6 text-center text-ink/50"
                  >
                    Nenhum registro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {page && (
        <div className="flex items-center justify-between border-t border-ink/10 px-3 py-2 text-xs text-ink/65">
          <span>
            {page.total} registro(s) · pág. {page.page}/{totalPages}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" disabled={page.page <= 1} onClick={() => onPage(page.page - 1)}>
              Anterior
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={page.page >= totalPages}
              onClick={() => onPage(page.page + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function RecordModal({
  mode,
  schema,
  initial,
  onClose,
  onDone,
  onError,
}: {
  mode: "create" | "edit";
  schema: DbTableSchema;
  initial: Record<string, unknown> | null;
  onClose: () => void;
  onDone: () => void;
  onError: (m: string | null) => void;
}) {
  const editableCols = schema.columns.filter(
    (c) => !c.isSensitive && (mode === "create" ? !c.isIdentity : !c.isPrimaryKey && !c.isIdentity),
  );

  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const d: Record<string, string> = {};
    for (const c of editableCols) {
      const v = initial?.[c.name];
      d[c.name] = v == null ? "" : String(v);
    }
    return d;
  });

  const save = useMutation({
    mutationFn: async () => {
      if (mode === "create") {
        const values: Record<string, unknown | null> = {};
        for (const c of editableCols) {
          const raw = draft[c.name] ?? "";
          if (raw === "" && c.isNullable) values[c.name] = null;
          else if (raw === "" && c.defaultValue) continue;
          else values[c.name] = coerce(raw, c);
        }
        return dbBrowserApi.insert(schema.table, values);
      }

      const pk: Record<string, unknown | null> = {};
      for (const c of schema.columns.filter((x) => x.isPrimaryKey)) {
        pk[c.name] = (initial?.[c.name] as unknown) ?? null;
      }

      const changes: Record<string, unknown | null> = {};
      const changedLabels: string[] = [];
      for (const c of editableCols) {
        const before = initial?.[c.name];
        const raw = draft[c.name] ?? "";
        const after = raw === "" && c.isNullable ? null : coerce(raw, c);
        const beforeNorm = before == null ? null : String(before);
        const afterNorm = after == null ? null : String(after);
        if (beforeNorm !== afterNorm) {
          changes[c.name] = after;
          changedLabels.push(c.name);
        }
      }
      if (Object.keys(changes).length === 0) throw new ApiError(400, "Nenhuma alteração.");
      const confirm = window.confirm(
        `Salvar alterações nestes campos?\n\n${changedLabels.join(", ")}`,
      );
      if (!confirm) throw new ApiError(0, "Cancelado.");
      return dbBrowserApi.update(schema.table, pk, changes);
    },
    onSuccess: () => {
      onError(null);
      onDone();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.message === "Cancelado.") return;
      onError(e instanceof ApiError ? e.message : "Falha ao salvar.");
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog">
      <Card className="max-h-[90vh] w-full max-w-lg overflow-auto">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">
            {mode === "create" ? "Novo registro" : "Editar registro"} — {schema.table}
          </h3>
          <button type="button" className="text-xs text-ink/55 hover:text-ink" onClick={onClose}>
            Fechar
          </button>
        </div>
        <div className="space-y-3">
          {mode === "edit" &&
            schema.columns
              .filter((c) => c.isPrimaryKey)
              .map((c) => (
                <Field key={c.name} label={`${c.name} (PK)`}>
                  <Input value={String(initial?.[c.name] ?? "")} disabled />
                </Field>
              ))}
          {editableCols.map((c) => (
            <Field
              key={c.name}
              label={c.name}
              hint={`${c.udtName ?? c.dataType}${c.isNullable ? " · nullable" : ""}${c.foreignKey ? ` · FK → ${c.foreignKey.referencedTable}.${c.foreignKey.referencedColumn}` : ""}`}
            >
              <Input
                value={draft[c.name] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [c.name]: e.target.value }))}
                placeholder={c.isNullable ? "NULL se vazio" : c.defaultValue ? "default do banco se vazio" : ""}
              />
            </Field>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v == null) return "NULL";
  return String(v);
}

function renderCell(v: unknown) {
  if (v == null) return <span className="italic text-ink/35">NULL</span>;
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function coerce(raw: string, col: DbColumnInfo): unknown {
  const t = (col.udtName ?? col.dataType).toLowerCase();
  if (t === "bool" || t === "boolean") return raw === "true" || raw === "1";
  if (t === "int2" || t === "int4" || t === "int8" || t.includes("int")) return Number(raw);
  if (t === "float4" || t === "float8" || t === "numeric" || t === "money") return Number(raw);
  if (
    t === "uuid" ||
    t.includes("timestamp") ||
    t === "date" ||
    t === "text" ||
    t === "varchar" ||
    t === "json" ||
    t === "jsonb"
  )
    return raw;
  return raw;
}
