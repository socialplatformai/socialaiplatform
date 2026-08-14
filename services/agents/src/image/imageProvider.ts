/**
 * IImageProvider — abstração de geração de imagem trocável por env (T-5.2.1).
 * Provider escolhido por IMAGE_PROVIDER: gemini | imagen | openai.
 *
 * Fallback determinístico (gradiente de marca via render-engine) é responsabilidade
 * do chamador (image-generator.ts) — aqui cada provider lança erro DIAGNOSTICÁVEL
 * em vez de devolver imagem preta silenciosa (AM-4/R-2).
 */

import { GeminiAPIClient } from "../gemini/client.js";
import type { AiConfig } from "../config.js";

export interface ImageOptions {
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "4:5";
  style?: string;
}

export interface IImageProvider {
  readonly name: string;
  /** Retorna data-URL (data:image/...;base64,...) ou lança erro diagnosticável. */
  generate(prompt: string, options?: ImageOptions): Promise<string>;
}

/** Gemini — reusa o client REST já portado (com o fix de finishReason). */
export class GeminiImageProvider implements IImageProvider {
  readonly name = "gemini";
  constructor(private client: GeminiAPIClient) {}
  generate(prompt: string, options?: ImageOptions): Promise<string> {
    return this.client.generateImage(prompt, options);
  }
}

/** Imagen (Vertex/Generative Language). Stub explícito até o endpoint ser ligado. */
export class ImagenImageProvider implements IImageProvider {
  readonly name = "imagen";
  constructor(private apiKey: string) {}
  async generate(_prompt: string, _options?: ImageOptions): Promise<string> {
    if (!this.apiKey) throw new Error("IMAGE_PROVIDER_KEY ausente para Imagen.");
    // Endpoint Imagen a ligar em iteração futura; falha diagnosticável, não imagem preta.
    throw new Error("ImagenImageProvider ainda não implementado — use IMAGE_PROVIDER=gemini.");
  }
}

/** Resposta mínima da Images API que consumimos. */
interface OpenAiImageResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
  error?: { message?: string };
}

/**
 * OpenAI Images — REST puro via fetch nativo (Node 20+), espelhando o
 * estilo do GeminiAPIClient (A/ADR-0008). Sem SDK. Endpoint:
 * POST /v1/images/generations. Pede response_format=b64_json e monta o data-URL; se
 * a API só devolver url, busca o binário e converte p/ base64. Sem chave → erro com
 * "openai" e o campo faltante; erro de HTTP → mensagem com "openai" e status.
 */
export class OpenAiImageProvider implements IImageProvider {
  readonly name = "openai";
  private endpoint = "https://api.openai.com/v1/images/generations";

  constructor(private apiKey: string, private model: string) {}

  async generate(prompt: string, options?: ImageOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error("Chave da OpenAI ausente (IMAGE_PROVIDER_KEY/AI_PROVIDER_KEY) — defina-a para usar IMAGE_PROVIDER=openai.");
    }

    let fullPrompt = prompt;
    if (options?.style) fullPrompt += ` Estilo: ${options.style}.`;

    // ATENÇÃO: os modelos GPT image (gpt-image-1/2) NÃO suportam
    // `response_format` — enviá-lo causa HTTP 400 "unknown parameter: response_format". Eles
    // SEMPRE retornam base64 por default. Para escolher o formato do binário usa-se `output_format`
    // (ex.: 'jpeg'). Por isso NÃO enviamos response_format aqui (era um 400 garantido no gpt-image-2).
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        prompt: fullPrompt,
        n: 1,
        output_format: "jpeg",
      }),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as OpenAiImageResponse;
      const detail = data.error?.message ?? response.statusText;
      throw new Error(`Falha na API da OpenAI (imagem) — HTTP ${response.status}: ${detail}`);
    }

    const data = (await response.json()) as OpenAiImageResponse;
    const first = data.data?.[0];

    if (first?.b64_json) {
      // Pedimos output_format:'jpeg' acima → o binário é JPEG. MIME coerente com o pedido.
      return `data:image/jpeg;base64,${first.b64_json}`;
    }
    // Fallback: a API devolveu só uma URL — busca o binário e converte p/ data-URL.
    if (first?.url) {
      const bin = await fetch(first.url);
      if (!bin.ok) {
        throw new Error(`Falha ao buscar a imagem da OpenAI (imagem) — HTTP ${bin.status} ao baixar a url retornada.`);
      }
      const mime = bin.headers.get("content-type") ?? "image/png";
      const base64 = Buffer.from(await bin.arrayBuffer()).toString("base64");
      return `data:${mime};base64,${base64}`;
    }

    throw new Error("Resposta da OpenAI (imagem) sem b64_json nem url (data[0] vazio).");
  }
}

// ──────────────────────────────────────────────────────────────────────────
// task 1.2 — FLUX via Replicate (foto generativa de alto padrão) + Pexels (banco de imagens).
// REST puro via fetch nativo (Node 20+), mesmo estilo do OpenAiImageProvider (sem SDK). Cada um
// lança erro DIAGNOSTICÁVEL (provider + status no texto), nunca devolve imagem silenciosamente ruim.
// ──────────────────────────────────────────────────────────────────────────

