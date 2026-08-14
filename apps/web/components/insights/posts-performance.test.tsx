// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { PostsPerformance } from '@/components/insights/posts-performance'
import type { PostMetric } from '@/lib/learning'

// SoT "Desempenho" (Fatia 3): verifica a tabela densa + small-multiples + medidor de amostra com
// dado REAL-shaped (espelha PostMetric do backend). Não toca rede; valida só a renderização.

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

afterEach(cleanup)

function post(over: Partial<PostMetric>): PostMetric {
  return {
    contentId: crypto.randomUUID(),
    caption: 'Post de teste',
    type: 'Carousel',
    reach: 1000,
    engagement: 120,
    likes: 80,
    saves: 30,
    qualityScore: 82,
    window: 'noite',
    isMock: false,
    collectedAt: '2026-06-20T12:00:00Z',
    postedAt: '2026-06-19T20:00:00Z',
    ...over,
  }
}

describe('PostsPerformance — SoT Desempenho (tabela densa + small-multiples)', () => {
  it('<3 posts: mostra medidor de amostra honesto, NUNCA tabela/gráfico vazio', () => {
    render(<PostsPerformance loading={false} error={false} posts={[post({}), post({})]} />)
    expect(screen.getByText(/amostra de desempenho/i)).toBeInTheDocument()
    expect(screen.getByText(/2\/3/)).toBeInTheDocument()
    expect(screen.getByText(/não mostramos gráfico vazio/i)).toBeInTheDocument()
    // não renderiza a tabela
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('≥3 posts: renderiza a tabela densa com as colunas e os valores reais', () => {
    const posts = [
      post({ caption: 'Top performer', type: 'Carousel', reach: 5000, engagement: 900, likes: 600, saves: 200, qualityScore: 91, window: 'noite' }),
      post({ caption: 'Médio', type: 'Post', reach: 2000, engagement: 300, likes: 150, saves: 50, qualityScore: 75, window: 'tarde' }),
      post({ caption: 'Fraco', type: 'Story', reach: 800, engagement: 90, likes: 40, saves: 10, qualityScore: 60, window: 'manhã' }),
    ]
    render(<PostsPerformance loading={false} error={false} posts={posts} />)
    const table = screen.getByRole('table')
    expect(table).toBeInTheDocument()
    // colunas da SoT
    for (const col of ['Alcance', 'Engaj.', 'Likes', 'Saves', 'Qual.']) {
      expect(within(table).getByText(col)).toBeInTheDocument()
    }
    // valores reais formatados (pt-BR usa . como separador de milhar)
    expect(within(table).getByText('5.000')).toBeInTheDocument()
    expect(within(table).getByText('Top performer')).toBeInTheDocument()
    // ordenado por engajamento desc: o top vem antes do fraco no DOM
    const rows = within(table).getAllByRole('row').slice(1) // tira o header
    expect(rows[0].textContent).toContain('Top performer')
    // cada linha encadeia "Gerar mais assim" (SoT)
    expect(screen.getAllByText(/gerar mais assim/i)).toHaveLength(3)
  })

  it('≥3 posts: renderiza os small-multiples (engajamento por formato e por janela)', () => {
    const posts = [post({}), post({ type: 'Post', window: 'manhã' }), post({ type: 'Story', window: 'tarde' })]
    render(<PostsPerformance loading={false} error={false} posts={posts} />)
    expect(screen.getByText(/engajamento por formato/i)).toBeInTheDocument()
    expect(screen.getByText(/engajamento por janela/i)).toBeInTheDocument()
  })

  it('rotula honestamente quando as métricas são simuladas (isMock)', () => {
    const posts = [post({ isMock: true }), post({ isMock: true }), post({ isMock: true })]
    render(<PostsPerformance loading={false} error={false} posts={posts} />)
    // badge "Simulado" quando todas mock
    expect(screen.getByText(/simulado/i)).toBeInTheDocument()
  })

  it('erro: mensagem PT-BR, sem tabela', () => {
    render(<PostsPerformance loading={false} error={true} posts={[]} />)
    expect(screen.getByText(/não foi possível carregar/i)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
