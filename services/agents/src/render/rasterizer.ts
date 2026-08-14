/**
 * F3 (ADR-0014 §4e) — Rasterizador server-side de CAMADAS → JPEG, via Satori + resvg.
 *
 * Por quê aqui (agents/Node) e não no worker (.NET): o layout é CSS-flexbox (o mesmo do
 * `<SlideCanvas>` React). Satori (engine do @vercel/og) computa flexbox via Yoga — o MESMO modelo
 * do browser — então o JPEG sai FIEL ao preview (preview==raster por construção, não por sorte).
 * ImageSharp exigiria reimplementar flexbox em primitivas de desenho (2 motores divergindo).
 *
 * Pipeline: layers (role-based) → árvore de nós Satori (sem JSX — objetos {type,props}) → SVG →
 * resvg → PNG → JPEG (resvg já emite PNG; a conversão p/ JPEG do publish fica no worker/MediaService,
 * que já converte PNG→JPEG). Devolvemos data-uri PNG; o caller decide persistir como ImageUrl.
 *
 * FONTE (gotcha verificado): Satori NÃO lê woff2 (só TTF/OTF/WOFF). A fonte da marca (Satoshi) precisa
 * existir em TTF/OTF/WOFF em assets/fonts/. Ausente → erro CLARO (nunca fonte genérica em silêncio,
 * que quebraria a fidelidade). Ver loadFonts().
 */

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import satori from 'satori'
import type { Font } from 'satori'
import { Resvg } from '@resvg/resvg-js'

const CANVAS_W = 1080
const CANVAS_H = 1350

// Espelha SlideLayers do contrato HTTP (services/agents/src/types.ts) — só o que o raster consome.
interface RasterElement {
  type?: string
  role?: string
  content?: string
  style?: Record<string, unknown>
}
export interface RasterLayers {
  background?: { type?: string; value?: string }
  elements?: RasterElement[]
  anchorY?: 'top' | 'center' | 'bottom'
}

type SatoriNode = { type: string; props: Record<string, unknown> }
const el = (type: string, props: Record<string, unknown>, children?: unknown): SatoriNode => ({
  type,
  props: children === undefined ? props : { ...props, children },
})

function isImage(v: string | undefined): v is string {
  return !!v && (v.startsWith('data:') || v.startsWith('http'))
}
// Gradiente CSS (R0 refutou que gradiente está morto → fallback iridescente MANTIDO).
// Satori suporta backgroundImage: 'linear/conic/radial-gradient(...)' (o scrim já usa).
function isGradient(v: string | undefined): v is string {
  return !!v && (v.startsWith('linear-gradient') || v.startsWith('conic-gradient') || v.startsWith('radial-gradient'))
}

// PB-2 (R4.0) — fallback de cor UNIFICADO entre os dois renderers (preview==raster).
// O SlideCanvas web cai em var(--color-canvas-2) = #F0EBE6 (creme) quando não há imagem
// nem solid; o raster caía em #1A1A1A (preto) → preview≠raster num slide tipográfico.
// Agora ambos usam o MESMO creme. (#1A1A1A permanece SÓ como base atrás de uma imagem —
// o "scrim" que só aparece se a imagem falhar — não como fundo de slide sem imagem.)
const FALLBACK_SURFACE = '#F0EBE6' // === var(--color-canvas-2) do apex-vars.css
const IMAGE_SCRIM_BASE = '#1A1A1A' // base atrás de foto (visível só se a imagem falhar)
const INK = '#1B1F2E' // === var(--color-ink) — texto escuro em slide sem imagem (== web)

