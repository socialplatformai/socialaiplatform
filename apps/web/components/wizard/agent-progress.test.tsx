// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { AgentProgress, friendlyGenError } from './agent-progress'

afterEach(cleanup)

// R5a — a viz dos agentes é AI-nativa: comunica o que cada agente FAZ (não só "carregando"),
// anuncia o agente ativo a leitores de tela (T1), e mostra erro claro/honesto.

describe('AgentProgress (R5a — viz AI-nativa)', () => {
  it('mostra a FALA do agente ativo (substância, não só rótulo)', () => {
    render(<AgentProgress step="copywriter" progress={45} />)
    // a manchete vira o pensamento do agente ativo
    expect(screen.getAllByText(/Escrevendo a copy na voz da sua marca/).length).toBeGreaterThan(0)
    // o rótulo do agente também aparece
    expect(screen.getByText('Copywriter')).toBeInTheDocument()
  })

  it('anuncia o agente ativo a leitores de tela (T1 — role=status)', () => {
    render(<AgentProgress step="visual-compositor" progress={60} />)
    const status = screen.getByRole('status')
    expect(status.textContent).toContain('Compositor visual')
  })

  it('expõe o progresso como progressbar acessível', () => {
    render(<AgentProgress step="story-architect" progress={30} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '30')
  })

  it('em 100% comunica conclusão (não fica "processando")', () => {
    render(<AgentProgress step={null} progress={100} />)
    expect(screen.getByText(/seu conteúdo está montado/i)).toBeInTheDocument()
    expect(screen.getByRole('status').textContent).toContain('concluída')
  })

  it('estado de erro: alerta claro + tradução PT-BR honesta', () => {
    render(<AgentProgress step="copywriter" progress={40} error="AI_PROVIDER_KEY ausente" />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toMatch(/chave de IA/i)
    expect(alert.textContent).toMatch(/Nenhum conteúdo foi gerado/i)
  })
})

describe('friendlyGenError (honestidade de UX preservada)', () => {
  it('chave ausente → não insinua que algo foi gerado', () => {
    expect(friendlyGenError('AI_PROVIDER_KEY ausente')).toMatch(/Nenhum conteúdo foi gerado/i)
  })
  it('erro só de imagem → diz que o texto pode ter sido salvo', () => {
    expect(friendlyGenError('image generation failed')).toMatch(/fundo provisório/i)
  })
  it('erro genérico → mensagem neutra, sem afirmar o que foi gerado', () => {
    expect(friendlyGenError('something weird')).toMatch(/Não foi possível concluir/i)
  })
})
