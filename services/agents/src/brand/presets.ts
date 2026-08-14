/**
 * Presets de design system (E2.3 / DEC-4) — coleções de design tokens versionadas,
 * NÃO temas hardcoded espalhados. Um preset é a unidade visual coerente; a marca pode
 * sobrescrever campos pontuais (resolvido por merge no input-adapter).
 *
 * Determinístico, sem IA. Fonte única dos defaults visuais que antes viviam soltos no
 * input-adapter (cores #1B1F2E/Satoshi). APEX é o default (estética travada do projeto,
 * ver ARCHITECTURE.md); Minimal e Bold são alternativas on-brand para o usuário escolher.
 */

export type PresetId = 'apex' | 'minimal' | 'bold'

export const DEFAULT_PRESET: PresetId = 'apex'

/** Forma dos tokens visuais de um preset — espelha brandConfig.visualIdentity do pipeline. */
export interface VisualPreset {
  colors: {
    primary: { hex: string; name: string }
    secondary: { hex: string; name: string }
    accent: { hex: string; name: string }
    background: { hex: string; name: string }
    text: { hex: string; name: string }
  }
  typography: {
    heading: { family: string; weights: number[] }
    body: { family: string; weights: number[] }
  }
}

const APEX: VisualPreset = {
  // Tokens APEX (preservados byte-a-byte do input-adapter original — sem regressão visual).
  colors: {
    primary: { hex: '#1B1F2E', name: 'Ink' },
    secondary: { hex: '#4A5266', name: 'Ink 3' },
    accent: { hex: '#D7C6FF', name: 'Lilac' },
    background: { hex: '#F5F1EE', name: 'Canvas' },
    text: { hex: '#1B1F2E', name: 'Ink' },
  },
  typography: {
    heading: { family: 'Satoshi', weights: [500, 700] },
    body: { family: 'Satoshi', weights: [400, 500] },
  },
}

const MINIMAL: VisualPreset = {
  // Monocromático/neutro, máxima sobriedade — preto sobre branco-osso, sem cor de destaque forte.
  colors: {
    primary: { hex: '#111111', name: 'Quase preto' },
    secondary: { hex: '#666666', name: 'Cinza médio' },
    accent: { hex: '#111111', name: 'Quase preto' },
    background: { hex: '#FAFAFA', name: 'Branco-osso' },
    text: { hex: '#111111', name: 'Quase preto' },
  },
  typography: {
    heading: { family: 'Inter', weights: [600, 700] },
    body: { family: 'Inter', weights: [400, 500] },
  },
}

const BOLD: VisualPreset = {
  // Alto contraste e cor saturada — energia e presença; fundo escuro, destaque vibrante.
  colors: {
    primary: { hex: '#0A0A0A', name: 'Preto' },
    secondary: { hex: '#1F1F1F', name: 'Grafite' },
    accent: { hex: '#FF3D2E', name: 'Vermelho vivo' },
    background: { hex: '#0A0A0A', name: 'Preto' },
    text: { hex: '#FFFFFF', name: 'Branco' },
  },
  typography: {
    heading: { family: 'Archivo', weights: [700, 900] },
    body: { family: 'Archivo', weights: [400, 600] },
  },
}

const PRESETS: Record<PresetId, VisualPreset> = {
  apex: APEX,
  minimal: MINIMAL,
  bold: BOLD,
}

/** Resolve um preset por id; id desconhecido/ausente → APEX (fail-safe, nunca lança). */
export function resolvePreset(id?: string | null): VisualPreset {
  // Case-insensitive e tolerante a espaços: a API já normaliza p/ minúsculo na escrita,
  // mas dado legado/seed ("APEX") não deve cair no default por engano (defesa na fronteira).
  const key = id?.trim().toLowerCase()
  if (key && key in PRESETS) return PRESETS[key as PresetId]
  return PRESETS[DEFAULT_PRESET]
}
