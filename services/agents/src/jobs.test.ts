import { describe, it, expect, vi } from 'vitest'
import { mergeAiOverride, sanitizeRequest } from './jobs.js'
import type { GenerateRequest } from './types.js'
import { type AiConfig, defaultModelFor } from './config.js'
import { resolveTextProvider, OpenAiTextProvider } from './text/textProvider.js'
import { resolveImageProvider, OpenAiImageProvider } from './image/imageProvider.js'
import { getGeminiClient, clearGeminiClient } from './gemini/client.js'
import type { GeminiAPIClient } from './gemini/client.js'

// B (ADR-0008) — chave/modelo de IA por workspace.
//  - mergeAiOverride: o override do workspace VENCE o env; ausência → env (degradado).
//  - B4-bis: a chave do override chega à factory (OpenAiTextProvider/Image com a chave X).
//  - B7: configs distintas → clientes/providers distintos (sem colisão de singleton).
//  - REDACTION: serializar/logar o request NÃO expõe a apiKey.

/** AiConfig-base de teste (== loadAiConfig({}) no espírito: gemini default, sem chave). */
function baseAi(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    textProvider: 'gemini',
    imageProvider: 'gemini',
    apiKey: 'chave-do-env',
    imageApiKey: '',
    model: { text: 'models/gemini-flash-latest', image: 'models/gemini-2.5-flash-image' },
    temperature: 0.7,
    maxTokens: 16384,
    promptOverridesEnabled: false,
    ...overrides,
  }
}

function fakeGeminiClient() {
  return {
    complete: vi.fn(async () => 'texto'),
    completeJSON: vi.fn(async () => ({ ok: true })),
    generateImage: vi.fn(async () => 'data:image/png;base64,zzz'),
  } as unknown as GeminiAPIClient
}

describe('mergeAiOverride — override do workspace vence o env (B4)', () => {
  it('sem override: devolve a config do env intacta', () => {
    const base = baseAi()
    expect(mergeAiOverride(base, undefined)).toBe(base)
  })

  it('override de provider+chave troca provider, chave e o modelo (default do novo provider)', () => {
    const ai = mergeAiOverride(baseAi(), { provider: 'openai', apiKey: 'chave-do-workspace' })
    expect(ai.textProvider).toBe('openai')
    expect(ai.imageProvider).toBe('openai')
    expect(ai.apiKey).toBe('chave-do-workspace') // override vence o env
    // trocou o provider sem dar modelo → recalcula o default do provider efetivo (não Gemini)
    expect(ai.model.text).toBe(defaultModelFor('openai', 'text'))
    expect(ai.model.image).toBe(defaultModelFor('openai', 'image'))
  })

  it('override de modelo explícito vence o default do provider', () => {
    const ai = mergeAiOverride(baseAi(), { provider: 'openai', apiKey: 'k', textModel: 'modelo-x' })
    expect(ai.model.text).toBe('modelo-x')
    expect(ai.model.image).toBe(defaultModelFor('openai', 'image'))
  })

  it('campo ausente no override → mantém o valor do env (degradado honesto)', () => {
    // override só com a chave; provider/modelo ficam os do env (gemini).
    const ai = mergeAiOverride(baseAi(), { apiKey: 'só-a-chave' })
    expect(ai.textProvider).toBe('gemini')
    expect(ai.apiKey).toBe('só-a-chave')
    expect(ai.model.text).toBe('models/gemini-flash-latest') // preserva o modelo do env
  })

  it('provider inválido no override é ignorado (cai no env)', () => {
    const ai = mergeAiOverride(baseAi(), { provider: 'inexistente', apiKey: 'k' })
    expect(ai.textProvider).toBe('gemini')
  })
})

