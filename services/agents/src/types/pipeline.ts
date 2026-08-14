/**
 * Pipeline Types v2.0
 * Social AI Platform — portado do branding-os.
 *
 * Tipos rigorosos que garantem sinergia entre todos os agentes.
 * Cada tipo representa EXATAMENTE o que flui de um agente para outro.
 */

// ADR-0011/E10.2: as 5 chaves de agente de LLM (tipo de domínio — fonte única em agent-keys).
import type { PromptAgentKey } from '@/types/agent-keys'
// Formato de conteúdo (post/carousel/story) — fonte única em types.ts. Import só de tipo
// (sem ciclo em runtime; ciclos type-level são seguros). Usado no viés de performance das preferences.
import type { ContentFormat } from '@/types'

// ============================================
// SLIDE TYPES & LAYOUTS
// ============================================

export type SlideType =
  | 'cover'           // Slide de abertura (hook)
  | 'problem'         // Apresenta a dor
  | 'agitation'       // Amplifica a dor
  | 'solution'        // Apresenta solução
  | 'benefits'        // Lista benefícios
  | 'features'        // Detalha funcionalidades
  | 'social-proof'    // Depoimento/prova
  | 'stats'           // Estatísticas
  | 'comparison'      // Antes/depois
  | 'offer'           // Apresenta oferta
  | 'urgency'         // Cria escassez
  | 'cta'             // Call to action final
  | 'transition'      // Slide de transição

export type SlideLayout =
  | 'centered-headline'      // Headline centralizado
  | 'headline-subheadline'   // Headline + subheadline
  | 'stat-highlight'         // Número grande + contexto
  | 'bullet-points'          // Lista com bullets
  | 'icon-grid'              // Grid de ícones com texto
  | 'testimonial'            // Quote + attribution
  | 'split-image-text'       // Imagem de um lado, texto do outro
  | 'offer-box'              // Box com oferta
  | 'cta-focused'            // CTA como elemento principal
  | 'comparison-columns'     // Duas colunas comparativas

// ============================================
// EMOTIONAL ARC
// ============================================

export type EmotionalBeat =
  | 'curiosity'    // Desperta interesse
  | 'pain'         // Toca na dor
  | 'frustration'  // Amplifica frustração
  | 'hope'         // Mostra possibilidade
  | 'excitement'   // Gera entusiasmo
  | 'trust'        // Constrói confiança
  | 'urgency'      // Cria senso de urgência
  | 'relief'       // Oferece solução
  | 'empowerment'  // Empodera a decisão

// ============================================
// NARRATIVE ANGLES
// ============================================

export type NarrativeAngle =
  | 'transformation-story'   // Foca na transformação do cliente
  | 'problem-solution'       // Apresenta problema, resolve
  | 'social-proof-led'       // Lidera com provas sociais
  | 'education-first'        // Educa antes de vender
  | 'urgency-scarcity'       // Foca em escassez/urgência
  | 'value-stack'            // Empilha valor antes da oferta
  | 'comparison'             // Compara com alternativas
  | 'behind-scenes'          // Mostra bastidores

// ============================================
// TEMPLATE DEFINITION
// ============================================

export interface SlideElementConstraint {
  maxChars?: number
  minChars?: number
  style?: string  // Guideline de estilo para o copywriter
  count?: number  // Para elementos múltiplos (bullets)
}

export interface TemplateSlide {
  index: number
  type: SlideType
  purpose: string               // Descrição clara do propósito
  layout: SlideLayout
  emotionalBeat: EmotionalBeat
  requiredElements: string[]    // ['headline', 'body', etc]
  optionalElements?: string[]
  copyConstraints: Record<string, SlideElementConstraint>
  visualNotes?: string          // Notas para o Visual Compositor
}

export interface CarouselTemplate {
  id: string
  name: string
  description: string
  slideCount: number
  recommendedFor: Array<'awareness' | 'consideration' | 'conversion'>
  bestFor: string[]             // ["product launches", "course promos"]
  slides: TemplateSlide[]
}

// ============================================
// AGENT 1: BRAND STRATEGIST OUTPUT
// ============================================

export interface StrategyBlueprint {
  // Decisões estratégicas
  templateId: string
  templateName: string
  slideCount: number
  narrativeAngle: NarrativeAngle

  // Arco emocional planejado
  emotionalArc: EmotionalBeat[]

