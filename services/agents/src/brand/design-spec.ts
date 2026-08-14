/**
 * Design Compiler — Brand Design Spec canônico (ADR-0012).
 *
 * COMPILADOR DE IDENTIDADE determinístico: funde as variáveis da marca (já mescladas pelo
 * input-adapter, merge 3-níveis campo ?? preset ?? default-APEX) + o design system (preset/APEX)
 * + o template num ARTEFATO CANÔNICO único (BrandDesignSpec). Dele derivam TODOS os consumidores
 * por campos nomeados: render-engine (cores/fontes via CSS vars --bd-*), prompt de imagem
 * (paleta/mood/estética), copywriter (voz) e a UX futura (edita os inputs, preview chamando esta
 * mesma função). Um lugar, tudo deriva.
 *
 * INVARIANTES (ADR-0012):
 * - PURO: sem LLM, sem I/O, sem process.env. Idempotente (mesmo input → mesmo spec byte-a-byte).
 * - FAIL-SAFE: qualquer ausência → defaults APEX inline; NUNCA lança.
 * - VENDORIZADO, não importado: a fatia estrutural do APEX é uma constante congelada AQUI (não um
 *   import de packages/design-tokens — que quebraria o build Docker do agents: COPY . . só de
 *   services/agents, rootDir:src, sem a dependência declarada). Regenerar à mão se o design system mudar.
 */

import type { BrandConfigForPipeline, CarouselTemplate, VisualSpecification } from '@/types/pipeline'
import type { PresetId } from './presets.js'

export type ColorToken = { hex: string; name: string; role: string }

export interface BrandDesignSpec {
  version: '1.0'
  palette: {
    primary: ColorToken
    secondary: ColorToken
    accent: ColorToken
    background: ColorToken
    text: ColorToken
    ink: ColorToken // = text (alias semântico p/ texto sobre superfície clara)
    muted: ColorToken // DERIVADO: mix(text, background) p/ legendas/subtítulos
    onImage: ColorToken // DERIVADO: branco ou quase-preto por luminância do background
    onAccent: ColorToken // DERIVADO: branco ou quase-preto por luminância do ACENTO (texto sobre painel de acento)
  }
  typography: {
    heading: { family: string; weights: number[]; scale?: Record<string, number>; tracking?: string }
    body: { family: string; weights: number[]; scale?: Record<string, number>; tracking?: string }
  }
  structure: {
    spacing: Record<string, string>
    radius: Record<string, string>
    shadow: Record<string, string>
  }
  imageAesthetics: {
    palette: string[] // hexes da palette p/ o prompt de imagem
    mood: string // derivado do preset (apex→etéreo; bold→dramático; minimal→editorial)
    style: string // qualificadores técnicos do prompt
    gradientFallback: string // = iris-grad vendorizado (fonte única do fallback AM-4/R-2)
  }
  voice: {
    attributes: string[]
    toneGuidelines: string[]
    copyExamples: Array<{ text: string; isGood: boolean; context: string }>
  }
  templateBinding: {
    templateId: string
    slotColors: Record<string, string> // slot → nome-de-token (documenta o binding do render)
  }
  // LOGO da marca (estampado no render quando enabled). `url` vem do BrandKit (pode ser null);
  // `enabled` é a decisão POR-GERAÇÃO (toggle "usar identidade do logo" no wizard). enabled só é
  // honrado pelo render quando há url válida (http/data). Desligado/sem url → render byte-equivalente.
  logo: { url: string | null; enabled: boolean }
}

// ──────────────────────────────────────────────────────────────────────────
// APEX_STRUCTURE — VENDORIZADO de packages/design-tokens/tailwind.tokens.js (apexTokens).
// Copiado byte-a-byte; regenerar À MÃO se o design system APEX mudar (NÃO importar cross-package).
// ──────────────────────────────────────────────────────────────────────────
const APEX_STRUCTURE = {
  spacing: {
    '0': '0px', '1': '4px', '2': '8px', '3': '12px', '4': '16px', '5': '20px',
    '6': '24px', '8': '32px', '10': '40px', '12': '48px', '16': '64px',
    '20': '80px', '24': '96px', '32': '128px',
  },
  radius: { sm: '12px', md: '20px', lg: '24px', xl: '36px', pill: '999px' },
  shadow: {
    sm: '0 4px 14px -4px rgba(27,31,46,0.10)',
    md: '0 8px 32px -16px rgba(27,31,46,0.14)',
    lg: '0 18px 50px -22px rgba(27,31,46,0.20)',
    xl: '0 40px 90px -30px rgba(27,31,46,0.25), 0 20px 50px -20px rgba(215,198,255,0.40)',
  },
  gradient: {
    'iris-grad': 'linear-gradient(120deg, #C8E0FF 0%, #D7C6FF 30%, #FFC6F0 55%, #FFD7C6 75%, #B6F0FF 100%)',
  },
} as const

