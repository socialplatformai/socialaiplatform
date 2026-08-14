import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Field, Input } from './ui'

// Fundação de QA (E0.2) — base dos testes de UX guiada (E9).
// Testamos semântica/a11y das primitivas, não estilo Tailwind.

describe('Field', () => {
  it('renderiza o label associado ao controle', () => {
    render(
      <Field label="Nome da marca" htmlFor="brand-name">
        <Input id="brand-name" />
      </Field>,
    )
    expect(screen.getByText('Nome da marca')).toBeInTheDocument()
    // label[htmlFor] aponta para o input com mesmo id (a11y)
    expect(screen.getByLabelText('Nome da marca')).toBeInTheDocument()
  })

  it('mostra a dica (hint) quando não há erro', () => {
    render(
      <Field label="Tom" hint="Ex.: acolhedor, direto">
        <Input />
      </Field>,
    )
    expect(screen.getByText('Ex.: acolhedor, direto')).toBeInTheDocument()
  })

  it('mostra o erro com role=alert e oculta a dica', () => {
    render(
      <Field label="Tom" hint="Ex.: acolhedor, direto" error="Campo obrigatório">
        <Input />
      </Field>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Campo obrigatório')
    expect(screen.queryByText('Ex.: acolhedor, direto')).not.toBeInTheDocument()
  })
})

describe('Input', () => {
  it('renderiza o placeholder', () => {
    render(<Input placeholder="@minha_marca" />)
    expect(screen.getByPlaceholderText('@minha_marca')).toBeInTheDocument()
  })

  it('marca aria-invalid quando error é true', () => {
    render(<Input placeholder="x" error />)
    expect(screen.getByPlaceholderText('x')).toHaveAttribute('aria-invalid', 'true')
  })

  it('não marca aria-invalid quando não há erro', () => {
    render(<Input placeholder="y" />)
    expect(screen.getByPlaceholderText('y')).not.toHaveAttribute('aria-invalid')
  })
})
