import "./load-env.js"; // PRIMEIRO import: carrega o .env da raiz antes de qualquer leitura de env.
import Fastify from "fastify";
import { createJob, getJob, runJob, sanitizeRequest, mergeAiOverride } from "./jobs.js";
import type { GenerateRequest, AiOverride } from "./types.js";
import { loadAiConfig } from "./config.js";
import { rasterizeSlide, type RasterLayers } from "./render/rasterizer.js";
import { inventPauta, type InventPautaRequest } from "./pauta/invent-pauta.js";

// 🔴 SEGURANÇA (B/ADR-0008): redaction do logger do Fastify (pino). O serializer de
// request do Fastify loga os HEADERS — então censuramos o x-internal-token aqui (caminho
// ATIVO e efetivo). O corpo (req.body) NÃO é logado pelo serializer padrão, então a apiKey
// do aiOverride não chega ao log por essa via; a defesa REAL contra logar o corpo é o
// sanitizeRequest() (jobs.ts), USADO no handler /generate abaixo — nunca logamos o body cru.
const app = Fastify({
  // F3 (ADR-0014 §4e): /rasterize recebe as camadas COM a imagem de fundo embutida (data-uri base64,
  // ~1 MB/slide). O default do Fastify (1 MB) estoura com 413. 16 MB cobre folgado um slide rico,
  // mantendo um teto contra abuso (a rota é interna, autenticada por x-internal-token).
  bodyLimit: 16 * 1024 * 1024,
  logger: {
    redact: {
      paths: ['req.headers["x-internal-token"]'],
      remove: true,
    },
  },
});
const PORT = Number(process.env.PORT ?? 4000);

// S-29: segredo compartilhado interno para proteger /generate de chamadas externas.
// Se AGENTS_INTERNAL_TOKEN não estiver definida (dev/modo degradado), permitimos o
// acesso mas logamos um aviso único no boot — nunca quebramos o dev local.
const INTERNAL_TOKEN = process.env.AGENTS_INTERNAL_TOKEN;
if (!INTERNAL_TOKEN) {
  app.log.warn(
    "[SEGURANÇA] AGENTS_INTERNAL_TOKEN não definida — agents está sem autenticação. " +
    "Defina essa variável em produção para proteger o budget de IA."
  );
}

/**
 * Verifica o header x-internal-token quando AGENTS_INTERNAL_TOKEN está configurado.
 * Retorna true se a requisição está autorizada.
 */
function checkInternalToken(req: { headers: Record<string, string | string[] | undefined> }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }): boolean {
  if (!INTERNAL_TOKEN) return true; // sem env → dev/degradado, permite sempre
  const received = req.headers["x-internal-token"];
  if (received === INTERNAL_TOKEN) return true;
  reply.code(401).send({ error: "unauthorized" });
  return false;
}

// S-25: handlers globais para rejeições não capturadas. runJob() é fire-and-forget
// (void), então uma rejeição não tratada dentro do job não seria observada sem esses
// handlers — o processo cairia silenciosamente ou produziria erros fantasmas.
process.on("unhandledRejection", (reason, promise) => {
  app.log.error({ reason, promise }, "[processo] unhandledRejection detectada — verifique runJob e callbacks de agentes");
});

process.on("uncaughtException", (err) => {
  app.log.error({ err }, "[processo] uncaughtException detectada — o processo pode estar instável");
});

// Healthcheck (usado pelo docker-compose). Não requer auth — sinal de vida apenas.
app.get("/health", async () => ({
  status: "healthy",
  service: "agents",
  aiProvider: process.env.AI_PROVIDER ?? "gemini",
  timestamp: new Date().toISOString(),
}));

// AM-4: contrato ASYNC. POST /generate retorna { jobId } imediatamente.
// O pipeline de 5 LLM-steps + imagem estoura timeout de proxy se síncrono.
app.post<{ Body: GenerateRequest }>("/generate", async (req, reply) => {
  // S-29: apenas rotas de geração são protegidas; /health é pública (docker healthcheck).
  if (!checkInternalToken(req, reply)) return;

  const body = req.body;
  if (!body?.brandContext || !body?.pauta || !body?.format) {
    return reply.code(400).send({
      error: "bad_request",
      detail: "brandContext, pauta e format são obrigatórios",
    });
  }
  // 🔴 §6.6: observabilidade do request SEM a apiKey em claro. sanitizeRequest substitui
  // a chave do aiOverride por "***" antes de qualquer log — a defesa de redaction do corpo
  // é ATIVA aqui (nunca logamos req.body cru). provider/format ajudam a diagnosticar.
  const job = createJob(body);
  // F5 (Eixo D): jobId é o CORRELATION ID ponta a ponta (request→agents→resultado→spend).
  // Loga-o no início para que o mesmo job seja rastreável por um id em toda a cadeia.
  req.log.info(
    { request: sanitizeRequest(body), jobId: job.id },
    `[generate] job iniciado (jobId=${job.id}, provider=${body.aiOverride?.provider ?? "env"}, format=${body.format})`,
  );
  // dispara em background; não aguarda (fire-and-forget)
  void runJob(job.id, body);
  return reply.code(202).send({ jobId: job.id, status: job.status });
});

