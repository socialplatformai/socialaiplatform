import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SlideEditor } from './slide-editor'
import type { ContentSlide } from '@/lib/content'

// F3 (ADR-0014) — Editor visual: edita camadas e devolve os slides ao salvar (round-trip → gate F3).

function slide(p: Partial<ContentSlide>): ContentSlide {
  return { index: 0, copy: null, imageUrl: null, ...p }
}

const baseSlides: ContentSlide[] = [
  slide({
    index: 0,
    layers: {
      anchorY: 'bottom',
      elements: [
        { type: 'text', role: 'headline', content: 'Título original', style: { color: '#fff' } },
        { type: 'text', role: 'body', content: 'Corpo original', style: { color: '#ccc' } },
        { type: 'image', role: 'background', content: 'data:image/jpeg;base64,AAA', style: { objectFit: 'cover' } },
      ],
    },
  }),
]

describe('SlideEditor — round-trip de edição', () => {
  it('edita o texto de um papel e devolve no onSave', () => {
    const onSave = vi.fn()
    render(<SlideEditor slides={baseSlides} onSave={onSave} />)

    const headlineBox = screen.getByDisplayValue('Título original')
    fireEvent.change(headlineBox, { target: { value: 'Título editado' } })

    fireEvent.click(screen.getByText('Salvar slide'))
    expect(onSave).toHaveBeenCalledTimes(1)
    const saved = onSave.mock.calls[0][0] as ContentSlide[]
    const headline = saved[0].layers!.elements!.find((e) => e.role === 'headline')
    expect(headline!.content).toBe('Título editado')
  })

  it('muda a âncora vertical do texto (posição) e persiste em layers.anchorY', () => {
    const onSave = vi.fn()
    render(<SlideEditor slides={baseSlides} onSave={onSave} />)
    fireEvent.click(screen.getByText('Topo'))
    fireEvent.click(screen.getByText('Salvar slide'))
    const saved = onSave.mock.calls[0][0] as ContentSlide[]
    expect((saved[0].layers as { anchorY?: string }).anchorY).toBe('top')
  })

  it('botão Salvar fica desabilitado quando nada mudou (sem dirty)', () => {
    render(<SlideEditor slides={baseSlides} onSave={vi.fn()} />)
    const btn = screen.getByText('Salvar slide') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('Descartar reverte as edições ao estado inicial', () => {
    render(<SlideEditor slides={baseSlides} onSave={vi.fn()} />)
    fireEvent.change(screen.getByDisplayValue('Título original'), { target: { value: 'mudou' } })
    expect(screen.getByText('Descartar')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Descartar'))
    // voltou ao original → o input mostra o valor inicial de novo
    expect(screen.getByDisplayValue('Título original')).toBeInTheDocument()
  })
})

// G4 (A/B barato) — as alternativas que a IA já gera (headline/cta) aparecem como chips no papel
// correspondente; clicar pré-preenche o campo (sem regenerar). Trava o affordance E o degradado.
describe('SlideEditor — alternativas A/B (G4)', () => {
  const alternatives = { headlines: ['Título ousado', 'Título direto'], ctas: ['Comece agora'] }

  it('aplicar uma alternativa de headline pré-preenche o campo e entra no onSave', () => {
    const onSave = vi.fn()
    render(<SlideEditor slides={baseSlides} onSave={onSave} alternatives={alternatives} />)

    // a faixa de troca aparece e oferece a opção; o nome acessível é "Usar como título: {opt}".
    fireEvent.click(screen.getByRole('button', { name: 'Usar como título: Título ousado' }))
    expect(screen.getByDisplayValue('Título ousado')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Salvar slide'))
    const saved = onSave.mock.calls[0][0] as ContentSlide[]
    const headline = saved[0].layers!.elements!.find((e) => e.role === 'headline')
    expect(headline!.content).toBe('Título ousado')
  })

  it('a opção em uso é perceptível ao leitor de tela (aria-disabled + aria-pressed + nome explícito)', () => {
    const slides: ContentSlide[] = [
      slide({
        index: 0,
        layers: { elements: [{ type: 'text', role: 'headline', content: 'Título ousado' }] },
      }),
    ]
    render(<SlideEditor slides={slides} onSave={vi.fn()} alternatives={alternatives} />)
    // QA a11y (HIG): NÃO usar `disabled` (sairia da ordem de foco, escondendo o estado do teclado/
    // leitor). aria-disabled mantém focável + anunciável; nome acessível diz "(em uso)".
    const inUse = screen.getByRole('button', { name: 'Título ousado (em uso)' }) as HTMLButtonElement
    expect(inUse.getAttribute('aria-disabled')).toBe('true')
    expect(inUse.getAttribute('aria-pressed')).toBe('true')
    expect(inUse.disabled).toBe(false) // focável de propósito
  })

  it('clicar na opção JÁ em uso NÃO altera o campo (guard real, não só estilo)', () => {
    const onSave = vi.fn()
    const slides: ContentSlide[] = [
      slide({
        index: 0,
        layers: { elements: [{ type: 'text', role: 'headline', content: 'Título ousado' }] },
      }),
    ]
    render(<SlideEditor slides={slides} onSave={onSave} alternatives={alternatives} />)
    const inUse = screen.getByRole('button', { name: 'Título ousado (em uso)' })
    fireEvent.click(inUse)
    // o onClick é no-op p/ inUse → nada muda → Salvar segue desabilitado (sem dirty).
    const salvar = screen.getByText('Salvar slide') as HTMLButtonElement
    expect(salvar.disabled).toBe(true)
  })

  it('sem alternatives → a faixa de troca não aparece (degradado honesto)', () => {
    render(<SlideEditor slides={baseSlides} onSave={vi.fn()} />)
    // o rótulo diz o JOB ("Trocar título…"), não a origem
    expect(screen.queryByText(/Trocar título por uma opção/)).not.toBeInTheDocument()
  })

  it('alternatives só de headline → o papel body não ganha faixa (per-papel)', () => {
    render(<SlideEditor slides={baseSlides} onSave={vi.fn()} alternatives={{ headlines: ['X'], ctas: [] }} />)
    // só 1 faixa (no headline); o body não tem opções
    expect(screen.getAllByText(/Trocar título por uma opção/)).toHaveLength(1)
  })

  it('o papel CTA recebe microcopy de botão ("Trocar botão…"), não de título', () => {
    const slides: ContentSlide[] = [
      slide({ index: 0, layers: { elements: [{ type: 'text', role: 'cta', content: 'Saiba mais' }] } }),
    ]
    render(<SlideEditor slides={slides} onSave={vi.fn()} alternatives={alternatives} />)
    expect(screen.getByText(/Trocar botão por uma opção/)).toBeInTheDocument()
    expect(screen.queryByText(/Trocar título/)).not.toBeInTheDocument()
  })
})
