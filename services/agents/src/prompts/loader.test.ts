import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadBasePrompt, __resetPromptCacheForTests, type PromptAgentKey } from './loader.js'
import { BrandStrategistAgent } from '../agents/brand-strategist.js'
import { StoryArchitectAgent } from '../agents/story-architect.js'
import { CopywriterAgentV2 } from '../agents/copywriter.js'
import { VisualCompositorAgent } from '../agents/visual-compositor.js'
import { QualityValidatorAgent } from '../agents/quality-validator.js'
import { TEMPLATE_LIST } from '../templates/index.js'
import type { AiConfig } from '../config.js'

// ADR-0011 / E10.1 — prompts versionados em prompts/*.md, lidos por um loader cacheado.
// Estes testes provam: (a) extração com comportamento IDÊNTICO (snapshot), (b) editar o
// arquivo muda o systemPrompt resolvido (com reset de cache), e o caso especial do
// brand-strategist ({{TEMPLATES}} substituído pelo pool efetivo, sem sobrar placeholder).

function makeAi(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    textProvider: 'gemini',
    imageProvider: 'gemini',
    apiKey: 'test-key-not-used',
    imageApiKey: '',
    model: { text: 'models/x', image: 'models/y' },
    temperature: 0.7,
    maxTokens: 16384,
    promptOverridesEnabled: false,
    ...overrides,
  }
}

beforeEach(() => __resetPromptCacheForTests())

describe('loadBasePrompt — leitura cacheada e diagnóstico (E10.1.a/b)', () => {
  it('resolve os 5 agentKeys com conteúdo não-vazio', () => {
    const keys: PromptAgentKey[] = [
      'brand-strategist', 'story-architect', 'copywriter', 'visual-compositor', 'quality-validator',
    ]
    for (const k of keys) {
      const p = loadBasePrompt(k)
      expect(p.length).toBeGreaterThan(100)
    }
  })

  it('é cacheado: a 2ª leitura volta do cache (mesma referência de string)', () => {
    const a = loadBasePrompt('copywriter')
    const b = loadBasePrompt('copywriter')
    expect(a).toBe(b)
  })
})

describe('getters lêem do arquivo e o comportamento é IDÊNTICO (E10.1.a — snapshot)', () => {
  // O snapshot é o guarda anti-drift: se um .md divergir do prompt esperado, ele quebra.
  it('story-architect: systemPrompt == prompts/story-architect.md (byte-a-byte)', () => {
    const agent = new StoryArchitectAgent(makeAi())
    expect(agent.systemPrompt).toBe(loadBasePrompt('story-architect'))
    expect(agent.systemPrompt).toMatchSnapshot()
  })

  it('copywriter: systemPrompt == prompts/copywriter.md (byte-a-byte)', () => {
    const agent = new CopywriterAgentV2(makeAi())
    expect(agent.systemPrompt).toBe(loadBasePrompt('copywriter'))
    expect(agent.systemPrompt).toMatchSnapshot()
  })

  it('visual-compositor: systemPrompt == prompts/visual-compositor.md (byte-a-byte)', () => {
    const agent = new VisualCompositorAgent(makeAi())
    expect(agent.systemPrompt).toBe(loadBasePrompt('visual-compositor'))
    expect(agent.systemPrompt).toMatchSnapshot()
  })

  it('quality-validator: systemPrompt == prompts/quality-validator.md (byte-a-byte)', () => {
    const agent = new QualityValidatorAgent(makeAi())
    expect(agent.systemPrompt).toBe(loadBasePrompt('quality-validator'))
    expect(agent.systemPrompt).toMatchSnapshot()
  })
})

describe('brand-strategist: {{TEMPLATES}} substituído pelo pool efetivo (E10.1.a — whitespace exato)', () => {
  it('não sobra placeholder e o bloco renderizado é idêntico ao .map(...).join() original', () => {
    const agent = new BrandStrategistAgent(makeAi())
    const resolved = agent.systemPrompt

    // O placeholder some por completo (whitespace exato — drift morreria aqui).
    expect(resolved).not.toContain('{{TEMPLATES}}')

    // O bloco injetado é EXATAMENTE o do interpolador original (effectiveTemplates default).
    const expectedBlock = TEMPLATE_LIST.map(t => `
### ${t.name} (ID: ${t.id})
- Description: ${t.description}
- Slides: ${t.slideCount}
- Best for: ${(t.bestFor ?? []).join(', ')}
- Recommended objectives: ${(t.recommendedFor ?? []).join(', ')}
`).join('\n')
    expect(resolved).toContain(expectedBlock)

    // Prova adicional: reconstruir o base com o placeholder de volta == arquivo cru.
    const raw = loadBasePrompt('brand-strategist')
    expect(resolved).toBe(raw.replace('{{TEMPLATES}}', expectedBlock))

    // Cada template do pool aparece (sanidade semântica).
    for (const t of TEMPLATE_LIST) {
      expect(resolved).toContain(`(ID: ${t.id})`)
    }

    expect(resolved).toMatchSnapshot()
  })
})

describe('editar o .md muda o systemPrompt resolvido com reset de cache (E10.1.b)', () => {
  const key: PromptAgentKey = 'copywriter'
  const path = fileURLToPath(new URL('./copywriter.md', import.meta.url))
  const original = readFileSync(path, 'utf8')

  afterAll(() => {
    // Restaura o arquivo original — o teste não pode deixar resíduo no asset versionado.
    writeFileSync(path, original, 'utf8')
    __resetPromptCacheForTests()
  })

  it('marcador injetado no arquivo aparece no systemPrompt após reset', () => {
    const marker = '\n\n## MARCADOR-DE-TESTE-E10-1-B'
    writeFileSync(path, original + marker, 'utf8')
    __resetPromptCacheForTests() // sem reset, o cache "gruda" o conteúdo antigo (não é hot-reload)

    const agent = new CopywriterAgentV2(makeAi())
    expect(agent.systemPrompt).toContain('MARCADOR-DE-TESTE-E10-1-B')

    // E sem o reset+restauração, o cache prova que NÃO é hot-reload: gruda o valor lido.
    writeFileSync(path, original, 'utf8') // restaura o arquivo...
    expect(loadBasePrompt(key)).toContain('MARCADOR-DE-TESTE-E10-1-B') // ...mas o cache mantém o antigo
    __resetPromptCacheForTests()
    expect(loadBasePrompt(key)).not.toContain('MARCADOR-DE-TESTE-E10-1-B') // só após reset volta
  })
})
