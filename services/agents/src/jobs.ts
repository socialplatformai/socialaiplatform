import { randomUUID } from "node:crypto";
import type { AiOverride, GenerateRequest, GenerateResult, Job } from "./types.js";
import { adaptHttpToPipelineInput, validatePipelineInput, sanitizePromptOverrides } from "./agents/input-adapter.js";
import { runPipelineV2 } from "./agents/pipeline-v2.js";
import type { PipelineResult, SlideCopy } from "./types/pipeline.js";
import { type AiConfig, type ProviderKind, type ImageProviderKind, defaultModelFor, loadAiConfig } from "./config.js";
import { resolveTemplates } from "./templates/resolve.js";
import { rasterizeSlide, type RasterLayers } from "./render/rasterizer.js";

// Store de jobs em memória — decisão aceita para este deploy single-tenant.
// Jobs NÃO sobrevivem a restart do processo; isso é aceitável porque:
//   - O worker .NET tem um reaper que detecta PublishLog órfãos e os reativa.
//   - O frontend já exibe mensagem de erro quando o poll retorna 404.
// Redis foi considerado e descartado: adicionaria complexidade sem ganho real
// no modelo de deploy atual. Reavaliar se houver múltiplas instâncias de agents.
const jobs = new Map<string, Job>();

/** Normaliza um provider de string livre p/ ProviderKind; inválido/ausente → undefined. */
function normOverrideProvider(v: string | undefined): ProviderKind | undefined {
  const k = (v ?? "").trim().toLowerCase();
  return k === "gemini" || k === "openai" || k === "grok" || k === "anthropic" || k === "imagen" ? k : undefined;
}

/**
 * task 1.2: o override de workspace carrega UM `provider` (texto+imagem juntos). Para a IMAGEM,
 * só vale se for um provider que GERA imagem (gemini/openai/imagen — grok/anthropic não geram).
 * grok/anthropic no override → undefined aqui → a imagem mantém o provider do env (base). flux/stock
 * não chegam por este campo unificado (seleção por env nesta fase); a UI de imagem-só é evolução.
 */
function normOverrideImageProvider(v: string | undefined): ImageProviderKind | undefined {
  const k = (v ?? "").trim().toLowerCase();
  return k === "gemini" || k === "openai" || k === "imagen" || k === "flux" || k === "stock" ? k : undefined;
}

/**
 * Mescla o aiOverride (vindo da API por workspace, B4) SOBRE a AiConfig do ambiente.
 * Regra: override vence campo-a-campo; ausência → mantém o valor do env (degradado honesto).
 *
 * Sutileza do modelo: se o override TROCA o provider de uma modalidade e NÃO fornece o
 * modelo, o modelo do `base` (que segue o provider do .env) ficaria errado — pegaria o id
 * de OUTRO provider. Então recalculamos o default pelo provider efetivo via defaultModelFor.
 * Se o override mantém o provider, preserva-se o modelo do base (respeita AI_TEXT_MODEL do env).
 *
 * Modelos inválidos (e-mail, vazio) são descartados — já vimos AI_IMAGE_MODEL / imageModel
 * com e-mail em produção → Gemini HTTP 404.
 *
 * A função é PURA (sem process.env, sem efeito) — testável isoladamente (B4-bis).
 */
function isUsableModelId(v: string | undefined | null): v is string {
  const s = (v ?? "").trim();
  if (!s) return false;
  // E-mail ou lixo que não é id de modelo (causa 404 no Gemini).
  if (s.includes("@")) return false;
  return true;
}

