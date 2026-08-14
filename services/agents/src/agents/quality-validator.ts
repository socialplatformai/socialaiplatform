/**
 * Quality Validator Agent v2.0
 * Social AI Platform — portado do branding-os.
 *
 * O QUINTO agente do pipeline.
 * Faz validação TÉCNICA (não narrativa) do output visual.
 *
 * PERGUNTA-CHAVE: "Esse output está 100% on-brand para o tenant?"
 * S-12: referências ao tenant original (Academia Lendária) foram removidas;
 * a marca do tenant vem de pipelineInput.brandConfig e é injetada no userPrompt.
 */

import type { AiConfig } from '@/config'
import type {
  PipelineInput,
  VisualSpecification,
  CopyOutput,
  QualityReport,
  QualityCheck,
} from '@/types/pipeline'
import { BaseAgent } from '../agents/base'
import { loadBasePrompt } from '@/prompts/loader'

interface QualityValidatorInput {
  pipelineInput: PipelineInput
  copy: CopyOutput
  visual: VisualSpecification
}

// ============================================
// HELPER FUNCTIONS FOR TECHNICAL VALIDATION
// ============================================

/**
 * Calculate relative luminance for a color
 */
function getLuminance(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0

  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map(v => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Calculate contrast ratio between two colors
 */
function getContrastRatio(hex1: string, hex2: string): number {
  const l1 = getLuminance(hex1)
  const l2 = getLuminance(hex2)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Convert hex to RGB
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null
}

/**
 * Check if a value is a multiple of 8
 */
function isMultipleOf8(value: number): boolean {
  return value % 8 === 0
}

/**
 * Normalize hex color for comparison
 */
function normalizeHex(hex: string): string {
  return hex.toUpperCase().replace('#', '')
}

// ============================================
// QUALITY VALIDATOR AGENT
// ============================================

/** Saída qualitativa do LLM (forma INLINE — não é o QualityReport final, que é combinado
 *  com os checks determinísticos no execute). Tipada aqui para reuso no caminho de override. */
interface QualitativeResponse {
  voiceChecks: QualityCheck[]
  copyQualityChecks: QualityCheck[]
  overallAssessment: {
    brandConsistency: number
    copyQuality: number
    visualHarmony: number
    recommendations: string[]
  }
}

export class QualityValidatorAgent extends BaseAgent<QualityValidatorInput, QualityReport> {
  protected readonly overrideKey = 'quality-validator' as const // ADR-0011/E10.2
  constructor(ai: AiConfig) {
    super(ai, 'quality-gate')
  }

  /**
   * ADR-0011/E10.2: a chamada de IA deste agente é INLINE (tipo anônimo, temperature 0.3) e seu
   * parseOutput é stub — então não cabe no executeWithPrompt<TOutput> genérico. Aqui replicamos o
   * mesmo padrão de override+fallback: com a flag ON e um override válido, tenta-o e valida o shape
   * mínimo (3 notas numéricas + arrays de checks); se inválido/erro, cai no base (não-silencioso).
   * Caminho base (sem override) = 1 chamada, idêntico ao comportamento anterior (completeJSON 0.3).
   */
  private async runQualitative(input: QualityValidatorInput): Promise<QualitativeResponse> {
    const userPrompt = this.buildUserPrompt(input)
    // Usa a temperature EFETIVA da config (genParams), não um literal 0.3. Motivo: Gemini 3.x
    // degrada/loopa com temperature<1.0, e o default migrou p/ 1.0 ao pinar 3.5-flash. Seguir a
    // config evita regressão de qualidade e mantém o validador alinhado ao resto do pipeline
    // (trocável por AI_TEMPERATURE; quem usar slugs 2.5/openai pode baixar via env).
    const callLLM = (systemPrompt: string) =>
      this.provider.completeJSON<QualitativeResponse>(systemPrompt, userPrompt, {
        temperature: this.genParams.temperature,
        // Propaga também o maxTokens da config (paridade com BaseAgent.executeWithPrompt). Sem isto,
        // a chamada cairia no default 8192 do provider e truncaria relatórios longos, divergindo do
        // teto efetivo que o resto do pipeline usa.
        maxTokens: this.genParams.maxTokens,
      })

    const override = this.resolveOverride(input)
    if (override === undefined) {
      return callLLM(this.systemPrompt) // caminho base byte-equivalente
    }

    const onFallback = input.pipelineInput.onPromptFallback
    const finalPrompt = this.applyOverride(override)
    if (finalPrompt !== null) {
      try {
        const out = await callLLM(finalPrompt)
        this.assertQualitativeShape(out) // contrato mínimo — parseOutput é stub, não valida
        return out
      } catch (error) {
        this.notifyFallback(onFallback, error instanceof Error ? error.message : String(error))
      }
    } else {
      this.notifyFallback(onFallback, 'override estruturalmente inválido')
    }
    return callLLM(this.systemPrompt) // fallback ao base
  }

  /** Contrato mínimo da saída qualitativa (o parseOutput stub não valida nada). Lança se o
   *  override produziu uma forma inutilizável pelo cálculo de score → dispara o fallback. */
  private assertQualitativeShape(r: QualitativeResponse): void {
    const a = r?.overallAssessment
    const numeric = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
    if (!a || !numeric(a.brandConsistency) || !numeric(a.copyQuality) || !numeric(a.visualHarmony)) {
      throw new Error('override produziu avaliação qualitativa sem notas numéricas — fallback ao base')
    }
    if (!Array.isArray(r.voiceChecks) || !Array.isArray(r.copyQualityChecks)) {
      throw new Error('override produziu avaliação qualitativa sem os arrays de checks — fallback ao base')
    }
  }

  /**
   * task 1.4 — EIXO VISUAL (determinístico, sem LLM). Roda sobre o visual PÓS-geração de imagem
   * (o que o `execute` técnico/voz NÃO faz — ele avalia a spec pré-imagem, em paralelo com o gerador).
   * Detecta "resultado visual pobre" de forma CONHECÍVEL (L8): imagem que caiu no fallback de gradiente
   * de marca (o SVG data-uri iridescente do image-generator, ou background virado 'gradient'), e slides
   * cuja estratégia era imagem mas ficaram sem imagem real. NÃO usa modelo — é inspeção estrutural.
   *
   * Contrato: entra `VisualSpecification` já com imagens (data-URL/http ou o fallback). Sai um array de
   * QualityCheck category:'visual'. Um check REPROVADO (severity 'error') sinaliza ao orquestrador que
   * a estratégia visual daquele slide falhou → gatilho de retry de estratégia (com teto). Sem imagens
   * geradas (mock/degradado, background solid/gradient legítimo do template) → todos passam (não-regressão).
   *
   * @param visual  spec COM imagens (pós image-generator).
   * @param direction (opcional) direção criativa por slide, p/ o motivo do retry citar a estratégia.
   */
  runVisualChecks(
    visual: VisualSpecification,
    direction?: import('@/types/pipeline').CreativeDirection,
  ): QualityCheck[] {
    const checks: QualityCheck[] = []
    const byIndex = new Map(
      (direction?.perSlide ?? []).map((d) => [d.index, d]),
    )

    // O image-generator, ao falhar a geração de um ELEMENTO, substitui o content por um data-URI SVG
    // de gradiente (gradientCssToSvgDataUri) — reconhecível por 'svg+xml' + 'linearGradient'. Já o
    // background caído em fallback vira type:'gradient'. Ambos = "não é imagem real da marca".
    const isGradientFallbackImage = (value: string | undefined): boolean =>
      typeof value === 'string' &&
      value.startsWith('data:image/svg+xml') &&
      value.includes('linearGradient')

    visual.slides.forEach((slide, i) => {
      if (!slide) return
      const slideNo = slide.index ?? i + 1
      const dir = byIndex.get(slideNo)
      // Só cobramos "imagem real" de slides cuja estratégia pediu FOTO (generative/stock). Composição
      // gráfica e slides sem direção de imagem não são reprovados por não terem foto (não-regressão).
      const expectsPhoto = !dir || dir.strategy === 'generative-photo' || dir.strategy === 'stock-photo'
      if (!expectsPhoto) return

      // 1. Background que deveria ser imagem mas caiu no gradiente de fallback.
      const bg = slide.background
      const bgIsFallback =
        bg?.type === 'gradient' && dir?.strategy && dir.strategy !== 'graphic-composition'
      if (bgIsFallback) {
        checks.push({
          rule: `slide-${slideNo}-visual-background-fallback`,
          category: 'visual',
          passed: false,
          details:
            `Slide ${slideNo}: a imagem de fundo caiu no gradiente de marca (fallback), ` +
            `estratégia '${dir?.strategy}' não produziu foto real.`,
          severity: 'error',
        })
      }

      // 2. Elemento de imagem cujo content ficou no gradiente-fallback (data-URI SVG).
      for (const el of slide.elements ?? []) {
        if ((el.type === 'image' || el.role === 'image' || el.role === 'background') &&
            isGradientFallbackImage(el.content)) {
          checks.push({
            rule: `slide-${slideNo}-visual-element-fallback`,
            category: 'visual',
            passed: false,
            details:
              `Slide ${slideNo}: elemento de imagem '${el.role}' caiu no gradiente de marca (fallback) — ` +
              `sem foto real.`,
            severity: 'error',
          })
        }
      }
    })

    // Nenhum problema visual → um check informativo (passa), p/ o relatório registrar que o eixo rodou.
    if (checks.length === 0) {
      checks.push({
        rule: 'visual-axis-ok',
        category: 'visual',
        passed: true,
        details: 'Eixo visual: nenhuma imagem em fallback; estratégias com foto renderizaram imagem real.',
        severity: 'info',
      })
    }
    return checks
  }

  /**
   * Run content validation checks (headlines, body text)
   */
  private runContentChecks(input: QualityValidatorInput): QualityCheck[] {
    const checks: QualityCheck[] = []
    const { copy } = input

    // CRITICAL: Validate that ALL slides have headlines
    copy.slides.forEach((slide, index) => {
      const hasHeadline = Boolean(slide.headline && slide.headline.trim().length > 0)
      checks.push({
        rule: `slide-${index + 1}-headline-present`,
        category: 'content',
        passed: hasHeadline,
        details: hasHeadline
          ? `Slide ${index + 1} has headline: "${slide.headline?.slice(0, 50)}..."`
          : `CRITICAL: Slide ${index + 1} is MISSING a headline. All slides MUST have headlines.`,
        severity: hasHeadline ? 'info' : 'critical'
      })

      // Check headline length (should be between 5 and 100 chars typically)
      if (hasHeadline) {
        const headlineLength = slide.headline!.trim().length
        const isValidLength = headlineLength >= 5 && headlineLength <= 120
        checks.push({
          rule: `slide-${index + 1}-headline-length`,
          category: 'content',
          passed: isValidLength,
          details: isValidLength
            ? `Headline length (${headlineLength} chars) is appropriate`
            : `Headline length (${headlineLength} chars) may be ${headlineLength < 5 ? 'too short' : 'too long'}`,
          severity: isValidLength ? 'info' : 'warning'
        })
      }
    })

    return checks
  }

  /**
   * Run technical validation checks (no AI needed for these)
   */
  private runTechnicalChecks(input: QualityValidatorInput): QualityCheck[] {
    const checks: QualityCheck[] = []
    const { pipelineInput, visual } = input
    const brandColors = pipelineInput.brandConfig.visualIdentity.colors
    const brandFonts = pipelineInput.brandConfig.visualIdentity.typography

    // Collect all allowed colors
    const allowedColors = new Set([
      normalizeHex(brandColors.primary.hex),
      normalizeHex(brandColors.secondary.hex),
      normalizeHex(brandColors.accent.hex),
      brandColors.background ? normalizeHex(brandColors.background.hex) : 'FFFFFF',
      brandColors.text ? normalizeHex(brandColors.text.hex) : '1A1A1A',
      // Common neutrals that are always allowed
      '000000', 'FFFFFF', '1A1A1A', 'F7F7F7', 'FAFAFA'
    ])

    // Collect allowed fonts
    const allowedFonts = new Set([
      brandFonts.heading.family.toLowerCase(),
      brandFonts.body.family.toLowerCase()
    ])

    // Check each slide
    visual.slides.forEach((slide, slideIndex) => {
      if (!slide) return

      // Check 1: Background color is allowed
      if (slide.background && slide.background.type === 'solid') {
        const bgColor = normalizeHex(slide.background.value)
        const isAllowed = allowedColors.has(bgColor)
        checks.push({
          rule: `slide-${slideIndex + 1}-background-color`,
          category: 'color',
          passed: isAllowed,
          details: isAllowed
            ? `Background color ${slide.background.value} is in brand palette`
            : `Background color ${slide.background.value} is NOT in brand palette`,
          severity: isAllowed ? 'info' : 'error'
        })
      }

      // Check each element
      if (slide.elements && Array.isArray(slide.elements)) {
        slide.elements.forEach((element, elementIndex) => {
          if (!element) return

          // Check 2: Text colors are allowed
          if (element.type === 'text' && element.style && element.style.color) {
            const textColor = normalizeHex(element.style.color)
            const isAllowed = allowedColors.has(textColor)
            checks.push({
              rule: `slide-${slideIndex + 1}-element-${elementIndex + 1}-color`,
              category: 'color',
              passed: isAllowed,
              details: isAllowed
                ? `${element.role} color ${element.style.color} is in brand palette`
                : `${element.role} color ${element.style.color} is NOT in brand palette`,
              severity: isAllowed ? 'info' : 'error'
            })
          }

          // Check 3: Fonts are allowed
          if (element.type === 'text' && element.style && element.style.fontFamily) {
            const font = element.style.fontFamily.toLowerCase()
            const isAllowed = allowedFonts.has(font)
            checks.push({
              rule: `slide-${slideIndex + 1}-element-${elementIndex + 1}-font`,
              category: 'typography',
              passed: isAllowed,
              details: isAllowed
                ? `Font ${element.style.fontFamily} is in brand typography`
                : `Font ${element.style.fontFamily} is NOT in brand typography`,
              severity: isAllowed ? 'info' : 'error'
            })
          }

          // Check 4: Contrast ratio (text on background)
          if (element.type === 'text' && element.style && element.style.color && slide.background && slide.background.type === 'solid') {
            const contrast = getContrastRatio(element.style.color, slide.background.value)
            const passes = contrast >= 4.5 // WCAG AA
            checks.push({
              rule: `slide-${slideIndex + 1}-element-${elementIndex + 1}-contrast`,
              category: 'contrast',
              passed: passes,
              details: passes
                ? `${element.role} contrast ratio ${contrast.toFixed(2)}:1 meets WCAG AA (≥4.5:1)`
                : `${element.role} contrast ratio ${contrast.toFixed(2)}:1 FAILS WCAG AA (needs ≥4.5:1)`,
              severity: passes ? 'info' : 'warning'
            })
          }

          // Check 5: Spacing is 8px grid
          if (element.position) {
            const spacingChecks = [
              { name: 'x', value: element.position.x },
              { name: 'y', value: element.position.y },
              { name: 'width', value: element.position.width },
            ]

            spacingChecks.forEach(({ name, value }) => {
              if (typeof value === 'number') {
                const isGrid = isMultipleOf8(value)
                // Only flag as warning, not error (8px grid is a guideline)
                if (!isGrid) {
                  checks.push({
                    rule: `slide-${slideIndex + 1}-element-${elementIndex + 1}-spacing-${name}`,
                    category: 'spacing',
                    passed: true, // Don't fail, just warn
                    details: `${element.role} ${name}=${value}px is not a multiple of 8px (guideline)`,
                    severity: 'warning'
                  })
                }
              }
            })
          }
        })
      }
    })

    return checks
  }

  // ADR-0011/E10.1: prompt-base versionado em prompts/quality-validator.md (git é a verdade),
  // lido por um loader cacheado. Comportamento idêntico (snapshot guarda).
  get systemPrompt(): string {
    return loadBasePrompt('quality-validator')
  }

  buildUserPrompt(input: QualityValidatorInput): string {
    const { pipelineInput, copy, visual } = input
    const { brandConfig } = pipelineInput

    // S-12: a marca/produto do tenant vem de pipelineInput, não de string hardcoded.
    const brandName = pipelineInput.context.productName || 'a marca do tenant'

    return `## BRAND VOICE TO VALIDATE AGAINST

**Brand/Product:** ${brandName}

**Attributes:** ${brandConfig.voice.attributes.join(', ')}

**Tone Guidelines:**
${brandConfig.voice.toneGuidelines.map(g => `- ${g}`).join('\n')}

${brandConfig.voice.copyExamples.filter(e => !e.isGood).length > 0 ? `
**Examples of what to AVOID:**
${brandConfig.voice.copyExamples.filter(e => !e.isGood).map(e =>
      `- "${e.text}" (${e.context})`
    ).join('\n')}
` : ''}

---

## COPY TO VALIDATE

${copy.slides.map(slide => `
### Slide ${slide.index}
${slide.headline ? `**Headline:** "${slide.headline}"` : ''}
${slide.subheadline ? `**Subheadline:** "${slide.subheadline}"` : ''}
${slide.body ? `**Body:** "${slide.body}"` : ''}
${slide.stat ? `**Stat:** "${slide.stat}" - ${slide.statContext}` : ''}
${slide.bullets ? `**Bullets:** ${slide.bullets.map(b => `"${b}"`).join(', ')}` : ''}
${slide.quote ? `**Quote:** "${slide.quote}" - ${slide.attribution}` : ''}
${slide.cta ? `**CTA:** "${slide.cta}"` : ''}
${slide.caption ? `**Caption:** "${slide.caption}"` : ''}
`).join('\n---\n')}

**Microcopy:**
- CTA Button: "${copy.microcopy?.ctaButton || 'Saiba Mais'}"
- Swipe Hint: "${copy.microcopy?.swipeHint || 'Arrasta →'}"

---

## VISUAL SPECIFICATION SUMMARY

${visual.slides.map((slide, i) => `
### Slide ${i + 1}
- Background: ${slide.background?.type || 'unknown'} - ${slide.background?.value || 'unknown'}
- Elements: ${slide.elements?.length || 0} (${slide.elements?.map(e => e.role).join(', ') || 'none'})
`).join('\n')}

---

Now validate:
1. Voice/Tone alignment with brand attributes
2. Copy quality (clarity, punch, CTA effectiveness)
3. Overall brand consistency

Provide specific, actionable feedback.`
  }

  async execute(input: QualityValidatorInput): Promise<QualityReport> {
    // Run content validation first (critical - headlines)
    const contentChecks = this.runContentChecks(input)

    // Check for critical content issues BEFORE proceeding
    const criticalContentIssues = contentChecks.filter(c => c.severity === 'critical' && !c.passed)
    if (criticalContentIssues.length > 0) {
      // Return early with failed report if critical content is missing
      return {
        passed: false,
        score: 0,
        checks: contentChecks,
        summary: {
          totalChecks: contentChecks.length,
          passedChecks: contentChecks.filter(c => c.passed).length,
          warnings: contentChecks.filter(c => c.severity === 'warning').length,
          errors: contentChecks.filter(c => c.severity === 'error').length,
          criticalIssues: criticalContentIssues.length
        },
        requiredFixes: criticalContentIssues.map(c => ({
          slideIndex: parseInt(c.rule.match(/slide-(\d+)/)?.[1] || '0'),
          element: c.rule,
          issue: c.details,
          suggestion: 'Regenerate copy - all slides MUST have headlines'
        }))
      }
    }

    // Run technical checks (no AI needed)
    const technicalChecks = this.runTechnicalChecks(input)

    // Run AI-based qualitative checks (com override+fallback de prompt — ADR-0011/E10.2).
    const aiResponse = await this.runQualitative(input)

    // Combine all checks
    const allChecks = [
      ...contentChecks,
      ...technicalChecks,
      ...aiResponse.voiceChecks.map(c => ({ ...c, category: 'voice' as const })),
      ...aiResponse.copyQualityChecks.map(c => ({ ...c, category: 'voice' as const }))
    ]

    // Calculate summary
    const passedChecks = allChecks.filter(c => c.passed).length
    const warnings = allChecks.filter(c => c.severity === 'warning').length
    const errors = allChecks.filter(c => c.severity === 'error').length
    const criticalIssues = allChecks.filter(c => c.severity === 'critical').length

    // Calculate overall score
    const technicalScore = technicalChecks.length > 0
      ? (technicalChecks.filter(c => c.passed).length / technicalChecks.length) * 100
      : 100

    const qualitativeScore = (
      aiResponse.overallAssessment.brandConsistency +
      aiResponse.overallAssessment.copyQuality +
      aiResponse.overallAssessment.visualHarmony
    ) / 3

    const overallScore = Math.round((technicalScore * 0.4) + (qualitativeScore * 0.6))

    // Determine if passed (no critical issues, no errors, score >= 70)
    const passed = criticalIssues === 0 && errors === 0 && overallScore >= 70

    return {
      passed,
      score: overallScore,
      checks: allChecks,
      summary: {
        totalChecks: allChecks.length,
        passedChecks,
        warnings,
        errors,
        criticalIssues
      },
      requiredFixes: errors > 0 || criticalIssues > 0
        ? allChecks
          .filter(c => c.severity === 'error' || c.severity === 'critical')
          .map(c => ({
            slideIndex: parseInt(c.rule.match(/slide-(\d+)/)?.[1] || '0'),
            element: c.rule,
            issue: c.details,
            suggestion: 'Review and fix the identified issue'
          }))
        : undefined
    }
  }

  parseOutput(response: string): QualityReport {
    // This is handled in execute() since we combine technical + AI checks
    return JSON.parse(response)
  }
}
