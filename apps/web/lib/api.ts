// Cliente HTTP mínimo p/ a API .NET. Token JWT guardado no localStorage
// (a tela de login completa chega depois; E-3 foca a config de marca).
//
// Modo PROXY (NEXT_PUBLIC_API_PROXY=true): o browser chama a MESMA ORIGEM (`/api/...`) e o
// Next (server.js) faz rewrite para a API em runtime (ver next.config.ts). Isso elimina a
// dependência de build-time da URL da API e o CORS — usado em deploy PaaS (Render/Fly), onde
// a URL da API só é conhecida em runtime. Sem a flag, mantém o comportamento atual (URL direta,
// build-time) do Docker Compose / dev.
const PROXY = process.env.NEXT_PUBLIC_API_PROXY === "true";
const BASE = PROXY ? "" : (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5080");

const TOKEN_KEY = "sap_token";
const ROLE_KEY = "sap_role";
// Refresh token de 30d — evita logout a cada 2h quando o access expira (S-27).
const REFRESH_KEY = "sap_refresh";
// Marca ativa (E1-d). Enviada como X-Brand-Id; escopa pauta/conteúdo/aprovação/agenda
// à marca dentro do workspace. Sem marca → não envia (backend cai na marca-default).
const BRAND_KEY = "sap_brand";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

/**
 * Monta a URL absoluta de uma imagem servida pela API (proxy de slide), com o JWT na query —
 * porque <img>/background-image NÃO mandam o header Authorization (o token vive no localStorage).
 * A API aceita ?access_token= SÓ nas rotas de imagem (ver JwtBearerEvents no Program.cs). Respeita
 * o modo PROXY (BASE="" → same-origin). Recebe um path relativo (ex.: o coverImageUrl do histórico).
 */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const token = getToken();
  const sep = path.includes("?") ? "&" : "?";
  return `${BASE}${path}${token ? `${sep}access_token=${encodeURIComponent(token)}` : ""}`;
}

export function setToken(token: string) {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(REFRESH_KEY);
}

export function setRefreshToken(token: string) {
  window.localStorage.setItem(REFRESH_KEY, token);
}

// Limpeza do cache do React Query no fim da sessão. Vive aqui (e não importando o
// QueryClient, que é client-side) via callback registrado pelos Providers. Sem isso,
// a navegação SPA pós-login/logout preserva o QueryClient da raiz e dados em cache de
// um workspace/marca vazariam na UI para a próxima sessão (achado da verificação
// adversarial E1-d).
let cacheClearer: (() => void) | null = null;
export function registerCacheClearer(fn: () => void) {
  cacheClearer = fn;
}

export function clearToken() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(ROLE_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
  // A marca ativa pertence à sessão: ao sair, esquece o contexto de marca também.
  window.localStorage.removeItem(BRAND_KEY);
  // Esvazia o cache de queries: impede que pautas/marcas/etc. da sessão anterior
  // apareçam para a próxima (cross-session leak na UI).
  cacheClearer?.();
}

/** Id da marca ativa (X-Brand-Id). null = sem seleção → backend usa a marca-default. */
export function getBrandId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(BRAND_KEY);
}

export function setBrandId(brandId: string | null) {
  if (typeof window === "undefined") return;
  // localStorage pode lançar (Safari modo privado, quota) — não derrubar a UI por isso.
  try {
    if (brandId) window.localStorage.setItem(BRAND_KEY, brandId);
    else window.localStorage.removeItem(BRAND_KEY);
  } catch {
    // Sem persistência de marca: o backend cai na marca-default; degradação aceitável.
  }
}

/** Papel do usuário logado (Admin | Member). Guardado no login/registro. */
export function setRole(role: string | null) {
  if (role) window.localStorage.setItem(ROLE_KEY, role);
  else window.localStorage.removeItem(ROLE_KEY);
}

export function getRole(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ROLE_KEY);
}

export function isAdmin(): boolean {
  return getRole() === "Admin";
}

