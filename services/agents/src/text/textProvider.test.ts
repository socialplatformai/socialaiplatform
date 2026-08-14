import { describe, it, expect, vi } from 'vitest'
import {
  resolveTextProvider,
  GeminiTextProvider,
  OpenAiTextProvider,
  ClaudeTextProvider,
  GROK_DIALECT,
  type ITextProvider,
} from './textProvider.js'
import type { GeminiAPIClient } from '../gemini/client.js'
import type { AiConfig, ProviderKind } from '../config.js'
import { defaultModelFor, AI_DEFAULTS } from '../config.js'

// E5.1 / Z (ADR-0008) — ITextProvider trocável, espelhando IImageProvider.
// A seleção agora vem da AiConfig EFETIVA (não de process.env): a factory recebe
// `ai` e decide por ai.textProvider. A leitura do env→AiConfig é responsabilidade
// de loadAiConfig (coberta por config.test.ts), não desta factory.
// Usa um client falso (spy) — não construímos o GeminiAPIClient real (que valida
// a chave e lançaria); aqui o foco é a abstração e a seleção por config.

function fakeClient() {
  return {
    complete: vi.fn(async () => 'texto'),
    completeJSON: vi.fn(async () => ({ ok: true })),
  } as unknown as GeminiAPIClient
}

/** Monta uma AiConfig de teste; só os campos relevantes são sobrescritos. */
function makeAi(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    textProvider: 'gemini',
    imageProvider: 'gemini',
    apiKey: '',
    imageApiKey: '',
    model: { text: 'models/x', image: 'models/y' },
    temperature: 0.7,
    maxTokens: 16384,
    promptOverridesEnabled: false,
    ...overrides,
  }
}

describe('resolveTextProvider — seleção pela AiConfig efetiva', () => {
  it('default é gemini (textProvider=gemini)', () => {
    const p = resolveTextProvider(makeAi(), fakeClient())
    expect(p.name).toBe('gemini')
    expect(p).toBeInstanceOf(GeminiTextProvider)
  })

  it('textProvider=openai devolve o provider OpenAI (stub) com a chave da config', () => {
    const p = resolveTextProvider(makeAi({ textProvider: 'openai', apiKey: 'k' }), fakeClient())
    expect(p.name).toBe('openai')
    expect(p).toBeInstanceOf(OpenAiTextProvider)
  })

  it('provider não-textual (imagen) cai em gemini, sem ler env', () => {
    // 'imagen' é um ProviderKind válido para imagem, não para texto: o default vence.
    const p = resolveTextProvider(makeAi({ textProvider: 'imagen' as ProviderKind }), fakeClient())
    expect(p.name).toBe('gemini')
    expect(p).toBeInstanceOf(GeminiTextProvider)
  })

  it('a factory NÃO lê process.env (TEXT_PROVIDER no env é ignorado)', () => {
    const prev = process.env.TEXT_PROVIDER
    process.env.TEXT_PROVIDER = 'openai'
    try {
      // ai.textProvider=gemini deve vencer o env=openai — prova que env não é lido.
      expect(resolveTextProvider(makeAi({ textProvider: 'gemini' }), fakeClient()).name).toBe('gemini')
    } finally {
      if (prev === undefined) delete process.env.TEXT_PROVIDER
      else process.env.TEXT_PROVIDER = prev
    }
  })

  it('textProvider=grok reusa o wrapper OpenAI-compatible com name "grok"', () => {
    const p = resolveTextProvider(makeAi({ textProvider: 'grok', apiKey: 'k' }), fakeClient())
    expect(p.name).toBe('grok')
    expect(p).toBeInstanceOf(OpenAiTextProvider) // mesmo wrapper, dialeto diferente
  })

  it('textProvider=anthropic devolve o ClaudeTextProvider (wrapper próprio)', () => {
    const p = resolveTextProvider(makeAi({ textProvider: 'anthropic', apiKey: 'k' }), fakeClient())
    expect(p.name).toBe('anthropic')
    expect(p).toBeInstanceOf(ClaudeTextProvider)
  })
})

describe('GeminiTextProvider — delega ao client (reusa retry/JSON-repair)', () => {
  it('complete e completeJSON chamam o client com os mesmos args', async () => {
    const client = fakeClient()
    const p: ITextProvider = new GeminiTextProvider(client)

    await p.complete('sys', 'user', { temperature: 0.5, maxTokens: 100 })
    expect(client.complete).toHaveBeenCalledWith('sys', 'user', { temperature: 0.5, maxTokens: 100 })

    const out = await p.completeJSON<{ ok: boolean }>('sys', 'user', { temperature: 0.3 })
    expect(client.completeJSON).toHaveBeenCalledWith('sys', 'user', { temperature: 0.3 })
    expect(out).toEqual({ ok: true })
  })
})

