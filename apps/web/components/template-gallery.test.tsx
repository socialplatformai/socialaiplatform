import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TemplateGallery } from './template-gallery'
import type { Template } from '@/lib/templates'
import type { BrandKit } from '@/lib/brand'

// F6/B1+B2+B3 — galeria de template no wizard: preview na marca (mock via <SlideCanvas>),
// recomendação por objetivo (recommendedFor × objetivo da pauta), e seleção controlada.

const TEMPLATES: Template[] = [
  {
    id: 't1', key: 'product-launch', name: 'Product Launch', description: 'PAS p/ conversão',
    builtIn: true, slideCount: 8, bestFor: ['lançamentos'], recommendedFor: ['conversion', 'awareness'],
  },
  {
    id: 't2', key: 'educational', name: 'Educational', description: 'Ensina antes de vender',
    builtIn: true, slideCount: 6, bestFor: ['tutoriais'], recommendedFor: ['education'],
  },
]

const KIT = { primaryColorHex: '#123456', accentColorHex: '#abcdef' } as BrandKit

describe('TemplateGallery (F6/B1-B3)', () => {
  it('mostra os templates com nome, nº de slides e a opção "deixar a IA escolher"', () => {
    render(<TemplateGallery templates={TEMPLATES} kit={KIT} selectedId={null} onSelect={() => {}} />)
    // CUS/templates-SOTA: o nome renderiza em PT-BR (pela key), não o `name` em inglês da fonte.
    // Aparece 2× por card (título + headline do preview na marca via SlideCanvas) — getAllByText.
    expect(screen.getAllByText('Lançamento de produto').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Educativo / Tutorial').length).toBeGreaterThanOrEqual(1)
    // O nome em inglês da fonte NÃO deve vazar pra UI.
    expect(screen.queryByText('Product Launch')).not.toBeInTheDocument()
    expect(screen.getByText('Deixar a IA escolher')).toBeInTheDocument()
    // preview na marca: o subheadline do mock mostra o nº de slides (renderizado pelo SlideCanvas).
    expect(screen.getAllByText('8 slides').length).toBeGreaterThan(0)
  })

  it('B3: marca "Recomendado" o template cujo recommendedFor casa com o objetivo da pauta', () => {
    render(
      <TemplateGallery templates={TEMPLATES} kit={KIT} objective="conversion" selectedId={null} onSelect={() => {}} />,
    )
    // product-launch tem recommendedFor=['conversion',...] → ganha o selo; educational não.
    expect(screen.getByText(/Recomendado para/)).toBeInTheDocument()
    expect(screen.getByText(/Conversão/)).toBeInTheDocument()
  })

  it('sem objetivo → nenhum selo de recomendação', () => {
    render(<TemplateGallery templates={TEMPLATES} kit={KIT} selectedId={null} onSelect={() => {}} />)
    expect(screen.queryByText(/Recomendado para/)).not.toBeInTheDocument()
  })

  it('seleção: clicar num template chama onSelect com a key; "IA escolhe" chama com null', () => {
    const onSelect = vi.fn()
    render(<TemplateGallery templates={TEMPLATES} kit={KIT} selectedId={null} onSelect={onSelect} />)

    // radios na ordem: [0]=IA escolhe, [1]=product-launch (t1), [2]=educational (t2).
    const radios = screen.getAllByRole('radio')
    fireEvent.click(radios[1])
    expect(onSelect).toHaveBeenCalledWith('t1')

    fireEvent.click(radios[0])
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('o selecionado fica com aria-checked=true (radio)', () => {
    render(<TemplateGallery templates={TEMPLATES} kit={KIT} selectedId="t2" onSelect={() => {}} />)
    const radios = screen.getAllByRole('radio')
    const checked = radios.filter((r) => r.getAttribute('aria-checked') === 'true')
    expect(checked).toHaveLength(1)
  })

  it('preview na marca: marca de cor CLARA → headline com texto ESCURO (contraste, não branco-no-branco)', () => {
    // Marca com primária quase-branca: o mock deve usar texto escuro p/ o nome do template ser legível.
    const lightKit = { primaryColorHex: '#FAFAF5', accentColorHex: '#111111' } as BrandKit
    render(<TemplateGallery templates={[TEMPLATES[0]]} kit={lightKit} selectedId={null} onSelect={() => {}} />)
    // O headline do preview é o nome (PT-BR) do template; pega o nó renderizado pelo SlideCanvas.
    const nodes = screen.getAllByText('Lançamento de produto')
    const headline = nodes.find((n) => {
      const c = (n as HTMLElement).style.color
      return c && c !== ''
    }) as HTMLElement | undefined
    expect(headline).toBeTruthy()
    // cor escura (#1A1A1A...) — NÃO branco. jsdom normaliza hex → rgb; aceitamos qualquer não-branco escuro.
    const color = headline!.style.color.toLowerCase()
    expect(color).not.toContain('255, 255, 255')
    expect(color).not.toBe('#ffffff')
  })

  it('CUS/SOTA: renderiza a faixa de JORNADA (estrutura) quando a API entrega journey', () => {
    const withJourney: Template[] = [{
      ...TEMPLATES[0],
      journey: ['cover', 'problem', 'solution', 'social-proof', 'cta'],
    }]
    render(<TemplateGallery templates={withJourney} kit={KIT} selectedId={null} onSelect={() => {}} />)
    // As etapas aparecem em PT-BR como chips (capa→problema→solução→prova→cta).
    expect(screen.getByText('Estrutura')).toBeInTheDocument()
    expect(screen.getByText('Capa')).toBeInTheDocument()
    expect(screen.getByText('Problema')).toBeInTheDocument()
    expect(screen.getByText('CTA')).toBeInTheDocument()
  })

  it('CUS/SOTA: sem journey (API antiga) → faixa some, card continua útil (degrada honesto)', () => {
    render(<TemplateGallery templates={TEMPLATES} kit={KIT} selectedId={null} onSelect={() => {}} />)
    expect(screen.queryByText('Estrutura')).not.toBeInTheDocument()
  })

  it('CUS/persona P1: renderiza "Use quando" com o 1º bestFor (exemplo concreto pro leigo)', () => {
    render(<TemplateGallery templates={TEMPLATES} kit={KIT} selectedId={null} onSelect={() => {}} />)
    // bestFor[0] do product-launch no fixture = 'lançamentos'; aparece como exemplo "Use quando".
    expect(screen.getAllByText(/Use quando:/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('lançamentos')).toBeInTheDocument()
  })

  it('sem kit (marca degradada) → não quebra e ainda mostra os templates', () => {
    render(<TemplateGallery templates={TEMPLATES} kit={undefined} selectedId={null} onSelect={() => {}} />)
    expect(screen.getAllByText('Lançamento de produto').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Deixar a IA escolher')).toBeInTheDocument()
  })
})
