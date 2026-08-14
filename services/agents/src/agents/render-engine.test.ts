import { describe, it, expect } from 'vitest'
import { RenderEngine } from './render-engine.js'
import type { VisualSpecification } from '@/types/pipeline'
import { compileBrandDesignSpec } from '../brand/design-spec.js'
import type { BrandConfigForPipeline } from '@/types/pipeline'

// ADR-0012 PR2 — render brand-aware. ESTA é a primeira rede do render-engine (que tinha
// cobertura ZERO). Dois eixos:
//  (1) AC4 — render() SEM designSpec é byte-idêntico ao baseline (fallback Figma preservado).
//  (2) AC5/AC6 — render() COM designSpec emite --bd-* no :root e os templates resolvem para as
//      cores da marca via var(--bd-X, FIGMA).

const engine = new RenderEngine()

/** Um VisualSpecification mínimo cobrindo os 3 layouts (cover/body/last). */
function makeVisual(): VisualSpecification {
  return {
    slides: [
      {
        index: 1,
        layoutId: 'branding-os-cover-v1',
        canvas: { width: 1080, height: 1350 },
        background: { type: 'solid', value: '#000000' },
        elements: [
          { type: 'text', role: 'headline', content: 'Título', style: {}, position: { x: 0, y: 0, width: 920, height: 'auto' } },
          { type: 'text', role: 'subheadline', content: 'Sub', style: {}, position: { x: 0, y: 0, width: 920, height: 'auto' } },
        ],
      },
      {
        index: 2,
        layoutId: 'branding-os-body-v1',
        canvas: { width: 1080, height: 1350 },
        background: { type: 'solid', value: '#000000' },
        elements: [
          { type: 'text', role: 'headline', content: 'Corpo', style: {}, position: { x: 0, y: 0, width: 770, height: 'auto' } },
          { type: 'text', role: 'body', content: 'Texto', style: {}, position: { x: 0, y: 0, width: 770, height: 'auto' } },
        ],
      },
      {
        index: 3,
        layoutId: 'branding-os-last-v1',
        canvas: { width: 1080, height: 1350 },
        background: { type: 'solid', value: '#FFD44A' },
        elements: [
          { type: 'text', role: 'headline', content: 'Final', style: {}, position: { x: 0, y: 0, width: 770, height: 'auto' } },
          { type: 'text', role: 'body', content: 'CTA', style: {}, position: { x: 0, y: 0, width: 770, height: 'auto' } },
        ],
      },
    ],
    tokens: {
      colors: { background: '#1A1A1A', text: '#FFFFFF', accent: '#C9B298' },
      fonts: { heading: 'Inter', body: 'Source Serif 4' },
      spacing: { margin: 80 },
    },
  }
}

function brandConfig(bg: string, accent: string): BrandConfigForPipeline {
  return {
    handle: '@m',
    visualIdentity: {
      logo: { url: null },
      colors: {
        primary: { hex: '#112233', name: 'P' },
        secondary: { hex: '#445566', name: 'S' },
        accent: { hex: accent, name: 'A' },
        background: { hex: bg, name: 'B' },
        text: { hex: '#FFFFFF', name: 'T' },
      },
      typography: { heading: { family: 'Satoshi', weights: [700] }, body: { family: 'Satoshi', weights: [400] } },
    },
    voice: { attributes: [], toneGuidelines: [], copyExamples: [] },
    examples: [],
  }
}

