// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InlineSchedule } from './inline-schedule'
import { scheduleApi } from '@/lib/workflow'

// R3 — o agendar inline mata o beco-sem-saída (aprovar → toast morto → re-navegar).
// Prova: o componente agenda no MESMO lugar, passando a hora de parede CRUA (sem
// reinterpretar com new Date) — o mesmo contrato do calendário/create.

function renderWithClient(props: Parameters<typeof InlineSchedule>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <InlineSchedule {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.spyOn(scheduleApi, 'schedule').mockResolvedValue({} as never)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('InlineSchedule (R3 — próxima-ação)', () => {
  it('agenda passando contentId + hora de parede CRUA ao scheduleApi', async () => {
    const onScheduled = vi.fn()
    renderWithClient({ contentId: 'content-1', onScheduled })

    const future = '2099-12-31T10:00'
    fireEvent.change(screen.getByLabelText('Agendar para'), { target: { value: future } })
    fireEvent.click(screen.getByText('Agendar'))

    await waitFor(() => expect(scheduleApi.schedule).toHaveBeenCalled())
    const [id, when] = (scheduleApi.schedule as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]
    expect(id).toBe('content-1')
    // hora de parede CRUA — NÃO convertida com new Date().toISOString()
    expect(when).toBe(future)
    await waitFor(() => expect(onScheduled).toHaveBeenCalled())
  })

  it('bloqueia data no passado com erro de validação (não chama a API)', async () => {
    renderWithClient({ contentId: 'content-2' })
    fireEvent.change(screen.getByLabelText('Agendar para'), { target: { value: '2000-01-01T10:00' } })
    fireEvent.click(screen.getByText('Agendar'))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(scheduleApi.schedule).not.toHaveBeenCalled()
  })

  it('não agenda com data vazia', () => {
    renderWithClient({ contentId: 'content-3' })
    fireEvent.click(screen.getByText('Agendar'))
    expect(scheduleApi.schedule).not.toHaveBeenCalled()
  })
})