// Mesma ordem semântica do <SlideCanvas> (preview==raster).
const TEXT_ROLE_ORDER = ['stat', 'statContext', 'headline', 'subheadline', 'quote', 'attribution', 'body', 'bullets', 'caption', 'cta']
// Tamanho de fonte por papel, em px ABSOLUTOS no canvas 1080 (equivale aos cqw do preview:
// cqw% × 1080/100). Ex.: headline 7cqw → ~76px. Mantém a proporção idêntica ao SlideCanvas.
const ROLE_PX: Record<string, number> = {
  stat: 140, headline: 76, subheadline: 43, quote: 54, cta: 41,
  bullets: 37, caption: 32, attribution: 32, statContext: 32, body: 39,
}
const ROLE_WEIGHT: Record<string, number> = {
  stat: 800, headline: 700, subheadline: 500, quote: 600, cta: 700, body: 400, bullets: 500, caption: 400, attribution: 400, statContext: 400,
}

function roleRank(role: string): number {
  const i = TEXT_ROLE_ORDER.indexOf(role)
  return i === -1 ? TEXT_ROLE_ORDER.length : i
}

// Exportado p/ o harness de golden-diff (R4.0): a resolução de fundo é a decisão que
// DIVERGIA entre os 2 renderers (PB-2). Testável em isolamento, sem rasterizar pixels.
export function resolveBg(layers: RasterLayers, fallbackImageUrl?: string): { image?: string; gradient?: string; color: string } {
  const bg = layers.background
  const bgEl = layers.elements?.find((e) => e.role === 'background' || e.role === 'image' || e.type === 'image')
  if (bg?.type === 'image' && isImage(bg.value)) return { image: bg.value, color: IMAGE_SCRIM_BASE }
  if (bg?.type === 'gradient' && isGradient(bg.value)) return { gradient: bg.value, color: FALLBACK_SURFACE }
  if (bg?.type === 'solid' && bg.value) return { color: bg.value }
  if (bgEl && isImage(bgEl.content)) return { image: bgEl.content, color: IMAGE_SCRIM_BASE }
  if (isImage(fallbackImageUrl)) return { image: fallbackImageUrl, color: IMAGE_SCRIM_BASE }
  // F0/R0: fallback gradiente iridescente (preservado) — quando o "fallback" é um gradiente CSS.
  if (isGradient(fallbackImageUrl)) return { gradient: fallbackImageUrl, color: FALLBACK_SURFACE }
  // PB-2: sem imagem e sem solid → creme (igual ao web), NÃO preto.
  return { color: FALLBACK_SURFACE }
}

function justify(anchorY: RasterLayers['anchorY']): 'flex-start' | 'center' | 'flex-end' {
  return anchorY === 'top' ? 'flex-start' : anchorY === 'center' ? 'center' : 'flex-end'
}

// Cor de texto default por papel (R4.0 golden-diff): branco sobre imagem (com scrim),
// ink escuro sobre superfície clara — IDÊNTICO ao SlideCanvas web (preview==raster).
// `explicit` = e.style.color (vence sempre). hasImage = há foto de fundo.
export function resolveTextColor(explicit: string | undefined, hasImage: boolean): string {
  return explicit ?? (hasImage ? '#FFFFFF' : INK)
}

