/**
 * Brand Strategist Agent v2.0
 * Social AI Platform — portado do branding-os.
 *
 * O PRIMEIRO agente do pipeline.
 * Toma decisões estratégicas de ALTO NÍVEL que guiam todos os outros agentes.
 *
 * PERGUNTA-CHAVE: "Qual é a melhor forma de contar essa história para esse público?"
 */

import type { AiConfig } from '@/config'
import type {
  CarouselTemplate,
  PipelineInput,
  StrategyBlueprint,
} from '@/types/pipeline'
import { TEMPLATES, TEMPLATE_LIST } from '@/templates'
import { BaseAgent } from '../agents/base'
import { loadBasePrompt } from '@/prompts/loader'

interface BrandStrategistInput {
  pipelineInput: PipelineInput
}

export class BrandStrategistAgent extends BaseAgent<BrandStrategistInput, StrategyBlueprint> {
  protected readonly overrideKey = 'brand-strategist' as const // ADR-0011/E10.2
  // D4 (ADR-0008): pool EFETIVO de templates do job (request curado OU built-in). Setado no
  // início de execute() a partir de input.preferences.availableTemplates; o systemPrompt e o
  // parseOutput o consultam (em vez do registry global) para escolher/validar dentre ELES.
  private effectiveTemplates: CarouselTemplate[] = TEMPLATE_LIST

  constructor(ai: AiConfig) {
    super(ai, 'analyzer') // Usando 'analyzer' por compatibilidade com o pipeline atual
  }

  /** Mapa id→template do pool efetivo (para validação em parseOutput). */
  private get effectiveById(): Record<string, CarouselTemplate> {
    return Object.fromEntries(this.effectiveTemplates.map((t) => [t.id, t]))
  }

  /**
   * D3/D4: short-circuit quando há template FORÇADO (não roda o LLM-strategist nem
   * selectBestTemplate — usa exatamente o template). Caso normal: fixa o pool efetivo e
   * delega ao LLM via BaseAgent.execute, que escolhe DENTRE o pool (systemPrompt/parseOutput).
   */
  override async execute(input: BrandStrategistInput): Promise<StrategyBlueprint> {
    const prefs = input.pipelineInput.preferences
    if (prefs?.availableTemplates && prefs.availableTemplates.length > 0) {
      this.effectiveTemplates = prefs.availableTemplates
    } else {
      this.effectiveTemplates = TEMPLATE_LIST
    }

    // POST ÚNICO: o usuário pediu um post (não carrossel), mas TODOS os templates são de carrossel
    // (5-8 slides) e tanto o template forçado quanto o parseOutput fixam slideCount = template.slideCount,
    // ignorando a preferência de 1 slide. Resultado (bug): "post" virava carrossel. Aqui truncamos o
    // blueprint a 1 slide quando assetType='single-post' — ponto ÚNICO que cobre os dois caminhos abaixo.
    const isSinglePost = input.pipelineInput.assetType === 'single-post'

    // D3: template forçado → blueprint direto, SEM LLM (determinístico, honesto).
    if (prefs?.forcedTemplate) {
      return this.maybeTruncateToSingle(this.blueprintFromTemplate(prefs.forcedTemplate), isSinglePost)
    }
    return this.maybeTruncateToSingle(await super.execute(input), isSinglePost)
  }

  /** POST ÚNICO: reduz o blueprint a 1 slide (só a capa) quando o formato é single-post. Mantém o
   *  1º beat do arco (a capa é auto-suficiente: headline + subtítulo + CTA). No-op p/ carrossel. */
  private maybeTruncateToSingle(bp: StrategyBlueprint, isSinglePost: boolean): StrategyBlueprint {
    if (!isSinglePost || bp.slideCount === 1) return bp
    return {
      ...bp,
      slideCount: 1,
      emotionalArc: bp.emotionalArc.slice(0, 1),
    }
  }

