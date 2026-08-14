/**
 * Render Engine Agent v2.0
 * Social AI Platform — portado do branding-os.
 *
 * O SEXTO e ÚLTIMO agente do pipeline.
 * Transforma especificações visuais em HTML/CSS renderizável.
 *
 * NOTA: Este agente é DETERMINÍSTICO - não usa IA.
 * Ele simplesmente converte a especificação visual em código.
 */

import type {
  VisualSpecification,
  SlideVisualSpec,
  VisualElement,
  ElementStyle,
  RenderOutput,
  RenderedSlide,
} from '@/types/pipeline'
import type { BrandDesignSpec } from '../brand/design-spec.js'

// ADR-0012 PR5 — assets inline (data-URI). Antes, o render referenciava /assets/patterns/*.svg
// por PATH; esses arquivos NÃO existem no runtime do agents → ícones não carregavam (quebra
// visual silenciosa). Agora os 3 assets são SVGs inline, desenhados limpos e minimalistas,
// herdando a cor da marca via currentColor (que o CSS amarra a var(--bd-ink)). Sem dependência
// de arquivo, sempre renderizáveis. Encode URL-safe (mais legível que base64 para SVG).
function svgDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg.trim())}`
}

// Seta de "deslize" (→) — traço fino, currentColor; usada no cover e no botão de swipe do body.
const ASSET_SETA_DESLIZE = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="48" viewBox="0 0 80 48" fill="none">
    <path d="M16 24h44m0 0-14-14m14 14-14 14" stroke="currentColor" stroke-width="3"
      stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
)

// Checkmark (✓) num círculo — bullet da lista do body; currentColor.
const ASSET_CHECKED = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="20" r="18" stroke="currentColor" stroke-width="2.5" opacity="0.35"/>
    <path d="M12 20.5l5.5 5.5L28 14" stroke="currentColor" stroke-width="3"
      stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
)

// Listras verticais sutis — padrão de fundo do body/last; opacidade baixa via o próprio SVG.
const ASSET_LISTRAS = svgDataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"
    preserveAspectRatio="none"><g stroke="currentColor" stroke-width="1" opacity="0.06">
    <line x1="12" y1="0" x2="12" y2="48"/><line x1="24" y1="0" x2="24" y2="48"/>
    <line x1="36" y1="0" x2="36" y2="48"/></g></svg>`,
)

// Escapa conteúdo textual vindo do LLM antes de interpolá-lo no HTML dos templates. Sem isto, um
// '<', '&' ou '"' literal numa headline/stat/quote/cta quebra a marcação do slide (e, num contexto
// de preview/browser, abriria espaço p/ injeção). O render é determinístico, então escapar aqui é
// barato e fecha o buraco de saída de forma uniforme nos 3 templates (cover/body/last).
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ============================================
// RENDER ENGINE (No AI - Pure Transformation)
// ============================================

export class RenderEngine {
  /* ===========================================================================
   * TEMPLATE SYSTEMS (FIGMA EXACT MATCH)
   * =========================================================================== */