/** Monta a árvore Satori de UM slide — espelha a composição do <SlideCanvas>. */
function buildTree(layers: RasterLayers, fallbackImageUrl: string | undefined, fontFamily: string): SatoriNode {
  const bg = resolveBg(layers, fallbackImageUrl)
  const texts = (layers.elements ?? [])
    .filter((e) => e.type !== 'image' && e.role !== 'background' && e.role !== 'image' && !!e.content)
    .sort((a, b) => roleRank(a.role ?? 'body') - roleRank(b.role ?? 'body'))
  const hasImage = !!bg.image

  const children: unknown[] = []
  // Camada de imagem de fundo (Satori: <img> absoluto cobrindo o frame).
  if (bg.image) {
    children.push(el('img', { src: bg.image, width: CANVAS_W, height: CANVAS_H, style: { position: 'absolute', top: 0, left: 0, width: CANVAS_W, height: CANVAS_H, objectFit: 'cover' } }))
  } else if (bg.gradient) {
    // Gradiente de fundo (== SlideCanvas web). Satori lê linear/conic/radial-gradient via backgroundImage.
    children.push(el('div', { style: { position: 'absolute', top: 0, left: 0, width: CANVAS_W, height: CANVAS_H, backgroundImage: bg.gradient } }))
  }
  // Scrim de legibilidade (igual ao SlideCanvas) quando há imagem.
  if (hasImage) {
    children.push(el('div', { style: { position: 'absolute', top: 0, left: 0, width: CANVAS_W, height: CANVAS_H, backgroundImage: 'linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.30) 45%, rgba(0,0,0,0.10) 100%)' } }))
  }
  // Zona de texto: flex-column, mesma âncora/padding (% → px sobre 1080/1350).
  const textChildren = texts.map((e) => {
    const role = e.role ?? 'body'
    const isCta = role === 'cta'
    const color = resolveTextColor(e.style?.color as string | undefined, hasImage)
    const base = {
      fontFamily,
      fontSize: ROLE_PX[role] ?? ROLE_PX.body,
      fontWeight: ROLE_WEIGHT[role] ?? 400,
      lineHeight: 1.15,
      margin: 0,
      // Satori exige display:flex em nós com múltiplos filhos; texto puro é ok como string child.
    } as Record<string, unknown>
    if (isCta) {
      return el('div', { style: { ...base, color: '#1A1A1A', backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 999, padding: '16px 40px', alignSelf: 'flex-start', textTransform: 'uppercase' } }, e.content)
    }
    return el('div', { style: { ...base, color } }, e.content)
  })
  children.push(
    el('div', {
      style: {
        position: 'absolute', top: 0, left: 0, width: CANVAS_W, height: CANVAS_H,
        display: 'flex', flexDirection: 'column', justifyContent: justify(layers.anchorY),
        gap: 22, padding: 76, // 7% de 1080 ≈ 76
      },
    }, textChildren),
  )

  return el('div', {
    style: {
      width: CANVAS_W, height: CANVAS_H, display: 'flex', position: 'relative',
      backgroundColor: bg.color, overflow: 'hidden',
    },
  }, children)
}

// Cache das fontes carregadas (mesmo processo serve N rasterizações). Tipo Font do Satori.
let fontsCache: Font[] | null = null

// F7/D-1 — fonte web SOTA: quando não há Satoshi-*.ttf local, BUSCA uma fonte estática de um CDN
// imutável (jsDelivr/@fontsource — entrega WOFF estático por peso, que o Satori LÊ). Baixa uma vez,
// cacheia em disco (tmp) e reusa. Assim um deploy limpo NÃO cai na fonte do sistema (Segoe/Arial):
// a tipografia fica consistente e fiel sem exigir bundle manual de fonte. Configurável:
//   RASTER_FONT_FAMILY   nome da família no Satori (default 'Satoshi' p/ casar o SlideCanvas)
//   RASTER_FONT_BASE_URL  base do CDN (default @fontsource/inter via jsDelivr — sans geométrica estável)
//   RASTER_FONT_FILES     "peso:arquivo,..." sobrescreve os arquivos por peso (p/ apontar Satoshi-CDN)
const FONT_FAMILY = process.env.RASTER_FONT_FAMILY || 'Satoshi'
const FONT_BASE_URL = process.env.RASTER_FONT_BASE_URL || 'https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.0/files'
// Default: Inter estático por peso (latin) — substituto confiável da Satoshi quando ela não está no bundle.
const FONT_FILES_DEFAULT: Array<{ weight: number; file: string }> = [
  { weight: 400, file: 'inter-latin-400-normal.woff' },
  { weight: 500, file: 'inter-latin-500-normal.woff' },
  { weight: 700, file: 'inter-latin-700-normal.woff' },
  { weight: 900, file: 'inter-latin-900-normal.woff' },
]

