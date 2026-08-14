// Contratos de fronteira do microserviço agents (L9). O pipeline real (6 agentes,
// port do branding-os) chega em E-5; aqui ficam os tipos do contrato /generate.

import type { CarouselTemplate } from "./types/pipeline.js";
import type { PromptAgentKey } from "./types/agent-keys.js";

export type ContentFormat = "post" | "carousel" | "story";

/** Identidade visual da marca (E2/ADR-0005). preset = id do design system; os demais
 *  campos sobrescrevem o preset campo-a-campo (merge no input-adapter). */
export interface BrandVisualIdentity {
  preset?: string;
  colors?: {
    primary?: string;
    secondary?: string;
    accent?: string;
    background?: string;
    text?: string;
  };
  headingFont?: string;
  bodyFont?: string;
  logoUrl?: string;
}

/** Contexto de marca serializado pela API (E-3) e enviado aos agentes. */
export interface BrandContext {
  workspaceId: string;
  branding?: string;
  tone?: string;
  guidelines?: string;
  competitors?: string[];
  visualReferences?: string[];
  learningSummary?: string; // injetado pelo loop de aprendizado (E-8), textual (lido pelo copywriter)
  // Sinal TIPADO do loop de aprendizado — formato que mais engajou (post/carousel/story), da API
  // (PerformanceAnalyzer.BuildBestFormatAsync). O input-adapter o mapeia p/ preferences.performanceBestFormat
  // e o brand-strategist o usa como VIÉS de escolha de template. Ausente (amostra <3) → sem viés.
  bestFormat?: ContentFormat;
  // S-12: handle do Instagram do tenant (ex: "@minha_marca").
  // Quando ausente, o render usa string vazia — nunca um handle de terceiro.
  handle?: string;
  // Brand config completo (persistia no BrandKit mas não chegava aos agentes).
  positioningRules?: string;
  desiredContentTypes?: string;
  // E2 (ADR-0005): identidade visual da marca (tipo nomeado BrandVisualIdentity).
  // Ausente → cai no preset/default APEX (degradado honesto, B5).
  visualIdentity?: BrandVisualIdentity;
  // E3.1 (via E2): público-alvo da marca. Substitui o literal 'Audiência da marca'.
  targetAudience?: string;
  // E3.3 (via E2): exemplos de copy da marca (deixam de ser []).
  copyExamples?: string[];
  // E2 (ADR-0008): hashtags da biblioteca de marca (BrandLibraryItem Kind=Hashtag). A engine
  // as injeta na caption final; ausente → sem hashtags da biblioteca (degradado honesto).
  hashtags?: string[];
  // ADR-0013: override de system-prompt por agente (agentKey→texto), emitido pela API .NET por
  // workspace. SÓ é lido quando PROMPT_OVERRIDES_ENABLED=true (gate único em jobs.ts); caso
  // contrário, ignorado e cada agente usa o prompt-base versionado. Ausente = nenhum override.
  promptOverrides?: Record<string, string>;
  [key: string]: unknown;
}

/** Pauta vinda da API (E-4). */
export interface Pauta {
  id: string;
  title: string;
  objective?: string;
  context?: string;
  attachments?: string[];
  // E3.2: objetivo de marketing da pauta (texto curto). O adapter normaliza p/ o union
  // goal.objective (awareness|consideration|conversion); sem casar → awareness (fallback).
  marketingObjective?: string;
  // E3.5: categoria da pauta → entra em content.additionalNotes.
  category?: string;
  [key: string]: unknown;
}

/**
 * Override de IA por workspace (B4/ADR-0008). A API injeta provider/modelo/chave do
 * workspace aqui; ausente → o agents cai no .env (loadAiConfig). A `apiKey` é SENSÍVEL:
 * NUNCA pode ser logada em claro (ver sanitizeRequest em jobs.ts e a redaction do logger
 * em server.ts). Todos os campos são opcionais — o merge sobre o env só aplica o presente.
 */
export interface AiOverride {
  provider?: string;
  textModel?: string;
  imageModel?: string;
  apiKey?: string;
}