describe('RenderEngine — não-regressão sem designSpec (AC4)', () => {
  it('render() sem designSpec produz output estável (snapshot baseline)', () => {
    const out = engine.render(makeVisual())
    // O CSS dos 3 slides + globalCSS é a superfície que o brand-aware vai tocar.
    // Normaliza o timestamp dinâmico (generateGlobalCSS emite "Generated at: <ISO>") para o
    // snapshot ser estável entre execuções — só a ESTRUTURA do CSS importa aqui.
    const css = (out.slides.map((s) => s.css).join('\n') + out.globalCSS).replace(
      /Generated at: [^*]+/,
      'Generated at: <normalizado>',
    )
    expect(css).toMatchSnapshot()
  })

  it('render() sem spec mantém os literais Figma nos templates', () => {
    const out = engine.render(makeVisual())
    const css = out.slides.map((s) => s.css).join('\n')
    // pagination-number amarela, last bg amarelo: os literais Figma seguem presentes (como fallback).
    expect(css).toContain('#FFD44A')
    expect(css).toContain('#000000')
  })

  it('AC4 (semântico): sem spec, NENHUM --bd-* é declarado → toda var() resolve no fallback Figma', () => {
    const out = engine.render(makeVisual())
    const all = out.slides.map((s) => s.css).join('\n') + out.globalCSS
    // Sem designSpec, o generateGlobalCSS não emite o bloco --bd-* → as var(--bd-X, FALLBACK)
    // dos templates caem no fallback (byte-idêntico ao literal antigo). Isso É a não-regressão
    // visual: mesmo pixel, mesmo que o texto do CSS agora use var()/fallback.
    expect(all).not.toMatch(/--bd-[a-z-]+:/)
  })
})

