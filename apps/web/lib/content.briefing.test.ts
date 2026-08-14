// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { contentApi } from './content'
import { setToken, setBrandId } from './api'

// E9.5 (ADR-0007): o client briefingPreview chama GET /api/content/briefing/preview com
// os parâmetros corretos na querystring e carrega Authorization + X-Brand-Id (via lib/api).
// Mockamos fetch e inspecionamos a URL e os headers.

function mockFetch() {
  const spy = vi.fn(async () =>
    new Response(JSON.stringify({ brandContext: {}, pauta: { id: 'preview' }, format: 'post' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', spy)
  return spy
}

function urlOf(spy: ReturnType<typeof mockFetch>, call = 0): string {
  const args = spy.mock.calls[call] as unknown[] | undefined
  return String(args?.[0])
}

function headersOf(spy: ReturnType<typeof mockFetch>, call = 0): Record<string, string> {
  const args = spy.mock.calls[call] as unknown[] | undefined
  const init = args?.[1] as RequestInit | undefined
  return (init?.headers ?? {}) as Record<string, string>
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('contentApi.briefingPreview', () => {
  it('caminho PAUTA: envia pautaId e format na querystring', async () => {
    const spy = mockFetch()
    await contentApi.briefingPreview({ pautaId: 'p-1', format: 1 })
    const url = urlOf(spy)
    expect(url).toContain('/api/content/briefing/preview?')
    expect(url).toContain('pautaId=p-1')
    expect(url).toContain('format=1')
    expect(url).not.toContain('theme=')
  })

  it('caminho TEMA: envia theme e format, sem pautaId', async () => {
    const spy = mockFetch()
    await contentApi.briefingPreview({ theme: 'rotina matinal', format: 0 })
    const url = urlOf(spy)
    expect(url).toContain('theme=rotina+matinal')
    expect(url).toContain('format=0')
    expect(url).not.toContain('pautaId=')
  })

  it('carrega Authorization + X-Brand-Id (via lib/api, ponto único)', async () => {
    const spy = mockFetch()
    setToken('jwt-123')
    setBrandId('brand-A')
    await contentApi.briefingPreview({ pautaId: 'p-1', format: 2 })
    const h = headersOf(spy)
    expect(h['Authorization']).toBe('Bearer jwt-123')
    expect(h['X-Brand-Id']).toBe('brand-A')
  })

  it('retorna o briefing parseado (camelCase)', async () => {
    mockFetch()
    const res = await contentApi.briefingPreview({ pautaId: 'p-1', format: 1 })
    expect(res.pauta.id).toBe('preview')
    expect(res.format).toBe('post')
  })
})
