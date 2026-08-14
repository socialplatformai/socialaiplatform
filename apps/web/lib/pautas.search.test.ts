// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { pautaApi } from './pautas'
import { setToken, setBrandId } from './api'

// E12.1 (ADR-0007): busca server-side por título. O client pautaApi.list ganha um 4º
// parâmetro posicional opcional `search`, retrocompatível com os call sites atuais
// (list(), list(undefined, priority, category)). URLSearchParams só seta `search`
// quando não-vazio. Mockamos fetch e inspecionamos a URL/headers.

function mockFetch() {
  const spy = vi.fn(async () =>
    new Response(JSON.stringify([]), {
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

describe('pautaApi.list — busca (E12.1)', () => {
  it('envia search na querystring quando informado', async () => {
    const spy = mockFetch()
    await pautaApi.list(undefined, undefined, undefined, 'engajamento')
    const url = urlOf(spy)
    expect(url).toContain('search=engajamento')
  })

  it('NÃO envia search quando vazio (retrocompat: list() inalterado)', async () => {
    const spy = mockFetch()
    await pautaApi.list()
    expect(urlOf(spy)).not.toContain('search=')
    // sem nenhum filtro, a URL é a base limpa (sem querystring)
    expect(urlOf(spy)).toMatch(/\/api\/pautas$/)
  })

  it('NÃO envia search quando string vazia', async () => {
    const spy = mockFetch()
    await pautaApi.list(undefined, 2, 'Dicas', '')
    const url = urlOf(spy)
    expect(url).not.toContain('search=')
    // mas mantém os filtros posicionais anteriores
    expect(url).toContain('priority=2')
    expect(url).toContain('category=Dicas')
  })

  it('convive com os filtros existentes (priority + category + search)', async () => {
    const spy = mockFetch()
    await pautaApi.list(undefined, 1, 'Bastidores', 'rotina')
    const url = urlOf(spy)
    expect(url).toContain('priority=1')
    expect(url).toContain('category=Bastidores')
    expect(url).toContain('search=rotina')
  })

  it('borda — busca por "%" literal: o client passa o % cru (escape é no backend, ILike)', async () => {
    // Prova do caminho do aceite "título com % literal é achado por busca de %":
    // o client NÃO transforma % em wildcard nem o remove; envia o termo cru. Quem
    // trata %/_/\ como LITERAIS é o EscapeLike do PautaController (teste .NET).
    const spy = mockFetch()
    await pautaApi.list(undefined, undefined, undefined, '50%')
    const url = urlOf(spy)
    // URLSearchParams codifica % como %25; decodificar tem que devolver "search=50%".
    const decoded = decodeURIComponent(url.split('?')[1] ?? '')
    expect(decoded).toContain('search=50%')
  })

  it('a busca passa pelo lib/api (Authorization + X-Brand-Id, ponto único)', async () => {
    const spy = mockFetch()
    setToken('jwt-123')
    setBrandId('brand-A')
    await pautaApi.list(undefined, undefined, undefined, 'x')
    const h = headersOf(spy)
    expect(h['Authorization']).toBe('Bearer jwt-123')
    expect(h['X-Brand-Id']).toBe('brand-A')
  })
})