  // Constraints para os outros agentes
  constraints: {
    tone: string              // "empowering-but-not-pushy"
    visualEnergy: 'calm' | 'moderate' | 'dynamic' | 'intense'
    ctaStyle: string          // "urgency-with-value"
    avoidPatterns: string[]   // Coisas a evitar
  }

  // Reasoning (para debug/transparency)
  reasoning: {
    whyThisTemplate: string
    whyThisAngle: string
    keyInsights: string[]
  }
}

// ============================================
// AGENT 2: STORY ARCHITECT OUTPUT
// ============================================

export interface StorySlide {
  index: number
  type: SlideType
  layout: SlideLayout
  purpose: string              // O que esse slide precisa fazer
  emotionalBeat: EmotionalBeat
  contentBrief: string         // Direcionamento para o copywriter
  visualDirection: string      // Sugestão visual
  transitionTo?: string        // Como conecta com o próximo slide
}

export interface StoryStructure {
  // Metadados
  totalSlides: number
  overallNarrative: string     // Uma frase sobre a história toda

  // Slides
  slides: StorySlide[]

  // Notas para o copywriter
  copywriterNotes: {
    keyMessage: string
    toneReminders: string[]
    phrasesToUse: string[]
    phrasesToAvoid: string[]
  }
}

// ============================================
// AGENT 2.5: CREATIVE DIRECTOR OUTPUT (Pilar I · task 1.1)
// ============================================

/**
 * Estratégia visual escolhida por slide. O Creative Director decide, por pauta, COMO a imagem
 * de cada slide deve nascer — não o quê (isso é do image-generator/providers).
 * - `generative-photo`   → foto gerada por IA (lançamento/destaque). ÚNICA com provider real hoje.
 * - `stock-photo`        → banco de imagens curado (depoimento/confiança). Provider em 1.2.
 * - `graphic-composition`→ composição gráfica (comparativo/dados). Provider em 1.2/1.3.
 */
export type ImageStrategy = 'generative-photo' | 'stock-photo' | 'graphic-composition'

export interface SlideCreativeDirection {
  index: number
  strategy: ImageStrategy
  /** Por que esta estratégia (rótulo curto, auditável no output do job). */
  reason: string
  /**
   * Estratégia que o image-generator de fato EXECUTA neste slide. Hoje só `generative-photo` tem
   * provider real; `stock-photo`/`graphic-composition` são ROTEADAS mas executam via foto generativa
   * até 1.2/1.3 (fronteira honesta, não mascarada). `effective === strategy` quando o provider existe.
   */
  effectiveStrategy: ImageStrategy
  /** true quando `effectiveStrategy !== strategy` (a estratégia ideal ainda não tem provider). */
  deferred: boolean
}

export interface CreativeDirection {
  /** Estratégia predominante (a mais frequente entre os slides) — resumo para a UI/reveal. */
  primaryStrategy: ImageStrategy
  /** Racional curto da decisão global (auditável). */
  rationale: string
  /** Decisão por slide. */
  perSlide: SlideCreativeDirection[]
}

// ============================================
// AGENT 3: COPYWRITER OUTPUT
// ============================================

export interface SlideCopy {
  index: number

  // Elementos de texto
  headline?: string
  subheadline?: string
  body?: string
  bullets?: string[]
  quote?: string
  attribution?: string
  stat?: string
  statContext?: string
  cta?: string
  caption?: string

  // Metadata
  charCounts: {
    headline?: number
    body?: number
    [key: string]: number | undefined
  }
}

export interface CopyOutput {
  slides: SlideCopy[]

  // Alternativas geradas (para variations)
  alternatives?: {
    headlines: string[]
    ctas: string[]
  }

  // Microcopy adicional
  microcopy: {
    ctaButton: string
    swipeHint: string
    profileCaption: string
  }
}

// ============================================
// AGENT 4: VISUAL COMPOSITOR OUTPUT
// ============================================

