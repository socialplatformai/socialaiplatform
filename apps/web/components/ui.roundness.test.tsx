import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Card, Input, Textarea, Select, Button, Skeleton, SelectableCard, CheckCircle } from './ui'

// R1 (redesign SOTA-2026) — contrato do sistema de RAIO em tiers.
// Regressão que o operador apontou: os boxes de texto estavam MAIS redondos que o
// container (input rounded-xl=36px > card 20px). A regra do tier system é:
// container (rounded-lg) sempre mais macio que seu conteúdo (input rounded-sm);
// só o botão/CTA é pill (rounded-full). Este teste trava essa relação.
//
// Mapa de tiers (apex.tokens.json → @theme): sm=8 · md=12 · lg=16 · xl=24 · pill=999.

const radiusClassOf = (el: Element) =>
  Array.from(el.classList).find((c) => c.startsWith('rounded-')) ?? ''

describe('R1 — sistema de raio em tiers', () => {
  it('input usa rounded-sm (mais apertado que o container)', () => {
    const { container } = render(<Input placeholder="x" />)
    expect(radiusClassOf(container.querySelector('input')!)).toBe('rounded-sm')
  })

  it('textarea e select também usam rounded-sm', () => {
    const ta = render(<Textarea placeholder="x" />)
    expect(radiusClassOf(ta.container.querySelector('textarea')!)).toBe('rounded-sm')
    const sel = render(<Select><option>a</option></Select>)
    expect(radiusClassOf(sel.container.querySelector('select')!)).toBe('rounded-sm')
  })

  it('card usa rounded-lg (container, mais macio que o input)', () => {
    const { container } = render(<Card>conteúdo</Card>)
    expect(radiusClassOf(container.firstElementChild!)).toBe('rounded-lg')
  })

  it('o container NÃO é mais redondo que o input (corrige o bug R1)', () => {
    // ordem do tier: sm(8) < md(12) < lg(16) < xl(24) < pill/full(999)
    const order = ['rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-xl', 'rounded-full']
    const card = render(<Card>x</Card>).container.firstElementChild!
    const input = render(<Input placeholder="x" />).container.querySelector('input')!
    expect(order.indexOf(radiusClassOf(card))).toBeGreaterThan(
      order.indexOf(radiusClassOf(input)),
    )
  })

  it('só o botão é oval (rounded-full / pill)', () => {
    const { container } = render(<Button>Salvar</Button>)
    expect(radiusClassOf(container.querySelector('button')!)).toBe('rounded-full')
  })

  it('skeleton acompanha o tier de conteúdo (rounded-sm)', () => {
    const { container } = render(<Skeleton />)
    expect(radiusClassOf(container.firstElementChild!)).toBe('rounded-sm')
  })
})

describe('R1 — variante danger é vermelha (não cinza-ghost)', () => {
  it('Button danger usa o token de fundo danger-solid', () => {
    const { container } = render(<Button variant="danger">Excluir</Button>)
    const cls = container.querySelector('button')!.className
    expect(cls).toContain('bg-danger-solid')
    expect(cls).not.toContain('text-ink/65') // o cinza-ghost antigo
  })
})

// R1 (Atomic Design) — SelectableCard é a molécula ÚNICA de card-radio (antes duplicada
// em create + template-gallery x2). Trava a a11y e o comportamento de seleção num ponto só.
describe('R1 — SelectableCard (molécula reusada)', () => {
  it('expõe role=radio + aria-checked refletindo a seleção', () => {
    render(<SelectableCard selected onSelect={() => {}} ariaLabel="Carrossel">x</SelectableCard>)
    const radio = screen.getByRole('radio')
    expect(radio).toHaveAttribute('aria-checked', 'true')
    expect(radio).toHaveAttribute('aria-label', 'Carrossel')
  })

  it('chama onSelect ao clicar', () => {
    let clicked = false
    render(<SelectableCard selected={false} onSelect={() => { clicked = true }}>y</SelectableCard>)
    fireEvent.click(screen.getByRole('radio'))
    expect(clicked).toBe(true)
  })

  it('o card usa o tier de container (rounded-lg), não um raio órfão', () => {
    const { container } = render(<SelectableCard selected={false} onSelect={() => {}}>z</SelectableCard>)
    // o <button> herda o tier de container; o <Card> interno é rounded-lg
    expect(radiusClassOf(container.querySelector('button')!)).toBe('rounded-lg')
  })

  it('CheckCircle preenche (bg-ink) quando selecionado e fica vazio quando não', () => {
    const on = render(<CheckCircle selected icon={<span>✓</span>} />)
    expect(on.container.firstElementChild!.className).toContain('bg-ink')
    const off = render(<CheckCircle selected={false} icon={<span>✓</span>} />)
    expect(off.container.firstElementChild!.className).toContain('text-transparent')
  })
})
