// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DashboardPage from './page'
import { approvalApi, scheduleApi } from '@/lib/workflow'
import { instagramApi } from '@/lib/instagram'
import { brandApi } from '@/lib/brand'
import type { ReactNode } from 'react'
import { pautaApi } from '@/lib/pautas'

// next/link → âncora simples no jsdom (sem depender do router do App Router em teste
// unitário). Preserva href para podermos asserir os deep-links do onboarding.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

// E12.6 (ADR-0007): o checklist de onboarding reflete o estado real, cada passo linka
// para a rota EXATA da ação, e PERMANECE acessível (colapsado) mesmo a 3/3 — sem
// desaparecer nem virar dead-end. Mockamos os clients; o backend não é tocado.

function renderDash() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <DashboardPage />
    </QueryClientProvider>,
  )
}

// Configura o estado de cada um dos 3 gates (marca/IG/pauta).
function setupState({
  hasBrand,
  connected,
  hasPautas,
}: {
  hasBrand: boolean
  connected: boolean
  hasPautas: boolean
}) {
  vi.spyOn(brandApi, 'getKit').mockResolvedValue(
    hasBrand
      ? { branding: null, tone: 'Próximo e direto', editorialGuidelines: null } as never
      : { branding: null, tone: null, editorialGuidelines: null } as never,
  )
  vi.spyOn(instagramApi, 'status').mockResolvedValue({
    connected,
    username: connected ? 'marca' : null,
  } as never)
  vi.spyOn(pautaApi, 'list').mockResolvedValue(
    hasPautas ? ([{ id: 'p-1', title: 'X' }] as never) : ([] as never),
  )
  // queries não relacionadas ao onboarding — respostas mínimas válidas.
  vi.spyOn(approvalApi, 'pending').mockResolvedValue([] as never)
  vi.spyOn(scheduleApi, 'calendar').mockResolvedValue([] as never)
}

// href do CTA cujo rótulo casa com `text`. Na faixa de setup o texto vive DENTRO
// do <Link> (<a>) — então o link é o ancestral mais próximo (closest('a')).
function hrefByText(text: string | RegExp): string | null {
  const label = screen.getByText(text)
  return label.closest('a')?.getAttribute('href') ?? null
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('dashboard — onboarding guiado (E12.6)', () => {
  it('3/3 concluído: mostra a faixa "Configuração concluída" com atalho para gerar conteúdo', async () => {
    setupState({ hasBrand: true, connected: true, hasPautas: true })
    renderDash()

    // a faixa colapsada aparece (não some) e leva ao gerador.
    let banner: HTMLElement
    await waitFor(() => {
      banner = screen.getByText(/Configuração concluída/i)
      expect(banner).toBeInTheDocument()
    })
    // o atalho "Gerar conteúdo" DA FAIXA (não o das Ações rápidas) aponta p/ /create.
    // O título e o atalho dividem o mesmo Card (ancestral comum mais próximo).
    const card = banner!.closest('div')!.parentElement!
    const cta = Array.from(card.querySelectorAll('a')).find(
      (a) => a.textContent?.includes('Gerar conteúdo'),
    )
    expect(cta?.getAttribute('href')).toBe('/create')
    // a 3/3 NÃO renderiza o checklist de 3 passos (colapsou).
    expect(screen.queryByText('Configure sua conta em 3 passos')).not.toBeInTheDocument()
  })

  it('pendente: a faixa de setup aparece e cada passo aponta para a rota correta', async () => {
    setupState({ hasBrand: false, connected: false, hasPautas: false })
    renderDash()

    // faixa incompleta: progresso "0/3 concluídos" + CTAs dos passos que faltam.
    await waitFor(() =>
      expect(screen.getByText('0/3 concluídos')).toBeInTheDocument(),
    )
    // cada CTA pendente linka à rota EXATA da ação (o título do passo vive no rótulo do CTA).
    expect(hrefByText(/Configurar:/)).toBe('/brand')
    expect(hrefByText(/Conectar:/)).toBe('/settings/instagram')
    expect(hrefByText(/Criar pauta:/)).toBe('/pautas')
  })

  it('parcial (só falta a pauta): o passo pendente aponta para /pautas', async () => {
    setupState({ hasBrand: true, connected: true, hasPautas: false })
    renderDash()

    // 2/3 → faixa incompleta (ainda não concluída, sem faixa "tudo pronto").
    await waitFor(() =>
      expect(screen.getByText('2/3 concluídos')).toBeInTheDocument(),
    )
    expect(screen.queryByText(/Configuração concluída/i)).not.toBeInTheDocument()
    // o único passo pendente (pauta) leva à rota certa.
    expect(hrefByText(/Criar pauta:/)).toBe('/pautas')
  })
})
