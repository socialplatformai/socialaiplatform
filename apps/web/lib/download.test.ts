// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { downloadBlob, setToken, setBrandId } from './api'
import { contentApi } from './content'

// E11.5 (ADR-0006) — achado adversarial: um <a href> cru NÃO envia JWT nem X-Brand-Id
// (401 / marca errada). O download tem que ir via fetch autenticado e devolver Blob.
// Este teste trava esse contrato.

function mockBlobFetch() {
  const spy = vi.fn(async () =>
    new Response(new Blob(['zip-bytes']), {
      status: 200,
      headers: { 'content-type': 'application/zip' },
    }),
  )
  vi.stubGlobal('fetch', spy)
  return spy
}

function headersOf(spy: ReturnType<typeof mockBlobFetch>, call = 0): Record<string, string> {
  const args = spy.mock.calls[call] as unknown[] | undefined
  const init = args?.[1] as RequestInit | undefined
  return (init?.headers ?? {}) as Record<string, string>
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('downloadBlob — export autenticado (E11.5)', () => {
  it('carrega Authorization + X-Brand-Id e devolve Blob', async () => {
    const spy = mockBlobFetch()
    setToken('jwt-1')
    setBrandId('brand-A')
    const blob = await downloadBlob('/api/content/c1/export.zip')
    expect(blob).toBeInstanceOf(Blob)
    const h = headersOf(spy)
    expect(h['Authorization']).toBe('Bearer jwt-1')
    expect(h['X-Brand-Id']).toBe('brand-A')
  })

  it('contentApi.downloadExport bate na rota de export do conteúdo', async () => {
    const spy = mockBlobFetch()
    setToken('jwt-1')
    await contentApi.downloadExport('c-42')
    const args = spy.mock.calls[0] as unknown[] | undefined
    const url = args?.[0] as string
    expect(url).toContain('/api/content/c-42/export.zip')
  })

  it('401 no download propaga ApiError (sessão expirada), não Blob silencioso', async () => {
    const spy = vi.fn(async () => new Response('', { status: 401 }))
    vi.stubGlobal('fetch', spy)
    setToken('jwt-1')
    await expect(downloadBlob('/api/content/c1/export.zip')).rejects.toMatchObject({ status: 401 })
  })
})