  /** D3: constrói um StrategyBlueprint mínimo e válido a partir de um template forçado, sem LLM.
   *  O arco emocional vem dos próprios slides do template (fonte fiel ao design escolhido). */
  private blueprintFromTemplate(t: CarouselTemplate): StrategyBlueprint {
    return {
      templateId: t.id,
      templateName: t.name,
      slideCount: t.slideCount,
      narrativeAngle: 'problem-solution',
      emotionalArc: t.slides.map((s) => s.emotionalBeat),
      constraints: {
        tone: 'on-brand',
        visualEnergy: 'moderate',
        ctaStyle: 'clear-value',
        avoidPatterns: [],
      },
      reasoning: {
        whyThisTemplate: `Template forçado pela pauta (D3/ADR-0008): ${t.name}.`,
        whyThisAngle: 'Ângulo neutro — o template define a estrutura; o copywriter preenche.',
        keyInsights: [],
      },
    }
  }

  /**
   * ADR-0011/E10.1: prompt-base versionado em prompts/brand-strategist.md (git é a verdade).
   * O `.md` carrega o placeholder `{{TEMPLATES}}` no lugar da interpolação dinâmica; aqui ele
   * é substituído pelo bloco renderizado do POOL EFETIVO (curável por marca via effectiveTemplates,
   * NÃO o registry cru). A substituição reproduz o whitespace EXATO do `.map(...).join('\n')`
   * original — o snapshot é o guarda anti-drift. Getter parameterless: sempre o base (o override
   * de prompt, ADR-0011/E10.2, NÃO entra por aqui — entra no execute via executeWithPrompt).
   */
  get systemPrompt(): string {
    return loadBasePrompt('brand-strategist').replace('{{TEMPLATES}}', this.renderTemplatesBlock())
  }

  /**
   * ADR-0011/E10.2: o systemPrompt deste agente é DINÂMICO (injeta o pool de templates). Um
   * override de prompt do operador é, portanto, um TEMPLATE com o placeholder `{{TEMPLATES}}` —
   * aqui ele é resolvido com o pool efetivo (mesma substituição do getter). Override SEM o
   * placeholder não conseguiria listar os templates disponíveis → estruturalmente inválido →
   * `null` dispara o fallback ao base SEM gastar uma chamada de IA.
   */
  protected override applyOverride(override: string): string | null {
    if (!override.includes('{{TEMPLATES}}')) return null
    return override.replace('{{TEMPLATES}}', this.renderTemplatesBlock())
  }

  /** Bloco "## AVAILABLE TEMPLATES" derivado do pool efetivo. Fonte única da renderização
   *  (reusada pelo getter e pelo caminho de override em E10.2). Whitespace idêntico ao original. */
  private renderTemplatesBlock(): string {
    return this.effectiveTemplates.map(t => `
### ${t.name} (ID: ${t.id})
- Description: ${t.description}
- Slides: ${t.slideCount}
- Best for: ${(t.bestFor ?? []).join(', ')}
- Recommended objectives: ${(t.recommendedFor ?? []).join(', ')}
`).join('\n')
  }