// Modelo OpenAI vem de defaultModelFor (A4b): testes NÃO repetem o literal — assim
// o único ponto a editar quando o modelo mudar continua sendo defaultModelFor.
const OPENAI_TEXT_MODEL = defaultModelFor('openai', 'text')

describe('OpenAiTextProvider — REST real via fetch (A/ADR-0008)', () => {
  it('sem chave: erro diagnosticável com "openai" e o campo faltante (A3)', async () => {
    const p = new OpenAiTextProvider('', OPENAI_TEXT_MODEL)
    // A3: erro aponta o provider (openai) E a env/campo (AI_PROVIDER_KEY).
    await expect(p.complete('s', 'u')).rejects.toThrow(/openai/i)
    await expect(p.complete('s', 'u')).rejects.toThrow(/AI_PROVIDER_KEY/i)
    await expect(p.completeJSON('s', 'u')).rejects.toThrow(/openai/i)
  })

  it('erro de HTTP (401) vira mensagem clara com "openai" e o status (A3)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid key' } }), { status: 401 }),
    )
    try {
      const p = new OpenAiTextProvider('chave-ruim', OPENAI_TEXT_MODEL)
      await expect(p.complete('s', 'u')).rejects.toThrow(/openai/i)
      await expect(p.complete('s', 'u')).rejects.toThrow(/401/)
    } finally {
      spy.mockRestore()
    }
  })

  it('complete: POSTa em /v1/chat/completions com Bearer e devolve o content', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'olá' } }] }), { status: 200 }),
    )
    try {
      const p = new OpenAiTextProvider('chave-boa', OPENAI_TEXT_MODEL)
      const out = await p.complete('sys', 'user')
      expect(out).toBe('olá')
      const [url, init] = spy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://api.openai.com/v1/chat/completions')
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer chave-boa')
      expect(JSON.parse(init.body as string).model).toBe(OPENAI_TEXT_MODEL)
    } finally {
      spy.mockRestore()
    }
  })

  it('completeJSON: parse resiliente extrai o 1º bloco {..} mesmo com cercas markdown', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: '```json\n{"ok": true}\n```' } }] }),
        { status: 200 },
      ),
    )
    try {
      const p = new OpenAiTextProvider('chave-boa', OPENAI_TEXT_MODEL)
      const out = await p.completeJSON<{ ok: boolean }>('s', 'u')
      expect(out).toEqual({ ok: true })
      // response_format json_object é pedido quando possível.
      const init = spy.mock.calls[0][1] as RequestInit
      expect(JSON.parse(init.body as string).response_format).toEqual({ type: 'json_object' })
    } finally {
      spy.mockRestore()
    }
  })
})

// A4: defaultModelFor é o ÚNICO ponto com o literal de modelo OpenAI.
describe('defaultModelFor — default por (provider × modalidade) (A4)', () => {
  it('openai/text e openai/image: não-vazios e != id Gemini', () => {
    const otext = defaultModelFor('openai', 'text')
    const oimg = defaultModelFor('openai', 'image')
    expect(otext).toBeTruthy()
    expect(oimg).toBeTruthy()
    expect(otext).not.toBe(defaultModelFor('gemini', 'text'))
    expect(oimg).not.toBe(defaultModelFor('gemini', 'image'))
    expect(otext).not.toBe(oimg)
  })

  it('gemini reusa os defaults Gemini (byte-equivalente)', () => {
    expect(defaultModelFor('gemini', 'text')).toBe(AI_DEFAULTS.textModel)
    expect(defaultModelFor('gemini', 'image')).toBe(AI_DEFAULTS.imageModel)
  })
})