export interface GenerateRequest {
  brandContext: BrandContext;
  pauta: Pauta;
  format: ContentFormat;
  // B4 (ADR-0008): override de IA por workspace (provider/modelo/chave). Só é aceito em
  // request autenticada por x-internal-token (server.ts). Ausente → env (modo padrão).
  aiOverride?: AiOverride;
  // D4 (ADR-0008): templates ativos da marca (curados na API). O agents os usa no lugar do
  // registry built-in; ausente/vazio → fallback ao registry (degradado honesto). Cada item é
  // validado (D5) antes de entrar no pool — inválido é descartado com log, nunca crash.
  templates?: CarouselTemplate[];
  // D3/D4: id (CarouselTemplate.id, = Template.Key na API) do template FORÇADO pela pauta.
  // Presente → o agents pula selectBestTemplate e usa exatamente esse; ausente → seleção normal.
  forcedTemplateId?: string;
  // A1 (ADR-0009): instrução de regeneração (top-level, NÃO dentro de pauta — é da requisição,
  // não da pauta persistida). O adapter a injeta verbatim no início de content.additionalNotes.
  regenerationInstruction?: string;
  // Toggle POR-GERAÇÃO ("usar identidade do logo"): estampa o logo da marca nos slides. A API só
  // envia true quando há logo cadastrado. Ausente/false → render byte-equivalente ao atual.
  useLogoIdentity?: boolean;
  // FASE 0 (auditoria — fundação de input criativo): direção criativa por-geração que o operador
  // fornece no wizard. Tudo opcional → ausente/vazio = briefing byte-equivalente ao atual. A API
  // omite o objeto quando o operador não preencheu nada. O input-adapter roteia: referenceUrl/
  // backgroundUrl → referenceContext (referência textual); cta/subtitle/backgroundUrl → direção
  // em additionalNotes (o copywriter/compositor respeitam, mantendo a identidade da marca).
  creativeInput?: {
    referenceUrl?: string;
    backgroundUrl?: string;
    cta?: string;
    subtitle?: string;
  };
}

export type JobStatus = "queued" | "running" | "done" | "error";

/**
 * FASE 1 (ADR-0014): camadas de composição de UM slide — o que o `<SlideCanvas>` (F2) e o
 * rasterizador server-side (F3) renderizam. É JSON OPACO na fronteira: a API .NET persiste/reemite
 * verbatim, sem raciocinar sobre o interior; a fonte única do shape é este arquivo + types/pipeline.ts.
 * Tudo OPCIONAL — slide manual/antigo vem sem `layers` (a UI cai no preview só-imagem). `tokens` da
 * marca NÃO viajam aqui (a UI já os tem do brand kit) — evita repetir ~1 KB por slide.
 */
export interface SlideLayers {
  background?: { type: "solid" | "gradient" | "image"; value: string; opacity?: number };
  elements?: Array<{
    type: "text" | "icon" | "image" | "shape" | "divider";
    role: string; // 'headline' | 'body' | 'stat' | 'quote' | 'bullets' | 'cta' | 'image' | ...
    content: string;
    style?: Record<string, unknown>; // ElementStyle (cor/fonte/peso/objectFit/focalPoint/overlay/...)
    position?: { x: number; y: number; width: number; height: number | "auto" };
  }>;
  canvas?: { width: number; height: number };
}

export interface GenerateResultSlide {
  index: number;
  copy: string;
  imageUrl?: string;
  // FASE 0 (ADR-0014/B2): renderHtml removido — era ~1 MB de base64 que o frontend nunca
  // consumia. A coluna .NET ContentSlide.RenderHtml será dropada na migração da Fase 1.
  // FASE 1 (ADR-0014): camadas de composição (fundo + elementos posicionados). Ausente quando o
  // pipeline não produziu spec visual (degradado) — a API persiste como LayersJson NULL.
  layers?: SlideLayers;
}

