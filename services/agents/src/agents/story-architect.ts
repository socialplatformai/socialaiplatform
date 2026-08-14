/**
 * Story Architect Agent v2.0
 * Social AI Platform — portado do branding-os.
 *
 * O SEGUNDO agente do pipeline.
 * Constrói a estrutura narrativa slide-by-slide baseado na estratégia.
 *
 * PERGUNTA-CHAVE: "Qual é o propósito de cada slide e como eles se conectam?"
 */

import type { AiConfig } from '@/config'
import type {
  PipelineInput,
  StrategyBlueprint,
  StoryStructure,
} from '@/types/pipeline'
import { getTemplateById } from '@/templates'
import { BaseAgent } from '../agents/base'
import { loadBasePrompt } from '@/prompts/loader'

interface StoryArchitectInput {
  pipelineInput: PipelineInput
  strategy: StrategyBlueprint
}

export class StoryArchitectAgent extends BaseAgent<StoryArchitectInput, StoryStructure> {
  protected readonly overrideKey = 'story-architect' as const // ADR-0011/E10.2
  constructor(ai: AiConfig) {
    super(ai, 'strategist') // Compatibilidade com pipeline atual
  }

  // ADR-0011/E10.1: prompt-base versionado em prompts/story-architect.md (git é a verdade),
  // lido por um loader cacheado. Comportamento idêntico (snapshot guarda).
  get systemPrompt(): string {
    return loadBasePrompt('story-architect')
  }

  /**
   * POST ÚNICO (defesa em profundidade): o buildUserPrompt já recorta o prompt a slideCount
   * (o LLM só vê os slides pedidos), mas o modelo pode devolver MAIS slides do que o briefing —
   * o caminho feliz nem roda parseOutput (o provider parseia direto). Aqui truncamos a saída ao
   * slideCount efetivo do strategist: garante 1 slide no single-post mesmo se o LLM desobedecer.
   * No-op para carrossel (slice ao próprio tamanho). Determinístico, sem custo de IA.
   */
  override async execute(input: StoryArchitectInput): Promise<StoryStructure> {
    const out = await super.execute(input)
    const want = input.strategy.slideCount
    if (Array.isArray(out.slides) && out.slides.length > want) {
      // Sincroniza totalSlides com o array truncado — downstream (compositor/render) lê os dois.
      return { ...out, slides: out.slides.slice(0, want), totalSlides: want }
    }
    return out
  }

  buildUserPrompt(input: StoryArchitectInput): string {
    const { pipelineInput, strategy } = input
    const { context, content, brandConfig } = pipelineInput

    const template = getTemplateById(strategy.templateId)
    if (!template) {
      throw new Error(`Template not found: ${strategy.templateId}`)
    }

    // POST ÚNICO (bug crítico): o brand-strategist trunca o blueprint a slideCount=1 para
    // single-post, MAS aqui montávamos o prompt sobre `template.slides` CRU (5-8 slides do
    // template original). O LLM via "Slide Count: 1" e, ao mesmo tempo, 6 blocos de estrutura
    // detalhados — obedecia à estrutura concreta e devolvia 6 slides. A truncagem do strategist
    // nunca chegava ao prompt que importa. Recortamos os slides do template ao slideCount efetivo:
    // single-post → só a capa (slide auto-suficiente); carrossel → todos (slice é no-op).
    const blueprintSlides = template.slides.slice(0, strategy.slideCount)

    return `## STRATEGIC DECISIONS (from Brand Strategist)

**Template:** ${strategy.templateName} (${strategy.templateId})
**Slide Count:** ${strategy.slideCount}
**Narrative Angle:** ${strategy.narrativeAngle}
**Emotional Arc:** ${strategy.emotionalArc.join(' → ')}

**Constraints from Strategist:**
- Tone: ${strategy.constraints.tone}
- Visual Energy: ${strategy.constraints.visualEnergy}
- CTA Style: ${strategy.constraints.ctaStyle}
- Avoid: ${strategy.constraints.avoidPatterns.join(', ')}

**Strategist's Reasoning:**
- Why this template: ${strategy.reasoning.whyThisTemplate}
- Why this angle: ${strategy.reasoning.whyThisAngle}
- Key insights: ${strategy.reasoning.keyInsights.join('; ')}

---

## TEMPLATE STRUCTURE (your blueprint)

${blueprintSlides.map((slide, i) => `
### Slide ${slide.index}: ${slide.type.toUpperCase()}
- **Purpose:** ${slide.purpose}
- **Layout:** ${slide.layout}
- **Required elements:** ${slide.requiredElements.join(', ')}
- **Emotional beat:** ${strategy.emotionalArc[i] || slide.emotionalBeat}
- **Copy constraints:**
${Object.entries(slide.copyConstraints).map(([key, c]) =>
  `  - ${key}: max ${c.maxChars || 'N/A'} chars, style: ${c.style || 'N/A'}`
).join('\n')}
${slide.visualNotes ? `- **Visual notes:** ${slide.visualNotes}` : ''}
`).join('\n')}

---

## CONTENT TO TRANSFORM

**Product:** ${context.productName}
**Description:** ${context.productDescription}
**Target Audience:** ${context.targetAudience}
**Key Benefits:** ${context.keyBenefits.join(', ')}

**Main Message:**
${content.mainMessage}

${content.supportingPoints?.length ? `**Supporting Points:**
${content.supportingPoints.map(p => `- ${p}`).join('\n')}` : ''}

${content.mustInclude?.length ? `**MUST include:** ${content.mustInclude.join(', ')}` : ''}
${content.mustAvoid?.length ? `**MUST avoid:** ${content.mustAvoid.join(', ')}` : ''}

---

## BRAND VOICE

**Attributes:** ${brandConfig.voice.attributes.join(', ')}

**Tone Guidelines:**
${brandConfig.voice.toneGuidelines.map(g => `- ${g}`).join('\n')}

---

Now, build the story structure.

For EACH slide, define:
1. The specific PURPOSE for this carousel
2. A detailed CONTENT BRIEF for the copywriter
3. VISUAL DIRECTION suggestions
4. How it TRANSITIONS to the next slide

Think about the FLOW of the narrative. The reader should be PULLED through each slide.

Remember:
- Match the emotional arc: ${strategy.emotionalArc.join(' → ')}
- Use the template's slide types and layouts
- Be SPECIFIC in content briefs - reference the actual product/benefits`
  }

  parseOutput(response: string): StoryStructure {
    const parsed = JSON.parse(response)

    // Validate structure
    if (!parsed.slides || !Array.isArray(parsed.slides)) {
      throw new Error('Missing slides array in story structure')
    }

    if (!parsed.copywriterNotes) {
      throw new Error('Missing copywriterNotes in story structure')
    }

    return parsed as StoryStructure
  }
}