  // Registry de CSS por template — permite propagação do spec sem alterar o contrato externo.
  // Sem spec: cada fn retorna exatamente o mesmo literal de hoje (byte-idêntico → snapshot não quebra).
  // Com spec: var(--bd-TOKEN, LITERAL_ATUAL) — o fallback garante identidade sem vars no :root.
  private static readonly TEMPLATE_CSS: Record<string, (spec?: BrandDesignSpec) => string> = {
    'branding-os-cover-v1': (spec) => `
        /* Cover Template Layout - Figma Node 35:1321 - ABSOLUTE POSITIONING */
        .slide-content-cover {
          position: relative;
          width: 100%;
          height: 100%;
          z-index: 10;
        }

        /* Header - ABSOLUTE: top: 80px */
        .cover-header {
          position: absolute;
          top: 80px;
          left: 80px;
          right: 80px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .cover-header-text {
          font-family: var(--bd-font-heading, 'Inter'), sans-serif;
          font-size: 18px;
          font-weight: 600;
          line-height: 21.78px;
          color: var(--bd-on-image, #FFFFFF);
          letter-spacing: 0px;
        }

        /* Text wrapper - FLEXBOX positioned at bottom for consistent spacing */
        .cover-text-wrapper {
          position: absolute;
          bottom: 90px;
          left: 80px;
          width: 920px;
          display: flex;
          flex-direction: column;
          gap: 32px; /* Consistent 32px gap between headline and subtitle */
        }

        /* Headline - flows naturally inside wrapper */
        .cover-title {
          font-family: var(--bd-font-heading, 'Inter'), sans-serif;
          font-size: 96px;
          font-weight: 600;
          line-height: 104px;
          letter-spacing: 0px;
          color: var(--bd-on-image, #FFFFFF);
          text-align: left;
          margin: 0;
        }

        /* Subtitle - flows naturally below headline with 32px gap */
        .cover-subtitle {
          font-family: var(--bd-font-heading, 'Inter'), sans-serif;
          font-size: 32px;
          font-weight: 600;
          line-height: 40px;
          color: var(--bd-muted, #969696);
          text-align: left;
          margin: 0;
        }

        /* GRADIENT OVERLAY - Figma exact: starts at y=42.78%, diagonal to bottom-left (208deg) */
        .cover-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            208deg,
            transparent 0%,
            transparent 42%,
            rgba(0,0,0,0.2) 48%,
            rgba(0,0,0,0.7) 55%,
            rgba(0,0,0,1) 62%,
            rgba(0,0,0,1) 100%
          );
          z-index: 2;
        }

        /* Top gradient - subtle fade at top */
        .cover-top-gradient {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 13%;
          background: linear-gradient(to bottom, rgba(0,0,0,0.32) 0%, rgba(0,0,0,0) 100%);
          z-index: 3;
        }

        /* Arrow button - ABSOLUTE: bottom: 84px, right: 83px (Figma exact) */
        .cover-arrow-btn {
          position: absolute;
          bottom: 84px;
          right: 83px;
          width: 80px;
          height: 48px;
          z-index: 20;
        }

        .cover-arrow-btn img {
          width: 100%;
          height: 100%;
        }
      `,

    'branding-os-body-v1': (spec) => `
        /* Body Template Layout - Figma Node 28:1018 - ABSOLUTE POSITIONING */

        .slide-content-body {
          position: relative;
          width: 100%;
          height: 100%;
          z-index: 2;
        }

        /* Vertical stripe pattern - using listras-fundo.svg */
        .body-stripes {
          position: absolute;
          top: 80px;
          left: 79px;
          right: 79px;
          height: 1190px;
          background-image: url("${ASSET_LISTRAS}");
          background-repeat: repeat-x;
          background-position: center;
          background-size: 923px 100%;
          pointer-events: none;
          z-index: 1;
          color: var(--bd-ink, #FFFFFF);
        }

        /* Header - ABSOLUTE: top: 80px (Figma exact) */
        .body-header {
          position: absolute;
          top: 80px;
          left: 80px;
          right: 80px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          z-index: 10;
        }

        .body-header-text {
          font-family: var(--bd-font-heading, 'Inter'), sans-serif;
          font-size: 18px;
          font-weight: 600;
          line-height: 21.78px;
          color: var(--bd-muted, #646464);
          letter-spacing: 0px;
        }

        /* Text container - FLEXBOX for proper spacing regardless of line count */
        .body-text-wrapper {
          position: absolute;
          top: 223px;
          left: 157px;
          width: 770px;
          display: flex;
          flex-direction: column;
          gap: 20px; /* Consistent 20px gap between headline and body */
          z-index: 10;
        }

        /* Headline - now flows naturally inside wrapper */
        .body-headline {
          font-family: var(--bd-font-heading, 'Inter'), sans-serif;
          font-size: 48px;
          font-weight: 600;
          line-height: 58px;
          color: var(--bd-on-image, #FFFFFF);
          margin: 0;
        }

        /* Body text - now flows naturally below headline with 20px gap */
        .body-text {
          font-family: var(--bd-font-heading, 'Inter'), sans-serif;
          font-size: 32px;
          font-weight: 600;
          line-height: 38px;
          color: var(--bd-muted, #888888);
          white-space: pre-line;
          margin: 0;
        }

        /* Bullet List - flows naturally below headline */
        .body-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .body-list li {
          font-family: var(--bd-font-heading, 'Inter'), sans-serif;
          font-size: 32px;
          font-weight: 600;
          line-height: 38px;
          color: var(--bd-muted, #888888);
          margin-bottom: 24px;
          display: flex;
          align-items: flex-start;
          gap: 16px;
        }

        /* Checkbox icon - using checked.svg (40x40) */
        .body-list li::before {
          content: "";
          display: block;
          width: 40px;
          height: 40px;
          background-image: url("${ASSET_CHECKED}");
          background-size: contain;
          background-repeat: no-repeat;
          flex-shrink: 0;
          color: var(--bd-accent, #FFD44A);
        }

        /* Stat block (layout stat-highlight) — número grande de destaque + contexto sutil,
           a partir dos papéis 'stat'/'statContext'. */
        .body-stat {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .body-stat-number {
          font-family: var(--bd-font-heading, 'Inter'), sans-serif;
          font-size: 120px;
          font-weight: 700;
          line-height: 1.05;
          color: var(--bd-accent, #FFD44A);
          letter-spacing: -2px;
        }

        .body-stat-context {
          font-family: var(--bd-font-heading, 'Inter'), sans-serif;
          font-size: 28px;
          font-weight: 600;
          line-height: 34px;
          color: var(--bd-muted, #888888);
        }

        /* Quote block (layout testimonial) — citação + autoria. Honra 'quote'/'attribution'. */
        .body-quote {
          margin: 0;
          border-left: 4px solid var(--bd-accent, #FFD44A);
          padding-left: 28px;
        }

        .body-quote-text {
          font-family: var(--bd-font-heading, 'Inter'), sans-serif;
          font-size: 36px;
          font-weight: 600;
          line-height: 46px;
          color: var(--bd-on-image, #FFFFFF);
          margin: 0;
        }

        .body-quote-attrib {
          font-family: var(--bd-font-heading, 'Inter'), sans-serif;
          font-size: 22px;
          font-weight: 600;
          line-height: 28px;
          color: var(--bd-muted, #888888);
          margin-top: 16px;
        }

        /* CTA inline no corpo (ex.: oferta) — pílula com a cor de destaque da marca. */
        .body-cta {
          align-self: flex-start;
          font-family: var(--bd-font-heading, 'Inter'), sans-serif;
          font-size: 26px;
          font-weight: 600;
          line-height: 32px;
          color: var(--bd-background, #1A1A1A);
          background-color: var(--bd-accent, #FFD44A);
          padding: 20px 40px;
          border-radius: var(--bd-radius-pill, 999px);
        }

        /* IMAGE - ABSOLUTE: top: 519px, left: 80px (Figma exact - CRITICAL FIX) */
        .body-image-container {
          position: absolute;
          top: 519px;
          left: 80px;
          width: 924px;
          height: 634px;
          border-radius: 16px;
          overflow: hidden;
          z-index: 5;
        }

        .body-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center center;
        }

        /* Pagination - ABSOLUTE: y=1239, x=80 (Figma Frame 159) */
        .body-pagination {
          position: absolute;
          top: 1239px;
          left: 80px;
          display: flex;
          align-items: center;
          gap: 16px;
          z-index: 20;
        }

        .pagination-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          /* dots = "outros slides" (neutros) → muted da marca; fallback byte-idêntico ao Figma. */
          background-color: var(--bd-muted, #484848);
        }

        .pagination-number {
          font-family: var(--bd-font-heading, 'Inter'), sans-serif;
          font-size: 18px;
          font-weight: 600;
          line-height: 21.78px;
          color: var(--bd-accent, #FFD44A);
        }

        /* Swipe pill button - ABSOLUTE: y=1214, right=80 (Figma Frame 156) */
        .swipe-pill {
          position: absolute;
          top: 1214px;
          right: 80px;
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 4px 4px 4px 32px;
          background-color: #242424;
          border-radius: 2000px;
          z-index: 20;
        }

        .swipe-text {
          font-family: var(--bd-font-heading, 'Inter'), sans-serif;
          font-size: 18px;
          font-weight: 600;
          line-height: 21.78px;
          color: #646464;
        }

        /* Arrow button - using seta-deslize.svg */
        .swipe-arrow-btn {
          width: 80px;
          height: 48px;
        }

        .swipe-arrow-btn img {
          width: 100%;
          height: 100%;
        }
      `,

    'branding-os-last-v1': (spec) => `
        /* Final Template Layout - Figma Node 35:1335 - ABSOLUTE POSITIONING */

        .slide-content-last {
          position: relative;
          width: 100%;
          height: 100%;
          z-index: 2;
        }

        /* Vertical stripe pattern - very subtle (opacity 0.02) — inline data-URI (PR5) */
        .last-stripes {
          position: absolute;
          top: 80px;
          left: 79px;
          right: 79px;
          height: 1190px;
          background-image: url("${ASSET_LISTRAS}");
          background-repeat: repeat-x;
          background-position: center;
          background-size: 923px 100%;
          color: var(--bd-text, #000000);
          opacity: 0.02;
          pointer-events: none;
          z-index: 1;
        }

        /* Header - ABSOLUTE: top: 80px (Figma exact) */
        .last-header {
          position: absolute;
          top: 80px;
          left: 80px;
          right: 80px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          z-index: 10;
        }

        .last-header-text {
          font-family: var(--bd-font-heading, 'Inter'), sans-serif;
          font-size: 18px;
          font-weight: 600;
          line-height: 21.78px;
          color: var(--bd-accent, #D0A711);
          letter-spacing: 0px;
        }

        /* Text wrapper - FLEXBOX for consistent spacing */
        .last-text-wrapper {
          position: absolute;
          top: 228px;
          left: 158px;
          width: 770px;
          display: flex;
          flex-direction: column;
          gap: 20px; /* Consistent gap between headline and body */
          z-index: 10;
        }

        /* Headline - flows naturally inside wrapper */
        .last-headline {
          font-family: var(--bd-font-heading, 'Inter'), sans-serif;
          font-size: 48px;
          font-weight: 600;
          line-height: 58px;
          color: var(--bd-text, #000000);
          margin: 0;
        }

        /* Body - flows naturally below headline with 20px gap */
        .last-body {
          font-family: var(--bd-font-heading, 'Inter'), sans-serif;
          font-size: 32px;
          font-weight: 600;
          line-height: 38.73px;
          color: var(--bd-text, #242424);
          margin: 0;
        }

        /* CTA Button - ABSOLUTE: top: 562px, left: 158px (Figma exact) */
        .last-cta-btn {
          position: absolute;
          top: 562px;
          left: 158px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 32px 48px;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid transparent;
          border-radius: 200px;
          backdrop-filter: blur(4px);
          z-index: 10;
          /* Gradient border - diagonal from top-left to bottom-right */
          background-image: linear-gradient(rgba(255,255,255,0.08), rgba(255,255,255,0.08)),
                            linear-gradient(135deg, rgba(255,255,255,0.48) 0%, rgba(255,255,255,0.16) 51%, rgba(255,255,255,0.48) 100%);
          background-origin: border-box;
          background-clip: padding-box, border-box;
        }

        .last-cta-icon {
          width: 24px;
          height: 24px;
        }

        .last-cta-text {
          font-family: var(--bd-font-heading, 'Inter'), sans-serif;
          font-size: 24px;
          font-weight: 600;
          line-height: 29px;
          color: var(--bd-text, #000000);
        }

        /* IMAGE - ABSOLUTE: top: 687px, left: 80px (Figma exact) */
        .last-image-container {
          position: absolute;
          top: 687px;
          left: 80px;
          width: 924px;
          height: 583px;
          border-radius: 8px;
          overflow: hidden;
          z-index: 5;
        }

        .last-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center center;
        }
      `,

    /*
     * ADR-0015 PR2 — comparison-columns (o `comparison-vs` da spec "Templates atômicos em camadas").
     * UM lado forte por slide (decisão "1 lado por slide" — honestidade L5, sem 2º lado sem copy).
     * Linguagem visual da spec: eyebrow tracking (rótulo do lado) + body GRANDE protagonista, painel
     * de página inteira. 100% brand-agnostic (só var(--bd-*) — AC4): nenhum hex de marca literal.
     * A variante A (problema/antes) usa o fundo da marca; a B (solução/depois) preenche com --bd-accent.
     * Esqueleto comum às duas variantes (`.cmp-*`); a diferença A×B é só fundo + cor de texto.
     */
    'comparison-columns-a': () => RenderEngine.comparisonCSS('a'),
    'comparison-columns-b': () => RenderEngine.comparisonCSS('b'),
  }

