// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { api, setBrandId, getBrandId, clearToken, setToken, registerCacheClearer } from './api'

// E1-d: lib/api.ts é o ÚNICO ponto que injeta X-Brand-Id. Este teste trava esse
// contrato: marca ativa presente → header enviado; ausente → header AUSENTE
// (backend cai na marca-default). Mockamos fetch e inspecionamos os headers.

function mockFetch() {
  const spy = vi.fn(async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', spy)
  return spy
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

describe('lib/api — injeção de X-Brand-Id', () => {
  it('anexa X-Brand-Id quando há marca ativa', async () => {
    const spy = mockFetch()
    setBrandId('brand-A')
    await api('/api/pautas')
    expect(headersOf(spy)['X-Brand-Id']).toBe('brand-A')
  })

  it('NÃO anexa X-Brand-Id quando não há marca selecionada', async () => {
    const spy = mockFetch()
    expect(getBrandId()).toBeNull()
    await api('/api/pautas')
    expect(headersOf(spy)).not.toHaveProperty('X-Brand-Id')
  })

  it('envia o header X-Brand-Id atualizado depois de trocar de marca', async () => {
    const spy = mockFetch()
    setBrandId('brand-A')
    await api('/api/pautas')
    setBrandId('brand-B')
    await api('/api/pautas')
    expect(headersOf(spy, 0)['X-Brand-Id']).toBe('brand-A')
    expect(headersOf(spy, 1)['X-Brand-Id']).toBe('brand-B')
  })

  it('Authorization e X-Brand-Id coexistem (um único ponto)', async () => {
    const spy = mockFetch()
    setToken('jwt-123')
    setBrandId('brand-A')
    await api('/api/pautas')
    const h = headersOf(spy)
    expect(h['Authorization']).toBe('Bearer jwt-123')
    expect(h['X-Brand-Id']).toBe('brand-A')
  })

  it('clearToken (logout) esquece a marca ativa', () => {
    setBrandId('brand-A')
    setToken('jwt-123')
    clearToken()
    expect(getBrandId()).toBeNull()
  })

  it('403 de marca inválida: limpa sap_brand e refaz a request sem header (auto-recuperação)', async () => {
    // Achado adversarial QA: sap_brand apontando p/ marca que não existe mais no
    // workspace fazia TODA request dar 403 → loop de toasts "sem permissão", sem
    // recuperação. A UI tem que limpar a marca e cair na default automaticamente.
    setBrandId('brand-fantasma')
    const spy = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ title: 'Marca inválida para o workspace atual.', status: 403 }), {
          status: 403,
          headers: { 'content-type': 'application/problem+json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', spy)

    const result = await api<{ ok: boolean }>('/api/pautas')

    expect(result).toEqual({ ok: true })
    // marca fantasma foi esquecida
    expect(getBrandId()).toBeNull()
    // 1ª tentativa levou o header inválido; o retry foi SEM header
    expect(headersOf(spy, 0)['X-Brand-Id']).toBe('brand-fantasma')
    expect(headersOf(spy, 1)).not.toHaveProperty('X-Brand-Id')
  })

  it('403 de AÇÃO (sem marca ativa) NÃO entra em recuperação — propaga o erro', async () => {
    // Sem X-Brand-Id, um 403 é erro de permissão de ação: não mexer em marca.
    expect(getBrandId()).toBeNull()
    const spy = vi.fn(async () =>
      new Response(JSON.stringify({ title: 'Você não tem permissão.', status: 403 }), {
        status: 403,
        headers: { 'content-type': 'application/problem+json' },
      }),
    )
    vi.stubGlobal('fetch', spy)

    await expect(api('/api/pautas')).rejects.toMatchObject({ status: 403 })
    // não houve retry
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('clearToken (logout) esvazia o cache de queries (anti cross-session leak)', () => {
    // Achado adversarial: sem isto, o QueryClient da raiz sobrevive à navegação SPA
    // e dados em cache de uma sessão aparecem para a próxima. clearToken tem que
    // disparar o clearer registrado pelos Providers.
    const clearer = vi.fn()
    registerCacheClearer(clearer)
    setToken('jwt-123')
    clearToken()
    expect(clearer).toHaveBeenCalledTimes(1)
  })
})
