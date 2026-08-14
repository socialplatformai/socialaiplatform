"use client";

import { useState } from "react";
import type { ContentSlide, SlideLayers, SlideLayerElement } from "@/lib/content";
import { IconChevronLeft, IconChevronRight } from "@/components/icons";

// F2 (ADR-0014) — <SlideCanvas>: render WYSIWYG por COMPOSIÇÃO DE CAMADAS, fiel ao que publica.
// Decisão de design (ADR-0014 §F2): layout ROLE-BASED semântico (o compositor não emite x/y; o
// render-engine usa posições por papel). O fundo (imagem/gradiente) preenche o frame 1080×1350
// (aspect 4:5); os elementos de texto empilham numa zona de conteúdo com scrim de legibilidade,
// estilizados pela marca (style.color/fontFamily). `overflow:hidden` no frame garante 0 elementos
// fora do canvas (containment por construção — gate §6). Sem `layers` → cai no preview só-imagem.

const CANVAS_W = 1080;
const CANVAS_H = 1350;

/** Detecta imagem real (data-uri/http) vs prompt de texto livre que não virou imagem. */
function isImageUrl(v: string | undefined | null): v is string {
  return !!v && (v.startsWith("data:") || v.startsWith("http"));
}
function isGradient(v: string | undefined | null): v is string {
  return !!v && (v.startsWith("linear-gradient") || v.startsWith("conic-gradient") || v.startsWith("radial-gradient"));
}

/** focalPoint {x,y} 0..1 → object-position '%'. Default centro. */
function focalToPosition(style: Record<string, unknown> | undefined): string {
  const fp = style?.focalPoint as { x?: number; y?: number } | undefined;
  if (fp && typeof fp.x === "number" && typeof fp.y === "number") {
    return `${Math.round(clamp01(fp.x) * 100)}% ${Math.round(clamp01(fp.y) * 100)}%`;
  }
  const op = style?.objectPosition;
  return typeof op === "string" ? op : "center";
}
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** F3: âncora vertical da zona de texto → justify-content. Default rodapé. */
function anchorClass(anchorY: SlideLayers["anchorY"]): string {
  return anchorY === "top" ? "justify-start" : anchorY === "center" ? "justify-center" : "justify-end";
}

/** Resolve o fundo do slide a partir das camadas: background field OU elemento role=background/image. */
function resolveBackground(layers: SlideLayers | undefined, fallbackImageUrl: string | null): {
  imageUrl?: string;
  gradient?: string;
  solid?: string;
  focal: string;
} {
  const bg = layers?.background;
  const bgEl = layers?.elements?.find(
    (e) => (e.role === "background" || e.role === "image" || e.type === "image"),
  );
  // Precedência: background field → elemento de imagem → imageUrl do slide (fallback F0).
  if (bg) {
    if (bg.type === "image" && isImageUrl(bg.value)) return { imageUrl: bg.value, focal: focalToPosition(undefined) };
    if (bg.type === "gradient" && isGradient(bg.value)) return { gradient: bg.value, focal: "center" };
    if (bg.type === "solid") return { solid: bg.value, focal: "center" };
  }
  if (bgEl && isImageUrl(bgEl.content)) return { imageUrl: bgEl.content, focal: focalToPosition(bgEl.style) };
  if (isImageUrl(fallbackImageUrl)) return { imageUrl: fallbackImageUrl, focal: "center" };
  if (isGradient(fallbackImageUrl)) return { gradient: fallbackImageUrl!, focal: "center" };
  return { solid: "var(--color-canvas-2)", focal: "center" };
}

// Ordem semântica de empilhamento dos papéis de texto (de cima p/ baixo na zona de conteúdo).
const TEXT_ROLE_ORDER = ["stat", "statContext", "headline", "subheadline", "quote", "attribution", "body", "bullets", "caption", "cta"];

function textElements(layers: SlideLayers | undefined): SlideLayerElement[] {
  const els = (layers?.elements ?? []).filter((e) => e.type !== "image" && e.role !== "background" && e.role !== "image" && !!e.content);
  return [...els].sort((a, b) => roleRank(a.role) - roleRank(b.role));
}
function roleRank(role: string): number {
  const i = TEXT_ROLE_ORDER.indexOf(role);
  return i === -1 ? TEXT_ROLE_ORDER.length : i;
}

