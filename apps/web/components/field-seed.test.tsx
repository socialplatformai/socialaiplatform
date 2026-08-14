import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { Field, FieldSeed, Input } from './ui'

// E9.2 — exemplo-semente removível. "Usar exemplo" preenche o controle; o
// exemplo NUNCA é enviado se intocado; "limpar" esvazia.

const EXEMPLO = '5 erros que sabotam o engajamento'

// Harness mínimo espelhando o uso real (Nova Pauta): state controla o Input;
// onSubmit recebe o valor atual; FieldSeed só altera o state ao clicar.
function Harness({ onSubmit }: { onSubmit: (value: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <div>
      <Field label="Título">
        <Input placeholder={EXEMPLO} value={value} onChange={(e) => setValue(e.target.value)} />
        <FieldSeed
          value={value}
          example={EXEMPLO}
          onUse={(ex) => setValue(ex)}
          onClear={() => setValue('')}
        />
      </Field>
      <button onClick={() => onSubmit(value)}>Salvar</button>
    </div>
  )
}

describe('FieldSeed', () => {
  it('"usar exemplo" copia o texto do exemplo para o input', () => {
    render(<Harness onSubmit={() => {}} />)
    const input = screen.getByLabelText('Título') as HTMLInputElement
    expect(input.value).toBe('') // começa vazio (exemplo é só placeholder)
    fireEvent.click(screen.getByRole('button', { name: 'Usar exemplo' }))
    expect(input.value).toBe(EXEMPLO)
  })

  it('NÃO polui o submit: intocado, envia vazio (não o texto do exemplo)', () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    // Submete sem tocar no campo.
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(onSubmit).toHaveBeenCalledWith('') // vazio, jamais o exemplo
  })

  it('"limpar" aparece só quando há valor e esvazia o campo', () => {
    render(<Harness onSubmit={() => {}} />)
    // Sem valor: não há botão "limpar".
    expect(screen.queryByRole('button', { name: 'Limpar' })).not.toBeInTheDocument()
    // Após usar o exemplo, "limpar" aparece e funciona.
    fireEvent.click(screen.getByRole('button', { name: 'Usar exemplo' }))
    const input = screen.getByLabelText('Título') as HTMLInputElement
    expect(input.value).toBe(EXEMPLO)
    fireEvent.click(screen.getByRole('button', { name: 'Limpar' }))
    expect(input.value).toBe('')
  })

  it('botões são type=button (não disparam submit de formulário)', () => {
    render(<Harness onSubmit={() => {}} />)
    expect(screen.getByRole('button', { name: 'Usar exemplo' })).toHaveAttribute('type', 'button')
  })
})
