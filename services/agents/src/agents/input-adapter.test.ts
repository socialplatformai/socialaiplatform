import { describe, it, expect } from 'vitest'
import { adaptHttpToPipelineInput, validatePipelineInput } from './input-adapter.js'
import type { BrandContext, Pauta, ContentFormat } from '../types.js'

// Fundação de QA (E0.1) — a peça mais crítica e testável de coleta↔engine:
// o adapter HTTP → PipelineInput. Função pura, base dos testes de E3.

const baseBrand: BrandContext = {
  workspaceId: 'ws-1',
  branding: 'Marca que transforma rotina em ritual',
  tone: 'Acolhedor, Direto; Inspirador',
  guidelines: 'Sem jargão. Frases curtas.',
  positioningRules: 'Premium acessível',
  handle: '@minha_marca',
  learningSummary: 'Carrosséis às 19h performam melhor',
  desiredContentTypes: 'Carrossel, Reels',
}

const basePauta: Pauta = {
  id: 'p-1',
  title: 'Lançamento da coleção de inverno',
  objective: 'Gerar desejo pela nova coleção',
  context: 'Foco em conforto e estilo',
}

describe('adaptHttpToPipelineInput', () => {
  it('mapeia carousel → carousel e usa slideCount 6', () => {
    const out = adaptHttpToPipelineInput(baseBrand, basePauta, 'carousel')
    expect(out.assetType).toBe('carousel')
    expect(out.preferences?.slideCount).toBe(6)
  })

  it('mapeia post e story → single-post com slideCount 1', () => {
    for (const fmt of ['post', 'story'] as ContentFormat[]) {
      const out = adaptHttpToPipelineInput(baseBrand, basePauta, fmt)
      expect(out.assetType).toBe('single-post')
      expect(out.preferences?.slideCount).toBe(1)
    }
  })

  it('deriva o contexto do produto a partir da pauta', () => {
    const out = adaptHttpToPipelineInput(baseBrand, basePauta, 'carousel')
    expect(out.context.productName).toBe(basePauta.title)
    expect(out.context.productDescription).toBe(basePauta.objective)
    expect(out.content.mainMessage).toBe(basePauta.objective)
    expect(out.context.uniqueSellingPoint).toBe(baseBrand.branding)
  })

  it('faz parse do tom em atributos de voz (vírgula e ponto-e-vírgula)', () => {
    const out = adaptHttpToPipelineInput(baseBrand, basePauta, 'carousel')
    expect(out.brandConfig.voice.attributes).toEqual(['Acolhedor', 'Direto', 'Inspirador'])
  })

  it('inclui guidelines e positioningRules como toneGuidelines', () => {
    const out = adaptHttpToPipelineInput(baseBrand, basePauta, 'carousel')
    expect(out.brandConfig.voice.toneGuidelines).toEqual([
      baseBrand.guidelines,
      baseBrand.positioningRules,
    ])
  })

  it('compõe additionalNotes com contexto + learning + tipos desejados', () => {
    const out = adaptHttpToPipelineInput(baseBrand, basePauta, 'carousel')
    const notes = out.content.additionalNotes ?? ''
    expect(notes).toContain(basePauta.context!)
    expect(notes).toContain(baseBrand.learningSummary!)
    expect(notes).toContain('Carrossel, Reels')
  })

  it('propaga o handle do tenant (nunca handle de terceiro)', () => {
    const out = adaptHttpToPipelineInput(baseBrand, basePauta, 'carousel')
    expect(out.brandConfig.handle).toBe('@minha_marca')

    const semHandle = adaptHttpToPipelineInput({ ...baseBrand, handle: undefined }, basePauta, 'carousel')
    expect(semHandle.brandConfig.handle).toBe('')
  })

  it('usa cor primária default on-brand quando o BrandContext é pobre', () => {
    const out = adaptHttpToPipelineInput({ workspaceId: 'ws-2' }, basePauta, 'carousel')
    expect(out.brandConfig.visualIdentity.colors.primary.hex).toBe('#1B1F2E')
    expect(out.brandConfig.voice.attributes).toEqual([])
  })
})