export function mergeAiOverride(base: AiConfig, override?: AiOverride): AiConfig {
  if (!override) {
    // Sem override: preserva referência se os modelos do env já são usáveis (não-regressão nos testes).
    const textOk = isUsableModelId(base.model.text);
    const imageOk = isUsableModelId(base.model.image);
    if (textOk && imageOk) return base;
    return {
      ...base,
      model: {
        text: textOk ? base.model.text : defaultModelFor(base.textProvider, "text"),
        image: imageOk ? base.model.image : defaultModelFor(base.imageProvider, "image"),
      },
    };
  }
  const provider = normOverrideProvider(override.provider);
  // task 1.2: imagem usa o normalizador SÓ-imagem — grok/anthropic no override não viram
  // imageProvider (não geram imagem); mantém o do env. Os modelos abaixo seguem o provider efetivo.
  const imageProviderOverride = normOverrideImageProvider(override.provider);
  const textProvider = provider ?? base.textProvider;
  const imageProvider = imageProviderOverride ?? base.imageProvider;

  const apiKey = override.apiKey?.trim() || base.apiKey;
  // O override carrega UMA chave; quando presente, vale para texto e imagem (a chave do
  // workspace é única). Sem override de chave, preserva-se a separação do env.
  const imageApiKey = override.apiKey?.trim() || base.imageApiKey;

  const overrideText = isUsableModelId(override.textModel) ? override.textModel.trim() : undefined;
  const overrideImage = isUsableModelId(override.imageModel) ? override.imageModel.trim() : undefined;
  const baseText = isUsableModelId(base.model.text) ? base.model.text : defaultModelFor(textProvider, "text");
  const baseImage = isUsableModelId(base.model.image) ? base.model.image : defaultModelFor(imageProvider, "image");

  const text =
    overrideText ||
    (provider ? defaultModelFor(textProvider, "text") : baseText);
  const image =
    overrideImage ||
    (imageProviderOverride ? defaultModelFor(imageProvider, "image") : baseImage);

  return {
    ...base,
    textProvider,
    imageProvider,
    apiKey,
    imageApiKey,
    model: { text, image },
  };
}

/**
 * 🔴 SEGURANÇA (B/ADR-0008): devolve uma cópia do request SEM a apiKey em claro, para
 * logar com segurança. A apiKey do override NUNCA pode ir parar em console/app.log. O
 * campo é substituído por "***" quando presente. Função pura e testável (teste de redaction).
 */
export function sanitizeRequest(req: GenerateRequest): GenerateRequest {
  if (!req?.aiOverride?.apiKey) return req;
  return { ...req, aiOverride: { ...req.aiOverride, apiKey: "***" } };
}

