import type { NextConfig } from "next";

// CSP é defense-in-depth: o JWT fica em localStorage (trade-off aceito, documentado em D5),
// então XSS é a principal ameaça que a CSP mitiga restringindo origens de scripts e conexões.
//
// 'unsafe-inline' em script-src e style-src é exigido pelo Next.js 15 (hidratação RSC +
// estilos injetados por emotion/tailwind). Remover quebraria o app em produção.
// Em dev, 'unsafe-eval' é necessário para source maps e hot-reload do webpack.
//
// connect-src inclui NEXT_PUBLIC_API_URL (default localhost:5080) para que o fetch()
// da UI chegue à API sem ser bloqueado pela CSP.
const isDev = process.env.NODE_ENV !== "production";
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5080";

// Modo PROXY (deploy PaaS): o browser fala com a mesma origem (`/api/*`), e o encaminhamento
// para a API roda no servidor. O proxy NÃO é mais um rewrites() do next.config: no Next
// standalone o rewrites() é CONGELADO em build-time (gravado no routes-manifest.json), então
// API_URL injetado em runtime pelo PaaS seria IGNORADO — congelava o destination no fallback
// localhost:5080 → 500. O proxy agora vive em app/api/[...path]/route.ts, que lê API_URL em
// runtime de verdade (a cada request). Aqui PROXY serve só p/ a CSP (connect-src) saber que o
// client fala com a mesma origem.
const PROXY = process.env.NEXT_PUBLIC_API_PROXY === "true";

// ws://* e wss://* permitem o HMR websocket do Next.js em dev sem erros no console.
const connectSrc = [
  "'self'",
  ...(PROXY ? [] : [apiUrl]),
  ...(isDev ? ["ws://localhost:3000", "wss://localhost:3000"] : []),
].join(" ");

// Imagem de slide (MinIO): a imagem do slide deixou de ser base64 inline (data:) e passou a vir do PROXY da
// API (302 → presigned do MinIO). O CSP img-src precisa permitir a origem da API E o destino do
// redirect (o MinIO) — o browser valida AMBOS os saltos do <img>. Em modo PROXY a imagem vem da
// mesma origem ('self'). Em dev o MinIO é http://localhost:9000; em prod, MINIO_PUBLIC_BASE_URL
// (já coberto por https:). Sem isto o browser bloqueia a imagem (blockedReason: csp) e o slide
// fica cinza — base64 funcionava só porque data: estava liberado.
const minioPublic = process.env.MINIO_PUBLIC_BASE_URL ?? (isDev ? "http://localhost:9000" : "");
const imgSrc = [
  "'self'",
  "data:",   // gerações legadas / degraded-mode (sem store) ainda inline
  "https:",  // MinIO/CDN em prod (presigned https)
  "blob:",
  ...(PROXY ? [] : [apiUrl]),                  // origem do proxy (302) — em dev http://localhost:5080
  ...(minioPublic && !minioPublic.startsWith("https:") ? [minioPublic] : []), // destino http do 302 (dev)
].join(" ");

const csp = [
  "default-src 'none'",
  // 'unsafe-inline' é necessário para Next.js (inline scripts de hidratação).
  // 'unsafe-eval' só em dev (webpack HMR + source maps).
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  // Tailwind + Next.js injetam <style> inline; sem 'unsafe-inline' a UI fica sem estilos.
  "style-src 'self' 'unsafe-inline'",
  // Imagem de slide (MinIO): além de data:/https:/blob:, libera a origem do proxy da API (e o MinIO http em
  // dev) p/ a imagem do slide carregar via URL (não mais base64). Ver `imgSrc` acima.
  `img-src ${imgSrc}`,
  // Satoshi self-hosted em /public/fonts → 'self' cobre. Sem allowlist de CDN externa
  // (a fonte deixou de vir da Fontshare; o CSP fica fechado por isso).
  "font-src 'self' data:",
  connectSrc ? `connect-src ${connectSrc}` : "",
  // Nenhum plugin Flash/PDF embutido é necessário.
  "object-src 'none'",
  // Prefetch de manifests de outros sites é desnecessário.
  "manifest-src 'self'",
  // Permite workers de service worker (pwa futura) e workers inline do Next.
  "worker-src 'self' blob:",
  // Impede que a página seja embutida em iframes de outras origens (mesmo efeito de X-Frame-Options).
  "frame-ancestors 'none'",
]
  .filter(Boolean)
  .join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,

  // O proxy /api/* foi movido de rewrites() para app/api/[...path]/route.ts (runtime real —
  // ver comentário no topo). rewrites() congelava o destination em build-time no standalone.

  async headers() {
    return [
      {
        // Aplica a todas as rotas da app.
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: csp,
          },
          {
            // Impede clickjacking mesmo em browsers que ignoram frame-ancestors da CSP.
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            // Evita MIME-sniffing: browser deve respeitar o Content-Type declarado.
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            // Não vaza a URL completa no cabeçalho Referer ao navegar para domínios externos.
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
