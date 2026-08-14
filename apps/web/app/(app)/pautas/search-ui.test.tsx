// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PautasPage from './page'
import { pautaApi } from '@/lib/pautas'

// E12.1 (ADR-0007) — guarda do caminho UI→request da busca de pautas. O teste de
// client (pautas.search.test.ts) já prova que pautaApi.list serializa `search`; o de
// .NET prova o escape de %/_/\. ESTE prova o que falta: o campo de busca da PautaList
// realmente alimenta `search` no client (via debounce na query key). Sem este teste,
// uma regressão na fiação do debounce (ex.: tirar `debounced` da queryKey, ou quebrar
// o useEffect) passaria batido — o critério "digitar substring → request carrega
// search" ficaria sem rede.

function renderPautas() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <PautasPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(pautaApi, 'categories').mockResolvedValue([] as never)
  vi.spyOn(pautaApi, 'queue').mockResolvedValue([] as never)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PautaList — busca por título (E12.1, UI→request)', () => {
  it('digitar no campo de busca chega ao client como o 4º arg (search) após o debounce', async () => {
    const listSpy = vi.spyOn(pautaApi, 'list').mockResolvedValue([] as never)
    renderPautas()

    // Monta com busca vazia (4º arg undefined).
    await waitFor(() => expect(listSpy).toHaveBeenCalled())
    expect(listSpy.mock.calls[0][3]).toBeUndefined()

    // Digita uma substring no campo de busca da lista.
    const box = screen.getByLabelText('Buscar pautas por título') as HTMLInputElement
    fireEvent.change(box, { target: { value: 'engajamento' } })

    // Após o debounce (~300ms) o termo entra na query key e a request carrega `search`.
    await waitFor(
      () => {
        const sentTerm = listSpy.mock.calls.some((c) => c[3] === 'engajamento')
        expect(sentTerm).toBe(true)
      },
      { timeout: 2000 },
    )
  })

  it('espaços em volta do termo são aparados antes de virar `search`', async () => {
    const listSpy = vi.spyOn(pautaApi, 'list').mockResolvedValue([] as never)
    renderPautas()
    await waitFor(() => expect(listSpy).toHaveBeenCalled())

    const box = screen.getByLabelText('Buscar pautas por título') as HTMLInputElement
    fireEvent.change(box, { target: { value: '  rotina  ' } })

    await waitFor(
      () => {
        // o termo enviado é o aparado (trim), nunca com os espaços.
        expect(listSpy.mock.calls.some((c) => c[3] === 'rotina')).toBe(true)
        expect(listSpy.mock.calls.some((c) => c[3] === '  rotina  ')).toBe(false)
      },
      { timeout: 2000 },
    )
  })
})