export interface ElementStyle {
  fontFamily?: string
  fontSize?: string
  fontWeight?: number
  color?: string
  textAlign?: 'left' | 'center' | 'right'
  lineHeight?: number
  letterSpacing?: string
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
  // ADR-0012 PR4 — composição de imagem-no-layout. Todos OPCIONAIS; ausência = comportamento atual
  // (object-fit:cover, object-position:center center, sem zoom). O render lê estes do elemento de
  // imagem/background. Permite controlar foco/crop/escala da imagem dentro do frame do template.
  objectFit?: 'cover' | 'contain'
  objectPosition?: string // ex.: '50% 30%'
  focalPoint?: { x: number; y: number } // 0..1; atalho convertido p/ object-position '%'
  scale?: number // zoom via transform:scale(); default 1
  overlay?: { color: string; opacity: number } // camada de contraste sobre a foto (latente)
}

export interface ElementPosition {
  x: number
  y: number
  width: number
  height: number | 'auto'
}

export interface VisualElement {
  type: 'text' | 'icon' | 'image' | 'shape' | 'divider'
  role: string                  // 'headline', 'body', 'cta', etc
  content: string
  style: ElementStyle
  position: ElementPosition
}

export interface SlideBackground {
  type: 'solid' | 'gradient' | 'image'
  value: string                 // HEX, gradient CSS, or image URL
  opacity?: number
}

export interface SlideVisualSpec {
  index: number
  layoutId?: string             // ID do template (opcional)
  canvas: {
    width: number               // 1080
    height: number              // 1080
  }
  background: SlideBackground
  elements: VisualElement[]
}

export interface VisualSpecification {
  slides: SlideVisualSpec[]

  // Design tokens usados
  tokens: {
    colors: Record<string, string>
    fonts: Record<string, string>
    spacing: Record<string, number>
  }
}

// ============================================
// AGENT 5: QUALITY VALIDATOR OUTPUT
// ============================================

export interface QualityCheck {
  // task 1.4: 'visual' — eixo de qualidade da IMAGEM gerada (coerência com paleta/mood, detecção de
  // resultado pobre/fallback). Determinístico (sem LLM); roda sobre o visual PÓS-geração de imagem.
  rule: string
  category: 'color' | 'typography' | 'spacing' | 'contrast' | 'voice' | 'structure' | 'content' | 'visual'
  passed: boolean
  details: string
  severity: 'info' | 'warning' | 'error' | 'critical'
}

export interface QualityReport {
  passed: boolean
  score: number                 // 0-100

  checks: QualityCheck[]

  summary: {
    totalChecks: number
    passedChecks: number
    warnings: number
    errors: number
    criticalIssues: number
  }

  // Se não passou, o que precisa corrigir
  requiredFixes?: Array<{
    slideIndex: number
    element: string
    issue: string
    suggestion: string
  }>
}

// ============================================
// AGENT 6: RENDER ENGINE OUTPUT
// ============================================

export interface RenderedSlide {
  index: number
  html: string
  css: string
  preview?: string              // Base64 image preview
}

export interface RenderOutput {
  slides: RenderedSlide[]

  // CSS consolidado
  globalCSS: string

  // Fonts a carregar
  fontsToLoad: string[]

  // Export options
  exportReady: {
    html: boolean
    png: boolean
    pdf: boolean
  }
}

// ============================================
// PIPELINE FINAL OUTPUT
// ============================================

export interface PipelineResult {
  success: boolean
  error?: string

  // Metadados
  metadata: {
    pipelineId: string
    version: string
    generatedAt: Date
    duration: number            // ms total
    agentDurations: Record<string, number>
  }

  // Outputs de cada agente
  strategy: StrategyBlueprint
  story: StoryStructure
  copy: CopyOutput
  visual: VisualSpecification
  quality: QualityReport
  render: RenderOutput

  // Pilar I · task 1.1: decisão de estratégia visual por slide (auditável). Opcional —
  // ausente em mock/sem pipeline → contrato byte-equivalente ao atual.
  creativeDirection?: CreativeDirection

  // Resumo para UI
  summary: {
    template: string
    slideCount: number
    qualityScore: number
    mainCTA: string
  }

  // Imagens inseridas pelo usuário (por slide index)
  slideImages?: Record<number, string>

  // C (ADR-0008): uso agregado da geração (tokens de texto + nº de imagens), para a API
  // estimar o custo. Ausente quando não há uso reportado (mock/sem chave) — custo 0.
  // textInputTokens/textOutputTokens vêm do usageMetadata do provider; imageCount é o nº
  // de imagens geradas (não as que caíram no gradiente de fallback).
  usage?: {
    textInputTokens: number
    textOutputTokens: number
    imageCount: number
  }
}

// ============================================
// PIPELINE INPUT (refinado)
// ============================================

