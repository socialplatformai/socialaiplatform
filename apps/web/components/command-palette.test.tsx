// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CommandPalette } from './command-palette'

// R2.5 (E7/U4) — o Cmd-K é a superfície cognitiva 2026. Trava: abre por atalho, filtra,
// navega por teclado, e agrega ações + áreas (fonte única NAV_AREAS).

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/lib/brands', () => ({
  brandApi: { list: () => Promise.resolve([]) },
  getBrandId: () => 'b1',
  setBrandId: vi.fn(),
}))

function renderPalette() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><CommandPalette /></QueryClientProvider>)
}

beforeEach(() => { push.mockClear() })
afterEach(cleanup)

describe('CommandPalette (Cmd-K)', () => {
  it('fica fechado por padrão e abre com Ctrl/Cmd-K', () => {
    renderPalette()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('abre via evento do botão-dica do topbar', () => {
    renderPalette()
    act(() => { window.dispatchEvent(new Event('apex:command-palette')) })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('lista as ações do núcleo e as 6 áreas (fonte única)', () => {
    renderPalette()
    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    expect(screen.getByText('Gerar conteúdo')).toBeInTheDocument()
    expect(screen.getByText('Revisar & aprovar')).toBeInTheDocument()
    // áreas (Ir para) — "Início" é único; "Desempenho" aparece como área (getAllByText ≥1)
    expect(screen.getByText('Início')).toBeInTheDocument()
    expect(screen.getAllByText('Desempenho').length).toBeGreaterThan(0)
  })

  it('filtra por texto', () => {
    renderPalette()
    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    fireEvent.change(screen.getByLabelText('Buscar comando'), { target: { value: 'calend' } })
    expect(screen.getByText('Calendário')).toBeInTheDocument()
    expect(screen.queryByText('Gerar conteúdo')).not.toBeInTheDocument()
  })

  it('Enter executa o comando focado (navega)', () => {
    renderPalette()
    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    const input = screen.getByLabelText('Buscar comando')
    fireEvent.change(input, { target: { value: 'Gerar conteúdo' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(push).toHaveBeenCalledWith('/create')
  })

  it('Esc fecha', () => {
    renderPalette()
    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    fireEvent.keyDown(screen.getByLabelText('Buscar comando'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