// Tamanho de fonte por papel em CQW (% da LARGURA do container) — escala idêntica em qualquer
// tamanho de frame (thumbnail 80px nas aprovações OU preview 320px no detalhe). Depende de
// `container-type: size` no frame (setado inline). É o que torna o preview fiel a qualquer escala.
const ROLE_FONT_CQW: Record<string, number> = {
  stat: 13, headline: 7, subheadline: 4, quote: 5, cta: 3.8,
  bullets: 3.4, caption: 3, attribution: 3, statContext: 3, body: 3.6,
};

/** Estilo tipográfico (peso/leading/transform) por papel; tamanho vem em cqw via style. */
function roleTypography(role: string): { className: string; fontSizeCqw: number } {
  const fontSizeCqw = ROLE_FONT_CQW[role] ?? ROLE_FONT_CQW.body;
  switch (role) {
    case "stat":
      return { className: "font-extrabold leading-none", fontSizeCqw };
    case "headline":
      return { className: "font-bold leading-[1.05]", fontSizeCqw };
    case "subheadline":
      return { className: "font-medium leading-snug", fontSizeCqw };
    case "quote":
      return { className: "font-semibold italic leading-snug", fontSizeCqw };
    case "cta":
      return { className: "font-bold uppercase tracking-wide", fontSizeCqw };
    case "bullets":
      return { className: "font-medium leading-relaxed whitespace-pre-line", fontSizeCqw };
    case "caption":
    case "attribution":
    case "statContext":
      // Sem opacity: o papel secundário já é sinalizado pelo tamanho menor. opacity-85 derrubava o
      // contraste do texto sobre slide claro (sem imagem) abaixo do AA (axe). A cor cheia passa AA.
      return { className: "font-normal leading-snug", fontSizeCqw };
    default: // body
      return { className: "font-normal leading-relaxed", fontSizeCqw };
  }
}

/** Um slide composto (1 frame 1080×1350). Reusável: wizard, /content, aprovações, galeria de template. */
export function SlideCanvas({ slide, className }: { slide: ContentSlide; className?: string }) {
  const layers = slide.layers ?? undefined;
  const bg = resolveBackground(layers, slide.imageUrl);
  const texts = textElements(layers);
  // Sem texto estruturado mas com copy bruta → mostra a copy (fallback do preview antigo).
  const fallbackCopy = texts.length === 0 ? slide.copy : null;
  const hasImage = !!bg.imageUrl;

  return (
    <div
      role={hasImage ? "img" : undefined}
      aria-label={hasImage ? `Slide ${slide.index + 1}` : undefined}
      className={`relative aspect-[4/5] w-full overflow-hidden rounded-[20px] ring-1 ring-ink/5 ${className ?? ""}`}
      style={{
        // containerType:size habilita unidades cqw → tipografia escala com a LARGURA do frame
        // (preview fiel em qualquer tamanho: thumbnail nas aprovações ou preview grande no detalhe).
        containerType: "size",
        backgroundColor: bg.solid ?? "var(--color-canvas-2)",
        backgroundImage: bg.imageUrl ? `url(${bg.imageUrl})` : bg.gradient,
        backgroundSize: "cover",
        backgroundPosition: bg.focal,
      }}
    >
      {/* Scrim de legibilidade sobre a foto (só quando há imagem) — texto sempre legível. */}
      {hasImage && (
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.30) 45%, rgba(0,0,0,0.10) 100%)" }} />
      )}

      {/* Zona de conteúdo: empilha os papéis de texto. Âncora vertical editável (F3): topo/meio/
          rodapé — default rodapé (padrão editorial). */}
      <div className={`absolute inset-0 flex flex-col ${anchorClass(layers?.anchorY)} gap-[1.6%] p-[7%]`}>
        {texts.map((el, i) => {
          const typo = roleTypography(el.role);
          const color = (el.style?.color as string) ?? (hasImage ? "#FFFFFF" : "var(--color-ink)");
          const fontFamily = (el.style?.fontFamily as string) ?? undefined;
          const isCta = el.role === "cta";
          return (
            <p
              key={`${el.role}-${i}`}
              className={`${typo.className} ${isCta ? "self-start rounded-full bg-white/95 px-[3cqw] py-[1.5cqw] text-ink" : ""}`}
              style={{ fontSize: `${typo.fontSizeCqw}cqw`, color: isCta ? undefined : color, fontFamily }}
            >
              {el.content}
            </p>
          );
        })}
        {fallbackCopy && (
          <p className="whitespace-pre-line leading-relaxed" style={{ fontSize: "3.6cqw", color: hasImage ? "#FFFFFF" : "var(--color-ink)" }}>
            {fallbackCopy}
          </p>
        )}
      </div>
    </div>
  );
}