export interface PipelineInput {
  assetType: 'carousel' | 'single-post' | 'story'

  context: {
    productName: string
    productDescription: string
    targetAudience: string
    keyBenefits: string[]
    uniqueSellingPoint?: string
  }

  goal: {
    objective: 'awareness' | 'consideration' | 'conversion'
    angle: 'transformation' | 'social-proof' | 'urgency' | 'education'
    specificGoal?: string       // "Drive enrollments for Black Friday"
  }

  content: {
    mainMessage: string
    supportingPoints?: string[]
    additionalNotes?: string
    mustInclude?: string[]      // Frases obrigatórias
    mustAvoid?: string[]        // Coisas a evitar
    // E3.4 (DEC-2): materiais de referência da pauta (anexos) como referência TEXTUAL
    // (url + rótulo) — não análise de imagem. Opcional; agentes que não usam ignoram.
    referenceContext?: Array<{ url: string; label?: string }>
  }

  preferences?: {
    slideCount?: number         // Override do template
    templateId?: string         // Forçar template específico
    tone?: string               // Override de tom
    // D4 (ADR-0008): pool EFETIVO de templates p/ este job (request validado OU built-in).
    // O brand-strategist escolhe DENTRE eles; ausente → registry built-in (TEMPLATE_LIST).
    availableTemplates?: CarouselTemplate[]
    // D3: template FORÇADO já resolvido (presente em availableTemplates). Setado → o pipeline
    // pula selectBestTemplate e usa exatamente este; null/ausente → seleção normal.
    forcedTemplate?: CarouselTemplate
    // VIÉS de performance (sinal tipado do loop de aprendizado). Formato que mais engajou
    // historicamente (post/carousel/story), derivado de PerformanceMetric pela API. O brand-strategist
    // o trata como VIÉS (preferir, se o brief não pedir o contrário) — NÃO como ordem: o forcedTemplate
    // e o brief têm precedência. Ausente (amostra <3 na API) → seleção normal, sem viés.
    performanceBestFormat?: ContentFormat
    // Decisão POR-GERAÇÃO (toggle do wizard "usar identidade do logo"): estampar o logo da marca
    // nos slides. Default ausente/false → render byte-equivalente ao atual. Só tem efeito quando há
    // logo cadastrado (url válida); a API já evita enviar true sem logo.
    useLogoIdentity?: boolean
  }

  // ADR-0011/E10.2: override de system prompt POR AGENTE (agentKey → texto do prompt). Só é
  // populado pelo adapter quando PROMPT_OVERRIDES_ENABLED está ON (gate único em jobs.ts).
  // Ausente → cada agente usa o base do arquivo. Viaja DENTRO do input (por run): não persiste
  // no job store, não vaza entre runs/workspaces. O getter systemPrompt NUNCA o lê — só o
  // caminho executeWithPrompt (BaseAgent) o aplica, com fallback ao base se a saída for inválida.
  promptOverrides?: Partial<Record<PromptAgentKey, string>>

  // ADR-0011/D4: sink de fallback de prompt — chamado quando um override é rejeitado e o agente
  // cai no base. Injetado por run pelo orquestrador (bridge para PipelineV2Callbacks). Opcional:
  // ausente → o fallback ainda ocorre, só não é observado. Mantém BaseAgent desacoplado do pipeline.
  onPromptFallback?: (agentKey: PromptAgentKey, reason: string) => void

  // Brand config (do store)
  brandConfig: BrandConfigForPipeline
}

export interface BrandConfigForPipeline {
  // S-12: handle do Instagram do tenant (ex: "@minha_marca").
  // Vazio quando não fornecido — nunca usa handle de terceiro como fallback.
  handle?: string
  visualIdentity: {
    logo: { url: string | null }
    colors: {
      primary: { hex: string; name: string }
      secondary: { hex: string; name: string }
      accent: { hex: string; name: string }
      background: { hex: string; name: string }
      text: { hex: string; name: string }
    }
    typography: {
      heading: { family: string; weights: number[] }
      body: { family: string; weights: number[] }
    }
  }
  voice: {
    attributes: string[]
    toneGuidelines: string[]
    copyExamples: Array<{
      text: string
      isGood: boolean
      context: string
    }>
  }
  examples: Array<{
    type: string
    annotation: string
    whatMakesItOnBrand: string
  }>
}