  /**
   * Chrome de carrossel compartilhado (header + paginação + swipe-pill). Hoje cada blueprint
   * carrega o seu; os blueprints novos (PR2+) reusam ESTE para coerência. Não toca o body-v1
   * (que mantém o seu inline) → snapshot do body intacto (AC2). Só var(--bd-*), agnóstico.
   */
  private static carouselChromeCSS(onAccent = false): string {
    // Em painel de acento (lado B), o chrome (header/paginação) precisa contrastar com o ACENTO,
    // não com o fundo da marca — senão --bd-muted (derivado do bg) some sobre um acento claro.
    // onAccent=true → texto/dots usam --bd-on-accent (a cor que o Design Compiler garante legível
    // sobre o acento), com opacidade pra manter o chrome discreto. A pílula de swipe é escura e
    // autossuficiente nos dois casos. pagination-number: no lado B o acento é o FUNDO, então o
    // número ativo usa on-accent (não acento sobre acento → invisível).
    const chromeText = onAccent ? 'var(--bd-on-accent, #1A1A1A)' : 'var(--bd-muted, #646464)'
    const dotColor = onAccent ? 'var(--bd-on-accent, #1A1A1A)' : 'var(--bd-muted, #484848)'
    const numColor = onAccent ? 'var(--bd-on-accent, #1A1A1A)' : 'var(--bd-accent, #FFD44A)'
    const chromeOpacity = onAccent ? '0.65' : '1'
    return `
        .body-header {
          position: absolute;
          top: 80px;
          left: 80px;
          right: 80px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          z-index: 20;
        }
        .body-header-text {
          font-family: var(--bd-font-heading, 'Inter'), sans-serif;
          font-size: 18px;
          font-weight: 600;
          line-height: 21.78px;
          color: ${chromeText};
          opacity: ${chromeOpacity};
        }
        .body-pagination {
          position: absolute;
          top: 1239px;
          left: 80px;
          display: flex;
          align-items: center;
          gap: 16px;
          z-index: 20;
        }
        .pagination-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background-color: ${dotColor};
          opacity: ${chromeOpacity};
        }
        .pagination-number {
          font-family: var(--bd-font-heading, 'Inter'), sans-serif;
          font-size: 18px;
          font-weight: 600;
          line-height: 21.78px;
          color: ${numColor};
        }
        .swipe-pill {
          position: absolute;
          top: 1214px;
          right: 80px;
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 4px 4px 4px 32px;
          background-color: #242424;
          border-radius: 2000px;
          z-index: 20;
        }
        .swipe-text {
          font-family: var(--bd-font-heading, 'Inter'), sans-serif;
          font-size: 18px;
          font-weight: 600;
          line-height: 21.78px;
          color: #646464;
        }
        .swipe-arrow-btn { width: 80px; height: 48px; }
        .swipe-arrow-btn img { width: 100%; height: 100%; }
      `
  }