describe('RenderEngine — brand-aware com designSpec (AC5/AC6)', () => {
  it('AC5: designSpec com accent custom emite --bd-accent e o template usa var(--bd-accent, #FFD44A)', () => {
    const spec = compileBrandDesignSpec(brandConfig('#0A0A0A', '#FF0000'))
    const out = engine.render({ ...makeVisual(), designSpec: spec })
    const css = out.slides.map((s) => s.css).join('\n') + out.globalCSS
    // a var foi emitida no :root...
    expect(out.globalCSS).toContain('--bd-accent: #FF0000')
    // ...e os templates a consomem com fallback Figma byte-idêntico.
    expect(css).toContain('var(--bd-accent, #FFD44A)')
  })

  it('AC6: toda var(--bd-X) usada nos templates tem o --bd-X emitido no :root', () => {
    const spec = compileBrandDesignSpec(brandConfig('#0A0A0A', '#FF0000'))
    const out = engine.render({ ...makeVisual(), designSpec: spec })
    const css = out.slides.map((s) => s.css).join('\n')
    const usados = [...css.matchAll(/var\((--bd-[a-z-]+),/g)].map((m) => m[1])
    const emitidos = new Set([...out.globalCSS.matchAll(/(--bd-[a-z-]+):/g)].map((m) => m[1]))
    const semDeclaracao = [...new Set(usados)].filter((v) => !emitidos.has(v))
    expect(semDeclaracao, `vars usadas sem declaração: ${semDeclaracao.join(', ')}`).toEqual([])
  })
})

// LOGO estampado (toggle "usar identidade do logo"). Eixos: (1) ON + url → o <img> do logo
// aparece nos 3 layouts (cover/body/last); (2) OFF ou sem url → AUSENTE (render byte-equivalente
// ao atual). brandConfig com logo url + flag de geração via 4º arg de compileBrandDesignSpec.
function brandConfigComLogo(logoUrl: string | null): BrandConfigForPipeline {
  const base = brandConfig('#0A0A0A', '#FF0000')
  return { ...base, visualIdentity: { ...base.visualIdentity, logo: { url: logoUrl } } }
}

describe('RenderEngine — logo estampado (toggle useLogoIdentity)', () => {
  const LOGO = 'https://cdn.exemplo.com/logo.png'

  it('toggle ON + logo url → o <img> do logo aparece nos 3 layouts', () => {
    const spec = compileBrandDesignSpec(brandConfigComLogo(LOGO), undefined, undefined, true)
    const slides = engine.render({ ...makeVisual(), designSpec: spec }).slides
    // makeVisual tem cover(1)/body(2)/last(3) — cada slide deve estampar o logo.
    for (const s of slides) {
      expect(s.html, `slide ${s.index} sem logo`).toContain(LOGO)
      expect(s.html).toContain('alt="Logo"')
    }
  })

  it('toggle OFF (default) → logo AUSENTE em todos os slides (byte-equivalente ao atual)', () => {
    const spec = compileBrandDesignSpec(brandConfigComLogo(LOGO)) // 4º arg ausente → enabled=false
    const html = engine.render({ ...makeVisual(), designSpec: spec }).slides.map((s) => s.html).join('\n')
    expect(html).not.toContain(LOGO)
  })

  it('toggle ON mas SEM logo cadastrado (url null) → logo AUSENTE (nada a estampar)', () => {
    const spec = compileBrandDesignSpec(brandConfigComLogo(null), undefined, undefined, true)
    const html = engine.render({ ...makeVisual(), designSpec: spec }).slides.map((s) => s.html).join('\n')
    expect(html).not.toContain('alt="Logo"')
  })

  it('url de esquema não-http/data é descartada (não interpola url crua arbitrária)', () => {
    const spec = compileBrandDesignSpec(brandConfigComLogo('javascript:alert(1)'), undefined, undefined, true)
    const html = engine.render({ ...makeVisual(), designSpec: spec }).slides.map((s) => s.html).join('\n')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('alt="Logo"')
  })
})

// ADR-0015 PR2 — comparison-columns: 1º blueprint slot-based novo. Prova agnosticismo (AC4/AC5):
// mesma geometria, marca injetada por var(--bd-*); zero hex de marca literal no CSS do blueprint.
function makeComparison(side: 'a' | 'b'): VisualSpecification {
  return {
    slides: [
      {
        index: 2,
        layoutId: side === 'a' ? 'comparison-columns-a' : 'comparison-columns-b',
        canvas: { width: 1080, height: 1350 },
        background: { type: 'solid', value: '#000000' },
        elements: [
          { type: 'text', role: 'headline', content: side === 'a' ? 'O jeito comum' : 'O jeito certo', style: {}, position: { x: 0, y: 0, width: 856, height: 'auto' } },
          { type: 'text', role: 'body', content: 'Descrição do lado, peso editorial.', style: {}, position: { x: 0, y: 0, width: 856, height: 'auto' } },
        ],
      },
    ],
    tokens: { colors: {}, fonts: {}, spacing: {} },
  }
}

describe('RenderEngine — comparison-columns (ADR-0015 PR2)', () => {
  it('AC: renderiza A e B sem lançar; B usa --bd-accent no painel, A usa --bd-background', () => {
    const a = engine.render(makeComparison('a')).slides.map((s) => s.css).join('\n')
    const b = engine.render(makeComparison('b')).slides.map((s) => s.css).join('\n')
    expect(a).toContain('.cmp-panel')
    expect(b).toContain('.cmp-panel')
    // Lado A: painel = fundo da marca. Lado B: painel = acento (a inversão figura-fundo).
    expect(a).toMatch(/\.cmp-panel[\s\S]*background-color:\s*var\(--bd-background/)
    expect(b).toMatch(/\.cmp-panel[\s\S]*background-color:\s*var\(--bd-accent/)
    // Lado B: texto sobre acento usa --bd-on-accent (contraste garantido pelo Design Compiler).
    expect(b).toContain('var(--bd-on-accent')
  })

  it('AC4: CSS do blueprint é 100% brand-agnostic — nenhum hex de marca literal (só var(--bd-*) + fallbacks neutros)', () => {
    const css = engine.render(makeComparison('b')).slides.map((s) => s.css).join('\n')
    // Os ÚNICOS hex permitidos no CSS do blueprint são fallbacks neutros funcionais dentro de var().
    // Qualquer hex FORA de um var(...) seria cor de marca cravada (o erro nº1). Extrai hex soltos:
    const semVar = css.replace(/var\([^)]*\)/g, '')
    const hexSoltos = [...semVar.matchAll(/#[0-9A-Fa-f]{6}/g)].map((m) => m[0].toUpperCase())
    // Chrome NEUTRO herdado do sistema atual (swipe-pill): #242424 (fundo da pílula) + #646464
    // (texto). NÃO são cores de marca — são grays funcionais idênticos aos do body-v1. Tokenizá-los
    // é um refactor à parte (tocaria o snapshot do body). Qualquer OUTRO hex solto = cor de marca
    // cravada (o erro nº1 da spec) e reprova.
    const CHROME_NEUTRO = new Set(['#242424', '#646464'])
    const proibidos = hexSoltos.filter((h) => !CHROME_NEUTRO.has(h))
    expect(proibidos, `hex de marca cravado no blueprint: ${proibidos.join(', ')}`).toEqual([])
  })

  it('AC5: accent custom (#FF0000) resolve no painel do lado B', () => {
    const spec = compileBrandDesignSpec(brandConfig('#0A0A0A', '#FF0000'))
    const out = engine.render({ ...makeComparison('b'), designSpec: spec })
    expect(out.globalCSS).toContain('--bd-accent: #FF0000')
    // onAccent derivado: acento vermelho escuro → texto branco sobre o painel.
    expect(out.globalCSS).toContain('--bd-on-accent: #FFFFFF')
  })

  it('AC: HTML escapa conteúdo do LLM no rótulo e no body (anti-quebra de markup)', () => {
    const v = makeComparison('a')
    v.slides[0].elements[0].content = '<script>x</script>'
    const html = engine.render(v).slides[0].html
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('RenderEngine — composição de imagem-no-layout (PR4: AC10/AC11/AC12)', () => {
  it('AC10: <img> de body com objectPosition custom emite object-position inline', () => {
    expect(RenderEngine.imageCompositionAttr({ objectPosition: '50% 30%' })).toBe(
      ' style="object-position: 50% 30%"',
    )
  })

  it('AC11: cover com focalPoint emite background-position em % (Caminho B)', () => {
    expect(RenderEngine.coverBackgroundComposition({ focalPoint: { x: 0.5, y: 0.2 } })).toEqual({
      size: 'cover',
      position: '50% 20%',
    })
  })

  it('AC12: ausência de campos → composição idêntica ao atual (não-regressão)', () => {
    // <img>: sem campos → atributo style vazio (o CSS .body-image cover/center prevalece).
    expect(RenderEngine.imageCompositionAttr(undefined)).toBe('')
    expect(RenderEngine.imageCompositionAttr({})).toBe('')
    // cover ::before: sem campos → cover/center (idêntico ao baseline).
    expect(RenderEngine.coverBackgroundComposition(undefined)).toEqual({ size: 'cover', position: 'center' })
  })

  it('objectFit:contain e scale: emite contain + transform', () => {
    expect(RenderEngine.imageCompositionAttr({ objectFit: 'contain', scale: 1.2 })).toBe(
      ' style="object-fit: contain; transform: scale(1.2)"',
    )
    expect(RenderEngine.coverBackgroundComposition({ objectFit: 'contain' }).size).toBe('contain')
  })
})

describe('RenderEngine — assets inline (PR5: AC16)', () => {
  it('AC16: nenhum asset por path /assets/patterns/* permanece no output (todos data-URI)', () => {
    const out = engine.render(makeVisual())
    const all = out.slides.map((s) => s.css + s.html).join('\n') + out.globalCSS
    expect(all).not.toContain('/assets/patterns/')
    // E os data-URIs inline estão presentes (listras no body/last, seta no swipe).
    expect(all).toContain('data:image/svg+xml,')
  })
})

// ── Conteúdo rico, escape e paginação dinâmica ──────────────────────────────────────────
describe('RenderEngine — escape de conteúdo do LLM (anti-XSS / anti-quebra de markup)', () => {
  function visualWithContent(headline: string): VisualSpecification {
    return {
      slides: [
        {
          index: 1, layoutId: 'branding-os-cover-v1', canvas: { width: 1080, height: 1350 },
          background: { type: 'solid', value: '#000' },
          elements: [{ type: 'text', role: 'headline', content: headline, style: {}, position: { x: 0, y: 0, width: 920, height: 'auto' } }],
        },
      ],
      tokens: { colors: {}, fonts: {}, spacing: {} },
    }
  }

  it('um < / > / & / " no conteúdo é escapado, não injeta markup', () => {
    const out = engine.render(visualWithContent('Perca <b>2h</b> & "ganhe" tempo'))
    const html = out.slides[0].html
    expect(html).not.toContain('<b>2h</b>')           // a tag literal não entra crua
    expect(html).toContain('&lt;b&gt;2h&lt;/b&gt;')   // entra escapada
    expect(html).toContain('&amp;')
    expect(html).toContain('&quot;')
  })
})

describe('RenderEngine — conteúdo rico no body (stat/quote/bullets/cta)', () => {
  function bodyWith(roles: Array<{ role: string; content: string }>): VisualSpecification {
    return {
      slides: [
        { index: 1, layoutId: 'branding-os-cover-v1', canvas: { width: 1080, height: 1350 }, background: { type: 'solid', value: '#000' }, elements: [{ type: 'text', role: 'headline', content: 'Capa', style: {}, position: { x: 0, y: 0, width: 920, height: 'auto' } }] },
        { index: 2, layoutId: 'branding-os-body-v1', canvas: { width: 1080, height: 1350 }, background: { type: 'solid', value: '#000' }, elements: roles.map((r) => ({ type: 'text' as const, role: r.role, content: r.content, style: {}, position: { x: 0, y: 0, width: 770, height: 'auto' as const } })) },
        { index: 3, layoutId: 'branding-os-last-v1', canvas: { width: 1080, height: 1350 }, background: { type: 'solid', value: '#FFD44A' }, elements: [{ type: 'text', role: 'headline', content: 'Fim', style: {}, position: { x: 0, y: 0, width: 770, height: 'auto' } }] },
      ],
      tokens: { colors: {}, fonts: {}, spacing: {} },
    }
  }

  it('stat + statContext renderizam o bloco stat-highlight', () => {
    const html = engine.render(bodyWith([{ role: 'headline', content: 'H' }, { role: 'stat', content: '730h' }, { role: 'statContext', content: 'por ano' }])).slides[1].html
    expect(html).toContain('body-stat-number')
    expect(html).toContain('730h')
    expect(html).toContain('por ano')
  })

  it('quote + attribution renderizam o bloco testimonial', () => {
    const html = engine.render(bodyWith([{ role: 'headline', content: 'H' }, { role: 'quote', content: 'Mudou minha vida' }, { role: 'attribution', content: 'Maria, SP' }])).slides[1].html
    expect(html).toContain('body-quote-text')
    expect(html).toContain('Mudou minha vida')
    expect(html).toContain('Maria, SP')
  })

  it('cta no body renderiza a pílula', () => {
    const html = engine.render(bodyWith([{ role: 'headline', content: 'H' }, { role: 'cta', content: 'Garantir vaga' }])).slides[1].html
    expect(html).toContain('body-cta')
    expect(html).toContain('Garantir vaga')
  })

  it('M3: bullets explícitos NÃO duplicam com o body (só a lista renderiza)', () => {
    const html = engine.render(bodyWith([
      { role: 'headline', content: 'H' },
      { role: 'body', content: '- item um\n- item dois' },
      { role: 'bullets', content: 'item um\nitem dois' },
    ])).slides[1].html
    // a lista existe...
    expect(html).toContain('body-list')
    // ...e o body cru com os traços NÃO aparece como parágrafo (sem duplicação).
    expect(html).not.toContain('<p class="body-text">- item um')
  })

  it('headline+body apenas: renderiza parágrafo simples (sem blocos ricos)', () => {
    const html = engine.render(bodyWith([{ role: 'headline', content: 'H' }, { role: 'body', content: 'Texto comum' }])).slides[1].html
    expect(html).toContain('<p class="body-text">Texto comum</p>')
    expect(html).not.toContain('body-stat')
    expect(html).not.toContain('body-quote')
    expect(html).not.toContain('body-cta')
  })
})

describe('RenderEngine — paginação dinâmica (era fixa em 8)', () => {
  function nSlides(n: number): VisualSpecification {
    const slides = Array.from({ length: n }, (_, i) => ({
      index: i + 1,
      layoutId: i === 0 ? 'branding-os-cover-v1' : i === n - 1 ? 'branding-os-last-v1' : 'branding-os-body-v1',
      canvas: { width: 1080, height: 1350 },
      background: { type: 'solid' as const, value: '#000' },
      elements: [{ type: 'text' as const, role: 'headline', content: `S${i + 1}`, style: {}, position: { x: 0, y: 0, width: 770, height: 'auto' as const } }],
    }))
    return { slides, tokens: { colors: {}, fonts: {}, spacing: {} } }
  }

  it('carrossel de 5 slides → 5 indicadores no body (não 8)', () => {
    const out = engine.render(nSlides(5))
    const bodyHtml = out.slides[1].html // slide 2 (body)
    const dots = (bodyHtml.match(/pagination-dot/g) || []).length
    const numbers = (bodyHtml.match(/pagination-number/g) || []).length
    expect(dots + numbers).toBe(5) // total de indicadores = nº real de slides
  })
})