  buildUserPrompt(input: BrandStrategistInput): string {
    const { pipelineInput } = input
    const { context, goal, content, brandConfig } = pipelineInput

    // Determine some heuristics for template selection
    const hasTestimonials = brandConfig.examples.some(e =>
      e.type === 'testimonial' || e.annotation.toLowerCase().includes('depoimento')
    )
    const isNewProduct = content.mainMessage.toLowerCase().includes('novo') ||
      content.mainMessage.toLowerCase().includes('lançamento') ||
      content.mainMessage.toLowerCase().includes('launch')

    return `## BRIEF ANALYSIS

### Asset Type
${pipelineInput.assetType}

### Product/Service Context
**Name:** ${context.productName}
**Description:** ${context.productDescription}
**Target Audience:** ${context.targetAudience}
**Key Benefits:**
${context.keyBenefits.map(b => `- ${b}`).join('\n')}
${context.uniqueSellingPoint ? `**USP:** ${context.uniqueSellingPoint}` : ''}

### Campaign Goal
**Objective:** ${goal.objective}
**Angle Requested:** ${goal.angle}
${goal.specificGoal ? `**Specific Goal:** ${goal.specificGoal}` : ''}

### Content to Transform
**Main Message:**
${content.mainMessage}

${content.supportingPoints?.length ? `**Supporting Points:**
${content.supportingPoints.map(p => `- ${p}`).join('\n')}` : ''}

${content.additionalNotes ? `**Additional Notes:** ${content.additionalNotes}` : ''}

${content.mustInclude?.length ? `**Must Include:** ${content.mustInclude.join(', ')}` : ''}
${content.mustAvoid?.length ? `**Must Avoid:** ${content.mustAvoid.join(', ')}` : ''}

---

### Brand Voice (CRITICAL - match this)
**Attributes:** ${brandConfig.voice.attributes.join(', ')}

**Tone Guidelines:**
${brandConfig.voice.toneGuidelines.map(g => `- ${g}`).join('\n')}

${brandConfig.voice.copyExamples.length > 0 ? `**Copy Examples (for reference):**
${brandConfig.voice.copyExamples.slice(0, 3).map(e =>
  `- "${e.text}" (${e.isGood ? 'GOOD' : 'BAD'} - ${e.context})`
).join('\n')}` : ''}

---

### Heuristics Detected
- Has testimonials available: ${hasTestimonials}
- Appears to be new product launch: ${isNewProduct}

---

### User Preferences
${pipelineInput.preferences?.templateId ? `- Requested template: ${pipelineInput.preferences.templateId}` : '- No template preference'}
${pipelineInput.preferences?.slideCount ? `- Requested slide count: ${pipelineInput.preferences.slideCount}` : '- Use template default'}
${pipelineInput.preferences?.tone ? `- Tone override: ${pipelineInput.preferences.tone}` : '- Use brand voice'}
${pipelineInput.preferences?.performanceBestFormat ? `
### Performance Signal (learning loop — BIAS, not an order)
This brand's historically best-performing format by engagement is **${pipelineInput.preferences.performanceBestFormat}**.
When two templates fit the brief equally well, PREFER the one that better matches this format/energy.
This is a soft bias from real performance data — the brief, the requested asset type, and any forced
template ALWAYS take precedence. Do not distort the narrative just to match it.` : ''}

---

Based on this brief, provide your strategic decisions as a Brand Strategist.
Think carefully about:
1. What template BEST fits this specific brief and goal?
2. What narrative angle will RESONATE with this audience?
3. What emotional journey should the carousel take the reader through?
4. What constraints will help the other agents stay on-brand?`
  }

  parseOutput(response: string): StrategyBlueprint {
    const parsed = JSON.parse(response)

    // D4: valida contra o POOL EFETIVO (request curado OU built-in), não o registry global.
    // Se o LLM inventou um id fora do pool, cai no 1º do pool (degradado honesto, nunca crash).
    const byId = this.effectiveById
    if (!byId[parsed.templateId]) {
      const fallback = this.effectiveTemplates[0]
      console.warn(`[brand-strategist] templateId '${parsed.templateId}' fora do pool efetivo — usando '${fallback.id}' (D4).`)
      parsed.templateId = fallback.id
      parsed.templateName = fallback.name
      parsed.slideCount = fallback.slideCount
    }

    // Validate slide count matches emotional arc
    if (parsed.emotionalArc.length !== parsed.slideCount) {
      // Auto-adjust if needed
      const template = byId[parsed.templateId]
      parsed.slideCount = template.slideCount
      // Trim or extend emotional arc to match
      if (parsed.emotionalArc.length > parsed.slideCount) {
        parsed.emotionalArc = parsed.emotionalArc.slice(0, parsed.slideCount)
      } else {
        while (parsed.emotionalArc.length < parsed.slideCount) {
          parsed.emotionalArc.push('empowerment')
        }
      }
    }

    return parsed as StrategyBlueprint
  }
}