// Defaults APEX inline (fail-safe) — espelham o preset APEX (presets.ts), byte-a-byte.
const APEX_FALLBACK = {
  primary: { hex: '#1B1F2E', name: 'Ink' },
  secondary: { hex: '#4A5266', name: 'Ink 3' },
  accent: { hex: '#D7C6FF', name: 'Lilac' },
  background: { hex: '#F5F1EE', name: 'Canvas' },
  text: { hex: '#1B1F2E', name: 'Ink' },
  heading: { family: 'Satoshi', weights: [500, 700] },
  body: { family: 'Satoshi', weights: [400, 500] },
} as const

// Mood do prompt de imagem por preset (estética coerente com o design system).
const MOOD_BY_PRESET: Record<PresetId, string> = {
  apex: 'etéreo, luz suave, paleta pastel iridescente, sofisticado',
  minimal: 'editorial, neutro, muito espaço negativo, sóbrio',
  bold: 'alto contraste, dramático, cor saturada, energia e presença',
}

const DEFAULT_IMAGE_STYLE = 'cinematic, professional, high quality, 8k, minimalistic'

// ──────────────────────────────────────────────────────────────────────────
// Helpers de cor (puros, ~mínimos — sem motor OKLCH/APCA; ADR-0012 escopo travado).
// ──────────────────────────────────────────────────────────────────────────

/** Normaliza um hex (#RGB ou #RRGGBB) para [r,g,b] 0..255; inválido → null. */
function hexToRgb(hex: string): [number, number, number] | null {
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
}

/** Mistura linear sRGB de dois hexes: t=0 → a, t=1 → b. Hex inválido → o outro (fail-safe). */
export function mixHex(a: string, b: string, t: number): string {
  const ra = hexToRgb(a)
  const rb = hexToRgb(b)
  if (!ra) return b
  if (!rb) return a
  const m = ra.map((v, i) => v + (rb[i] - v) * t)
  return `#${toHex(m[0])}${toHex(m[1])}${toHex(m[2])}`
}

/** Luminância relativa (WCAG, simplificada) 0..1. Hex inválido → 0 (trata como escuro). */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// ──────────────────────────────────────────────────────────────────────────
// COMPILADOR
// ──────────────────────────────────────────────────────────────────────────

function tok(c: { hex?: string; name?: string } | undefined, role: string, fb: { hex: string; name: string }): ColorToken {
  return { hex: c?.hex || fb.hex, name: c?.name || fb.name, role }
}

/**
 * Compila o BrandDesignSpec canônico. PURO, fail-safe, idempotente (ADR-0012).
 * @param brandConfig já mesclado pelo input-adapter (merge 3-níveis). Ausências → defaults APEX.
 * @param presetId escolhe o mood do prompt de imagem (default APEX). Inválido → APEX.
 * @param template alimenta templateBinding.templateId (default '').
 */
