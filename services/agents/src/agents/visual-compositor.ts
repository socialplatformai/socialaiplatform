/**
 * Visual Compositor Agent v2.0
 * Social AI Platform — portado do branding-os.
 *
 * O QUARTO agente do pipeline.
 * Define especificações visuais EXATAS para cada slide.
 *
 * PERGUNTA-CHAVE: "Onde EXATAMENTE cada elemento fica e como ele aparece?"
 */

import type { AiConfig } from '@/config'
import type {
  PipelineInput,
  StrategyBlueprint,
  StoryStructure,
  CopyOutput,
  VisualSpecification,
  SlideVisualSpec,
} from '@/types/pipeline'
import { BaseAgent } from '../agents/base'
import { loadBasePrompt } from '@/prompts/loader'
import { resolveBlueprint, positionOf } from './blueprint-map'

interface VisualCompositorInput {
  pipelineInput: PipelineInput
  strategy: StrategyBlueprint
  story: StoryStructure
  copy: CopyOutput
}

export class VisualCompositorAgent extends BaseAgent<VisualCompositorInput, VisualSpecification> {
  protected readonly overrideKey = 'visual-compositor' as const // ADR-0011/E10.2
  constructor(ai: AiConfig) {
    super(ai, 'visual-director')
  }

  /**
   * ADR-0011/E10.2: o parseOutput deste agente é TOLERANTE (preenche defaults, quase nunca
   * lança) — então não serve para detectar um override ruim. Aqui asseguramos o contrato
   * MÍNIMO que o resto do pipeline consome: ao menos um slide com elementos. Saída vazia
   * (override que não produziu spec usável) → lança → fallback ao base. Só roda no caminho-override.
   */
  protected override validateOverrideOutput(output: VisualSpecification): void {
    const slides = output?.slides
    if (!Array.isArray(slides) || slides.length === 0) {
      throw new Error('override produziu visual-spec sem slides — fallback ao base')
    }
    if (!slides.some((s) => Array.isArray(s.elements) && s.elements.length > 0)) {
      throw new Error('override produziu visual-spec sem nenhum elemento — fallback ao base')
    }
  }

  // ADR-0011/E10.1: prompt-base versionado em prompts/visual-compositor.md (git é a verdade),
  // lido por um loader cacheado. Comportamento idêntico (snapshot guarda).
  get systemPrompt(): string {
    return loadBasePrompt('visual-compositor')
  }

