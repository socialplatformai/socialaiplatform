import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Field, Input, Textarea, Select } from './ui'

// E9.3 — a11y de campos: todo controle de formulário deve ter id associado ao
// label (htmlFor) do seu Field. O Field gera e propaga o id automaticamente.

describe('Field (auto-associação id↔label)', () => {
  it('associa label↔input mesmo sem id/htmlFor explícitos', () => {
    render(
      <Field label="Título">
        <Input placeholder="x" />
      </Field>,
    )
    // getByLabelText só acha se o <label htmlFor> casar com o id do <input>.
    const input = screen.getByLabelText('Título')
    expect(input).toBeInstanceOf(HTMLInputElement)
    expect(input.id).toBeTruthy()
  })

  it('funciona para Textarea e Select também', () => {
    render(
      <>
        <Field label="Objetivo">
          <Textarea placeholder="y" />
        </Field>
        <Field label="Prioridade">
          <Select>
            <option value="1">Alta</option>
          </Select>
        </Field>
      </>,
    )
    expect(screen.getByLabelText('Objetivo')).toBeInstanceOf(HTMLTextAreaElement)
    expect(screen.getByLabelText('Prioridade')).toBeInstanceOf(HTMLSelectElement)
  })

  it('propaga aria-describedby apontando para a dica', () => {
    render(
      <Field label="Anexo" hint="Print, depoimento, referência.">
        <Input placeholder="url" />
      </Field>,
    )
    const input = screen.getByLabelText('Anexo')
    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    const msg = document.getElementById(describedBy!)
    expect(msg).toHaveTextContent('Print, depoimento, referência.')
  })

  it('propaga aria-describedby apontando para o erro quando há erro', () => {
    render(
      <Field label="Título" hint="dica" error="Campo obrigatório.">
        <Input placeholder="z" />
      </Field>,
    )
    const input = screen.getByLabelText('Título')
    const describedBy = input.getAttribute('aria-describedby')
    const msg = document.getElementById(describedBy!)
    expect(msg).toHaveAttribute('role', 'alert')
    expect(msg).toHaveTextContent('Campo obrigatório.')
  })

  it('respeita id explícito do filho (escape hatch) e casa o label', () => {
    render(
      <Field label="Slide 1" htmlFor="slide-0">
        <Textarea id="slide-0" placeholder="copy" />
      </Field>,
    )
    const ta = screen.getByLabelText('Slide 1')
    expect(ta.id).toBe('slide-0')
  })

  it('gera ids ÚNICOS quando o mesmo Field é repetido em lista', () => {
    render(
      <>
        {['a', 'b', 'c'].map((k) => (
          <Field key={k} label="Item">
            <Input placeholder="i" />
          </Field>
        ))}
      </>,
    )
    const inputs = screen.getAllByLabelText('Item')
    const ids = inputs.map((el) => el.id)
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3) // todos distintos
  })

  it('não quebra com múltiplos filhos: injeta id só no controle, ignora o <p>', () => {
    render(
      <Field label="Tema">
        <Textarea placeholder="t" />
        <p>Texto de ajuda inline</p>
      </Field>,
    )
    const ta = screen.getByLabelText('Tema')
    expect(ta).toBeInstanceOf(HTMLTextAreaElement)
    expect(screen.getByText('Texto de ajuda inline')).toBeInTheDocument()
  })
})