/** Carrossel de SlideCanvas com navegação. Reusa o padrão do antigo slide-preview.
 *  `controlled` (índice + onIndex) é opcional: quando o pai precisa saber/ditar o slide ativo
 *  (ex.: sincronizar com a faixa de miniaturas), passa-os; senão o carrossel guarda o índice. */
export function SlideCarousel({
  slides,
  className,
  index,
  onIndex,
  showThumbs = true,
}: {
  slides: ContentSlide[];
  className?: string;
  index?: number;
  onIndex?: (i: number) => void;
  /** Faixa de miniaturas abaixo do slide (ver o carrossel inteiro de relance). */
  showThumbs?: boolean;
}) {
  const [internal, setInternal] = useState(0);
  const i = index ?? internal;
  const setI = (v: number) => {
    const clamped = Math.max(0, Math.min(slides.length - 1, v));
    if (onIndex) onIndex(clamped);
    else setInternal(clamped);
  };
  if (slides.length === 0) {
    return (
      <div className="flex aspect-[4/5] w-full items-center justify-center rounded-lg bg-canvas-2 text-sm text-ink/65">
        Sem slides.
      </div>
    );
  }
  const idx = Math.min(i, slides.length - 1);
  return (
    <div className={className}>
      <SlideCanvas slide={slides[idx]} />
      {slides.length > 1 && (
        <>
          <div className="mt-3 flex items-center justify-between">
            <button
              onClick={() => setI(idx - 1)}
              disabled={idx === 0}
              aria-label="Slide anterior"
              className="flex min-h-[40px] items-center gap-1 rounded-full px-3 text-sm text-ink/65 ring-1 ring-ink/10 transition hover:text-ink disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
            >
              <IconChevronLeft size={16} aria-hidden /> Anterior
            </button>
            <span className="text-xs text-ink/65">{idx + 1} / {slides.length}</span>
            <button
              onClick={() => setI(idx + 1)}
              disabled={idx === slides.length - 1}
              aria-label="Próximo slide"
              className="flex min-h-[40px] items-center gap-1 rounded-full px-3 text-sm text-ink/65 ring-1 ring-ink/10 transition hover:text-ink disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
            >
              Próximo <IconChevronRight size={16} aria-hidden />
            </button>
          </div>
          {showThumbs && <SlideThumbStrip slides={slides} active={idx} onPick={setI} />}
        </>
      )}
    </div>
  );
}

/** Faixa de miniaturas: ver o carrossel INTEIRO de relance e pular pra qualquer slide num clique.
 *  Reusa o <SlideCanvas> (mesma fidelidade), num tamanho pequeno — a tipografia cqw escala sozinha. */
export function SlideThumbStrip({
  slides,
  active,
  onPick,
}: {
  slides: ContentSlide[];
  active: number;
  onPick: (i: number) => void;
}) {
  return (
    <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Slides do carrossel">
      {slides.map((s, k) => (
        <button
          key={k}
          role="tab"
          aria-selected={k === active}
          aria-label={`Ir para o slide ${k + 1}`}
          onClick={() => onPick(k)}
          className={`relative w-14 shrink-0 overflow-hidden rounded-md ring-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${
            k === active ? "ring-2 ring-ink" : "ring-ink/10 hover:ring-ink/30"
          }`}
        >
          <SlideCanvas slide={s} />
          <span className="absolute bottom-0.5 right-0.5 rounded bg-ink/70 px-1 text-[9px] font-medium text-canvas">
            {k + 1}
          </span>
        </button>
      ))}
    </div>
  );
}

export { CANVAS_W, CANVAS_H };