export function createJob(_req: GenerateRequest): Job {
  const job: Job = {
    id: randomUUID(),
    status: "queued",
    progress: 0,
    createdAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

/** Mapeia o PipelineResult rico → o GenerateResult do contrato HTTP.
 *  Exportado p/ teste (C/ADR-0008): propagação de usage do PipelineResult ao contrato. */
/**
 * Detecta uma URL de imagem REAL (já gerada): data-uri base64 ou http(s).
 * Um prompt de texto livre (ex.: "uma rede de nós neon") NÃO é imagem — esses ficam
 * em background.value ANTES de o image-generator rodar; só após a geração viram data:/http.
 */
function isRealImage(v: unknown): v is string {
  return typeof v === "string" && (v.startsWith("data:image") || v.startsWith("http"));
}

/**
 * FASE 0 (ADR-0014/B1): a imagem gerada pode acabar em DOIS lugares no SlideVisualSpec:
 *   - background.value  → quando o slide usa imagem de FUNDO (image-generator.ts processSlide)
 *   - elements[].content → quando a imagem é um ELEMENTO (role 'image'/'background')
 * O extrator antigo lia SÓ background.value, então cover/last (que vêm como elemento)
 * caíam para undefined → ImageUrl vazio no banco → preview cinza. Agora cobrimos ambos,
 * com precedência para o background (é o fundo do slide; elemento é overlay/destaque).
 */
function extractSlideImage(visualSlide: unknown): string | undefined {
  if (!visualSlide || typeof visualSlide !== "object") return undefined;
  const slide = visualSlide as {
    background?: { value?: unknown };
    elements?: Array<{ role?: string; type?: string; content?: unknown }>;
  };
  if (isRealImage(slide.background?.value)) return slide.background!.value as string;
  const imgEl = slide.elements?.find(
    (e) => (e?.role === "image" || e?.role === "background" || e?.type === "image") && isRealImage(e?.content),
  );
  return imgEl ? (imgEl.content as string) : undefined;
}

/**
 * FASE 1 (ADR-0014): extrai as camadas de composição de um SlideVisualSpec → SlideLayers (contrato HTTP).
 * Repassa o que o pipeline JÁ produziu (background + elements posicionados + canvas), sem achatar — é a
 * estrutura que o `<SlideCanvas>` (F2) renderiza. Decisão de design F1: JSON opaco; a API .NET persiste/
 * reemite verbatim. `tokens` da marca NÃO entram aqui (a UI os tem do brand kit). Slide sem spec → undefined
 * (a API grava LayersJson NULL — degradado honesto). Função pura (testável isoladamente).
 */
function extractSlideLayers(visualSlide: unknown): import("./types.js").SlideLayers | undefined {
  if (!visualSlide || typeof visualSlide !== "object") return undefined;
  const slide = visualSlide as {
    background?: { type?: string; value?: unknown; opacity?: number };
    elements?: Array<{
      type?: string;
      role?: string;
      content?: unknown;
      style?: Record<string, unknown>;
      position?: { x?: number; y?: number; width?: number; height?: number | "auto" };
    }>;
    canvas?: { width?: number; height?: number };
  };

  const background =
    slide.background && typeof slide.background.value === "string"
      ? {
          type: (slide.background.type as "solid" | "gradient" | "image") ?? "solid",
          value: slide.background.value,
          ...(typeof slide.background.opacity === "number" ? { opacity: slide.background.opacity } : {}),
        }
      : undefined;

  const elements = Array.isArray(slide.elements)
    ? slide.elements
        .filter((e) => e && typeof e.content === "string")
        .map((e) => ({
          type: (e.type as "text" | "icon" | "image" | "shape" | "divider") ?? "text",
          role: typeof e.role === "string" ? e.role : "body",
          content: e.content as string,
          ...(e.style ? { style: e.style } : {}),
          ...(e.position
            ? {
                position: {
                  x: Number(e.position.x ?? 0),
                  y: Number(e.position.y ?? 0),
                  width: Number(e.position.width ?? 0),
                  height: e.position.height === "auto" ? ("auto" as const) : Number(e.position.height ?? 0),
                },
              }
            : {}),
        }))
    : undefined;

  const canvas =
    slide.canvas && typeof slide.canvas.width === "number" && typeof slide.canvas.height === "number"
      ? { width: slide.canvas.width, height: slide.canvas.height }
      : undefined;

  // Slide sem nenhuma camada → undefined (não emite objeto vazio).
  if (!background && !(elements && elements.length) && !canvas) return undefined;
  return {
    ...(background ? { background } : {}),
    ...(elements && elements.length ? { elements } : {}),
    ...(canvas ? { canvas } : {}),
  };
}

/**
 * Compõe a imagem FINAL de cada slide (fundo + texto da IA) e a grava em `imageUrl`, IN-PLACE.
 * Sem isto, a imagem publicada era só o fundo (extractSlideImage) e o texto ficava só nas `layers`
 * (composto apenas pelo preview do navegador) — então o post saía sem headline/corpo/CTA.
 *
 * Reusa `rasterizeSlide` (a mesma engine Satori/resvg do endpoint /rasterize da edição): as `layers`
 * já têm o shape de RasterLayers (background + elements). `imageUrl` atual entra como fallback de
 * fundo. Falha de UM slide (fonte ausente, resvg) → mantém o imageUrl atual (degradado honesto):
 * a geração NUNCA é derrubada por isto. Slides sem `layers` (mock/degradado) ficam intocados.
 */
export async function composeSlideImages(result: GenerateResult): Promise<void> {
  const slides = result.slides ?? [];
  // Em PARALELO: cada slide é independente (muta só a si). Corta o wall-clock vs sequencial num
  // carrossel (N×~1s → ~1s). Promise.all sem rejeição: cada slide trata o próprio erro (mantém o
  // fundo) → a composição NUNCA derruba a geração, mesmo que um slide falhe.
  await Promise.all(
    slides.map(async (slide) => {
      if (!slide.layers) return; // sem camadas → nada a compor (mantém imageUrl atual)
      try {
        const png = await rasterizeSlide(slide.layers as RasterLayers, slide.imageUrl);
        if (png) slide.imageUrl = png;
      } catch (err) {
        // Degradado honesto: mantém o fundo cru; loga p/ diagnóstico (não quebra a geração).
        console.error(`[compose] falha ao rasterizar slide ${slide.index} — mantém o fundo. Causa:`, err);
      }
    }),
  );
}

export function toGenerateResult(result: PipelineResult): GenerateResult {
  const copySlides: SlideCopy[] = result.copy?.slides ?? [];
  const visualSlides = result.visual?.slides ?? [];

  const slides = copySlides.map((c, i) => {
    const copyText = [c.headline, c.subheadline, c.body, c.quote, c.cta]
      .filter(Boolean)
      .join("\n");
    return {
      index: c.index ?? i,
      copy: copyText,
      imageUrl: extractSlideImage(visualSlides[i]),
      // FASE 0 (ADR-0014/B2): renderHtml REMOVIDO do contrato — era 1 MB de base64 que o
      // frontend nunca consumia (zero usos no web). A imagem agora viaja só em imageUrl.
      // FASE 1 (ADR-0014): camadas de composição (fundo + elementos posicionados) — sem achatar.
      // A API persiste em LayersJson (opaco); o `<SlideCanvas>` (F2) as renderiza.
      layers: extractSlideLayers(visualSlides[i]),
    };
  });

  const caption = result.copy?.microcopy?.profileCaption ?? "";
  const cta = result.copy?.microcopy?.ctaButton ?? "";
  const hashtags = (caption.match(/#[\p{L}0-9_]+/gu) ?? []).map((h) => h.slice(1));

  // S-14: repassa score/passed para que a API/worker possam tratar conteúdo
  // com qualidade abaixo do limiar (ex: salvar como Draft com badge de aviso).
  const quality = result.quality
    ? { score: result.quality.score, passed: result.quality.passed }
    : undefined;

  // AI-native: extrai o RACIOCÍNIO real dos agentes (antes descartado) para o reveal "por que a IA
  // fez assim". Tudo opcional/curto; ausente quando o pipeline não trouxe (mock) → a UI omite.
  const r = result.strategy?.reasoning;
  const checks = (result.quality?.checks ?? [])
    .filter((c) => !c.passed || c.severity === "error" || c.severity === "critical")
    .slice(0, 6)
    .map((c) => ({ label: c.details || c.rule, passed: c.passed, severity: c.severity }));
  // task 1.1: resumo curto e auditável da decisão do Creative Director (estratégia visual).
  const cd = result.creativeDirection;
  const creativeStrategy = cd
    ? {
        primary: cd.primaryStrategy,
        rationale: cd.rationale,
        deferredSlides: cd.perSlide.filter((s) => s.deferred).length,
      }
    : undefined;
  const reasoning =
    r || result.story?.overallNarrative || checks.length > 0 || creativeStrategy
      ? {
          whyTemplate: r?.whyThisTemplate,
          whyAngle: r?.whyThisAngle,
          narrativeAngle: result.strategy?.narrativeAngle,
          keyInsights: (r?.keyInsights ?? []).slice(0, 3),
          narrative: result.story?.overallNarrative,
          qualityChecks: checks,
          creativeStrategy,
        }
      : undefined;

  // C (ADR-0008): propaga o uso (tokens de texto + nº de imagens) p/ a API estimar o custo
  // e gravar um SpendEntry. Ausente no PipelineResult (mock/sem chave) → usage ausente no
  // contrato → a API trata como custo 0.
  // ⚠️ F5: provider/textModel/imageModel NÃO existem no PipelineResult — vêm da AiConfig do job e
  // são anexados por `withUsageMeta` (chamado SEMPRE após este mapper em runJob). Se você consumir
  // o retorno de toGenerateResult sem passar por withUsageMeta, o custo cai nos preços DEFAULT
  // (provider/modelo desconhecidos), nunca quebra — mas perde a fidelidade por modelo.
  const usage = result.usage
    ? {
        textInputTokens: result.usage.textInputTokens,
        textOutputTokens: result.usage.textOutputTokens,
        imageCount: result.usage.imageCount,
      }
    : undefined;

  // F6/B3: nome do template escolhido pelo brand-strategist (para o reveal no wizard). Vem do
  // summary; "unknown"/vazio → undefined (a UI omite o reveal em vez de mostrar "unknown").
  const tpl = result.summary?.template;
  const templateName = tpl && tpl !== "unknown" ? tpl : undefined;

  // G4 (A/B barato): as alternativas que o copywriter já gera (2 headlines + 2 CTAs) — antes
  // descartadas aqui. Só emite a faixa quando há pelo menos uma opção real (filtra vazias); ausente
  // (mock/degradado/copywriter sem alternativas) → undefined → a API/UI omitem a faixa "Alternativas".
  const altHeadlines = (result.copy?.alternatives?.headlines ?? [])
    .map((h) => h.trim())
    .filter(Boolean);
  const altCtas = (result.copy?.alternatives?.ctas ?? []).map((c) => c.trim()).filter(Boolean);
  const alternatives =
    altHeadlines.length || altCtas.length
      ? { headlines: altHeadlines, ctas: altCtas }
      : undefined;

  return { slides, caption, cta, hashtags, templateName, quality, reasoning, alternatives, usage };
}

/**
 * F5 (Eixo D): anexa provider + modelos efetivos ao `usage` do resultado, para a API estimar o
 * custo REAL (token×modelo) e gravar provider/model no SpendEntry. Os modelos vêm da AiConfig
 * resolvida POR JOB (env + override do workspace), não da resposta do provider. Sem `usage`
 * (mock/sem chave) nada é anexado — a API trata como custo 0. Função pura/testável.
 */
export function withUsageMeta(
  result: GenerateResult,
  ai: { textProvider: string; model: { text: string; image: string } },
): GenerateResult {
  if (!result.usage) return result;
  return {
    ...result,
    usage: {
      ...result.usage,
      provider: ai.textProvider,
      textModel: ai.model.text,
      imageModel: ai.model.image,
    },
  };
}

/**
 * E2 (ADR-0008): funde as hashtags da marca (brandContext.hashtags) no GenerateResult, sem
 * duplicar as já presentes (o copywriter pode tê-las incluído). Caso de borda: NÃO altera a
 * `caption` (a UI a edita); só o array `hashtags` (que a API persiste em content.Hashtags). As da
 * marca vão por último, preservando a ordem do que o copy gerou. Função pura/testável.
 */
export function mergeBrandHashtags(result: GenerateResult, brandHashtags?: string[]): GenerateResult {
  const normalized = (brandHashtags ?? [])
    .map((h) => (typeof h === "string" ? h.trim().replace(/^#+/, "").replace(/\s+/g, "") : ""))
    .filter(Boolean);
  if (normalized.length === 0) return result;

  const seen = new Set(result.hashtags.map((h) => h.toLowerCase()));
  const merged = [...result.hashtags];
  for (const core of normalized) {
    if (!seen.has(core.toLowerCase())) {
      seen.add(core.toLowerCase());
      merged.push(core); // GenerateResult.hashtags é SEM '#' (espelha o match do toGenerateResult)
    }
  }
  return { ...result, hashtags: merged };
}

/**
 * Pipeline assíncrono REAL (AM-4): roda o PipelineOrchestratorV2 portado do
 * branding-os. Atualiza progress/step via callbacks; resultado por poll/SSE.
 */
export async function runJob(id: string, req: GenerateRequest): Promise<void> {
  const job = jobs.get(id);
  if (!job) return;

  try {
    job.status = "running";
    job.step = "adapt-input";
    job.progress = 2;

    // AiConfig efetiva por job (Z/ADR-0008): fonte única da verdade (src/config.ts),
    // lida do ambiente e MESCLADA com o aiOverride do workspace (B4). O override (chave/
    // modelo/provider por workspace) VENCE; ausência → env. A AiConfig é resolvida POR JOB
    // (B7): jobs concorrentes com chaves/modelos distintos não compartilham instância —
    // a chave entra na cacheKey do client (gemini/client.ts) e os providers OpenAI são
    // construídos por execução. process.env não é lido pelas factories.
    // Resolvida ANTES do adapter porque o gate de override de prompt (E10.2) depende da flag.
    const ai = mergeAiOverride(loadAiConfig(), req.aiOverride);

    // D3/D4/D5 (ADR-0008): resolve o pool efetivo de templates ANTES do adapter. A guarda de
    // shape (D5) descarta inválidos com log; sem válidos → fallback ao registry built-in. O
    // resultado entra em input.preferences (availableTemplates + forcedTemplate).
    const resolved = resolveTemplates(req.templates, req.forcedTemplateId);
    const input = adaptHttpToPipelineInput(req.brandContext, req.pauta, req.format, {
      templates: resolved,
      // A1 (ADR-0009): instrução de regeneração do request → briefing (verbatim em additionalNotes).
      regenerationInstruction: req.regenerationInstruction,
      // 🔴 ADR-0011/E10.2 — GATE ÚNICO da flag: os overrides de prompt só entram no pipeline
      // quando PROMPT_OVERRIDES_ENABLED está ON. OFF → undefined → cada agente usa o base. É o
      // único ponto que lê a flag; os agentes nunca a reavaliam (veem só presença/ausência).
      promptOverrides: ai.promptOverridesEnabled
        ? sanitizePromptOverrides(req.brandContext.promptOverrides)
        : undefined,
      // Toggle por-geração: estampar o logo da marca nos slides (default false → render atual).
      useLogoIdentity: req.useLogoIdentity,
      // FASE 0: direção criativa do operador (referência/fundo/CTA/subtítulo). Ausente → briefing atual.
      creativeInput: req.creativeInput,
    });
    const validation = validatePipelineInput(input);
    if (!validation.valid) {
      throw new Error(`Input inválido: ${validation.errors.join("; ")}`);
    }

    if (!ai.apiKey) {
      throw new Error("AI_PROVIDER_KEY/GEMINI_API_KEY ausente — defina no .env para gerar.");
    }

    const result = await runPipelineV2(ai, input, {
      onAgentStart: (agentId) => {
        job.step = agentId;
      },
      onAgentComplete: () => {},
      onAgentError: (agentId, err) => {
        job.step = `error:${agentId}`;
        job.error = err.message;
      },
      onProgress: (progress, message) => {
        job.progress = Math.max(job.progress, Math.round(progress));
        job.step = message;
      },
      // ADR-0011/E10.2/D4: override de prompt rejeitado → registra no job (não-silencioso). NÃO
      // é erro de geração (o pipeline completa com o base); fica visível na observabilidade.
      onPromptFallback: (agentKey, reason) => {
        job.promptFallbacks = [...(job.promptFallbacks ?? []), { agentKey, reason }];
      },
    });

    // S-14: success=false significa falha REAL de execução (exceção capturada dentro
    // do pipeline). quality.passed=false é uma avaliação de qualidade — o artefato
    // existe e deve ser entregue; a API/worker decidem o tratamento downstream.
    if (!result.success) {
      throw new Error(result.error ?? "pipeline falhou");
    }

    // E2 (ADR-0008): garante que as hashtags da marca apareçam na saída final (não dependem do
    // copywriter tê-las incluído). Merge sem duplicata (case-insensitive), as da marca por último.
    // F5 (Eixo D): anexa provider+modelos efetivos ao usage (a API estima o custo real por modelo).
    const generateResult = mergeBrandHashtags(toGenerateResult(result), req.brandContext.hashtags);

    // BUG "publica sem texto": extractSlideImage devolvia só o FUNDO — o texto da IA (headline/
    // corpo/CTA) vivia só nas `layers` e nunca era embutido na imagem publicada (só o preview do
    // navegador o compunha). Aqui rasterizamos cada slide (fundo + texto) em PNG via rasterizeSlide
    // (mesma engine do /rasterize da edição), e usamos isso como imageUrl → o publicado == o preview.
    // As `layers` SEGUEM no resultado (a edição posterior re-rasteriza). Degradado honesto: se a
    // rasterização de um slide falhar, mantém o imageUrl atual (fundo) — não derruba a geração.
    await composeSlideImages(generateResult);

    job.result = withUsageMeta(generateResult, ai);
    job.progress = 100;
    job.step = "done";
    job.status = "done";
  } catch (err) {
    job.status = "error";
    job.error = err instanceof Error ? err.message : String(err);
    job.progress = 100;
  }
}
