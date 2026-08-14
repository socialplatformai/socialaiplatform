import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ADR-0012 PR4 / AC9 — o prompt de imagem deriva da estética do spec (paleta/mood/style da marca),
// p/ a imagem CASAR com o layout. Testamos capturando o `style` passado ao IImageProvider.

// Captura o options.style de cada chamada generate(); devolve um data-URL fake (sucesso).
const generateSpy = vi.fn(async (_prompt: string, _opts?: { style?: string }) => 'data:image/png;base64,AAA')

// Mocka a factory de provider de imagem p/ não tocar rede nem o GeminiAPIClient real.
vi.mock('../image/imageProvider.js', () => ({
  resolveImageProvider: () => ({ name: 'fake', generate: generateSpy }),
}))
// Mocka o client gemini (o agente o resolve, mas não o usa com o provider fake).
vi.mock('@/services/gemini', () => ({
  getGeminiClient: () => ({}),
}))

import { ImageGeneratorAgent } from './image-generator.js'
import { compileBrandDesignSpec } from '../brand/design-spec.js'
import type { AiConfig } from '@/config'
import type { BrandConfigForPipeline, VisualSpecification } from '@/types/pipeline'

const ai = {
  textProvider: 'gemini', imageProvider: 'gemini', apiKey: 'k', imageApiKey: '',
  model: { text: 't', image: 'i' }, temperature: 0.7, maxTokens: 100,
} as AiConfig

function brandConfig(accent: string): BrandConfigForPipeline {
  return {
    handle: '@m',
    visualIdentity: {
      logo: { url: null },
      colors: {
        primary: { hex: '#112233', name: 'P' }, secondary: { hex: '#445566', name: 'S' },
        accent: { hex: accent, name: 'A' }, background: { hex: '#0A0A0A', name: 'B' },
        text: { hex: '#FFFFFF', name: 'T' },
      },
      typography: { heading: { family: 'Satoshi', weights: [700] }, body: { family: 'Satoshi', weights: [400] } },
    },
    voice: { attributes: [], toneGuidelines: [], copyExamples: [] },
    examples: [],
  }
}

/** Um visual com um slide de cover cujo background é um PROMPT (não url) → dispara geração. */
function visualComBackgroundPrompt(): VisualSpecification {
  return {
    slides: [
      {
        index: 1,
        layoutId: 'branding-os-cover-v1',
        canvas: { width: 1080, height: 1350 },
        background: { type: 'image', value: 'uma cena minimalista' }, // prompt → gera
        elements: [],
      },
    ],
    tokens: { colors: {}, fonts: {}, spacing: {} },
  }
}

describe('ImageGeneratorAgent — estética derivada do spec (AC9)', () => {
  beforeEach(() => generateSpy.mockClear())

  it('AC9: com designSpec, o style passado ao provider contém uma cor da palette do spec', async () => {
    const spec = compileBrandDesignSpec(brandConfig('#FF3D2E'))
    const agent = new ImageGeneratorAgent(ai)
    await agent.execute({ pipelineInput: {} as never, visual: visualComBackgroundPrompt(), designSpec: spec })

    expect(generateSpy).toHaveBeenCalled()
    const style = generateSpy.mock.calls[0][1]?.style ?? ''
    expect(style).toContain('#FF3D2E') // cor da marca no prompt de imagem
    expect(style).toContain('paleta:')
  })

  it('sem designSpec, o style cai no default atual (não quebra)', async () => {
    const agent = new ImageGeneratorAgent(ai)
    await agent.execute({ pipelineInput: {} as never, visual: visualComBackgroundPrompt() })

    const style = generateSpy.mock.calls[0][1]?.style ?? ''
    expect(style).toContain('cinematic') // default atual preservado
    expect(style).not.toContain('paleta:')
  })
})

// FASE 1 (ADR-0014 §86): gera imagem para os 6 slides (era só cover+last). Regressão do gate
// "6 slides com fundo". Cada slide com background-prompt → 1 chamada a generate().
function carouselComBackgroundPrompts(n: number): VisualSpecification {
  return {
    slides: Array.from({ length: n }, (_, i) => ({
      index: i + 1,
      layoutId: `layout-${i + 1}`,
      canvas: { width: 1080, height: 1350 },
      background: { type: 'image' as const, value: `prompt do slide ${i + 1}` }, // prompt → gera
      elements: [],
    })),
    tokens: { colors: {}, fonts: {}, spacing: {} },
  }
}

// Falha de um ELEMENTO de imagem → gradiente de marca (data-URI SVG), nunca uma URL externa de terceiros.
function visualComElementoImagem(): VisualSpecification {
  return {
    slides: [
      {
        index: 1,
        layoutId: 'branding-os-body-v1',
        canvas: { width: 1080, height: 1350 },
        background: { type: 'solid' as const, value: '#000000' }, // não dispara geração de fundo
        elements: [
          // elemento de imagem cujo content é um PROMPT (não url) → dispara geração → vamos falhar.
          { role: 'image' as const, type: 'image' as const, content: 'um produto sobre a mesa' },
        ],
      },
    ],
    tokens: { colors: {}, fonts: {}, spacing: {} },
  } as unknown as VisualSpecification
}