// E2/ADR-0005 — identidade visual real da marca chega à engine (G1/G2).
describe('adaptHttpToPipelineInput — identidade visual (E2.2/E2.3)', () => {
  it('E2.2: cores e fontes REAIS da marca aparecem no payload, não os defaults', () => {
    const brand: BrandContext = {
      ...baseBrand,
      visualIdentity: {
        colors: { primary: '#FF0066', accent: '#00E5FF' },
        headingFont: 'Poppins',
      },
    }
    const out = adaptHttpToPipelineInput(brand, basePauta, 'carousel')
    expect(out.brandConfig.visualIdentity.colors.primary.hex).toBe('#FF0066')
    expect(out.brandConfig.visualIdentity.colors.accent.hex).toBe('#00E5FF')
    expect(out.brandConfig.visualIdentity.typography.heading.family).toBe('Poppins')
    // o que a marca NÃO definiu cai no preset (APEX default), não some
    expect(out.brandConfig.visualIdentity.colors.secondary.hex).toBe('#4A5266')
  })

  it('E2.3: preset escolhido carrega os tokens do preset (Bold) quando a marca não sobrescreve', () => {
    const brand: BrandContext = { ...baseBrand, visualIdentity: { preset: 'bold' } }
    const out = adaptHttpToPipelineInput(brand, basePauta, 'carousel')
    expect(out.brandConfig.visualIdentity.colors.accent.hex).toBe('#FF3D2E') // Bold
    expect(out.brandConfig.visualIdentity.typography.heading.family).toBe('Archivo')
  })

  it('E2.3: override pontual sobrepõe SÓ aquele campo do preset (merge)', () => {
    const brand: BrandContext = {
      ...baseBrand,
      visualIdentity: { preset: 'minimal', colors: { accent: '#FFD400' } },
    }
    const out = adaptHttpToPipelineInput(brand, basePauta, 'carousel')
    expect(out.brandConfig.visualIdentity.colors.accent.hex).toBe('#FFD400') // override
    expect(out.brandConfig.visualIdentity.colors.background.hex).toBe('#FAFAFA') // Minimal
  })

  it('preset desconhecido cai no APEX (fail-safe, sem lançar)', () => {
    const brand: BrandContext = { ...baseBrand, visualIdentity: { preset: 'nao-existe' } }
    const out = adaptHttpToPipelineInput(brand, basePauta, 'carousel')
    expect(out.brandConfig.visualIdentity.colors.primary.hex).toBe('#1B1F2E') // APEX
  })

  it('preset é case-insensitive: "BOLD" (legado maiúsculo) resolve Bold, não cai no default', () => {
    // Achado adversarial: dado legado/seed com preset maiúsculo NÃO deve degradar p/ APEX
    // silenciosamente. resolvePreset normaliza na fronteira.
    const brand: BrandContext = { ...baseBrand, visualIdentity: { preset: 'BOLD' } }
    const out = adaptHttpToPipelineInput(brand, basePauta, 'carousel')
    expect(out.brandConfig.visualIdentity.colors.accent.hex).toBe('#FF3D2E') // Bold
  })

  it('logoUrl da marca chega ao payload; ausente → null (nunca string vazia falsa)', () => {
    const comLogo = adaptHttpToPipelineInput(
      { ...baseBrand, visualIdentity: { logoUrl: 'https://cdn/logo.png' } },
      basePauta,
      'carousel',
    )
    expect(comLogo.brandConfig.visualIdentity.logo.url).toBe('https://cdn/logo.png')
    const semLogo = adaptHttpToPipelineInput(baseBrand, basePauta, 'carousel')
    expect(semLogo.brandConfig.visualIdentity.logo.url).toBeNull()
  })
})