export function compileBrandDesignSpec(
  brandConfig: BrandConfigForPipeline,
  presetId?: PresetId,
  template?: CarouselTemplate,
  // Decisão POR-GERAÇÃO: estampar o logo nos slides? Vem do toggle do wizard (preferences.useLogoIdentity).
  // Default false → comportamento atual byte-equivalente (logo nunca aparece sem opt-in explícito).
  useLogoIdentity?: boolean,
): BrandDesignSpec {
  const colors = brandConfig?.visualIdentity?.colors
  const typo = brandConfig?.visualIdentity?.typography

  const primary = tok(colors?.primary, 'primary', APEX_FALLBACK.primary)
  const secondary = tok(colors?.secondary, 'secondary', APEX_FALLBACK.secondary)
  const accent = tok(colors?.accent, 'accent', APEX_FALLBACK.accent)
  const background = tok(colors?.background, 'background', APEX_FALLBACK.background)
  const text = tok(colors?.text, 'text', APEX_FALLBACK.text)

  // DERIVADAS (escopo travado — sem motor de cor):
  // muted = mix 60/40 entre text e background (legendas/subtítulos legíveis mas suaves).
  const muted: ColorToken = { hex: mixHex(text.hex, background.hex, 0.4), name: 'Muted', role: 'muted' }
  // onImage = branco sobre fundo escuro, quase-preto sobre fundo claro (contraste garantido).
  const onImageHex = relativeLuminance(background.hex) < 0.5 ? '#FFFFFF' : '#0A0A0A'
  const onImage: ColorToken = { hex: onImageHex, name: onImageHex === '#FFFFFF' ? 'Branco' : 'Quase preto', role: 'onImage' }
  // onAccent = texto legível SOBRE o painel de acento (ADR-0015 PR2): mesma regra do onImage, mas
  // a luminância de referência é a do ACENTO (não do background) — garante contraste no lado B do
  // comparativo e em qualquer blueprint futuro que preencha com --bd-accent (cta-close, stat-hero…).
  const onAccentHex = relativeLuminance(accent.hex) < 0.5 ? '#FFFFFF' : '#0A0A0A'
  const onAccent: ColorToken = { hex: onAccentHex, name: onAccentHex === '#FFFFFF' ? 'Branco' : 'Quase preto', role: 'onAccent' }

  const heading = typo?.heading?.family
    ? { family: typo.heading.family, weights: typo.heading.weights ?? [...APEX_FALLBACK.heading.weights] }
    : { family: APEX_FALLBACK.heading.family, weights: [...APEX_FALLBACK.heading.weights] }
  const body = typo?.body?.family
    ? { family: typo.body.family, weights: typo.body.weights ?? [...APEX_FALLBACK.body.weights] }
    : { family: APEX_FALLBACK.body.family, weights: [...APEX_FALLBACK.body.weights] }

  const preset: PresetId = presetId && presetId in MOOD_BY_PRESET ? presetId : 'apex'

  return {
    version: '1.0',
    palette: { primary, secondary, accent, background, text, ink: { ...text, role: 'ink' }, muted, onImage, onAccent },
    typography: { heading, body },
    structure: {
      spacing: { ...APEX_STRUCTURE.spacing },
      radius: { ...APEX_STRUCTURE.radius },
      shadow: { ...APEX_STRUCTURE.shadow },
    },
    imageAesthetics: {
      palette: [primary.hex, accent.hex, background.hex],
      mood: MOOD_BY_PRESET[preset],
      style: DEFAULT_IMAGE_STYLE,
      gradientFallback: APEX_STRUCTURE.gradient['iris-grad'],
    },
    voice: {
      attributes: brandConfig?.voice?.attributes ?? [],
      toneGuidelines: brandConfig?.voice?.toneGuidelines ?? [],
      copyExamples: brandConfig?.voice?.copyExamples ?? [],
    },
    templateBinding: {
      templateId: template?.id ?? '',
      // Documenta o mapa slot→token que o render aplica via var(--bd-*). O var() no CSS é a
      // implementação real; este mapa é a referência legível (ADR-0012). Mantê-lo alinhado às
      // var() do render-engine: cada chave corresponde a um var(--bd-<token>) usado lá.
      slotColors: {
        'cover-bg': 'background',
        'cover-title': 'onImage',
        'cover-subtitle': 'muted',
        'body-bg': 'background',
        'body-headline': 'onImage',
        'body-text': 'muted',
        'pagination-number': 'accent', // número do slide atual (destaque)
        'pagination-dot': 'muted', // dots dos outros slides (neutros)
        'last-bg': 'accent',
        'last-headline': 'text',
        'last-header': 'accent',
      },
    },
    // Logo: url do BrandKit (fail-safe a null) + flag por-geração. O render só estampa quando
    // enabled E url válida; aqui apenas carregamos a decisão para o spec canônico.
    logo: {
      url: brandConfig?.visualIdentity?.logo?.url ?? null,
      enabled: !!useLogoIdentity,
    },
  }
}

/**
 * R3/AC13 (ADR-0012): sobrescreve `visual.tokens.colors` com a palette do spec — fonte única de
 * cor a partir daqui. Sem isto, os defaults que o visual-compositor.parseOutput injeta
 * (#1A1A1A/#C9B298) divergiriam do spec. Função PURA (retorna um novo visual, não muta).
 */
export function applySpecPaletteToTokens(
  visual: VisualSpecification,
  spec: BrandDesignSpec,
): VisualSpecification {
  return {
    ...visual,
    tokens: {
      ...visual.tokens,
      colors: {
        ...visual.tokens.colors,
        primary: spec.palette.primary.hex,
        secondary: spec.palette.secondary.hex,
        accent: spec.palette.accent.hex,
        background: spec.palette.background.hex,
        text: spec.palette.text.hex,
      },
    },
  }
}