describe('ImageGeneratorAgent — política: não entregar imagem degradada', () => {
  // Restaura o mock ao sucesso default após CADA teste — mockRejectedValue é persistente e
  // contaminaria os describes seguintes (que só fazem mockClear, não resetam a implementação).
  beforeEach(() => generateSpy.mockReset())
  afterEach(() => generateSpy.mockResolvedValue('data:image/png;base64,AAA'))

  it('falha transitória (1x) → RETRY recupera, imagem real (não gradiente)', async () => {
    // 1ª tentativa falha; a 2ª (retry) sucede → o slide recebe imagem real.
    generateSpy.mockResolvedValue('data:image/png;base64,AAA')
    generateSpy.mockRejectedValueOnce(new Error('429 transitório'))

    const agent = new ImageGeneratorAgent(ai)
    const out = await agent.execute({ pipelineInput: {} as never, visual: visualComElementoImagem() })

    const content = out.slides[0].elements![0].content!
    expect(content).toBe('data:image/png;base64,AAA') // imagem real do provider, NÃO fallback
    expect(generateSpy).toHaveBeenCalledTimes(2) // 1 falha + 1 retry bem-sucedido
  })

  it('falha persistente (esgota retry) → execute LANÇA (não publica gradiente fora-da-marca)', async () => {
    // Todas as tentativas falham → após o retry, a política FALHA a geração inteira.
    generateSpy.mockRejectedValue(new Error('cota esgotada'))

    const agent = new ImageGeneratorAgent(ai)
    await expect(agent.execute({ pipelineInput: {} as never, visual: visualComElementoImagem() }))
      .rejects.toThrow(/Geração de imagem falhou/)
    expect(generateSpy).toHaveBeenCalledTimes(3) // 1 + 2 retries antes de desistir
  })
})

// ============================================================================
// Task 1.3 — Contexto da pauta → prompt de imagem (injeção determinística, caminho B)
// O ASSUNTO real da pauta (produto/tema/benefício) tem de chegar ao prompt que vai ao provider,
// de forma VERIFICÁVEL (assert no 1º arg de generate), não só via estilo. Não-regressão: sem
// contexto, o prompt fica byte-equivalente ao base (o que ia antes).
// ============================================================================
describe('ImageGeneratorAgent — contexto da pauta no prompt (task 1.3)', () => {
  beforeEach(() => generateSpy.mockReset())
  afterEach(() => generateSpy.mockResolvedValue('data:image/png;base64,AAA'))

  const contextoPauta = {
    context: {
      productName: 'Curso de Barbearia PRO',
      productDescription: 'formacao completa para barbeiros',
      targetAudience: 'barbeiros iniciantes',
      keyBenefits: ['dobrar o faturamento', 'tecnicas modernas'],
    },
  }

  it('com contexto, o prompt enviado ao provider contém o produto e o benefício da pauta', async () => {
    generateSpy.mockResolvedValue('data:image/png;base64,AAA')
    const agent = new ImageGeneratorAgent(ai)
    await agent.execute({ pipelineInput: contextoPauta as never, visual: visualComBackgroundPrompt() })

    expect(generateSpy).toHaveBeenCalled()
    const prompt = generateSpy.mock.calls[0][0] as string
    expect(prompt).toContain('uma cena minimalista')       // prompt-base preservado (composição do slide)
    expect(prompt).toContain('Curso de Barbearia PRO')       // ASSUNTO ancorado (produto real)
    expect(prompt).toContain('dobrar o faturamento')         // 1º benefício preenchido
  })

  it('NÃO-REGRESSÃO: sem contexto, o prompt é byte-equivalente ao base (o de antes)', async () => {
    generateSpy.mockResolvedValue('data:image/png;base64,AAA')
    const agent = new ImageGeneratorAgent(ai)
    await agent.execute({ pipelineInput: {} as never, visual: visualComBackgroundPrompt() })

    const prompt = generateSpy.mock.calls[0][0] as string
    expect(prompt).toBe('uma cena minimalista') // exatamente o base — nada injetado
  })

  it('NÃO-REGRESSÃO: contexto presente mas com campos vazios → prompt base intocado', async () => {
    generateSpy.mockResolvedValue('data:image/png;base64,AAA')
    const agent = new ImageGeneratorAgent(ai)
    await agent.execute({
      pipelineInput: { context: { productName: '  ', productDescription: '', keyBenefits: [] } } as never,
      visual: visualComBackgroundPrompt(),
    })

    const prompt = generateSpy.mock.calls[0][0] as string
    expect(prompt).toBe('uma cena minimalista') // vazio não injeta ruído
  })
})

describe('ImageGeneratorAgent — 6 imagens (F1, remove otimização cover+last)', () => {
  beforeEach(() => generateSpy.mockClear())

  it('gera imagem para TODOS os 6 slides do carrossel (não só cover+last)', async () => {
    const agent = new ImageGeneratorAgent(ai)
    await agent.execute({ pipelineInput: {} as never, visual: carouselComBackgroundPrompts(6) })
    // ERA 2 (cover+last) antes da F1; agora deve ser 6.
    expect(generateSpy).toHaveBeenCalledTimes(6)
  })

  it('respeita o teto de concorrência (IMAGE_GEN_CONCURRENCY) sem perder slides', async () => {
    const prev = process.env.IMAGE_GEN_CONCURRENCY
    process.env.IMAGE_GEN_CONCURRENCY = '2'
    try {
      const agent = new ImageGeneratorAgent(ai)
      await agent.execute({ pipelineInput: {} as never, visual: carouselComBackgroundPrompts(6) })
      // Mesmo com teto 2, os 6 slides são processados (janela deslizante).
      expect(generateSpy).toHaveBeenCalledTimes(6)
    } finally {
      if (prev === undefined) delete process.env.IMAGE_GEN_CONCURRENCY
      else process.env.IMAGE_GEN_CONCURRENCY = prev
    }
  })
})
