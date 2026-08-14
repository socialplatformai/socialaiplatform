// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { api, ApiError, setRefreshToken, clearToken } from './api'

// UX-SPEC 3.1 (bug real) — rotas de AUTENTICAÇÃO ficam FORA do refresh-and-redirect.
// Antes: errar a senha (401) com refreshToken velho → tentava refresh → falhava →
// onUnauthorized() recarregava com "sessão expirou" em vez de "Credenciais inválidas".
// Este teste trava: /auth/login com 401 propaga ApiError(401), NÃO dispara refresh.

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => { localStorage.clear() })
afterEach(() => { vi.unstubAllGlobals(); clearToken() })

describe('lib/api — rotas de auth fora do refresh-and-redirect', () => {
  it('401 em /auth/login propaga ApiError(401) e NÃO tenta /auth/refresh (mesmo com refreshToken)', async () => {
    setRefreshToken('refresh-velho') // o cenário do bug: existe refresh token
    const spy = vi.fn(async (..._args: unknown[]) => jsonResponse(401, { title: 'Credenciais inválidas.' }))
    vi.stubGlobal('fetch', spy)

    await expect(
      api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'x@y.com', password: 'errada' }) }),
    ).rejects.toMatchObject({ status: 401 })

    // só UMA chamada (o login) — refresh NUNCA foi tentado
    const urls = spy.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/auth/refresh'))).toBe(false)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('401 em /auth/register também propaga direto (não vira "sessão expirada")', async () => {
    setRefreshToken('refresh-velho')
    const spy = vi.fn(async (..._args: unknown[]) => jsonResponse(401, { title: 'erro' }))
    vi.stubGlobal('fetch', spy)
    await expect(api('/api/auth/register', { method: 'POST' })).rejects.toBeInstanceOf(ApiError)
    expect(spy.mock.calls.some((c) => String(c[0]).includes('/auth/refresh'))).toBe(false)
  })

  it('401 numa rota PROTEGIDA (não-auth) ainda tenta refresh (comportamento S-27 preservado)', async () => {
    setRefreshToken('refresh-ok')
    let n = 0
    const spy = vi.fn(async (...args: unknown[]) => {
      const u = String(args[0])
      if (u.includes('/auth/refresh')) return jsonResponse(200, { accessToken: 'novo', refreshToken: 'novo-r' })
      n++
      // 1ª chamada da rota protegida = 401; após refresh, 2ª = 200
      return n === 1 ? jsonResponse(401, {}) : jsonResponse(200, { ok: true })
    })
    vi.stubGlobal('fetch', spy)
    const out = await api<{ ok: boolean }>('/api/pautas')
    expect(out).toEqual({ ok: true })
    expect(spy.mock.calls.some((c) => String(c[0]).includes('/auth/refresh'))).toBe(true)
  })
})
