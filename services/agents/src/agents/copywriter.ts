/**
 * Copywriter Agent v2.0
 * Social AI Platform — portado do branding-os.
 *
 * O TERCEIRO agente do pipeline.
 * Escreve o copy ESPECÍFICO para cada slide seguindo a estrutura definida.
 *
 * PERGUNTA-CHAVE: "Quais são as palavras EXATAS que vão em cada slide?"
 */

import type { AiConfig } from '@/config'
import type {
  PipelineInput,
  StrategyBlueprint,
  StoryStructure,
  CopyOutput,
  SlideCopy,
} from '@/types/pipeline'
import { getTemplateById } from '@/templates'
import { BaseAgent } from '../agents/base'
import { loadBasePrompt } from '@/prompts/loader'

interface CopywriterInput {
  pipelineInput: PipelineInput
  strategy: StrategyBlueprint
  story: StoryStructure
}

export class CopywriterAgentV2 extends BaseAgent<CopywriterInput, CopyOutput> {
  protected readonly overrideKey = 'copywriter' as const // ADR-0011/E10.2
  constructor(ai: AiConfig) {
    super(ai, 'copywriter')
  }

  // ADR-0011/E10.1: prompt-base versionado em prompts/copywriter.md (git é a verdade),
  // lido por um loader cacheado. Comportamento idêntico (snapshot guarda).
  get systemPrompt(): string {
    return loadBasePrompt('copywriter')
  }

  buildUserPrompt(input: CopywriterInput): string {
    const { pipelineInput, strategy, story } = input
    const { context, content, brandConfig } = pipelineInput

    const template = getTemplateById(strategy.templateId)
    if (!template) {
      throw new Error(`Template not found: ${strategy.templateId}`)
    }

    return `## STORY STRUCTURE TO FOLLOW

**Overall Narrative:** ${story.overallNarrative}
**Total Slides:** ${story.totalSlides}

---

## SLIDE-BY-SLIDE BRIEFS

${story.slides.map((slide, i) => {
  const templateSlide = template.slides[i]
  const constraints = templateSlide?.copyConstraints || {}

  return `
### SLIDE ${slide.index}: ${slide.type.toUpperCase()}

**Purpose:** ${slide.purpose}
**Emotional Beat:** ${slide.emotionalBeat}
**Layout:** ${slide.layout}

**Content Brief:**
${slide.contentBrief}

**Required Elements:** ${templateSlide?.requiredElements.join(', ') || 'headline'}
**Optional Elements:** ${templateSlide?.optionalElements?.join(', ') || 'none'}

**Character Constraints:**
${Object.entries(constraints).map(([key, c]) => {
  if (typeof c === 'object' && c !== null) {
    return `- ${key}: max ${c.maxChars || 'N/A'} chars ${c.style ? `(style: ${c.style})` : ''}`
  }
  return ''
}).filter(Boolean).join('\n')}

**Visual Direction (for context):** ${slide.visualDirection}
${slide.transitionTo ? `**Transitions to:** ${slide.transitionTo}` : ''}
`
}).join('\n---\n')}

---

## COPYWRITER NOTES FROM STORY ARCHITECT

**Key Message:** ${story.copywriterNotes.keyMessage}

**Tone Reminders:**
${story.copywriterNotes.toneReminders.map(t => `- ${t}`).join('\n')}

**Phrases to USE:**
${story.copywriterNotes.phrasesToUse.map(p => `- "${p}"`).join('\n')}

**Phrases to AVOID:**
${story.copywriterNotes.phrasesToAvoid.map(p => `- "${p}"`).join('\n')}

---

## BRAND VOICE (MATCH THIS EXACTLY)

**Attributes:** ${brandConfig.voice.attributes.join(', ')}

**Tone Guidelines:**
${brandConfig.voice.toneGuidelines.map(g => `- ${g}`).join('\n')}

${brandConfig.voice.copyExamples.length > 0 ? `
**Good Copy Examples (learn from these):**
${brandConfig.voice.copyExamples.filter(e => e.isGood).slice(0, 3).map(e =>
  `- "${e.text}" (${e.context})`
).join('\n')}

**Bad Copy Examples (avoid this style):**
${brandConfig.voice.copyExamples.filter(e => !e.isGood).slice(0, 2).map(e =>
  `- "${e.text}" (${e.context})`
).join('\n')}
` : ''}

---

## PRODUCT CONTEXT

**Product:** ${context.productName}
**Description:** ${context.productDescription}
**Target Audience:** ${context.targetAudience}
**Key Benefits:**
${context.keyBenefits.map(b => `- ${b}`).join('\n')}

**Original Content to Transform:**
${content.mainMessage}

${content.mustInclude?.length ? `**MUST include these phrases:** ${content.mustInclude.join(', ')}` : ''}
${content.mustAvoid?.length ? `**MUST avoid these phrases:** ${content.mustAvoid.join(', ')}` : ''}

---

## STRATEGIC CONSTRAINTS

**Tone:** ${strategy.constraints.tone}
**CTA Style:** ${strategy.constraints.ctaStyle}
**Avoid Patterns:** ${strategy.constraints.avoidPatterns.join(', ')}

---

Now write the copy for each slide.

REMEMBER:
1. COUNT characters for each element
2. RESPECT the max limits from constraints
3. MATCH the brand voice attributes
4. Follow the content brief for each slide
5. Write in PT-BR
6. Be SPECIFIC to this product, not generic

For alternatives, provide 2 headline options and 2 CTA options.`
  }

  parseOutput(response: string): CopyOutput {
    const parsed = JSON.parse(response)

    // Validate structure
    if (!parsed.slides || !Array.isArray(parsed.slides)) {
      throw new Error('Missing slides array in copy output')
    }

    // CRITICAL: Validate that ALL slides have headlines
    const slidesWithoutHeadline = parsed.slides.filter(
      (slide: SlideCopy) => !slide.headline || slide.headline.trim() === ''
    )

    if (slidesWithoutHeadline.length > 0) {
      const missingIndexes = slidesWithoutHeadline.map((s: SlideCopy) => s.index).join(', ')
      throw new Error(`VALIDATION ERROR: Slides without headline detected: [${missingIndexes}]. All slides MUST have a headline.`)
    }

    // Ensure charCounts exist
    parsed.slides = parsed.slides.map((slide: SlideCopy) => ({
      ...slide,
      charCounts: slide.charCounts || {}
    }))

    // Ensure microcopy exists
    if (!parsed.microcopy) {
      parsed.microcopy = {
        ctaButton: 'Começar Agora',
        swipeHint: 'Arrasta →',
        profileCaption: 'Salva esse post 🔖'
      }
    }

    return parsed as CopyOutput
  }
}