/** Resposta mínima de uma prediction do Replicate que consumimos. */
interface ReplicatePrediction {
  id?: string;
  status?: "starting" | "processing" | "succeeded" | "failed" | "canceled" | string;
  // FLUX devolve a imagem em `output`: string (1 url) ou array de urls. Pegamos a 1ª.
  output?: string | string[] | null;
  error?: string | null;
  urls?: { get?: string };
}

/**
 * FLUX (Black Forest Labs) via Replicate — foto generativa. Usa o endpoint MODEL-SPECIFIC
 * (`/v1/models/{owner}/{name}/predictions`), que roda a versão corrente do modelo nomeado sem pinar
 * hash. `Prefer: wait` pede modo SÍNCRONO (a API segura a conexão até o resultado); se ainda assim
 * voltar `processing`, faz POLL curto em `urls.get` até `succeeded`/timeout. O `output` (url) é
 * baixado e convertido p/ data-URL (o pipeline trabalha com data-URLs).
 *
 * BRAND-LOCKING: `options.style` (a paleta da marca, injetada pelo image-generator a partir do
 * design-spec) é dobrado no prompt — a foto nasce na cor da marca, não genérica.
 */
export class FluxImageProvider implements IImageProvider {
  readonly name = "flux";
  private base = "https://api.replicate.com/v1";
  // Teto de poll do fallback (quando `Prefer: wait` expira antes do modelo terminar). Curto:
  // o caller (image-generator) já re-tenta o provider inteiro; aqui só cobrimos o "quase pronto".
  private maxPollMs = 50_000;
  private pollIntervalMs = 2_000;

  constructor(private apiKey: string, private model: string) {}

  async generate(prompt: string, options?: ImageOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error("Chave do Replicate ausente (REPLICATE_API_TOKEN/IMAGE_PROVIDER_KEY) — defina-a para usar IMAGE_PROVIDER=flux.");
    }

    let fullPrompt = prompt;
    if (options?.style) fullPrompt += ` Estilo: ${options.style}.`; // brand-locking (paleta da marca)

    // FLUX aceita aspect_ratio como string ("1:1","16:9","9:16","4:5","4:3"…). Repassamos o pedido
    // do layout (default 4:5 retrato, coerente com o slide 1080×1350) — sem inventar dimensões.
    const aspect = options?.aspectRatio ?? "4:5";

