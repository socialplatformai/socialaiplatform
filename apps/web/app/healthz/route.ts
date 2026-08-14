import { NextResponse } from "next/server";

// Healthcheck do próprio web (Next standalone), consumido pelo healthCheckPath do Render.
// Propositalmente FORA de /api/* — esse prefixo é reescrito para a API em modo PROXY
// (ver next.config.ts), então /api/health testaria a API, não o web. /healthz testa só
// que o processo Next está de pé e servindo HTTP — exatamente o que o PaaS precisa saber
// antes de rotear tráfego (e o que evita marcar "live" um container inalcançável).
//
// force-dynamic: nunca cachear; o health tem de refletir o estado atual a cada chamada.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok" }, { status: 200 });
}
