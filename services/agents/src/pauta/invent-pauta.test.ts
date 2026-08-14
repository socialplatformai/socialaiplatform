import { describe, it, expect } from 'vitest'
import { normalize } from './invent-pauta.js'

// O `normalize` é a garantia de que a saída do LLM NUNCA vira pauta quebrada no worker:
// campos vazios/inválidos caem em defaults seguros; título vazio é falha honesta (não gera lixo).
describe('normalize (inventor de pauta)', () => {
  it('preenche defaults seguros quando o modelo devolve só o título', () => {
    const out = normalize({ title: 'Dica rápida de organização' })
    expect(out.title).toBe('Dica rápida de organização')
    expect(out.objective).toBeTruthy()
    expect(out.context).toBe('Dica rápida de organização') // fallback = título
    expect(out.category).toBe('geral')
    expect(out.marketingObjective).toBe('awareness')
    expect(out.suggestedType).toBe('post')
    expect(out.rationale).toBeTruthy()
  })

  it('lança erro (não gera lixo) quando falta título', () => {
    expect(() => normalize({ objective: 'x' })).toThrow(/título/)
    expect(() => normalize({ title: '   ' })).toThrow(/título/)
  })

  it('respeita o formato preferido do operador sobre o suggestedType do modelo', () => {
    const out = normalize({ title: 'T', suggestedType: 'carousel' }, 'story')
    expect(out.suggestedType).toBe('story')
  })

  it('cai em post quando o formato do modelo é inválido', () => {
    const out = normalize({ title: 'T', suggestedType: 'reels' as never })
    expect(out.suggestedType).toBe('post')
  })

  it('normaliza marketingObjective inválido para awareness', () => {
    const out = normalize({ title: 'T', marketingObjective: 'viral' as never })
    expect(out.marketingObjective).toBe('awareness')
  })

  it('preserva valores válidos do modelo', () => {
    const out = normalize({
      title: 'Bastidores da produção',
      objective: 'Mostrar o processo artesanal',
      context: 'Vídeo curto dos bastidores; tom acolhedor; foco no cuidado com o produto.',
      category: 'bastidores',
      marketingObjective: 'consideration',
      suggestedType: 'carousel',
      rationale: 'Fiel ao tom artesanal da marca',
    })
    expect(out.marketingObjective).toBe('consideration')
    expect(out.suggestedType).toBe('carousel')
    expect(out.category).toBe('bastidores')
  })
})