  /** CSS da família comparison-columns. side='a' (antes/fundo da marca) | 'b' (depois/painel acento). */
  private static comparisonCSS(side: 'a' | 'b'): string {
    // Lado B inverte a relação figura-fundo: fundo = acento, texto = a cor que contrasta com o acento
    // (--bd-on-accent, derivada pelo Design Compiler). Lado A = fundo da marca, texto = ink/on-image.
    const isB = side === 'b'
    const panelBg = isB ? 'var(--bd-accent, #FFD44A)' : 'var(--bd-background, #000000)'
    const labelColor = isB
      ? 'var(--bd-on-accent, #1A1A1A)'
      : 'var(--bd-accent, #FFD44A)'   // lado A: o rótulo herda o acento da marca sobre o fundo
    const bodyColor = isB ? 'var(--bd-on-accent, #1A1A1A)' : 'var(--bd-on-image, #FFFFFF)'
    const ruleColor = isB ? 'var(--bd-on-accent, #1A1A1A)' : 'var(--bd-muted, #646464)'
    return `
        ${RenderEngine.carouselChromeCSS(isB)}

        /* comparison-columns — lado ${side.toUpperCase()} (ADR-0015 PR2). Painel de página inteira. */
        .cmp-panel {
          position: absolute;
          inset: 0;
          background-color: ${panelBg};
          z-index: 1;
        }

        /* Régua de "lado": barra curta sob o rótulo, sinaliza a divisão sem o nó VS (1 lado/slide). */
        .cmp-rule {
          position: absolute;
          top: 200px;
          left: 112px;
          width: 96px;
          height: 6px;
          background-color: ${ruleColor};
          opacity: 0.5;
          z-index: 10;
        }

        .cmp-content {
          position: absolute;
          top: 240px;
          left: 112px;
          right: 112px;
          z-index: 10;
          display: flex;
          flex-direction: column;
          gap: 32px;
        }

        /* Rótulo do lado (eyebrow): tracking largo, caixa-alta — a assinatura do comparativo. */
        .cmp-label {
          font-family: var(--bd-font-heading, 'Inter'), sans-serif;
          font-size: 26px;
          font-weight: 700;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: ${labelColor};
          margin: 0;
        }

        /* Descrição: o protagonista. Body grande, line-height apertado — peso editorial da spec. */
        .cmp-body {
          font-family: var(--bd-font-heading, 'Inter'), sans-serif;
          font-size: 64px;
          font-weight: ${isB ? '600' : '500'};
          line-height: 1.08;
          letter-spacing: -0.02em;
          color: ${bodyColor};
          margin: 0;
          /* clamp anti-overflow: a copy do archetype é ≤140 char; corta com reticências se exceder. */
          display: -webkit-box;
          -webkit-line-clamp: 6;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        /* Caption opcional (swipe / micro-contexto), discreta no rodapé seguro. */
        .cmp-caption {
          position: absolute;
          left: 112px;
          bottom: 120px;
          font-family: var(--bd-font-heading, 'Inter'), sans-serif;
          font-size: 22px;
          font-weight: 500;
          color: ${ruleColor};
          z-index: 10;
          margin: 0;
        }
      `
  }

  private getTemplateCSS(layoutId: string, spec?: BrandDesignSpec): string {
    return (RenderEngine.TEMPLATE_CSS[layoutId] ?? (() => ''))(spec)
  }

  /**
   * ADR-0012 PR4 — composição de imagem-no-layout (Caminho A: <img>). Emite um atributo
   * style="..." inline a partir dos campos OPCIONAIS de ElementStyle, derivando object-fit,
   * object-position (de objectPosition ou focalPoint) e transform:scale. Quando NENHUM campo
   * está presente, retorna '' (string vazia) → o <img> fica idêntico ao atual e o CSS
   * .body-image/.last-image (object-fit:cover;object-position:center center) prevalece →
   * snapshot de baseline intacto. Inline ganha por especificidade quando presente.
   */
  static imageCompositionAttr(style?: ElementStyle): string {
    if (!style) return ''
    const parts: string[] = []
    if (style.objectFit) parts.push(`object-fit: ${style.objectFit}`)
    const pos = style.objectPosition
      ?? (style.focalPoint ? `${style.focalPoint.x * 100}% ${style.focalPoint.y * 100}%` : undefined)
    if (pos) parts.push(`object-position: ${pos}`)
    if (style.scale && style.scale !== 1) parts.push(`transform: scale(${style.scale})`)
    return parts.length ? ` style="${parts.join('; ')}"` : ''
  }

  /**
   * ADR-0012 PR4 — composição do background do cover (Caminho B: ::before). Deriva background-size
   * e background-position dos campos OPCIONAIS. Defaults = 'cover'/'center' (idêntico ao atual →
   * snapshot intacto). objectFit:'contain'→'contain'; focalPoint/objectPosition controlam o foco.
   */
  static coverBackgroundComposition(style?: ElementStyle): { size: string; position: string } {
    const size = style?.objectFit === 'contain' ? 'contain' : 'cover'
    const position =
      style?.objectPosition
      ?? (style?.focalPoint ? `${style.focalPoint.x * 100}% ${style.focalPoint.y * 100}%` : 'center')
    return { size, position }
  }