    const res = await fetch(`${this.base}/models/${this.model}/predictions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Prefer: "wait", // modo síncrono — segura a conexão até terminar (ou expirar p/ poll)
      },
      body: JSON.stringify({ input: { prompt: fullPrompt, aspect_ratio: aspect } }),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as ReplicatePrediction;
      const detail = (data.error as string) ?? res.statusText;
      throw new Error(`Falha na API do Replicate (flux) — HTTP ${res.status}: ${detail}`);
    }

    let pred = (await res.json()) as ReplicatePrediction;

    // Se `Prefer: wait` expirou com o modelo ainda rodando, faz poll curto em urls.get.
    pred = await this.pollUntilDone(pred);

    if (pred.status === "failed" || pred.status === "canceled") {
      throw new Error(`Replicate (flux) terminou em '${pred.status}': ${pred.error ?? "sem detalhe"}.`);
    }

    const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
    if (!url || typeof url !== "string") {
      throw new Error(`Replicate (flux) sem output utilizável (status '${pred.status ?? "?"}').`);
    }
    return this.toDataUrl(url);
  }

  /** Poll em urls.get enquanto starting/processing, até succeeded/failed ou timeout. */
  private async pollUntilDone(pred: ReplicatePrediction): Promise<ReplicatePrediction> {
    const getUrl = pred.urls?.get;
    let current = pred;
    let waited = 0;
    while ((current.status === "starting" || current.status === "processing") && getUrl) {
      if (waited >= this.maxPollMs) {
        throw new Error(`Replicate (flux) não terminou em ${this.maxPollMs}ms (status '${current.status}').`);
      }
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
      waited += this.pollIntervalMs;
      const r = await fetch(getUrl, { headers: { Authorization: `Bearer ${this.apiKey}` } });
      if (!r.ok) {
        throw new Error(`Falha ao consultar a prediction do Replicate (flux) — HTTP ${r.status}.`);
      }
      current = (await r.json()) as ReplicatePrediction;
    }
    return current;
  }

  /** Baixa a url de imagem do Replicate e converte p/ data-URL base64. */
  private async toDataUrl(url: string): Promise<string> {
    const bin = await fetch(url);
    if (!bin.ok) {
      throw new Error(`Falha ao baixar a imagem do Replicate (flux) — HTTP ${bin.status}.`);
    }
    const mime = bin.headers.get("content-type") ?? "image/png";
    const base64 = Buffer.from(await bin.arrayBuffer()).toString("base64");
    return `data:${mime};base64,${base64}`;
  }
}

/** Resposta mínima da busca do Pexels que consumimos. */
interface PexelsSearchResponse {
  photos?: Array<{ src?: { original?: string; large2x?: string; large?: string; medium?: string } }>;
  error?: string;
}

/**
 * Banco de imagens via Pexels — busca temática (NÃO geração). Implementa a MESMA interface:
 * `generate(prompt)` = buscar a foto mais relevante e baixá-la como data-URL. Pexels foi escolhido
 * sobre Unsplash por licença permissiva (sem atribuição obrigatória — o Unsplash exige por ToS),
 * chave simples (header `Authorization`, sem OAuth) e rate-limit melhor no free (200/h).
 *
 * O `prompt` é um briefing de imagem (frase) — Pexels casa melhor com poucas palavras-chave, então
 * encurtamos para os primeiros termos. `options.style` (paleta) NÃO entra na query (banco não compõe
 * por cor de marca; isso é da foto generativa) — fica documentado, não mascarado.
 */
export class StockImageProvider implements IImageProvider {
  readonly name = "stock";
  private endpoint = "https://api.pexels.com/v1/search";

  constructor(private apiKey: string) {}

  async generate(prompt: string, options?: ImageOptions): Promise<string> {
    if (!this.apiKey) {
      throw new Error("Chave do Pexels ausente (PEXELS_API_KEY/IMAGE_PROVIDER_KEY) — defina-a para usar IMAGE_PROVIDER=stock.");
    }

    // Pexels busca melhor com palavras-chave curtas; pega os primeiros ~8 termos do briefing.
    const query = prompt.trim().split(/\s+/).slice(0, 8).join(" ") || prompt.trim();
    const orientation = this.mapOrientation(options?.aspectRatio);
    const url = `${this.endpoint}?query=${encodeURIComponent(query)}&per_page=1&orientation=${orientation}`;

    const res = await fetch(url, { headers: { Authorization: this.apiKey } }); // SEM "Bearer" (ToS Pexels)
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as PexelsSearchResponse;
      const detail = data.error ?? res.statusText;
      throw new Error(`Falha na API do Pexels (stock) — HTTP ${res.status}: ${detail}`);
    }

    const data = (await res.json()) as PexelsSearchResponse;
    const src = data.photos?.[0]?.src;
    const photoUrl = src?.large2x ?? src?.large ?? src?.original ?? src?.medium;
    if (!photoUrl) {
      throw new Error(`Pexels (stock) não retornou foto para a busca "${query}".`);
    }

    const bin = await fetch(photoUrl);
    if (!bin.ok) {
      throw new Error(`Falha ao baixar a foto do Pexels (stock) — HTTP ${bin.status}.`);
    }
    const mime = bin.headers.get("content-type") ?? "image/jpeg";
    const base64 = Buffer.from(await bin.arrayBuffer()).toString("base64");
    return `data:${mime};base64,${base64}`;
  }

  /** aspect-ratio do layout → orientation do Pexels (landscape/portrait/square). */
  private mapOrientation(aspect?: ImageOptions["aspectRatio"]): "landscape" | "portrait" | "square" {
    switch (aspect) {
      case "9:16":
      case "4:5":
        return "portrait";
      case "1:1":
        return "square";
      default:
        return "landscape"; // 16:9, 4:3 e ausência
    }
  }
}

/**
 * Factory: escolhe o provider de imagem a partir da AiConfig efetiva (Z/ADR-0008).
 * NÃO lê process.env — provider e chave vêm de `ai`. A chave de imagem usa a chave
 * dedicada (ai.imageApiKey) com fallback para a chave geral (ai.apiKey), preservando
 * o comportamento atual (IMAGE_PROVIDER_KEY opcional). Default gemini (o único portado).
 * @param ai config efetiva propagada pela cadeia.
 * @param geminiClient client concreto já configurado (modelo de imagem da AiConfig).
 */
export function resolveImageProvider(ai: AiConfig, geminiClient: GeminiAPIClient): IImageProvider {
  const key = ai.imageApiKey || ai.apiKey;
  switch (ai.imageProvider) {
    case "imagen":
      return new ImagenImageProvider(key);
    case "openai":
      // Modelo já resolvido na AiConfig (default via defaultModelFor quando o env
      // não fixa AI_IMAGE_MODEL). O provider recebe {apiKey, model} — A/ADR-0008.
      return new OpenAiImageProvider(key, ai.model.image);
    case "flux":
      // task 1.2: FLUX via Replicate (foto generativa de alto padrão). Modelo (owner/name) já
      // resolvido na AiConfig (defaultModelFor('flux','image')). Chave = imageApiKey || apiKey.
      return new FluxImageProvider(key, ai.model.image);
    case "stock":
      // task 1.2: banco de imagens via Pexels (busca temática). Sem "modelo" — só a chave.
      return new StockImageProvider(key);
    case "gemini":
    default:
      return new GeminiImageProvider(geminiClient);
  }
}