/**
 * Sessão expirada (401). Limpa credenciais e leva ao login uma única vez.
 * Chamado apenas quando o refresh também falhar (S-27).
 */
let redirecting = false;
export function onUnauthorized() {
  if (typeof window === "undefined" || redirecting) return;
  // Não redireciona se já estamos no login (evita loop ao errar senha).
  if (window.location.pathname.startsWith("/login")) return;
  redirecting = true;
  clearToken();
  window.location.assign("/login?expired=1");
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Extrai mensagem legível de uma resposta de erro da API .NET.
 * A API retorna ProblemDetails (RFC 7807): { detail?, title?, ... }.
 * Preferimos detail > title > texto bruto. 404 sem corpo → mensagem fixa.
 */
async function extractErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return extractMessageFromText(res, text);
}

/** Versão de extractErrorMessage para quando o corpo já foi lido (res.text() só pode
 *  ser consumido uma vez). Mesma regra: detail > title > texto bruto. */
function extractMessageFromText(res: Response, text: string): string {
  const contentType = res.headers.get("content-type") ?? "";
  const isProblemJson =
    contentType.includes("application/problem+json") ||
    contentType.includes("application/json");

  if (res.status === 404 && !text) return "Não encontrado.";

  if (isProblemJson && text) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const msg =
        (parsed.detail as string | undefined) ??
        (parsed.title as string | undefined);
      if (msg) return msg;
    } catch {
      // JSON inválido — cai no fallback abaixo
    }
  }

  // Último recurso: a mensagem do backend (PT-BR) quando houver; nunca o res.statusText
  // (que vem em inglês cru). Sem mensagem → texto neutro e acionável (G6).
  return text || "Algo deu errado. Tente de novo em instantes.";
}

// Controla tentativa única de refresh para evitar loop infinito (S-27).
let isRefreshing = false;
// Controla a recuperação única de "marca inválida" (403) para evitar loop (E1-d QA).
let isRecoveringBrand = false;

// O backend (BrandAccessExceptionFilter) responde 403 com este Title quando o
// X-Brand-Id não pertence ao workspace. É o sinal que distingue "marca inválida"
// de "ação sem permissão" — só o primeiro deve limpar a marca e recuperar.
const INVALID_BRAND_TITLE = "Marca inválida para o workspace atual.";