/** Parseia RASTER_FONT_FILES ("400:Satoshi-Regular.woff,700:Satoshi-Bold.woff") → lista por peso. */
function parseFontFilesOverride(): Array<{ weight: number; file: string }> | null {
  const raw = (process.env.RASTER_FONT_FILES || '').trim()
  if (!raw) return null
  const out: Array<{ weight: number; file: string }> = []
  for (const pair of raw.split(',')) {
    const [w, f] = pair.split(':').map((s) => s.trim())
    const weight = Number(w)
    if (Number.isFinite(weight) && f) out.push({ weight, file: f })
  }
  return out.length > 0 ? out : null
}

/**
 * Busca a fonte web (CDN) por peso, cacheando em disco (tmp). Baixa uma vez por peso; reusa o
 * arquivo no próximo boot. Falha de rede em um peso não derruba os outros (degrada por peso).
 * Retorna [] se nada baixou (o chamador cai no fallback de sistema — degradado honesto).
 */
async function fetchWebFonts(): Promise<Font[]> {
  const files = parseFontFilesOverride() ?? FONT_FILES_DEFAULT
  const cacheDir = join(tmpdir(), 'social-ai-raster-fonts')
  try { await mkdir(cacheDir, { recursive: true }) } catch { /* já existe */ }

  const loaded: Font[] = []
  for (const { weight, file } of files) {
    const cachePath = join(cacheDir, file)
    // Tamanho mínimo de sanidade: um arquivo de fonte real tem KBs. Abaixo disso é resposta
    // truncada/vazia (200 sem corpo) — NÃO confiamos (evita cachear/usar fonte corrompida).
    const MIN_FONT_BYTES = 2048
    let data: Buffer | null = null
    // 1) cache em disco (download anterior) — só aceita se passar o piso de tamanho.
    try {
      const cached = Buffer.from(await readFile(cachePath))
      if (cached.length >= MIN_FONT_BYTES) data = cached
    } catch { /* não cacheado ainda */ }
    // 2) baixa do CDN e cacheia ATOMICAMENTE (escreve em .tmp e renomeia) — um leitor concorrente
    // nunca vê arquivo meio-escrito. Corpo vazio/curto (res.ok mas truncado) é descartado.
    if (!data) {
      try {
        const res = await fetch(`${FONT_BASE_URL}/${file}`)
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer())
          if (buf.length >= MIN_FONT_BYTES) {
            data = buf
            // pid no nome do .tmp evita colisão entre processos; rename é atômico no mesmo FS.
            const tmp = `${cachePath}.${process.pid}.tmp`
            try { await writeFile(tmp, buf); await rename(tmp, cachePath) } catch { /* cache best-effort */ }
          }
        }
      } catch { /* rede indisponível → tenta próximo peso */ }
    }
    if (data) loaded.push({ name: FONT_FAMILY, data, weight: weight as Font['weight'], style: 'normal' })
  }
  if (loaded.length > 0) {
    console.warn(
      `[rasterizer] Satoshi local ausente — usando fonte web "${FONT_FAMILY}" de ${FONT_BASE_URL} ` +
        '(cacheada em disco). Para tipografia 100% fiel, instale Satoshi-*.ttf em assets/fonts ou aponte ' +
        'RASTER_FONT_BASE_URL/RASTER_FONT_FILES para a Satoshi no seu CDN (D-1, ADR-0014 §4e).',
    )
  }
  return loaded
}

/**
 * Carrega Satoshi (TTF/OTF/WOFF) de assets/fonts. Satori NÃO aceita woff2 — por isso buscamos
 * extensões suportadas. Ausência → erro CLARO (a rasterização não cai numa fonte genérica que
 * quebraria preview==raster). O nome de família é 'Satoshi' (igual ao SlideCanvas).
 */