// ── Param-compat (o que previne HTTP 400 silencioso em produção) ─────────────────────
describe('OpenAiTextProvider — dialeto de params (antifrágil contra HTTP 400)', () => {
  it('OpenAI (default): usa max_completion_tokens e NÃO envia temperature (série GPT-5 rejeita ≠1)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }),
    )
    try {
      const p = new OpenAiTextProvider('k', OPENAI_TEXT_MODEL)
      await p.complete('s', 'u', { temperature: 0.7, maxTokens: 500 })
      const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string)
      expect(body.max_completion_tokens).toBe(500) // nome correto p/ GPT-5
      expect(body.max_tokens).toBeUndefined()       // NÃO o antigo (daria 400)
      expect(body.temperature).toBeUndefined()      // série GPT-5 rejeita temperature≠1
    } finally {
      spy.mockRestore()
    }
  })

  it('Grok (dialeto OpenAI-compat): usa max_tokens e ENVIA temperature, baseURL x.ai', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }),
    )
    try {
      const p = new OpenAiTextProvider('k', 'grok-4.3', {
        name: 'grok', baseUrl: 'https://api.x.ai/v1', dialect: GROK_DIALECT,
      })
      await p.complete('s', 'u', { temperature: 0.2, maxTokens: 500 })
      const [url, init] = spy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://api.x.ai/v1/chat/completions')
      const body = JSON.parse(init.body as string)
      expect(body.max_tokens).toBe(500)        // Grok aceita max_tokens
      expect(body.temperature).toBe(0.2)        // Grok aceita temperature
      expect(body.max_completion_tokens).toBeUndefined()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('ClaudeTextProvider — shape da Messages API (não OpenAI-compat)', () => {
  it('sem chave: erro diagnosticável com "anthropic" e a env', async () => {
    const p = new ClaudeTextProvider('', 'claude-opus-4-8')
    await expect(p.complete('s', 'u')).rejects.toThrow(/anthropic/i)
    await expect(p.complete('s', 'u')).rejects.toThrow(/AI_PROVIDER_KEY/i)
  })

  it('POSTa em /v1/messages com x-api-key, anthropic-version, system top-level e SEM temperature', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'olá' }] }), { status: 200 }),
    )
    try {
      const p = new ClaudeTextProvider('k', 'claude-opus-4-8')
      const out = await p.complete('SYS', 'USER', { maxTokens: 1000 })
      expect(out).toBe('olá')
      const [url, init] = spy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://api.anthropic.com/v1/messages')
      const h = init.headers as Record<string, string>
      expect(h['x-api-key']).toBe('k')             // NÃO Authorization: Bearer
      expect(h.Authorization).toBeUndefined()
      expect(h['anthropic-version']).toBe('2023-06-01') // obrigatório
      const body = JSON.parse(init.body as string)
      expect(body.system).toBe('SYS')              // system top-level, não em messages
      expect(body.messages).toEqual([{ role: 'user', content: 'USER' }]) // só user/assistant
      expect(body.max_tokens).toBe(1000)           // obrigatório, snake_case
      expect(body.temperature).toBeUndefined()     // Opus 4.7+ rejeita temperature≠default
    } finally {
      spy.mockRestore()
    }
  })

  it('completeJSON: extrai só blocos type=text (content[0] pode ser thinking) e parseia', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ content: [{ type: 'thinking', text: 'hmm' }, { type: 'text', text: '{"ok": true}' }] }),
        { status: 200 },
      ),
    )
    try {
      const p = new ClaudeTextProvider('k', 'claude-opus-4-8')
      const out = await p.completeJSON<{ ok: boolean }>('s', 'u')
      expect(out).toEqual({ ok: true }) // ignora o bloco thinking, pega o text
    } finally {
      spy.mockRestore()
    }
  })
})

describe('defaultModelFor — providers novos (grok/anthropic)', () => {
  it('grok/text e anthropic/text retornam slugs GA verificados, != Gemini', () => {
    expect(defaultModelFor('grok', 'text')).toBe('grok-4.3')
    expect(defaultModelFor('anthropic', 'text')).toBe('claude-opus-4-8')
    expect(defaultModelFor('grok', 'text')).not.toBe(defaultModelFor('gemini', 'text'))
  })
})

// Integração REAL marcada — pulada sem OPENAI_TEST_KEY. NÃO roda na suíte unit.
const OPENAI_TEST_KEY = process.env.OPENAI_TEST_KEY
describe('OpenAiTextProvider — integração real (rede)', () => {
  it.skipIf(!OPENAI_TEST_KEY)('complete devolve texto não-vazio da OpenAI real', async () => {
    const p = new OpenAiTextProvider(OPENAI_TEST_KEY!, defaultModelFor('openai', 'text'))
    const out = await p.complete('Responda em uma palavra.', 'Diga "ok".')
    expect(out.length).toBeGreaterThan(0)
  })
})