/** True se o corpo do 403 é o erro específico de marca inválida (não um 403 de ação). */
function isInvalidBrandProblem(text: string): boolean {
  if (!text) return false;
  try {
    const parsed = JSON.parse(text) as { title?: string };
    return parsed.title === INVALID_BRAND_TITLE;
  } catch {
    return false;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const brandId = getBrandId();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        // E1-d: escopa a request à marca ativa. Ausente → backend cai na marca-default.
        ...(brandId ? { "X-Brand-Id": brandId } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    // Falha de rede / servidor offline → status 0 (tratado como "sem conexão").
    throw new ApiError(0, "Sem conexão com o servidor.");
  }

  // UX-SPEC 3.1 (bug real): rotas de AUTENTICAÇÃO nunca passam pelo refresh-and-redirect.
  // Senão, errar a senha no login (401) com um refreshToken velho dispara refresh→falha→
  // onUnauthorized()→reload com "sessão expirou" — em vez de "Credenciais inválidas" inline.
  // O 401/409/400 dessas rotas DEVE propagar como ApiError p/ o form mostrar o erro por status.
  const isAuthEntryPath =
    path.includes("/auth/login") || path.includes("/auth/register") || path.includes("/auth/forgot");

  // S-27: access token expirado (401). Tenta renovar silenciosamente via refresh token.
  // Não tenta refresh se: já estamos tentando refresh (loop), a rota é /auth/refresh, ou é
  // uma rota de entrada de auth (login/register/forgot — o 401 ali é credencial, não sessão).
  if (res.status === 401 && !isRefreshing && !path.includes("/auth/refresh") && !isAuthEntryPath) {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      isRefreshing = true;
      try {
        const refreshRes = await fetch(`${BASE}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        if (refreshRes.ok) {
          const data = await refreshRes.json() as AuthResponse;
          setToken(data.accessToken);
          if (data.refreshToken) setRefreshToken(data.refreshToken);
          // Repete a request original com o novo token.
          isRefreshing = false;
          return api<T>(path, init);
        }
      } catch {
        // Refresh falhou por rede — trata como sessão expirada
      }
      isRefreshing = false;
    }
    // Refresh indisponível ou falhou: sessão expirada de verdade.
    onUnauthorized();
    throw new ApiError(401, "Sessão expirada.");
  }

  // E1-d QA: 403 com marca ativa pode ser "marca inválida para o workspace" (ex.:
  // sap_brand aponta p/ marca removida ou de outra conta). Em vez de travar a UI num
  // loop de toasts "sem permissão", esquece a marca e refaz a request UMA vez — cai na
  // marca-default. 403 sem marca ativa (ou de outro tipo) segue o fluxo de erro normal.
  if (res.status === 403 && brandId && !isRecoveringBrand) {
    const text = await res.text().catch(() => "");
    if (isInvalidBrandProblem(text)) {
      setBrandId(null);
      isRecoveringBrand = true;
      try {
        return await api<T>(path, init);
      } finally {
        isRecoveringBrand = false;
      }
    }
    // 403 de marca não-reconhecido: preserva a mensagem já lida e propaga.
    throw new ApiError(403, extractMessageFromText(res, text));
  }

  if (!res.ok) {
    const message = await extractErrorMessage(res);
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Baixa um arquivo binário autenticado (Blob), carregando Authorization + X-Brand-Id
 * — um <a href> cru NÃO envia esses headers (401 / marca errada). Usado pelo export ZIP
 * (E11.5). Devolve o Blob; o caller dispara o download com URL.createObjectURL.
 */
export async function downloadBlob(path: string): Promise<Blob> {
  const token = getToken();
  const brandId = getBrandId();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(brandId ? { "X-Brand-Id": brandId } : {}),
      },
    });
  } catch {
    throw new ApiError(0, "Sem conexão com o servidor.");
  }
  if (res.status === 401) {
    onUnauthorized();
    throw new ApiError(401, "Sessão expirada.");
  }
  if (!res.ok) throw new ApiError(res.status, await extractErrorMessage(res));
  return res.blob();
}

/** Campos retornados por login e registro (AuthResponse do backend). */
interface AuthResponse {
  accessToken: string;
  expiresAt?: string;
  refreshToken?: string;
  workspaceId?: string;
  userId?: string;
  role?: string;
}

/** Dispara o warm-up dos serviços (a API acorda o agents). Best-effort: fire-and-forget, nunca lança. */
function warmUp(): void {
  try {
    void api("/api/warmup").catch(() => {});
  } catch {
    /* ignore — warm-up é best-effort */
  }
}

/** Login: obtém e guarda o token. */
export async function quickLogin(email: string, password: string): Promise<string> {
  const r = await api<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setToken(r.accessToken);
  setRole(r.role ?? null);
  // Persiste refresh token para renovação silenciosa (S-27).
  if (r.refreshToken) setRefreshToken(r.refreshToken);
  // WARM-UP (cold-start Render free): o login já acordou a API; pedimos a ela que desperte o agents
  // em paralelo. Fire-and-forget — não atrasa nem quebra o login. No tempo de navegar até "Gerar", o
  // agents já está vivo → 1ª geração sem cold-start.
  warmUp();
  return r.accessToken;
}

/** Registro (primeiro acesso): cria User + Workspace e já guarda o token. */
export async function quickRegister(
  email: string,
  password: string,
  workspaceName?: string,
): Promise<string> {
  const r = await api<AuthResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, workspaceName }),
  });
  setToken(r.accessToken);
  setRole(r.role ?? null);
  // Persiste refresh token para renovação silenciosa (S-27).
  if (r.refreshToken) setRefreshToken(r.refreshToken);
  warmUp(); // cold-start: acorda o agents já no primeiro acesso (ver quickLogin)
  return r.accessToken;
}
