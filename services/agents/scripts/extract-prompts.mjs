/**
 * Extração determinística dos 5 system prompts embutidos → prompts/<key>.md (ADR-0011/E10.1.a).
 *
 * NÃO é um passo de build nem de runtime — é uma ferramenta de MIGRAÇÃO, rodada UMA vez
 * para gerar os `.md` byte-a-byte iguais aos literais atuais dos getters. Determinístico
 * (L8): instancia cada agente com uma AiConfig mínima, lê `systemPrompt` ANTES de trocar os
 * getters, e grava o arquivo. Para o brand-strategist, o getter interpola
 * `this.effectiveTemplates` — então gravamos o texto com o bloco de templates substituído
 * de volta pelo placeholder `{{TEMPLATES}}` (a mesma substituição que o agente fará ao ler).
 *
 * Depois desta extração, os getters passam a ler do loader; o snapshot de teste é o guarda
 * anti-drift. Este script fica versionado como documentação reproduzível da migração.
 *
 * Uso: node --import tsx scripts/extract-prompts.mjs   (a partir de services/agents)
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { BrandStrategistAgent } from '../src/agents/brand-strategist.ts'
import { StoryArchitectAgent } from '../src/agents/story-architect.ts'
import { CopywriterAgentV2 } from '../src/agents/copywriter.ts'
import { VisualCompositorAgent } from '../src/agents/visual-compositor.ts'
import { QualityValidatorAgent } from '../src/agents/quality-validator.ts'
import { TEMPLATE_LIST } from '../src/templates/index.ts'

/** AiConfig mínima — só o que o ctor do BaseAgent precisa; sem rede (não chamamos execute). */
const ai = {
  textProvider: 'gemini',
  imageProvider: 'gemini',
  apiKey: 'extract-only-not-used',
  imageApiKey: '',
  model: { text: 'models/x', image: 'models/y' },
  temperature: 0.7,
  maxTokens: 16384,
}

/** Reproduz EXATAMENTE o bloco que o brand-strategist injeta a partir de effectiveTemplates,
 *  para trocá-lo de volta pelo placeholder. Mantém o whitespace do `.map(...).join('\n')`. */
function renderTemplatesBlock(templates) {
  return templates
    .map(
      (t) => `
### ${t.name} (ID: ${t.id})
- Description: ${t.description}
- Slides: ${t.slideCount}
- Best for: ${(t.bestFor ?? []).join(', ')}
- Recommended objectives: ${(t.recommendedFor ?? []).join(', ')}
`,
    )
    .join('\n')
}

function out(key) {
  return fileURLToPath(new URL(`../src/prompts/${key}.md`, import.meta.url))
}

// Brand-strategist: o getter interpola TEMPLATE_LIST (default de effectiveTemplates). Lemos o
// prompt resolvido e substituímos o bloco renderizado de volta pelo placeholder {{TEMPLATES}}.
const bs = new BrandStrategistAgent(ai)
const bsResolved = bs.systemPrompt
const templatesBlock = renderTemplatesBlock(TEMPLATE_LIST)
if (!bsResolved.includes(templatesBlock)) {
  throw new Error('[extract] bloco de templates do brand-strategist não casou — abortando para não gerar .md errado.')
}
const bsTemplated = bsResolved.replace(templatesBlock, '{{TEMPLATES}}')
writeFileSync(out('brand-strategist'), bsTemplated, 'utf8')

// Demais agentes: getter estático, grava verbatim.
writeFileSync(out('story-architect'), new StoryArchitectAgent(ai).systemPrompt, 'utf8')
writeFileSync(out('copywriter'), new CopywriterAgentV2(ai).systemPrompt, 'utf8')
writeFileSync(out('visual-compositor'), new VisualCompositorAgent(ai).systemPrompt, 'utf8')
writeFileSync(out('quality-validator'), new QualityValidatorAgent(ai).systemPrompt, 'utf8')

console.log('[extract] 5 prompts gravados em src/prompts/*.md (brand-strategist com {{TEMPLATES}}).')