// Invenção de PAUTA (o cérebro do loop autônomo, ADR-0010/§2.4). SÍNCRONO (uma chamada LLM de texto,
// ~2-5s; sem job/poll — o worker aguarda a resposta e persiste a pauta). Protegida pelo mesmo
// x-internal-token. O worker chama isto quando a fila editorial esvazia; a resposta é UMA pauta pronta
// (título+objetivo+contexto). Sem chave de IA → 503 diagnosticável (o worker trata como "não inventou":
// degradado honesto, não cria pauta-lixo).
app.post<{ Body: { brand?: unknown; recentTitles?: string[]; desiredFormat?: string; aiOverride?: AiOverride } }>(
  "/invent-pauta",
  async (req, reply) => {
    if (!checkInternalToken(req, reply)) return;

    const body = req.body;
    if (!body?.brand || typeof body.brand !== "object") {
      return reply.code(400).send({ error: "bad_request", detail: "brand (objeto) é obrigatório" });
    }

    // AiConfig efetiva: env MESCLADO com o aiOverride do workspace (mesma regra do /generate). O
    // override (chave/provider/modelo por workspace) vence; ausência → env.
    const ai = mergeAiOverride(loadAiConfig(), body.aiOverride);

    try {
      const invReq: InventPautaRequest = {
        brand: body.brand as InventPautaRequest["brand"],
        recentTitles: Array.isArray(body.recentTitles) ? body.recentTitles : undefined,
        desiredFormat:
          body.desiredFormat === "post" || body.desiredFormat === "carousel" || body.desiredFormat === "story"
            ? body.desiredFormat
            : undefined,
      };
      const pauta = await inventPauta(invReq, ai);
      req.log.info({ provider: body.aiOverride?.provider ?? "env" }, "[invent-pauta] pauta inventada");
      return reply.send(pauta);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      // Sem chave / provider fora do ar / JSON inválido → 503 (degradado honesto): o robô não inventa.
      req.log.error({ err: detail }, "[invent-pauta] falha ao inventar pauta");
      return reply.code(503).send({ error: "invent_failed", detail });
    }
  },
);

// Poll do resultado. Também protegida — quem cria o job deve poder consultá-lo.
app.get<{ Params: { jobId: string } }>("/generate/:jobId", async (req, reply) => {
  // S-29: protege o poll também para não vazar status de jobs de outros tenants.
  if (!checkInternalToken(req, reply)) return;

  const job = getJob(req.params.jobId);
  if (!job) return reply.code(404).send({ error: "not_found" });
  return reply.send(job);
});

// F3 (ADR-0014 §4e): rasteriza camadas → PNG (Satori+resvg). SÍNCRONO (rápido, ~100-300ms/slide;
// sem job/poll). A API chama no save/approve p/ compor o slide editado num único PNG → ImageUrl
// (publish íntegro). Protegida pelo mesmo x-internal-token. Erro de fonte → 503 com mensagem clara.
app.post<{ Body: { layers?: unknown; fallbackImageUrl?: string } }>("/rasterize", async (req, reply) => {
  if (!checkInternalToken(req, reply)) return;
  const layers = req.body?.layers;
  if (!layers || typeof layers !== "object") {
    return reply.code(400).send({ error: "bad_request", detail: "layers (objeto) é obrigatório" });
  }
  try {
    const image = await rasterizeSlide(layers as RasterLayers, req.body?.fallbackImageUrl);
    return reply.send({ image });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    // Falta de fonte / falha do resvg → 503 (degradado honesto): a API mantém o ImageUrl atual.
    req.log.error({ err: detail }, "[rasterize] falha ao rasterizar camadas");
    return reply.code(503).send({ error: "rasterize_failed", detail });
  }
});

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`agents up on :${PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