  /**
   * F1b (ADR-0014/A4): schema do structured output do compositor — o JSON mais complexo do pipeline
   * (slides × elementos posicionados). Subset OpenAPI aceito pelo Gemini (type/properties/items/
   * required). Mantido ENXUTO (best practice: schema grande gasta tokens de input e pode degradar) —
   * descreve o esqueleto, não cada enum de role. Só vale quando GEMINI_STRUCTURED_OUTPUT=true; senão
   * o parseOutput tolerante + parse resiliente seguem cobrindo (fallback). parseOutput não muda.
   */
  protected override get responseSchema(): object {
    return {
      type: 'object',
      properties: {
        slides: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              index: { type: 'integer' },
              layoutId: { type: 'string' },
              background: {
                type: 'object',
                properties: { type: { type: 'string' }, value: { type: 'string' } },
              },
              elements: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string' },
                    role: { type: 'string' },
                    content: { type: 'string' },
                    style: { type: 'object', properties: { color: { type: 'string' } } },
                  },
                  required: ['type', 'role', 'content'],
                },
              },
            },
            required: ['index', 'elements'],
          },
        },
      },
      required: ['slides'],
    }
  }

  buildUserPrompt(input: VisualCompositorInput): string {
    const { pipelineInput, copy } = input
    void input.story
    void input.strategy
    const { brandConfig } = pipelineInput

    const colors = brandConfig.visualIdentity.colors
    const fonts = brandConfig.visualIdentity.typography

    // Encaminha TODOS os papéis que o copywriter produziu (não só headline/subheadline/body):
    // stat, quote, bullets, cta e caption chegam ao compositor, viram elementos e o render os honra.
    const slidesContent = copy.slides.map((slide, i) => {
      const isLast = i === copy.slides.length - 1
      const isFirst = i === 0

      let type = "BODY"
      if (isFirst) type = "COVER"
      if (isLast) type = "LAST"

      const parts = [`[${type}]`]
      if (slide.headline) parts.push(`H:"${slide.headline}"`)
      if (slide.subheadline) parts.push(`SH:"${slide.subheadline}"`)
      if (slide.body) parts.push(`B:"${slide.body.slice(0, 150)}"`)
      if (slide.stat) parts.push(`STAT:"${slide.stat}"`)
      if (slide.statContext) parts.push(`STATCTX:"${slide.statContext}"`)
      if (slide.bullets?.length) parts.push(`BULLETS:"${slide.bullets.join(' | ')}"`)
      if (slide.quote) parts.push(`QUOTE:"${slide.quote}"`)
      if (slide.attribution) parts.push(`ATTRIB:"${slide.attribution}"`)
      if (slide.cta) parts.push(`CTA:"${slide.cta}"`)
      if (slide.caption) parts.push(`CAPTION:"${slide.caption}"`)
      return `S${slide.index}: ${parts.join(' | ')}`
    }).join('\n')

    // Microcopy global (CTA do botão, hint de swipe) — o render usa o CTA real no último slide.
    const ctaButton = copy.microcopy?.ctaButton ?? ''
    const swipeHint = copy.microcopy?.swipeHint ?? ''

    return `## BRAND CONFIG
Primary: ${colors.primary.hex}
Secondary: ${colors.secondary.hex}
Font Heading: ${fonts.heading.family}
Font Body: ${fonts.body.family}

## MICROCOPY
CTA Button: "${ctaButton}"
Swipe Hint: "${swipeHint}"

## SLIDES CONTENT
${slidesContent}

## INSTRUCTIONS
1. Do NOT set layoutId — the engine derives it deterministically from the planned layout
   (ADR-0015). Whatever you emit is overwritten. Focus on mapping content into elements.
4. Map EVERY piece of copy you received into an element with the matching role. The render
   honors these roles on body slides: headline, body, stat, statContext, bullets, quote,
   attribution, cta, caption, image. If a slide has a STAT, emit a "stat" element (and
   "statContext"); if it has a QUOTE, emit "quote" + "attribution"; if it has BULLETS, emit a
   "bullets" element (join items with newlines); if it has a CTA, emit a "cta" element. Do not
   drop copy — every field above must become an element.
5. On the LAST slide, emit a "cta" element using the CTA Button microcopy so the final button
   shows the real call-to-action (not a placeholder).
6. Generate a background "image" element for EVERY slide (cover, all body slides, and last) with a
   highly detailed, slide-specific prompt derived from that slide's copy/purpose — each image must
   reinforce its own slide, not repeat the cover. Use role:"background" so it sits behind the text
   layers. This guarantees all ${input.copy.slides.length} slides have a real visual background.`
  }

  parseOutput(response: string): VisualSpecification {
    const parsed = JSON.parse(response)

    // Ensure slides array exists
    if (!parsed.slides || !Array.isArray(parsed.slides)) {
      parsed.slides = []
    }

    // Fill in defaults for each slide
    parsed.slides = parsed.slides.map((slide: Partial<SlideVisualSpec>, index: number) => ({
      index: slide.index || index + 1,
      layoutId: slide.layoutId, // Persist layout choice
      canvas: slide.canvas || { width: 1080, height: 1350 }, // Portrait default
      background: slide.background || { type: 'solid', value: '#1A1A1A' },
      elements: Array.isArray(slide.elements) ? slide.elements.map((el: any) => ({
        ...el,
        id: el.id || `el-${Math.random().toString(36).substr(2, 9)}`
      })) : []
    }))

    // Ensure tokens exist with defaults
    parsed.tokens = {
      colors: {
        background: '#1A1A1A',
        text: '#FFFFFF',
        accent: '#C9B298',
        ...(parsed.tokens?.colors || {})
      },
      fonts: {
        heading: 'Inter',
        body: 'Inter',
        ...(parsed.tokens?.fonts || {})
      }
    }

    return parsed as VisualSpecification
  }

  /**
   * ADR-0015 PR1 — a ponte planejamento→render. O `layoutId` deixa de ser cravado pelo LLM e passa
   * a ser DERIVADO, de forma determinística, do `SlideLayout` que o story-architect já escolheu por
   * slide (via `resolveBlueprint`). É o que liga a riqueza do planejamento (10 layouts) ao render.
   *
   * INVARIANTE PR1 (AC2): o mapa ainda aponta TODO layout para os 3 templates atuais → o `layoutId`
   * resultante é byte-equivalente ao que o prompt cravava (capa→cover, fecho→last, miolo→body). Zero
   * pixel novo. As fatias seguintes trocam o alvo de um layout no `blueprint-map`, num só ponto.
   *
   * Sobrescreve `execute` (não `parseOutput`, que é puro string→spec e não enxerga o story) para
   * pós-processar a spec com o contexto do run. Cobre os DOIS caminhos (base e override).
   */
  override async execute(input: VisualCompositorInput): Promise<VisualSpecification> {
    const spec = await super.execute(input)
    const storySlides = input.story?.slides ?? []
    const total = spec.slides.length
    spec.slides = spec.slides.map((slide, i) => {
      // Casa o slide visual com o slide planejado pelo índice (1-based no domínio, 0-based no array).
      const planned = storySlides.find((s) => s.index === slide.index) ?? storySlides[i]
      // O "tom" (type + beat) desambigua variantes de um mesmo layout (ex.: lado A×B do comparativo).
      const layoutId = resolveBlueprint(planned?.layout, positionOf(i, total), {
        type: planned?.type,
        beat: planned?.emotionalBeat,
      })
      return { ...slide, layoutId }
    })
    return spec
  }
}
