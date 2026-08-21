import { describe, it, expect } from 'vitest'
import { NAV_AREAS, activeArea, activeChildren, ROUTE_REDIRECTS } from './navigation'

// R2 — contrato da arquitetura de informação. Trava: ≤6 áreas, ordem do funil,
// 0 destino órfão (toda rota do app cai numa área), active-state correto.

// Todas as rotas (app) existentes — a verdade do repo no momento de R2.
const ALL_ROUTES = [
  '/dashboard',
  '/pautas', '/ideas', '/create', '/content/abc', '/content/compare',
  '/approvals', '/calendar',
  '/publishing',
  '/insights', '/history',
  '/brand',
  '/settings/brands', '/settings/instagram', '/settings/ai', '/settings/prompts',
  '/settings/approval', '/settings/usage', '/settings/workspace', '/settings/users',
  '/settings/audit', '/admin/database',
]

describe('R2 — espinha de ≤6 áreas (Hick/Miller)', () => {
  it('tem no máximo 6 áreas', () => {
    expect(NAV_AREAS.length).toBeLessThanOrEqual(6)
  })

  it('as áreas estão na ordem do funil (stage crescente, sem repetir)', () => {
    const stages = NAV_AREAS.map((a) => a.stage)
    const sorted = [...stages].sort((x, y) => x - y)
    expect(stages).toEqual(sorted)
    expect(new Set(stages).size).toBe(stages.length)
  })

  it('cada área tem id, label PT-BR, href e ícone', () => {
    for (const a of NAV_AREAS) {
      expect(a.id).toBeTruthy()
      expect(a.label).toBeTruthy()
      expect(a.href.startsWith('/')).toBe(true)
      expect(a.icon.startsWith('Icon')).toBe(true)
    }
  })
})

describe('R2 — 0 destino órfão (toda rota cai numa área)', () => {
  it.each(ALL_ROUTES)('rota %s resolve para uma área', (route) => {
    const area = activeArea(route)
    expect(area, `rota órfã: ${route}`).toBeDefined()
  })

  it('rotas de settings caem em Marca & Ajustes (não roubadas por /content)', () => {
    expect(activeArea('/settings/ai')?.id).toBe('ajustes')
    expect(activeArea('/settings/audit')?.id).toBe('ajustes')
  })

  it('/content/[id] cai em Conteúdo (não em outra área por prefixo)', () => {
    expect(activeArea('/content/xyz')?.id).toBe('conteudo')
  })

  it('/calendar cai em Revisão & Agenda (preservado como sub-view)', () => {
    expect(activeArea('/calendar')?.id).toBe('revisao')
    expect(activeChildren('/calendar').some((c) => c.href === '/calendar')).toBe(true)
  })

  it('NÃO casa por prefixo cru: /brandzilla, /createx, /insights-pro não roubam área (bug latente)', () => {
    // match por SEGMENTO (=== ou prefixo + "/"), não startsWith cru.
    expect(activeArea('/brandzilla')).toBeUndefined()
    expect(activeArea('/createx')).toBeUndefined()
    expect(activeArea('/insights-pro')).toBeUndefined()
    expect(activeArea('/publishing-settings')).toBeUndefined()
    // mas a rota real e suas filhas continuam casando:
    expect(activeArea('/brand')?.id).toBe('ajustes')
    expect(activeArea('/create')?.id).toBe('conteudo')
    expect(activeArea('/content/abc/edit')?.id).toBe('conteudo')
  })
})

describe('R2 — sub-nav contextual', () => {
  it('Conteúdo expõe Pautas/Ideias/Gerar como sub-rotas', () => {
    const kids = activeChildren('/pautas').map((c) => c.href)
    expect(kids).toEqual(expect.arrayContaining(['/pautas', '/ideas', '/create']))
  })

  it('Início não tem sub-nav (área simples)', () => {
    expect(activeChildren('/dashboard')).toEqual([])
  })
})

describe('R2 — tabela de redirect (contrato anti-quebra-silenciosa)', () => {
  it('existe e é um mapa (vazia por design: rotas não foram movidas, só reagrupadas)', () => {
    expect(typeof ROUTE_REDIRECTS).toBe('object')
    // se uma fase mover uma rota, este teste documenta que o redirect deve ser registrado
    for (const [from, to] of Object.entries(ROUTE_REDIRECTS)) {
      expect(from.startsWith('/')).toBe(true)
      expect(to.startsWith('/')).toBe(true)
    }
  })
})