// E3.2/E3.4/E3.5 + competitors — coleta↔engine (parar de jogar dado fora).
describe('adaptHttpToPipelineInput — coleta↔engine (E3.2/E3.4/E3.5)', () => {
  it('E3.2: marketingObjective real mapeia para goal.objective (não fixo awareness)', () => {
    const conv = adaptHttpToPipelineInput(baseBrand, { ...basePauta, marketingObjective: 'conversão' }, 'carousel')
    expect(conv.goal.objective).toBe('conversion')
    const cons = adaptHttpToPipelineInput(baseBrand, { ...basePauta, marketingObjective: 'consideration' }, 'carousel')
    expect(cons.goal.objective).toBe('consideration')
  })

  it('E3.2: objetivos de meio-de-funil PT (engajamento/tráfego) → consideration', () => {
    for (const obj of ['engajamento', 'tráfego', 'gerar tráfego']) {
      const out = adaptHttpToPipelineInput(baseBrand, { ...basePauta, marketingObjective: obj }, 'carousel')
      expect(out.goal.objective, obj).toBe('consideration')
    }
  })

  it('E3.2: sem marketingObjective → fallback awareness (honesto)', () => {
    const out = adaptHttpToPipelineInput(baseBrand, basePauta, 'carousel')
    expect(out.goal.objective).toBe('awareness')
  })

  it('E3.4 (DEC-2): anexos da pauta viram referenceContext (url + rótulo); ausente → undefined', () => {
    const out = adaptHttpToPipelineInput(
      baseBrand,
      { ...basePauta, attachments: ['https://cdn/brief.pdf', '  ', 'https://cdn/moodboard.png'] },
      'carousel',
    )
    expect(out.content.referenceContext).toEqual([
      { url: 'https://cdn/brief.pdf', label: 'brief.pdf' },
      { url: 'https://cdn/moodboard.png', label: 'moodboard.png' },
    ])
    const sem = adaptHttpToPipelineInput(baseBrand, basePauta, 'carousel')
    expect(sem.content.referenceContext).toBeUndefined()
  })

  it('E3.5: Category da pauta aparece em additionalNotes', () => {
    const out = adaptHttpToPipelineInput(baseBrand, { ...basePauta, category: 'Educacional' }, 'carousel')
    expect(out.content.additionalNotes ?? '').toContain('Categoria: Educacional')
  })

  it('competitors da marca aparecem em additionalNotes (referência textual)', () => {
    const out = adaptHttpToPipelineInput(
      { ...baseBrand, competitors: ['@rival_a', '@rival_b'] },
      basePauta,
      'carousel',
    )
    expect(out.content.additionalNotes ?? '').toContain('Concorrentes de referência: @rival_a, @rival_b')
  })
})

// E3.1/E3.3 (via E2) — texto de marca real chega à engine.
describe('adaptHttpToPipelineInput — texto de marca (E3.1/E3.3)', () => {
  it('E3.1: targetAudience real substitui o literal genérico', () => {
    const out = adaptHttpToPipelineInput(
      { ...baseBrand, targetAudience: 'Mulheres 25-40, urbanas' },
      basePauta,
      'carousel',
    )
    expect(out.context.targetAudience).toBe('Mulheres 25-40, urbanas')
  })

  it('E3.1: sem targetAudience → fallback genérico explícito', () => {
    const out = adaptHttpToPipelineInput(baseBrand, basePauta, 'carousel')
    expect(out.context.targetAudience).toBe('Audiência da marca')
  })

  it('E3.3: copyExamples reais viram objetos de voz; ausente → []', () => {
    const out = adaptHttpToPipelineInput(
      { ...baseBrand, copyExamples: ['Sua rotina merece ritual.', '  ', 'Menos é mais.'] },
      basePauta,
      'carousel',
    )
    expect(out.brandConfig.voice.copyExamples).toEqual([
      { text: 'Sua rotina merece ritual.', isGood: true, context: 'Exemplo de copy da marca' },
      { text: 'Menos é mais.', isGood: true, context: 'Exemplo de copy da marca' },
    ])
    const vazio = adaptHttpToPipelineInput(baseBrand, basePauta, 'carousel')
    expect(vazio.brandConfig.voice.copyExamples).toEqual([])
  })
})

// FASE 7 / ADR-0009 (Bloco A) — iterar o output: a instrução de regeneração chega
// à engine via additionalNotes. O adapter só repassa a instrução VERBATIM; a montagem
// da frase de slide dirigido é responsabilidade do controller .NET.
describe('adaptHttpToPipelineInput — regeneração dirigida (A1/A3)', () => {
  it('A1: regenerationInstruction entra em additionalNotes verbatim, com o prefixo "Instrução de regeneração:"', () => {
    const out = adaptHttpToPipelineInput(baseBrand, basePauta, 'carousel', {
      regenerationInstruction: 'mais curto',
    })
    const notes = out.content.additionalNotes ?? ''
    expect(notes).toContain('mais curto')
    expect(notes).toContain('Instrução de regeneração:')
  })

  it('A3: a frase de slide dirigido montada no .NET chega ao additionalNotes (o adapter só repassa)', () => {
    const out = adaptHttpToPipelineInput(baseBrand, basePauta, 'carousel', {
      regenerationInstruction: 'Refaça apenas o slide 3, preservando os demais.',
    })
    const notes = out.content.additionalNotes ?? ''
    expect(notes).toContain('Refaça apenas o slide 3')
  })
})