/**
 * C (ADR-0008): uso de tokens/imagens da geração, para a API estimar o custo e gravar
 * um SpendEntry. Espelha AgentsResult.Usage (.NET). Em mock/sem usage real (sem chave),
 * vem ausente ou zerado — a API estima 0 (modo mock não gasta). Os contadores de texto
 * vêm do usageMetadata do provider (Gemini: prompt/candidatesTokenCount); imageCount é o
 * nº de imagens efetivamente geradas no pipeline.
 */
export interface GenerateUsage {
  textInputTokens: number;
  textOutputTokens: number;
  imageCount: number;
  // F5 (Eixo D): provedor + modelos efetivos do job, para a API estimar o custo REAL por
  // token×modelo (não mais fixo por formato) e gravar provider/model no SpendEntry. Vêm da
  // AiConfig resolvida por job (env + override do workspace); ausentes em mock/sem chave.
  provider?: string;
  textModel?: string;
  imageModel?: string;
}

export interface GenerateResult {
  slides: GenerateResultSlide[];
  caption: string;
  cta: string;
  hashtags: string[];
  // F6/B3: nome do template que o brand-strategist escolheu (summary.template), para o reveal
  // pós-geração no wizard ("usei o template X"). Ausente em mock/degradado — a UI omite o reveal.
  templateName?: string;
  // S-14: score do quality-validator para a API/worker decidirem tratamento
  // (ex: salvar como Draft com badge de baixa qualidade). passed=false NÃO
  // significa falha de execução — o pipeline terminou, o artefato existe.
  quality?: {
    score: number;
    passed: boolean;
  };
  // AI-native (teatro c/ justificativa): o RACIOCÍNIO real dos agentes, antes descartado no
  // mapper. Expõe ao operador "por que a IA fez assim" no Resultado (proposta justificada, não
  // caixa-preta). Tudo OPCIONAL e curto — ausente em mock/degradado (a UI omite o painel).
  // Fonte: StrategyBlueprint.reasoning, StoryStructure.overallNarrative, QualityReport.checks.
  reasoning?: {
    whyTemplate?: string;       // strategy.reasoning.whyThisTemplate
    whyAngle?: string;          // strategy.reasoning.whyThisAngle
    narrativeAngle?: string;    // strategy.narrativeAngle (rótulo do ângulo)
    keyInsights?: string[];     // strategy.reasoning.keyInsights (até 3)
    narrative?: string;         // story.overallNarrative (a história em 1 frase)
    qualityChecks?: { label: string; passed: boolean; severity: string }[]; // quality.checks resumidos
    // task 1.1: decisão do Creative Director — estratégia visual predominante + racional curto.
    // Ausente em mock/degradado (a UI omite). `deferredSlides` = nº de slides cuja estratégia ideal
    // (banco/gráfico) ainda não tem provider e executou via foto generativa (fronteira honesta).
    creativeStrategy?: { primary: string; rationale: string; deferredSlides: number };
  };
  // G4 (A/B barato): as ALTERNATIVAS que o copywriter já gera (2 headlines + 2 CTAs) e que antes
  // eram descartadas no mapper. Per-content (não per-slide): valem como opções de troca para o
  // headline/CTA no editor. OPCIONAL — ausente em mock/degradado ou quando o copywriter não as
  // produziu (a UI omite a faixa "Alternativas"). Fonte: CopyOutput.alternatives (copywriter.ts).
  alternatives?: {
    headlines: string[];
    ctas: string[];
  };
  // C (ADR-0008): uso agregado da geração (tokens de texto + nº de imagens). Ausente
  // quando o pipeline não reportou uso (mock/sem chave) — a API trata como custo 0.
  usage?: GenerateUsage;
}

export interface Job {
  id: string;
  status: JobStatus;
  progress: number; // 0..100
  step?: string;
  result?: GenerateResult;
  error?: string;
  createdAt: string;
  // ADR-0011/E10.2/D4: overrides de prompt que foram REJEITADOS neste job e caíram no base.
  // Não-silencioso (o pipeline completa; isto é observabilidade, não erro). Ausente = nenhum.
  promptFallbacks?: Array<{ agentKey: PromptAgentKey; reason: string }>;
}
