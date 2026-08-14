import { describe, it, expect, vi } from 'vitest'
import {
  resolveImageProvider,
  GeminiImageProvider,
  ImagenImageProvider,
  OpenAiImageProvider,
  FluxImageProvider,
  StockImageProvider,
} from './imageProvider.js'
import type { GeminiAPIClient } from '../gemini/client.js'
import type { AiConfig } from '../config.js'
import { defaultModelFor } from '../config.js'

// A/Z (ADR-0008) — IImageProvider trocável; seleção vem da AiConfig EFETIVA, não de
// process.env. Espelha textProvider.test.ts (a assimetria que o cético de Z apontou).
// Client falso (spy): não construímos o GeminiAPIClient real (que valida a chave).

function fakeClient() {
  return {
    generateImage: vi.fn(async () => 'data:image/png;base64,zzz'),
  } as unknown as GeminiAPIClient
}

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

describe('resolveImageProvider — seleção pela AiConfig efetiva', () => {
  it('default é gemini (imageProvider=gemini)', () => {
    const p = resolveImageProvider(makeAi(), fakeClient())
    expect(p.name).toBe('gemini')
    expect(p).toBeInstanceOf(GeminiImageProvider)
  })

  it('imageProvider=imagen devolve o provider Imagen (stub)', () => {
    const p = resolveImageProvider(makeAi({ imageProvider: 'imagen' }), fakeClient())
    expect(p.name).toBe('imagen')
    expect(p).toBeInstanceOf(ImagenImageProvider)
  })

  it('imageProvider=openai devolve o provider OpenAI', () => {
    const p = resolveImageProvider(makeAi({ imageProvider: 'openai', apiKey: 'k' }), fakeClient())
    expect(p.name).toBe('openai')
    expect(p).toBeInstanceOf(OpenAiImageProvider)
  })

  it('task 1.2: imageProvider=flux devolve o FluxImageProvider', () => {
    const p = resolveImageProvider(makeAi({ imageProvider: 'flux', apiKey: 'k' }), fakeClient())
    expect(p.name).toBe('flux')
    expect(p).toBeInstanceOf(FluxImageProvider)
  })

  it('task 1.2: imageProvider=stock devolve o StockImageProvider', () => {
    const p = resolveImageProvider(makeAi({ imageProvider: 'stock', apiKey: 'k' }), fakeClient())
    expect(p.name).toBe('stock')
    expect(p).toBeInstanceOf(StockImageProvider)
  })

  it('a factory NÃO lê process.env (IMAGE_PROVIDER no env é ignorado)', () => {
    const prev = process.env.IMAGE_PROVIDER
    process.env.IMAGE_PROVIDER = 'openai'
    try {
      // ai.imageProvider=gemini deve vencer o env=openai — prova que env não é lido.
      expect(resolveImageProvider(makeAi({ imageProvider: 'gemini' }), fakeClient()).name).toBe('gemini')
    } finally {
      if (prev === undefined) delete process.env.IMAGE_PROVIDER
      else process.env.IMAGE_PROVIDER = prev
    }
  })
})

// Modelo OpenAI vem de defaultModelFor (A4b): testes NÃO repetem o literal.
const OPENAI_IMAGE_MODEL = defaultModelFor('openai', 'image')

describe('OpenAiImageProvider — REST real via fetch (A/ADR-0008)', () => {
  it('sem chave: erro diagnosticável com "openai" e o campo faltante (A3)', async () => {
    const p = new OpenAiImageProvider('', OPENAI_IMAGE_MODEL)
    await expect(p.generate('um gato')).rejects.toThrow(/openai/i)
    await expect(p.generate('um gato')).rejects.toThrow(/AI_PROVIDER_KEY/i)
  })

  it('erro de HTTP (401) vira mensagem clara com "openai" e o status (A3)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid key' } }), { status: 401 }),
    )
    try {
      const p = new OpenAiImageProvider('chave-ruim', OPENAI_IMAGE_MODEL)
      await expect(p.generate('um gato')).rejects.toThrow(/openai/i)
      await expect(p.generate('um gato')).rejects.toThrow(/401/)
    } finally {
      spy.mockRestore()
    }
  })

  it('b64_json: monta o data-URL e POSTa com Bearer e model', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: 'AAAA' }] }), { status: 200 }),
    )
    try {
      const p = new OpenAiImageProvider('chave-boa', OPENAI_IMAGE_MODEL)
      const out = await p.generate('um gato')
      // b64 retornado é JPEG (pedimos output_format:'jpeg') → MIME coerente.
      expect(out).toBe('data:image/jpeg;base64,AAAA')
      const [url, init] = spy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://api.openai.com/v1/images/generations')
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer chave-boa')
      const sent = JSON.parse(init.body as string)
      expect(sent.model).toBe(OPENAI_IMAGE_MODEL)
      // FIX: gpt-image-2 NÃO suporta response_format (→ HTTP 400). Não deve ser enviado;
      // o formato do binário é controlado por output_format.
      expect(sent.response_format).toBeUndefined()
      expect(sent.output_format).toBe('jpeg')
    } finally {
      spy.mockRestore()
    }
  })

  it('fallback url: busca o binário e converte p/ data-URL base64', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    // 1ª chamada: a Images API devolve só url.
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ url: 'https://cdn/img.png' }] }), { status: 200 }),
    )
    // 2ª chamada: busca do binário.
    spy.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    )
    try {
      const p = new OpenAiImageProvider('chave-boa', OPENAI_IMAGE_MODEL)
      const out = await p.generate('um gato')
      expect(out).toBe(`data:image/jpeg;base64,${Buffer.from([1, 2, 3]).toString('base64')}`)
      expect(spy).toHaveBeenCalledTimes(2)
    } finally {
      spy.mockRestore()
    }
  })
})