describe('B4-bis — a chave do override chega à factory (não a do process.env)', () => {
  it('texto: provider=openai + chave do override → OpenAiTextProvider POSTa com Bearer da chave X', async () => {
    const ai = mergeAiOverride(baseAi({ apiKey: 'chave-do-ENV' }), {
      provider: 'openai',
      apiKey: 'CHAVE-DO-WORKSPACE',
    })
    const provider = resolveTextProvider(ai, fakeGeminiClient())
    expect(provider).toBeInstanceOf(OpenAiTextProvider)

    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }),
    )
    try {
      await provider.complete('s', 'u')
      const init = spy.mock.calls[0][1] as RequestInit
      // A chave usada é a do WORKSPACE (override), não a do env.
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer CHAVE-DO-WORKSPACE')
    } finally {
      spy.mockRestore()
    }
  })

  it('imagem: provider=openai + chave do override → OpenAiImageProvider usa a chave X', async () => {
    const ai = mergeAiOverride(baseAi({ apiKey: 'chave-do-ENV' }), {
      provider: 'openai',
      apiKey: 'CHAVE-DO-WORKSPACE',
    })
    const provider = resolveImageProvider(ai, fakeGeminiClient())
    expect(provider).toBeInstanceOf(OpenAiImageProvider)

    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: 'AAAA' }] }), { status: 200 }),
    )
    try {
      await provider.generate('um gato')
      const init = spy.mock.calls[0][1] as RequestInit
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer CHAVE-DO-WORKSPACE')
    } finally {
      spy.mockRestore()
    }
  })
})

describe('B7 — sem instância compartilhada entre jobs com configs distintas', () => {
  it('chaves diferentes (mesmo provider gemini) → clients gemini distintos', () => {
    clearGeminiClient()
    const aiA = mergeAiOverride(baseAi(), { apiKey: 'chave-A' })
    const aiB = mergeAiOverride(baseAi(), { apiKey: 'chave-B' })
    // O client é cacheado por TUPLA (apiKey|modelos|params), nunca só por apiKey: chaves
    // distintas não colidem — não há vazamento da chave de um workspace p/ outro.
    const cA = getGeminiClient({
      apiKey: aiA.apiKey, textModel: aiA.model.text, imageModel: aiA.model.image,
      temperature: aiA.temperature, maxOutputTokens: aiA.maxTokens,
    })
    const cB = getGeminiClient({
      apiKey: aiB.apiKey, textModel: aiB.model.text, imageModel: aiB.model.image,
      temperature: aiB.temperature, maxOutputTokens: aiB.maxTokens,
    })
    expect(cA).not.toBe(cB)
    clearGeminiClient()
  })

  it('configs OpenAI com chaves distintas → instâncias de provider distintas (construído por execução)', () => {
    const aiA = mergeAiOverride(baseAi(), { provider: 'openai', apiKey: 'A' })
    const aiB = mergeAiOverride(baseAi(), { provider: 'openai', apiKey: 'B' })
    const pA = resolveTextProvider(aiA, fakeGeminiClient())
    const pB = resolveTextProvider(aiB, fakeGeminiClient())
    expect(pA).not.toBe(pB) // nunca a mesma instância entre configs diferentes
  })
})

describe('🔴 REDACTION — a apiKey NUNCA vaza ao serializar/logar o request', () => {
  const req: GenerateRequest = {
    brandContext: { workspaceId: 'ws-1' },
    pauta: { id: 'p1', title: 'Pauta' },
    format: 'carousel',
    aiOverride: { provider: 'openai', apiKey: 'SEGREDO-NUNCA-LOGAR' },
  }

  it('sanitizeRequest substitui a apiKey por "***"', () => {
    const safe = sanitizeRequest(req)
    expect(safe.aiOverride?.apiKey).toBe('***')
    // não muta o original (a geração ainda precisa da chave real)
    expect(req.aiOverride?.apiKey).toBe('SEGREDO-NUNCA-LOGAR')
  })

  it('serializar o request sanitizado NÃO contém a chave em claro', () => {
    const dump = JSON.stringify(sanitizeRequest(req))
    expect(dump).not.toContain('SEGREDO-NUNCA-LOGAR')
    expect(dump).toContain('***')
  })

  it('request sem aiOverride passa intacto (sem trabalho desnecessário)', () => {
    const semOverride: GenerateRequest = {
      brandContext: { workspaceId: 'ws-1' }, pauta: { id: 'p1', title: 'P' }, format: 'post',
    }
    expect(sanitizeRequest(semOverride)).toBe(semOverride)
  })
})