// FASE 0 (auditoria — fundação de input criativo): a direção criativa por-geração do operador
// (referência/fundo/CTA/subtítulo) chega ao briefing pelos canais certos. Default (ausente/vazio) →
// briefing byte-equivalente ao atual (nenhum campo novo no additionalNotes/referenceContext).
describe('adaptHttpToPipelineInput — direção criativa por-geração (Fase 0)', () => {
  it('referenceUrl e backgroundUrl entram no referenceContext (url + rótulo legível)', () => {
    const out = adaptHttpToPipelineInput(baseBrand, basePauta, 'carousel', {
      creativeInput: {
        referenceUrl: 'https://cdn.exemplo.com/moodboard.png',
        backgroundUrl: 'https://cdn.exemplo.com/fundo.jpg',
      },
    })
    expect(out.content.referenceContext).toEqual([
      { url: 'https://cdn.exemplo.com/moodboard.png', label: 'moodboard.png' },
      { url: 'https://cdn.exemplo.com/fundo.jpg', label: 'fundo.jpg' },
    ])
  })

  it('referenceContext combina anexos da pauta E a referência/fundo do operador (anexos primeiro)', () => {
    const out = adaptHttpToPipelineInput(
      baseBrand,
      { ...basePauta, attachments: ['https://cdn/brief.pdf'] },
      'carousel',
      { creativeInput: { referenceUrl: 'https://cdn/ref.png' } },
    )
    expect(out.content.referenceContext).toEqual([
      { url: 'https://cdn/brief.pdf', label: 'brief.pdf' },
      { url: 'https://cdn/ref.png', label: 'ref.png' },
    ])
  })

  it('cta e subtitle do operador entram em additionalNotes como direção de copy', () => {
    const out = adaptHttpToPipelineInput(baseBrand, basePauta, 'carousel', {
      creativeInput: { cta: 'Garanta o seu', subtitle: 'Edição limitada de inverno' },
    })
    const notes = out.content.additionalNotes ?? ''
    expect(notes).toContain('CTA desejado pelo operador')
    expect(notes).toContain('Garanta o seu')
    expect(notes).toContain('Subtítulo/linha de apoio desejada pelo operador')
    expect(notes).toContain('Edição limitada de inverno')
  })

  it('backgroundUrl entra em additionalNotes como direção visual (mantendo a marca)', () => {
    const out = adaptHttpToPipelineInput(baseBrand, basePauta, 'carousel', {
      creativeInput: { backgroundUrl: 'https://cdn/fundo.jpg' },
    })
    const notes = out.content.additionalNotes ?? ''
    expect(notes).toContain('Fundo de referência desejado pelo operador')
    expect(notes).toContain('https://cdn/fundo.jpg')
  })

  it('campos vazios/em-branco são ignorados (briefing byte-equivalente ao atual)', () => {
    const baseline = adaptHttpToPipelineInput(baseBrand, basePauta, 'carousel')
    const out = adaptHttpToPipelineInput(baseBrand, basePauta, 'carousel', {
      creativeInput: { referenceUrl: '  ', backgroundUrl: '', cta: '   ', subtitle: undefined },
    })
    expect(out.content.referenceContext).toBeUndefined()
    expect(out.content.additionalNotes).toBe(baseline.content.additionalNotes)
  })

  it('creativeInput ausente → idêntico ao comportamento atual (não-regressão)', () => {
    const baseline = adaptHttpToPipelineInput(baseBrand, basePauta, 'carousel')
    const out = adaptHttpToPipelineInput(baseBrand, basePauta, 'carousel', {})
    expect(out.content.additionalNotes).toBe(baseline.content.additionalNotes)
    expect(out.content.referenceContext).toBe(baseline.content.referenceContext)
  })
})

describe('validatePipelineInput', () => {
  it('valida um input bem-formado', () => {
    const out = adaptHttpToPipelineInput(baseBrand, basePauta, 'carousel')
    const result = validatePipelineInput(out)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('reprova quando o productName está vazio', () => {
    const out = adaptHttpToPipelineInput(baseBrand, { ...basePauta, title: '   ' }, 'carousel')
    // title vazio também esvazia mainMessage quando não há objective; aqui há objective.
    const broken = { ...out, context: { ...out.context, productName: '   ' } }
    const result = validatePipelineInput(broken)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Product name is required')
  })

  it('reprova quando a cor primária está ausente', () => {
    const out = adaptHttpToPipelineInput(baseBrand, basePauta, 'carousel')
    const broken = {
      ...out,
      brandConfig: {
        ...out.brandConfig,
        visualIdentity: {
          ...out.brandConfig.visualIdentity,
          colors: {
            ...out.brandConfig.visualIdentity.colors,
            primary: { hex: '', name: '' },
          },
        },
      },
    }
    const result = validatePipelineInput(broken)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Primary brand color is required')
  })
})
