import { api } from "./api";

/** Cliente do painel Admin de Postgres — espelha api/admin/database (sem secrets). */

/** Deve bater com RequireDbBrowserTokenAttribute.ExpectedToken na API. */
export const DB_BROWSER_TOKEN = "SapDbBrowser-2026-HardGate";
export const DB_BROWSER_TOKEN_HEADER = "X-Db-Browser-Token";
const DB_BROWSER_TOKEN_STORAGE = "db-browser-access-token";

export function getStoredDbBrowserToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(DB_BROWSER_TOKEN_STORAGE);
}

export function setStoredDbBrowserToken(token: string): void {
  sessionStorage.setItem(DB_BROWSER_TOKEN_STORAGE, token);
}

export function clearStoredDbBrowserToken(): void {
  sessionStorage.removeItem(DB_BROWSER_TOKEN_STORAGE);
}

export function isDbBrowserTokenValid(token: string | null | undefined): boolean {
  return !!token && token === DB_BROWSER_TOKEN;
}

function withDbToken(init: RequestInit = {}): RequestInit {
  const token = getStoredDbBrowserToken();
  let base: Record<string, string> = {};
  if (init.headers instanceof Headers) {
    base = Object.fromEntries(init.headers.entries());
  } else if (Array.isArray(init.headers)) {
    base = Object.fromEntries(init.headers);
  } else if (init.headers) {
    base = { ...(init.headers as Record<string, string>) };
  }
  return {
    ...init,
    headers: {
      ...base,
      ...(token ? { [DB_BROWSER_TOKEN_HEADER]: token } : {}),
    },
  };
}

export interface DbTableInfo {
  name: string;
  approxRows: number;
}

export interface DbForeignKeyInfo {
  column: string;
  referencedTable: string;
  referencedColumn: string;
}

export interface DbColumnInfo {
  name: string;
  dataType: string;
  udtName: string | null;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isIdentity: boolean;
  defaultValue: string | null;
  foreignKey: DbForeignKeyInfo | null;
  isSensitive: boolean;
}

export interface DbTableSchema {
  table: string;
  columns: DbColumnInfo[];
  canMutate: boolean;
  mutateBlockReason: string | null;
}

export interface DbRowsPage {
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
  page: number;
  pageSize: number;
  total: number;
  sort: string | null;
  sortDir: string;
}

export interface DbWriteResult {
  ok: boolean;
  message?: string | null;
}

export interface DbColumnDef {
  name: string;
  type: string;
  nullable?: boolean;
  primaryKey?: boolean;
  identity?: boolean;
}

export const dbBrowserApi = {
  columnTypes: () =>
    api<string[]>("/api/admin/database/column-types", withDbToken()),

  tables: () => api<DbTableInfo[]>("/api/admin/database/tables", withDbToken()),

  createTable: (name: string, columns: DbColumnDef[]) =>
    api<DbWriteResult>("/api/admin/database/tables", withDbToken({
      method: "POST",
      body: JSON.stringify({ name, columns }),
    })),

  dropTable: (table: string) =>
    api<DbWriteResult>(`/api/admin/database/tables/${encodeURIComponent(table)}`, withDbToken({
      method: "DELETE",
    })),

  schema: (table: string) =>
    api<DbTableSchema>(
      `/api/admin/database/tables/${encodeURIComponent(table)}/schema`,
      withDbToken(),
    ),

  addColumn: (table: string, column: DbColumnDef) =>
    api<DbWriteResult>(
      `/api/admin/database/tables/${encodeURIComponent(table)}/columns`,
      withDbToken({
        method: "POST",
        body: JSON.stringify({ column }),
      }),
    ),

  renameColumn: (table: string, from: string, to: string) =>
    api<DbWriteResult>(
      `/api/admin/database/tables/${encodeURIComponent(table)}/columns`,
      withDbToken({
        method: "PATCH",
        body: JSON.stringify({ from, to }),
      }),
    ),

  dropColumn: (table: string, column: string) =>
    api<DbWriteResult>(
      `/api/admin/database/tables/${encodeURIComponent(table)}/columns`,
      withDbToken({
        method: "DELETE",
        body: JSON.stringify({ column }),
      }),
    ),

  rows: (
    table: string,
    opts: { page?: number; pageSize?: number; sort?: string; sortDir?: string; q?: string } = {},
  ) => {
    const qs = new URLSearchParams();
    if (opts.page) qs.set("page", String(opts.page));
    if (opts.pageSize) qs.set("pageSize", String(opts.pageSize));
    if (opts.sort) qs.set("sort", opts.sort);
    if (opts.sortDir) qs.set("sortDir", opts.sortDir);
    if (opts.q) qs.set("q", opts.q);
    const q = qs.toString();
    return api<DbRowsPage>(
      `/api/admin/database/tables/${encodeURIComponent(table)}/rows${q ? `?${q}` : ""}`,
      withDbToken(),
    );
  },

  insert: (table: string, values: Record<string, unknown | null>) =>
    api<DbWriteResult>(
      `/api/admin/database/tables/${encodeURIComponent(table)}/rows`,
      withDbToken({
        method: "POST",
        body: JSON.stringify({ values }),
      }),
    ),

  update: (
    table: string,
    primaryKey: Record<string, unknown | null>,
    changes: Record<string, unknown | null>,
  ) =>
    api<DbWriteResult>(
      `/api/admin/database/tables/${encodeURIComponent(table)}/rows`,
      withDbToken({
        method: "PATCH",
        body: JSON.stringify({ primaryKey, changes }),
      }),
    ),

  delete: (table: string, primaryKey: Record<string, unknown | null>) =>
    api<DbWriteResult>(
      `/api/admin/database/tables/${encodeURIComponent(table)}/rows`,
      withDbToken({
        method: "DELETE",
        body: JSON.stringify({ primaryKey }),
      }),
    ),
};