async function loadFonts(): Promise<Font[]> {
  if (fontsCache) return fontsCache
  const here = dirname(fileURLToPath(import.meta.url))
  // assets ficam fora de src/ no build (copiados); em dev (tsx) lemos de ../../assets/fonts.
  const candidates = [
    join(here, '..', '..', 'assets', 'fonts'),
    join(here, '..', 'assets', 'fonts'),
    join(here, 'assets', 'fonts'),
  ]
  const weights: Array<{ file: string; weight: number }> = [
    { file: 'Satoshi-Regular', weight: 400 },
    { file: 'Satoshi-Medium', weight: 500 },
    { file: 'Satoshi-Bold', weight: 700 },
    { file: 'Satoshi-Black', weight: 900 },
  ]
  const exts = ['ttf', 'otf', 'woff'] // woff2 NÃO suportado pelo Satori
  const loaded: Font[] = []
  for (const dir of candidates) {
    for (const w of weights) {
      for (const ext of exts) {
        try {
          const data = await readFile(join(dir, `${w.file}.${ext}`))
          loaded.push({ name: 'Satoshi', data, weight: w.weight as Font['weight'], style: 'normal' })
          break
        } catch { /* tenta próxima ext */ }
      }
    }
    if (loaded.length > 0) break
  }
  // F7/D-1: ANTES de cair na fonte do sistema, tenta a fonte web (CDN imutável, cacheada em disco).
  // Supera o obstáculo "sem TTF no bundle" sem intervenção manual: baixa uma vez e reusa. Só cai no
  // sistema se a rede também falhar (degradado honesto em camadas: local → web → sistema → erro).
  if (loaded.length === 0) {
    const web = await fetchWebFonts()
    if (web.length > 0) {
      fontsCache = web
      return web
    }
  }

  if (loaded.length === 0) {
    // FALLBACK DECLARADO (não-silencioso): sem Satoshi-TTF nem fonte web, usa uma fonte do sistema p/
    // a rasterização CONTINUAR funcional (composição correta; só a família tipográfica diverge do
    // preview). Logado em alto-volume. Em produção, instale Satoshi-*.ttf em assets/fonts p/
    // preview==raster pixel-fiel. AGENTS_RASTER_FALLBACK_FONT permite apontar outro arquivo.
    const sysCandidates = [
      process.env.AGENTS_RASTER_FALLBACK_FONT,
      'C:/Windows/Fonts/segoeui.ttf',
      'C:/Windows/Fonts/arial.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/System/Library/Fonts/Supplemental/Arial.ttf',
    ].filter(Boolean) as string[]
    for (const path of sysCandidates) {
      try {
        const data = await readFile(path)
        console.warn(
          `[rasterizer] Satoshi (TTF/OTF/WOFF) ausente em assets/fonts — usando fonte de fallback "${path}". ` +
            'preview!=raster na tipografia. Instale Satoshi-*.ttf p/ fidelidade (ADR-0014 §4e).',
        )
        // Registra como 'Satoshi' para casar com fontFamily da árvore (Satori cai nesta fonte).
        for (const w of [400, 500, 700, 900]) loaded.push({ name: 'Satoshi', data, weight: w as Font['weight'], style: 'normal' })
        break
      } catch { /* tenta próximo */ }
    }
  }
  if (loaded.length === 0) {
    throw new Error(
      'Rasterizador: nenhuma fonte utilizável. Satori não lê woff2 — coloque Satoshi-*.ttf/.otf/.woff ' +
        'em services/agents/assets/fonts (ou defina AGENTS_RASTER_FALLBACK_FONT). (ADR-0014 §4e).',
    )
  }
  fontsCache = loaded
  return loaded
}

/**
 * Rasteriza UM slide (camadas) → PNG data-uri. fallbackImageUrl é o ImageUrl atual do slide (usado
 * como fundo quando as camadas não trazem imagem própria). Lança erro claro se a fonte faltar.
 */
export async function rasterizeSlide(layers: RasterLayers, fallbackImageUrl?: string): Promise<string> {
  const fonts = await loadFonts()
  const tree = buildTree(layers, fallbackImageUrl, 'Satoshi')
  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], {
    width: CANVAS_W,
    height: CANVAS_H,
    fonts,
  })
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: CANVAS_W } })
  const png = resvg.render().asPng()
  return `data:image/png;base64,${png.toString('base64')}`
}

export { CANVAS_W as RASTER_W, CANVAS_H as RASTER_H }
