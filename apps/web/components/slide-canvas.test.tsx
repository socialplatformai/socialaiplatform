import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { SlideCanvas, SlideCarousel } from './slide-canvas'
import type { ContentSlide } from '@/lib/content'

// F2 (ADR-0014) — <SlideCanvas>: render WYSIWYG por composição de camadas (role-based).
// Gate §6: 0 elementos fora do canvas em 50 render → garantido por construção (frame overflow-hidden).

const IMG = 'data:image/jpeg;base64,/9j/AAAA'

function slide(partial: Partial<ContentSlide>): ContentSlide {
  return { index: 0, copy: null, imageUrl: null, ...partial }
}

describe('SlideCanvas — composição por camadas', () => {
  it('renderiza os elementos de texto por papel (headline/body/caption)', () => {
    const s = slide({
      layers: {
        elements: [
          { type: 'text', role: 'headline', content: 'Título Forte', style: { color: '#fff' } },
          { type: 'text', role: 'body', content: 'Corpo do slide', style: { color: '#ccc' } },
          { type: 'text', role: 'caption', content: 'rodapé', style: {} },
          { type: 'image', role: 'background', content: IMG, style: { objectFit: 'cover' } },
        ],
      },
    })
    render(<SlideCanvas slide={s} />)
    expect(screen.getByText('Título Forte')).toBeInTheDocument()
    expect(screen.getByText('Corpo do slide')).toBeInTheDocument()
    expect(screen.getByText('rodapé')).toBeInTheDocument()
  })

  it('o frame tem overflow-hidden (containment — 0 elementos fora do canvas, gate §6)', () => {
    const s = slide({ layers: { elements: [{ type: 'text', role: 'headline', content: 'H', style: {} }] } })
    const { container } = render(<SlideCanvas slide={s} />)
    const frame = container.firstElementChild as HTMLElement
    expect(frame.className).toContain('overflow-hidden')
    expect(frame.className).toContain('aspect-[4/5]') // proporção 1080×1350
  })

  it('aplica a imagem de fundo (role=background) como backgroundImage', () => {
    const s = slide({ layers: { elements: [{ type: 'image', role: 'background', content: IMG, style: {} }] } })
    const { container } = render(<SlideCanvas slide={s} />)
    const frame = container.firstElementChild as HTMLElement
    expect(frame.style.backgroundImage).toContain('data:image/jpeg')
    // com imagem, o frame é anunciado como img p/ leitores de tela (a11y)
    expect(frame.getAttribute('role')).toBe('img')
  })

  it('fallback: sem layers, usa imageUrl + copy bruta (preview antigo preservado)', () => {
    const s = slide({ imageUrl: IMG, copy: 'copy de fallback' })
    render(<SlideCanvas slide={s} />)
    expect(screen.getByText('copy de fallback')).toBeInTheDocument()
  })

  it('sem imagem nem layers: não quebra, mostra a copy sobre fundo neutro', () => {
    const s = slide({ copy: 'só texto' })
    const { container } = render(<SlideCanvas slide={s} />)
    expect(screen.getByText('só texto')).toBeInTheDocument()
    const frame = container.firstElementChild as HTMLElement
    expect(frame.getAttribute('role')).toBeNull() // sem imagem → não é role=img
  })
})

describe('SlideCarousel — navegação', () => {
  it('mostra o contador N/total e o 1º slide', () => {
    const slides = [
      slide({ index: 0, layers: { elements: [{ type: 'text', role: 'headline', content: 'S1', style: {} }] } }),
      slide({ index: 1, layers: { elements: [{ type: 'text', role: 'headline', content: 'S2', style: {} }] } }),
    ]
    render(<SlideCarousel slides={slides} />)
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    // "S1" aparece no slide principal E na sua miniatura (faixa de thumbs) → ≥1 ocorrência.
    expect(screen.getAllByText('S1').length).toBeGreaterThanOrEqual(1)
  })

  it('faixa de miniaturas: 1 thumb por slide, navega ao clicar (índice controlado)', () => {
    const slides = [
      slide({ index: 0, layers: { elements: [{ type: 'text', role: 'headline', content: 'S1', style: {} }] } }),
      slide({ index: 1, layers: { elements: [{ type: 'text', role: 'headline', content: 'S2', style: {} }] } }),
    ]
    // role=tablist com 1 tab/slide; clicar a 2ª miniatura emite onIndex(1).
    const onIndex = vi.fn()
    render(<SlideCarousel slides={slides} index={0} onIndex={onIndex} />)
    const thumbs = screen.getByRole('tablist', { name: 'Slides do carrossel' })
    const tabs = within(thumbs).getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    fireEvent.click(tabs[1])
    expect(onIndex).toHaveBeenCalledWith(1)
  })

  it('lista vazia: estado vazio, não quebra', () => {
    render(<SlideCarousel slides={[]} />)
    expect(screen.getByText('Sem slides.')).toBeInTheDocument()
  })
})
