// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrandSelector } from './brand-selector'
import { brandApi, getBrandId } from '@/lib/brands'

// E1-d: o seletor TROCA o contexto de marca. Prova do aceite pela UI: ao escolher
// outra marca, a marca ativa (sap_brand) muda e as queries são invalidadas — então
// a próxima request sai escopada à nova marca (X-Brand-Id), e dados da marca A não
// vazam para a marca B. Mockamos brandApi.list; o backend não é tocado.

const BRANDS = [
  { id: 'brand-A', name: 'Marca A', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'brand-B', name: 'Marca B', createdAt: '2026-01-02T00:00:00Z' },
]

function renderWithClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <BrandSelector />
    </QueryClientProvider>,
  )
  return { invalidateSpy }
}

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(brandApi, 'list').mockResolvedValue(BRANDS)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('BrandSelector', () => {
  it('adota a 1ª marca quando não há seleção e invalida as queries', async () => {
    const { invalidateSpy } = renderWithClient()
    await waitFor(() => expect(getBrandId()).toBe('brand-A'))
    expect(invalidateSpy).toHaveBeenCalled()
  })

  it('trocar de marca persiste sap_brand e invalida as queries (recarrega a área)', async () => {
    const { invalidateSpy } = renderWithClient()
    const select = await screen.findByLabelText<HTMLSelectElement>('Marca ativa')
    await waitFor(() => expect(getBrandId()).toBe('brand-A'))
    invalidateSpy.mockClear()

    fireEvent.change(select, { target: { value: 'brand-B' } })

    expect(getBrandId()).toBe('brand-B')
    expect(invalidateSpy).toHaveBeenCalledTimes(1)
  })

  it('persiste a marca ANTES de invalidar (ordem load-bearing contra leak A→B)', async () => {
    // Blood lesson: se a ordem inverter (invalidar antes de setBrandId), o refetch
    // sai com a marca antiga e dados de A vazam para B. Este teste lê getBrandId()
    // DENTRO do invalidateQueries — tem que já ser a marca nova. Inverter = vermelho.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    let brandAtInvalidate: string | null = 'UNSET'
    vi.spyOn(client, 'invalidateQueries').mockImplementation((() => {
      brandAtInvalidate = getBrandId()
      return Promise.resolve()
    }) as typeof client.invalidateQueries)

    render(
      <QueryClientProvider client={client}>
        <BrandSelector />
      </QueryClientProvider>,
    )
    const select = await screen.findByLabelText<HTMLSelectElement>('Marca ativa')
    await waitFor(() => expect(getBrandId()).toBe('brand-A'))

    fireEvent.change(select, { target: { value: 'brand-B' } })

    // No instante da invalidação, a marca já tinha que ser a NOVA.
    expect(brandAtInvalidate).toBe('brand-B')
  })

  it('não invalida ao "trocar" para a marca que já está ativa', async () => {
    const { invalidateSpy } = renderWithClient()
    const select = await screen.findByLabelText<HTMLSelectElement>('Marca ativa')
    await waitFor(() => expect(getBrandId()).toBe('brand-A'))
    invalidateSpy.mockClear()

    fireEvent.change(select, { target: { value: 'brand-A' } })

    expect(getBrandId()).toBe('brand-A')
    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('não renderiza seletor quando há só uma marca (não polui o topbar)', async () => {
    vi.spyOn(brandApi, 'list').mockResolvedValue([BRANDS[0]])
    renderWithClient()
    // espera o efeito de adoção rodar; mesmo assim o select não aparece
    await waitFor(() => expect(getBrandId()).toBe('brand-A'))
    expect(screen.queryByLabelText('Marca ativa')).not.toBeInTheDocument()
  })
})
