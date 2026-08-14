# ── deps ─────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# H6: npm ci (build reproduzível a partir do lockfile) em vez de npm install.
RUN npm ci

# ── build ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# A1: o Next inlina NEXT_PUBLIC_* em BUILD-TIME no bundle. O environment: do compose
# (runtime) é ignorado pelo browser. Por isso a URL da API entra como build ARG e é
# congelada aqui — trocar a URL do cliente EXIGE rebuild do web (docker compose build web).
ARG NEXT_PUBLIC_API_URL=http://localhost:5080
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# NEXT_PUBLIC_API_PROXY também é NEXT_PUBLIC_* → tem de entrar em BUILD-TIME, não runtime.
# Tanto o client (lib/api.ts) quanto o rewrite do server (next.config.ts) leem esta flag, e
# ambos são congelados no build. Passá-la só como env de runtime (como o render.yaml fazia)
# NÃO chega ao bundle → o client cai no fallback http://localhost:5080. Em PaaS (proxy mode)
# o build-arg vem "true"; em dev/compose fica "false" (chamada direta à API).
ARG NEXT_PUBLIC_API_PROXY=false
ENV NEXT_PUBLIC_API_PROXY=$NEXT_PUBLIC_API_PROXY
RUN npm run build

# ── runtime (Next standalone) ─────────────────────────────────────────────────
FROM node:20-alpine AS final
WORKDIR /app
ENV NODE_ENV=production
# O server.js standalone faz bind em process.env.HOSTNAME (server.js: `process.env.HOSTNAME || '0.0.0.0'`).
# PaaS como o Render INJETAM HOSTNAME com o nome interno do container — sem este override, o Next
# escuta nesse hostname e o roteador externo não alcança o container → 502 Bad Gateway em todas as
# rotas. Forçar 0.0.0.0 garante bind em todas as interfaces, agnóstico de plataforma. A porta vem
# de process.env.PORT (Render injeta; default 3000 em dev/compose) — não fixar aqui.
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