  /**
   * LOGO da marca estampado no slide (toggle por-geração "usar identidade do logo"). Retorna o
   * markup do badge OU '' (string vazia) quando: o toggle está OFF, não há url, ou a url não é
   * http/data (mesma política de validação dos demais <img> do engine — nunca interpola url crua
   * de esquema arbitrário). Posição absoluta no canto inferior-esquerdo, fora da área de texto
   * dos 3 layouts; container com halo translúcido p/ legibilidade fundo-agnóstica (claro/escuro).
   * Estilo INLINE (não toca o CSS compartilhado) → quando OFF, o HTML é byte-equivalente ao atual.
   * A url passa por encodeURI p/ não quebrar o atributo (aspas/espaços); só http/data chegam aqui.
   */
  private static logoBadgeHtml(spec?: BrandDesignSpec): string {
    const logo = spec?.logo
    if (!logo?.enabled || !logo.url) return ''
    const url = logo.url
    if (!url.startsWith('http') && !url.startsWith('data:')) return ''
    const safeUrl = encodeURI(url).replace(/"/g, '%22')
    return `
          <!-- Logo da marca (toggle "usar identidade do logo") — canto inferior-esquerdo. -->
          <div style="position:absolute; left:80px; bottom:80px; z-index:5;
            display:flex; align-items:center; justify-content:center;
            padding:14px 18px; border-radius:16px;
            background:rgba(255,255,255,0.82); box-shadow:0 4px 14px -4px rgba(27,31,46,0.25);">
            <img src="${safeUrl}" alt="Logo" style="height:48px; max-width:200px; object-fit:contain; display:block;" />
          </div>`
  }

  /**
   * Render a slide using strict Template Logic
   */
  // S-12: parâmetro signature sem default — string vazia quando não fornecida.
  // Nunca usar handle de terceiro como fallback; o tenant deve configurar o seu.
  // totalSlides: nº REAL de slides do carrossel (paginação dinâmica). Default 8 preserva o
  // comportamento anterior quando o chamador não informa (byte-equivalente p/ carrosséis de 8).
  private renderTemplateSlide(slide: SlideVisualSpec, signature: string = '', designSpec?: BrandDesignSpec, totalSlides: number = 8): RenderedSlide {
    const index = slide.index || 1
    const layoutId = slide.layoutId || 'branding-os-body-v1'
    const canvas = slide.canvas || { width: 1080, height: 1350 }
    const elements = slide.elements || []

    let htmlContent = ''
    // S-12: fallback para string vazia — nunca substitui por handle de terceiro.
    const safeHandle = signature || ''
    const css = this.getTemplateCSS(layoutId, designSpec)

    // COVER RENDER (35:1321) - FLEXBOX layout for consistent spacing
    if (layoutId === 'branding-os-cover-v1') {
      // escapeHtml em todo conteúdo do LLM antes de ir ao HTML: um '<'/'&'/'"' literal
      // quebraria a marcação do slide.
      const headline = escapeHtml(elements.find(e => e.role === 'headline')?.content || '')
      const subheadline = escapeHtml(elements.find(e => e.role === 'subheadline')?.content || '')
      const hasSubheadline = subheadline && subheadline.trim().length > 0

      const bgElement = elements.find(e => e.role === 'background')
      const bgImage = bgElement?.content || ''
      const hasValidImage = bgImage && (bgImage.startsWith('http') || bgImage.startsWith('data:'))
      const bgUrl = hasValidImage ? bgImage : ''
      // ADR-0012 PR4 (Caminho B): composição do background do cover. Sem campos → 'cover'/'center'
      // (idêntico ao atual → snapshot intacto). focalPoint/objectPosition controlam o foco da foto.
      const bgComp = RenderEngine.coverBackgroundComposition(bgElement?.style)

      const slideCss = `
        .slide-${index} {
          position: relative;
          width: ${canvas.width}px;
          height: ${canvas.height}px;
          overflow: hidden;
          background-color: var(--bd-background, #000000);
        }

        ${hasValidImage ? `
        .slide-${index}::before {
          content: "";
          position: absolute;
          inset: 0;
          background-image: url('${bgUrl}');
          background-size: ${bgComp.size};
          background-position: ${bgComp.position};
          z-index: 0;
        }
        ` : ''}

        ${css}
      `

      htmlContent = `
        <div class="cover-overlay"></div>
        <div class="cover-top-gradient"></div>

        <div class="slide-content-cover">
          <!-- Header - ABSOLUTE: top: 80px -->
          <div class="cover-header">
            <span class="cover-header-text">${safeHandle}</span>
            <span class="cover-header-text">© ${new Date().getFullYear()} Todos os direitos reservados</span>
          </div>

          <!-- Text wrapper - FLEXBOX at bottom: 90px with 32px gap -->
          <div class="cover-text-wrapper">
            <h1 class="cover-title">${headline}</h1>
            ${hasSubheadline ? `<h2 class="cover-subtitle">${subheadline}</h2>` : ''}
          </div>
        </div>

        ${totalSlides > 1 ? `
        <!-- Arrow button - ABSOLUTE: bottom: 84px, right: 83px -->
        <!-- POST ÚNICO: omitido quando há 1 slide só — sem próximo slide, "Deslize →" não faz sentido. -->
        <div class="cover-arrow-btn">
          <img src="${ASSET_SETA_DESLIZE}" alt="Deslize" />
        </div>
        ` : ''}
        ${RenderEngine.logoBadgeHtml(designSpec)}
      `

      return { index, html: this.wrapSlide(index, canvas, htmlContent, ''), css: slideCss }
    }

    // BODY RENDER (28:1018) - FIGMA EXACT
    if (layoutId === 'branding-os-body-v1') {
      // headline escapado; body é escapado no ponto de uso (pode virar lista, escapada item a item).
      const headline = escapeHtml(elements.find(e => e.role === 'headline')?.content || '')
      const body = elements.find(e => e.role === 'body')?.content || ''
      const imageElement = elements.find(e => e.role === 'image') || elements.find(e => e.role === 'background')

      const hasValidImage = imageElement?.content && (imageElement.content.startsWith('http') || imageElement.content.startsWith('data:'))
      const imageUrl = hasValidImage ? imageElement.content : ''

      // Conteúdo rico do slide de corpo: honra os papéis que o copywriter/visual-compositor
      // produzem (stat, quote, bullets, cta). Cada bloco só aparece quando o papel correspondente
      // está presente → um slide simples (só headline+body) renderiza um parágrafo; os ricos
      // ganham o layout específico (stat-highlight, testimonial, lista, CTA).
      const statEl = elements.find(e => e.role === 'stat')
      const statCtxEl = elements.find(e => e.role === 'statContext')
      const quoteEl = elements.find(e => e.role === 'quote')
      const attribEl = elements.find(e => e.role === 'attribution')
      const bulletsEl = elements.find(e => e.role === 'bullets')
      const ctaEl = elements.find(e => e.role === 'cta')
      const captionEl = elements.find(e => e.role === 'caption')

      // Lista de bullets: papel explícito 'bullets' (separado por \n/•/-) OU detecção no body
      // (compat com o comportamento anterior, que varria •/- dentro do body).
      const bulletItems = (() => {
        if (bulletsEl?.content) {
          return bulletsEl.content.split(/[\n•]|(?:^|\s)-\s/).map(s => s.trim()).filter(Boolean)
        }
        if (body.includes('•') || body.includes('- ')) {
          return body.split(/[\n•-]/).map(s => s.trim()).filter(s => s.length > 0)
        }
        return []
      })()

      // Corpo textual: o <p> NÃO sai quando o conteúdo já virou lista. Vira lista quando há um
      // papel 'bullets' explícito OU quando o próprio body tem marcadores (•/-). Em ambos os
      // casos o parágrafo é suprimido para não duplicar o conteúdo (body cru + lista).
      const bodyIsBulletish = body.includes('•') || body.includes('- ')
      const bodyBecameList = bulletItems.length > 0 && (!!bulletsEl || bodyIsBulletish)
      // escapeHtml em todo conteúdo do LLM antes do HTML.
      const bodyHtml = body && !bodyBecameList ? `<p class="body-text">${escapeHtml(body)}</p>` : ''
      const listHtml = bulletItems.length > 0
        ? `<ul class="body-list">${bulletItems.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
        : ''

      // Bloco de estatística (layout stat-highlight): número grande + contexto.
      const statHtml = statEl?.content
        ? `<div class="body-stat"><span class="body-stat-number">${escapeHtml(statEl.content)}</span>${statCtxEl?.content ? `<span class="body-stat-context">${escapeHtml(statCtxEl.content)}</span>` : ''}</div>`
        : ''

      // Bloco de depoimento (layout testimonial): aspas + citação + autoria.
      const quoteHtml = quoteEl?.content
        ? `<figure class="body-quote"><blockquote class="body-quote-text">${escapeHtml(quoteEl.content)}</blockquote>${attribEl?.content ? `<figcaption class="body-quote-attrib">${escapeHtml(attribEl.content)}</figcaption>` : ''}</figure>`
        : ''

      // CTA dentro de um slide de corpo (ex.: oferta): pílula discreta sob o texto.
      const ctaHtml = ctaEl?.content ? `<div class="body-cta">${escapeHtml(ctaEl.content)}</div>` : ''

      const slideCss = `
        .slide-${index} {
          position: relative;
          width: ${canvas.width}px;
          height: ${canvas.height}px;
          background-color: var(--bd-background, #000000);
          overflow: hidden;
        }
        ${css}
      `

      // Paginação DINÂMICA: usa o nº real de slides do carrossel (antes era fixo em 8 — um
      // carrossel de 5 mostrava 8 bolinhas). O slide atual vira número; os demais, bolinhas.
      const totalDots = totalSlides
      let paginationHtml = ''
      for (let i = 1; i <= totalDots; i++) {
        if (i === index) {
          paginationHtml += `<span class="pagination-number">${i}</span>`
        } else {
          paginationHtml += `<span class="pagination-dot"></span>`
        }
      }

      // Texto do swipe: usa a caption real do copywriter quando houver; senão o default Figma. Escapado.
      const swipeText = escapeHtml(captionEl?.content?.trim() || 'Deslize para o lado')

      htmlContent = `
        <div class="body-stripes"></div>

        <div class="slide-content-body">
          <!-- Header - ABSOLUTE: top: 80px -->
          <div class="body-header">
            <span class="body-header-text">${safeHandle}</span>
            <span class="body-header-text">© ${new Date().getFullYear()} Todos os direitos reservados</span>
          </div>

          <!-- Text wrapper - FLEXBOX container for headline + body with consistent gap -->
          <div class="body-text-wrapper">
            <h3 class="body-headline">${headline}</h3>
            ${statHtml}
            ${bodyHtml}
            ${listHtml}
            ${quoteHtml}
            ${ctaHtml}
          </div>

          <!-- IMAGE - ABSOLUTE: top: 519px, left: 80px -->
          ${hasValidImage ? `
          <div class="body-image-container">
            <img src="${imageUrl}" class="body-image" alt="Visual"${RenderEngine.imageCompositionAttr(imageElement?.style)} />
          </div>
          ` : ''}

          <!-- Pagination - ABSOLUTE: y=1239, x=80 -->
          <div class="body-pagination">
            ${paginationHtml}
          </div>

          <!-- Swipe pill - ABSOLUTE: y=1214, right=80 -->
          <div class="swipe-pill">
            <span class="swipe-text">${swipeText}</span>
            <div class="swipe-arrow-btn">
              <img src="${ASSET_SETA_DESLIZE}" alt="Deslize" />
            </div>
          </div>
          ${RenderEngine.logoBadgeHtml(designSpec)}
        </div>
      `

      return { index, html: this.wrapSlide(index, canvas, htmlContent, ''), css: slideCss }
    }

    // LAST RENDER (35:1335) - FIGMA EXACT
    if (layoutId === 'branding-os-last-v1') {
      // Todo conteúdo do LLM escapado antes do HTML.
      const headline = escapeHtml(elements.find(e => e.role === 'headline')?.content || 'Para quem quer estar na vanguarda...')
      const body = escapeHtml(elements.find(e => e.role === 'body')?.content || 'O futuro não espera. Seja parte da revolução.')
      const imageElement = elements.find(e => e.role === 'image') || elements.find(e => e.role === 'background')
      const hasValidImage = imageElement?.content && (imageElement.content.startsWith('http') || imageElement.content.startsWith('data:'))
      const imageUrl = hasValidImage ? imageElement.content : ''
      // CTA real do copywriter (microcopy.ctaButton → papel 'cta'); fallback "Link na BIO". Escapado.
      const ctaText = escapeHtml(elements.find(e => e.role === 'cta')?.content?.trim() || 'Link na BIO')

      const slideCss = `
        .slide-${index} {
          position: relative;
          width: ${canvas.width}px;
          height: ${canvas.height}px;
          background-color: var(--bd-accent, #FFD44A);
          overflow: hidden;
        }
        ${css}
      `

      htmlContent = `
        <div class="last-stripes"></div>

        <div class="slide-content-last">
          <!-- Header - ABSOLUTE: top: 80px -->
          <div class="last-header">
            <span class="last-header-text">${safeHandle}</span>
            <span class="last-header-text">© ${new Date().getFullYear()} Todos os direitos reservados</span>
          </div>

          <!-- Text wrapper - FLEXBOX for consistent spacing -->
          <div class="last-text-wrapper">
            <h2 class="last-headline">${headline}</h2>
            <p class="last-body">${body}</p>
          </div>

          <!-- CTA Button - ABSOLUTE: top: 562px, left: 158px -->
          <div class="last-cta-btn">
            <svg class="last-cta-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 6H6C4.89543 6 4 6.89543 4 8V18C4 19.1046 4.89543 20 6 20H16C17.1046 20 18 19.1046 18 18V14M14 4H20M20 4V10M20 4L10 14" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span class="last-cta-text">${ctaText}</span>
          </div>

          <!-- IMAGE - ABSOLUTE: top: 687px, left: 80px -->
          ${hasValidImage ? `
          <div class="last-image-container">
            <img src="${imageUrl}" class="last-image" alt="Visual"${RenderEngine.imageCompositionAttr(imageElement?.style)} />
          </div>
          ` : ''}
          ${RenderEngine.logoBadgeHtml(designSpec)}
        </div>
      `

      return { index, html: this.wrapSlide(index, canvas, htmlContent, ''), css: slideCss }
    }

    // COMPARISON-COLUMNS (ADR-0015 PR2) — 1 lado forte por slide. headline = rótulo do lado;
    // body = a descrição protagonista; caption opcional no rodapé. Reusa paginação + swipe-pill
    // para coerência de carrossel com os demais blueprints.
    if (layoutId === 'comparison-columns-a' || layoutId === 'comparison-columns-b') {
      // headline vira o RÓTULO do lado (ex.: "O jeito comum"); body é a descrição. Ambos escapados.
      const label = escapeHtml(elements.find(e => e.role === 'headline')?.content || '')
      const bodyText = escapeHtml(elements.find(e => e.role === 'body')?.content || '')
      const captionEl = elements.find(e => e.role === 'caption')

      const slideCss = `
        .slide-${index} {
          position: relative;
          width: ${canvas.width}px;
          height: ${canvas.height}px;
          overflow: hidden;
        }
        ${css}
      `

      // Paginação dinâmica (idêntica ao body): slide atual = número, demais = bolinhas.
      let paginationHtml = ''
      for (let i = 1; i <= totalSlides; i++) {
        paginationHtml += i === index
          ? `<span class="pagination-number">${i}</span>`
          : `<span class="pagination-dot"></span>`
      }
      const swipeText = escapeHtml(captionEl?.content?.trim() || 'Deslize para o lado')

      htmlContent = `
        <div class="cmp-panel"></div>

        <!-- Header do carrossel (mesmo padrão dos demais blueprints) -->
        <div class="body-header">
          <span class="body-header-text">${safeHandle}</span>
          <span class="body-header-text">© ${new Date().getFullYear()} Todos os direitos reservados</span>
        </div>

        <div class="cmp-rule"></div>
        <div class="cmp-content">
          ${label ? `<p class="cmp-label">${label}</p>` : ''}
          ${bodyText ? `<p class="cmp-body">${bodyText}</p>` : ''}
        </div>

        <!-- Pagination -->
        <div class="body-pagination">
          ${paginationHtml}
        </div>

        <!-- Swipe pill -->
        <div class="swipe-pill">
          <span class="swipe-text">${swipeText}</span>
          <div class="swipe-arrow-btn">
            <img src="${ASSET_SETA_DESLIZE}" alt="Deslize" />
          </div>
        </div>
      `

      return { index, html: this.wrapSlide(index, canvas, htmlContent, ''), css: slideCss }
    }

    // Fallback if ID matches nothing
    return this.renderLegacySlide(slide)
  }

  private wrapSlide(index: number, canvas: { width: number, height: number }, content: string, style: string): string {
    return `<div class="slide slide-${index}" data-slide="${index}" style="width: ${canvas.width}px; height: ${canvas.height}px; ${style}; position: relative; overflow: hidden;">
      ${content}
    </div>`
  }

  /**
   * ORIGINAL RENDER method (Legacy Support)
   */
  private renderLegacySlide(slide: SlideVisualSpec): RenderedSlide {
    const index = slide.index || 1
    const canvas = slide.canvas || { width: 1080, height: 1080 }
    const background = slide.background || { type: 'solid', value: '#1A1A1A' }
    const elements = slide.elements || []

    // Build background style
    let backgroundStyle = ''
    if (background.type === 'solid') {
      backgroundStyle = `background-color: ${background.value}`
    } else if (background.type === 'gradient') {
      backgroundStyle = `background: ${background.value}`
    } else if (background.type === 'image') {
      backgroundStyle = `background-image: url('${background.value}'); background-size: cover; background-position: center`
    }

    if (background.opacity !== undefined && background.opacity < 1) {
      backgroundStyle += `; opacity: ${background.opacity}`
    }

    // Render elements using absolute positioning
    const elementsHTML = elements.map(el => this.renderElement(el)).join('\n    ')

    // Build slide HTML
    const html = `<div class="slide slide-${index}" data-slide="${index}" style="
  position: relative;
  width: ${canvas.width}px;
  height: ${canvas.height}px;
  ${backgroundStyle};
  overflow: hidden;
">
    ${elementsHTML}
  </div>`

    // Build slide-specific CSS
    const css = `
/* Slide ${index} */
.slide-${index} {
  position: relative;
  width: ${canvas.width}px;
  height: ${canvas.height}px;
  ${backgroundStyle};
  overflow: hidden;
}
`

    return {
      index,
      html,
      css
    }
  }

  /**
   * Convert a single element to HTML (Legacy)
   */
  private renderElement(element: VisualElement): string {
    if (!element) return ''

    const type = element.type || 'text'
    const role = element.role || 'body'
    const content = element.content || ''
    const style = element.style || {}
    const position = element.position || { x: 80, y: 400, width: 920 }

    // Build inline styles
    const styles: string[] = [
      `position: absolute`,
      `left: ${position.x || 80}px`,
      `top: ${position.y || 400}px`,
      `width: ${position.width || 920}px`,
      position.height && position.height !== 'auto' ? `height: ${position.height}px` : '',
    ].filter(Boolean)

    if (type === 'text') {
      styles.push(
        `font-family: '${style.fontFamily || 'Inter'}', sans-serif`,
        `font-size: ${style.fontSize || '24px'}`,
        `font-weight: ${style.fontWeight || 400}`,
        `color: ${style.color || '#FFFFFF'}`,
        `text-align: ${style.textAlign || 'center'}`,
        style.lineHeight ? `line-height: ${style.lineHeight}` : '',
        style.letterSpacing ? `letter-spacing: ${style.letterSpacing}` : '',
        style.textTransform ? `text-transform: ${style.textTransform}` : '',
      )

      // Escape HTML in content
      const escapedContent = content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')

      // Choose semantic tag based on role
      let tag = 'p'
      if (role === 'headline') tag = 'h1'
      else if (role === 'subheadline') tag = 'h2'
      else if (role === 'stat') tag = 'span'
      else if (role === 'cta') tag = 'button'
      else if (role === 'caption') tag = 'span'

      const styleString = styles.filter(Boolean).join('; ')

      if (role === 'cta') {
        // CTA as button
        return `<button class="cta-button" data-role="${role}" style="${styleString}; cursor: pointer; border: none; background: transparent;">${escapedContent}</button>`
      }

      return `<${tag} class="element element-${role}" data-role="${role}" style="${styleString}">${escapedContent}</${tag}>`
    }

    // For non-text elements (future: icons, shapes, images)
    return `<div class="element element-${role}" data-role="${role}" style="${styles.join('; ')}"></div>`
  }

  /**
   * Main render method
   */
  private renderSlide(slide: SlideVisualSpec, signature?: string, designSpec?: BrandDesignSpec, totalSlides?: number): RenderedSlide {
    // If layoutId is present, use Template System
    if (slide.layoutId) {
      return this.renderTemplateSlide(slide, signature, designSpec, totalSlides)
    }
    // Fallback to legacy
    return this.renderLegacySlide(slide)
  }

  /**
   * Generate global CSS for all slides
   */
  private generateGlobalCSS(tokens: VisualSpecification['tokens'], spec?: BrandDesignSpec): string {
    const colors = tokens?.colors || {}
    const fonts = tokens?.fonts || {}
    const spacing = tokens?.spacing || {}

    // Bloco --bd-* canônico (ADR-0012): emitido apenas quando spec presente.
    // Sem spec → saída byte-idêntica ao baseline (snapshot não quebra).
    const bdBlock = spec ? `

:root {
  --bd-primary: ${spec.palette.primary.hex};
  --bd-secondary: ${spec.palette.secondary.hex};
  --bd-accent: ${spec.palette.accent.hex};
  --bd-background: ${spec.palette.background.hex};
  --bd-text: ${spec.palette.text.hex};
  --bd-ink: ${spec.palette.ink.hex};
  --bd-muted: ${spec.palette.muted.hex};
  --bd-on-image: ${spec.palette.onImage.hex};
  --bd-on-accent: ${spec.palette.onAccent.hex};
  --bd-font-heading: '${spec.typography.heading.family}';
  --bd-font-body: '${spec.typography.body.family}';
  --bd-radius-sm: ${spec.structure.radius.sm};
  --bd-radius-md: ${spec.structure.radius.md};
  --bd-radius-lg: ${spec.structure.radius.lg};
  --bd-radius-pill: ${spec.structure.radius.pill};
  --bd-shadow-md: ${spec.structure.shadow.md};
  --bd-shadow-lg: ${spec.structure.shadow.lg};
}` : ''

    return `
/* Branding OS Generated Styles */
/* Generated at: ${new Date().toISOString()} */

:root {
  /* Brand Colors */
  ${Object.entries(colors).map(([name, value]) =>
      `--color-${name}: ${value};`
    ).join('\n  ') || '--color-primary: #5856D6;'}

  /* Brand Fonts */
  ${Object.entries(fonts).map(([role, family]) =>
      `--font-${role}: '${family}', sans-serif;`
    ).join('\n  ') || "--font-heading: 'Inter', sans-serif;"}

  /* Spacing */
  ${Object.entries(spacing).map(([name, value]) =>
      `--spacing-${name}: ${value}px;`
    ).join('\n  ') || '--spacing-margin: 80px;'}
}${bdBlock}

/* Base Reset */
.slide * {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

/* Element Base */
.element {
  display: block;
}

/* Text Elements */
.element-headline {
  font-family: var(--font-heading);
}

.element-subheadline {
  font-family: var(--font-heading);
}

.element-body {
  font-family: var(--font-body);
}

.element-caption {
  font-family: var(--font-body);
}

.element-stat {
  font-family: var(--font-heading);
}

/* CTA Button */
.cta-button {
  font-family: var(--font-heading);
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.cta-button:hover {
  transform: scale(1.02);
  opacity: 0.9;
}

/* Bullet Points */
.element-bullets {
  list-style: none;
}

.element-bullets li {
  margin-bottom: var(--spacing-gap-small);
}

/* Quote */
.element-quote {
  font-style: italic;
}

/* Responsive (for preview) */
@media (max-width: 1080px) {
  .slide {
    transform-origin: top left;
    transform: scale(calc(100vw / 1080));
  }
}
`
  }

  /**
   * Extract fonts to load
   */
  private extractFonts(tokens: VisualSpecification['tokens']): string[] {
    const fonts = Object.values(tokens?.fonts || { heading: 'Inter', body: 'Source Serif 4' })
    return [...new Set(fonts)]
  }

  /**
   * Main render function
   */
  render(visual: VisualSpecification & { signature?: string; designSpec?: BrandDesignSpec }): RenderOutput {
    // Ensure visual has required structure
    const slides = visual?.slides || []
    const signature = visual?.signature
    const designSpec = visual?.designSpec
    const tokens = visual?.tokens || {
      colors: { background: '#1A1A1A', text: '#FFFFFF', accent: '#C9B298' },
      fonts: { heading: 'Inter', body: 'Source Serif 4' },
      spacing: { margin: 80, 'gap-large': 48, 'gap-medium': 24, 'gap-small': 16 }
    }

    // Render each slide with signature e spec opcional (sem spec → output idêntico ao baseline).
    // totalSlides = nº real de slides → paginação dinâmica (antes fixa em 8).
    const totalSlides = slides.length
    const renderedSlides = slides.map(slide => this.renderSlide(slide, signature, designSpec, totalSlides))

    // Generate global CSS (com bloco --bd-* apenas quando spec presente)
    const globalCSS = this.generateGlobalCSS(tokens, designSpec)

    // Extract fonts
    const fontsToLoad = this.extractFonts(tokens)

    return {
      slides: renderedSlides,
      globalCSS,
      fontsToLoad,
      exportReady: {
        html: true,
        png: true,  // Would need html-to-image or similar
        pdf: false  // Would need additional library
      }
    }
  }

  /**
   * Generate complete HTML document for export
   */
  generateExportHTML(renderOutput: RenderOutput): string {
    const { slides, globalCSS, fontsToLoad } = renderOutput

    // Generate Google Fonts link
    const fontsQuery = fontsToLoad
      .map(f => f.replace(/ /g, '+'))
      .join('&family=')
    const fontsLink = fontsToLoad.length > 0
      ? `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=${fontsQuery}:wght@400;500;600;700&display=swap" rel="stylesheet">`
      : ''

    // Combine all slide HTML
    const slidesHTML = slides.map(s => s.html).join('\n\n')

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Carousel - Branding OS</title>
  ${fontsLink}
  <style>
    ${globalCSS}

    /* Export Layout */
    body {
      margin: 0;
      padding: 20px;
      background: #0a0a0a;
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
      justify-content: center;
    }

    .slide {
      flex-shrink: 0;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      border-radius: 8px;
    }

    /* Navigation for preview */
    .carousel-nav {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 8px;
      padding: 12px 20px;
      background: rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(10px);
      border-radius: 999px;
    }

    .carousel-nav button {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      border: none;
      background: rgba(255, 255, 255, 0.3);
      cursor: pointer;
      transition: background 0.2s;
    }

    .carousel-nav button.active,
    .carousel-nav button:hover {
      background: rgba(255, 255, 255, 0.9);
    }
  </style>
</head>
<body>
  ${slidesHTML}

  <nav class="carousel-nav">
    ${slides.map((_, i) =>
      `<button data-slide="${i + 1}" ${i === 0 ? 'class="active"' : ''}></button>`
    ).join('\n    ')}
  </nav>

  <script>
    // Simple carousel navigation
    const buttons = document.querySelectorAll('.carousel-nav button');
    const slides = document.querySelectorAll('.slide');

    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const slideIndex = parseInt(btn.dataset.slide);
        const targetSlide = document.querySelector(\`.slide-\${slideIndex}\`);
        if (targetSlide) {
          targetSlide.scrollIntoView({ behavior: 'smooth', block: 'center' });
          buttons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        }
      });
    });
  </script>
</body>
</html>`
  }

  /**
   * Generate single slide HTML (for PNG export via html-to-image)
   */
  generateSlideHTML(slide: RenderedSlide, globalCSS: string, fontsToLoad: string[]): string {
    const fontsQuery = fontsToLoad
      .map(f => f.replace(/ /g, '+'))
      .join('&family=')
    const fontsLink = fontsToLoad.length > 0
      ? `<link href="https://fonts.googleapis.com/css2?family=${fontsQuery}:wght@400;500;600;700&display=swap" rel="stylesheet">`
      : ''

    return `<!DOCTYPE html>
<html>
<head>
  <style>
    ${globalCSS}
  </style>
  ${fontsLink}
</head>
<body>
  ${slide.html}
</body>
</html>`
  }
}

export const renderEngine = new RenderEngine()

