import { NextRequest } from "next/server";

// ── Proxy /api/* → backend (.NET), em RUNTIME ───────────────────────────────
// Por que um Route Handler e não rewrites(): no Next standalone o rewrites() é
// CONGELADO em build-time (gravado no routes-manifest.json). Como o PaaS (Render)
// injeta API_URL só em runtime, o build congelava o destination no fallback
// localhost:5080 → 500 imediato (nem chegava na API). Este handler lê API_URL a
// CADA request — runtime de verdade, agnóstico de plataforma.
//
// Em dev/compose o client (lib/api.ts, PROXY=false) chama a API direto e NÃO passa
// por aqui; este proxy só é exercido em modo PROXY (PaaS), onde o browser fala /api/*
// com a mesma origem.

export const dynamic = "force-dynamic"; // nunca cachear; é um proxy.
export const runtime = "nodejs"; // precisa do fetch com body de stream (duplex).

function resolveApiBase(): string {
  // API_URL: injetada em runtime pelo PaaS. No Render vem como hostport da REDE PRIVADA
  // (ex.: "social-ai-api-jlhr:10000") — host interno + porta interna, SEM scheme.
  // Fallbacks: NEXT_PUBLIC_API_URL (build-time, dev) → localhost (local).
  const raw =
    process.env.API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:5080";
  let base = raw.trim().replace(/\/+$/, ""); // sem barra final
  // Normalização de scheme (o Render não inclui scheme no fromService):
  // - já tem http(s):// → usa como está (dev/compose, host público explícito);
  // - sem scheme MAS com :porta → rede privada interna do Render → http:// (a rede
  //   interna não tem TLS; prefixar https:// num host:porta interno falha o handshake);
  // - sem scheme e sem porta → host público → https:// (porta 443 implícita).
  if (!/^https?:\/\//i.test(base)) {
    const hasPort = /:\d+$/.test(base);
    base = hasPort ? `http://${base}` : `https://${base}`;
  }
  return base;
}

// Headers hop-by-hop e específicos do hop que NÃO devem ser repassados ao upstream:
// 'host' apontaria para o domínio do web (a API/CDN pode rejeitar); 'content-length'
// e 'connection' são recalculados pelo fetch; 'accept-encoding' deixa o runtime decidir.
// cdn-loop / x-forwarded-* / via / forwarded são injetados pelo edge (Cloudflare/Render)
// no 1º ingress; repassá-los ao upstream público faria o edge contar 2 passagens →
// 508 Loop Detected. Stripamos para o proxy server-side não disparar a detecção de loop.
const STRIP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "accept-encoding",
  "cdn-loop",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "via",
  "forwarded",
]);

async function handler(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params; // Next 15: params é assíncrono.
  const base = resolveApiBase();
  const search = req.nextUrl.search; // preserva query string
  const target = `${base}/api/${path.join("/")}${search}`;

  // Guarda anti-loop: se API_URL apontar para o PRÓPRIO web (engano comum de config —
  // colar a URL do web em vez da API), o fetch volta para este handler → loop infinito →
  // 508 Loop Detected, sem mensagem útil. Detectamos e abortamos com erro claro em PT-BR.
  try {
    if (new URL(target).host === req.nextUrl.host) {
      console.error(
        `[api-proxy] auto-referência: API_URL (${base}) aponta para o próprio web (${req.nextUrl.host}). ` +
        `Configure API_URL com a URL pública da API (serviço social-ai-api), não do web.`,
      );
      return new Response(
        JSON.stringify({
          error:
            "Configuração inválida: API_URL aponta para o próprio web. " +
            "Defina API_URL com a URL pública da API (social-ai-api), não a do web.",
        }),
        { status: 502, headers: { "content-type": "application/json" } },
      );
    }
  } catch {
    // URL malformada cai no fetch abaixo, que trata no catch.
  }

  // Copia headers do request, removendo os hop-by-hop.
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });

  // GET/HEAD não têm body. Para os demais, repassa o stream do body — exige
  // duplex: "half" no Node (sem isso o fetch lança ao enviar um ReadableStream).
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers,
    redirect: "manual",
    ...(hasBody ? { body: req.body as ReadableStream, duplex: "half" } : {}),
  };

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    // Falha de conectividade com o backend (DNS, recusa, timeout).
    console.error(`[api-proxy] falha ao chamar ${target}:`, err);
    return new Response(
      JSON.stringify({ error: "Backend indisponível." }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }

  // Repassa status, corpo e headers da resposta. Remove os que o runtime do Next
  // recalcula/gere para evitar conflito de framing (content-encoding/length).
  const respHeaders = new Headers(upstream.headers);
  respHeaders.delete("content-encoding");
  respHeaders.delete("content-length");
  respHeaders.delete("transfer-encoding");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
  handler as HEAD,
  handler as OPTIONS,
};