// task 1.2 — FLUX via Replicate. Modelo vem de defaultModelFor (ponto único); o teste não repete o literal.
const FLUX_MODEL = defaultModelFor('flux', 'image')

describe('FluxImageProvider — REST via Replicate (task 1.2)', () => {
  it('sem chave: erro diagnosticável com "flux"/REPLICATE e o campo faltante', async () => {
    const p = new FluxImageProvider('', FLUX_MODEL)
    await expect(p.generate('um gato')).rejects.toThrow(/flux/i)
    await expect(p.generate('um gato')).rejects.toThrow(/REPLICATE/i)
  })

  it('Prefer: wait → succeeded com output direto: POSTa no endpoint model-specific e baixa a imagem', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    // 1ª chamada: cria a prediction (sync, já succeeded com output url).
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'succeeded', output: ['https://repl/img.png'] }), { status: 200 }),
    )
    // 2ª chamada: baixa o binário.
    spy.mockResolvedValueOnce(
      new Response(new Uint8Array([9, 8, 7]), { status: 200, headers: { 'content-type': 'image/png' } }),
    )
    try {
      const p = new FluxImageProvider('tok', FLUX_MODEL)
      const out = await p.generate('um gato', { style: 'paleta: #FF0000', aspectRatio: '4:5' })
      expect(out).toBe(`data:image/png;base64,${Buffer.from([9, 8, 7]).toString('base64')}`)
      const [url, init] = spy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`https://api.replicate.com/v1/models/${FLUX_MODEL}/predictions`)
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
      expect((init.headers as Record<string, string>).Prefer).toBe('wait')
      const sent = JSON.parse(init.body as string)
      // brand-locking: o style (paleta) entra no prompt.
      expect(sent.input.prompt).toContain('#FF0000')
      expect(sent.input.aspect_ratio).toBe('4:5')
    } finally {
      spy.mockRestore()
    }
  })

  it('HTTP 422 → erro claro com "flux" e o status', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid input' }), { status: 422 }),
    )
    try {
      const p = new FluxImageProvider('tok', FLUX_MODEL)
      await expect(p.generate('x')).rejects.toThrow(/flux/i)
      await expect(p.generate('x')).rejects.toThrow(/422/)
    } finally {
      spy.mockRestore()
    }
  })

  it('status failed → lança (não devolve imagem ruim silenciosa)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'failed', error: 'NSFW' }), { status: 200 }),
    )
    try {
      const p = new FluxImageProvider('tok', FLUX_MODEL)
      await expect(p.generate('x')).rejects.toThrow(/failed/i)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('StockImageProvider — busca via Pexels (task 1.2)', () => {
  it('sem chave: erro diagnosticável com "stock"/PEXELS', async () => {
    const p = new StockImageProvider('')
    await expect(p.generate('praia')).rejects.toThrow(/stock/i)
    await expect(p.generate('praia')).rejects.toThrow(/PEXELS/i)
  })

  it('busca e baixa a 1ª foto; Authorization SEM Bearer (ToS Pexels)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    spy.mockResolvedValueOnce(
      new Response(JSON.stringify({ photos: [{ src: { large2x: 'https://pex/p.jpg' } }] }), { status: 200 }),
    )
    spy.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 1]), { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    )
    try {
      const p = new StockImageProvider('pkey')
      const out = await p.generate('praia ao pôr do sol', { aspectRatio: '4:5' })
      expect(out).toBe(`data:image/jpeg;base64,${Buffer.from([1, 1]).toString('base64')}`)
      const [url, init] = spy.mock.calls[0] as [string, RequestInit]
      expect(url).toContain('https://api.pexels.com/v1/search')
      expect(url).toContain('orientation=portrait') // 4:5 → portrait
      // chave direta, SEM "Bearer" (exigência do Pexels).
      expect((init.headers as Record<string, string>).Authorization).toBe('pkey')
    } finally {
      spy.mockRestore()
    }
  })

  it('busca sem resultados → erro claro com "stock" e a query', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ photos: [] }), { status: 200 }),
    )
    try {
      const p = new StockImageProvider('pkey')
      await expect(p.generate('xyzzy')).rejects.toThrow(/stock/i)
    } finally {
      spy.mockRestore()
    }
  })

  it('HTTP 401 → erro claro com "stock" e o status', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'bad key' }), { status: 401 }),
    )
    try {
      const p = new StockImageProvider('ruim')
      await expect(p.generate('praia')).rejects.toThrow(/stock/i)
      await expect(p.generate('praia')).rejects.toThrow(/401/)
    } finally {
      spy.mockRestore()
    }
  })
})

// Integração REAL marcada — pulada sem OPENAI_TEST_KEY. NÃO roda na suíte unit.
const OPENAI_TEST_KEY = process.env.OPENAI_TEST_KEY
describe('OpenAiImageProvider — integração real (rede)', () => {
  it.skipIf(!OPENAI_TEST_KEY)('generate devolve um data-URL de imagem', async () => {
    const p = new OpenAiImageProvider(OPENAI_TEST_KEY!, defaultModelFor('openai', 'image'))
    const out = await p.generate('um quadrado azul simples')
    expect(out.startsWith('data:image/')).toBe(true)
  })
})
