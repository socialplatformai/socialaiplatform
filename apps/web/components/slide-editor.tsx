"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ContentSlide, SlideLayers, SlideLayerElement, ContentAlternatives } from "@/lib/content";
import type { BrandKit } from "@/lib/brand";
import { SlideCanvas } from "@/components/slide-canvas";
import { IconChevronLeft, IconChevronRight, IconRefresh, IconSparkles, IconCheck } from "@/components/icons";

// F3 (ADR-0014) — Editor visual sobre o <SlideCanvas>. Edita as CAMADAS de um conteúdo:
//   • Texto inline por papel (headline/body/cta/…): editar/limpar o conteúdo.
//   • Posição da zona de texto: âncora topo/meio/rodapé (modelo role-based — sem coordenadas livres
//     que o render não honra; é a "posição" real que o layout suporta hoje, KISS).
//   • Cor + fonte por elemento (Onda 3): o <SlideCanvas> JÁ lê style.color/fontFamily — aqui o
//     operador estiliza com a PALETA/FONTES da marca (não seletor livre: Simon/satisfice). "Padrão"
//     limpa o override (reversível). Sobe Clareza+Inteligência (o que era cego do compositor fica editável).
//   • Foco da imagem (Onda 3): o <SlideCanvas> JÁ honra style.focalPoint {x,y} → object-position.
//     Grade 3×3 move o foco do recorte sem regenerar (rosto cortado → reenquadrar). WYSIWYG ao vivo.
//   • Reordenar slides (Onda 3): ↑/↓ permutam o array; updateText aceita a nova ordem. P6 (no comando).
//   • Imagem de fundo: trocar por URL/arquivo (data-uri) por slide.
// Salva via onSave(slides) → o pai chama contentApi.updateText com `layers`. Reabrir mantém (gate F3).
// O preview ao lado é o MESMO <SlideCanvas> do que publica → WYSIWYG durante a edição.

type AnchorY = "top" | "center" | "bottom";

// Onda 3 — paleta da marca para colorir elementos. Só cores que existem (do kit) + neutros
// universais. "Padrão" (value null) limpa o override e devolve ao comportamento do canvas
// (branco sobre foto / ink sobre fundo claro). Mantém Hick baixo: ~6 opções curadas, não um wheel.
type Swatch = { label: string; value: string | null };
function brandSwatches(kit?: BrandKit): Swatch[] {
  const out: Swatch[] = [{ label: "Padrão", value: null }];
  const add = (label: string, hex: string | null | undefined) => {
    if (hex && /^#?[0-9a-fA-F]{3,8}$/.test(hex)) out.push({ label, value: hex.startsWith("#") ? hex : `#${hex}` });
  };
  add("Primária", kit?.primaryColorHex);
  add("Secundária", kit?.secondaryColorHex);
  add("Destaque", kit?.accentColorHex);
  add("Texto", kit?.textColorHex);
  // Neutros sempre presentes (legíveis sobre foto / sobre claro).
  out.push({ label: "Branco", value: "#FFFFFF" });
  out.push({ label: "Preto", value: "#111111" });
  return out;
}

// Onda 3 — fontes editáveis: as da marca (heading/body) + "Padrão" (limpa). O canvas aplica
// style.fontFamily direto; só ofertamos o que a marca define (sem catálogo de fontes — fora de escopo).
function brandFonts(kit?: BrandKit): Array<{ label: string; value: string | null }> {
  const out: Array<{ label: string; value: string | null }> = [{ label: "Padrão", value: null }];
  if (kit?.headingFont) out.push({ label: `Título — ${kit.headingFont}`, value: kit.headingFont });
  if (kit?.bodyFont && kit.bodyFont !== kit.headingFont) out.push({ label: `Corpo — ${kit.bodyFont}`, value: kit.bodyFont });
  return out;
}

// 9 posições semânticas de foco (grade 3×3) → focalPoint {x,y} 0..1. Reenquadra o recorte da
// imagem (object-position) sem zoom (o canvas não honra scale no preview — não prometemos zoom).
const FOCAL_GRID: Array<{ x: number; y: number; label: string }> = [
  { x: 0, y: 0, label: "Topo esquerda" }, { x: 0.5, y: 0, label: "Topo centro" }, { x: 1, y: 0, label: "Topo direita" },
  { x: 0, y: 0.5, label: "Meio esquerda" }, { x: 0.5, y: 0.5, label: "Centro" }, { x: 1, y: 0.5, label: "Meio direita" },
  { x: 0, y: 1, label: "Base esquerda" }, { x: 0.5, y: 1, label: "Base centro" }, { x: 1, y: 1, label: "Base direita" },
];

/** Lê a âncora vertical guardada nas camadas (meta não-visual em layers.canvas? não — usamos um campo
 *  dedicado no objeto layers: `anchorY`). Default 'bottom' (padrão editorial do SlideCanvas). */
function getAnchor(layers: SlideLayers | undefined): AnchorY {
  const a = (layers as { anchorY?: string } | undefined)?.anchorY;
  return a === "top" || a === "center" || a === "bottom" ? a : "bottom";
}

/** Papéis de texto editáveis (exclui imagem/fundo). */
function textElems(layers: SlideLayers | undefined): SlideLayerElement[] {
  return (layers?.elements ?? []).filter((e) => e.type !== "image" && e.role !== "background" && e.role !== "image");
}
function bgElem(layers: SlideLayers | undefined): SlideLayerElement | undefined {
  return (layers?.elements ?? []).find((e) => e.role === "background" || e.role === "image" || e.type === "image");
}

const ROLE_LABEL: Record<string, string> = {
  headline: "Título", subheadline: "Subtítulo", body: "Corpo", stat: "Número",
  statContext: "Contexto", quote: "Citação", attribution: "Autoria", bullets: "Lista",
  cta: "Botão (CTA)", caption: "Legenda",
};

// G4 (A/B barato) — opções A/B que a IA já gerou, por papel editável. O copywriter produz 2
// headlines e 2 CTAs por conteúdo (per-content, não per-slide): mostramos as de headline no papel
// 'headline' e as de cta no papel 'cta'. Filtra vazias e dedup (a opção idêntica ao texto atual não
// vira clique morto — escondida na renderização). Outros papéis → sem opções (faixa não aparece).
//
// ⚠️ PREMISSA TRAVADA: per-content só é semanticamente honesto para papéis
// CONTENT-LEVEL (headline da capa, cta do final). ESTENDER para 'body'/'subheadline'/'quote' — que
// são slide-específicos — exige repensar para PER-SLIDE: aplicar uma "alternativa global de corpo"
// num slide com contexto próprio vira ruído. Hoje o human-in-loop (preview WYSIWYG ao lado) absorve
// o caso raro; não estenda os papéis sem mover o modelo para per-slide.
function altOptionsForRole(role: string, alternatives?: ContentAlternatives | null): string[] {
  if (!alternatives) return [];
  const raw = role === "headline" ? alternatives.headlines : role === "cta" ? alternatives.ctas : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of raw ?? []) {
    const t = (o ?? "").trim();
    // QA: dedup case-insensitive (locale PT-BR) — "Aproveite!" e "aproveite!" não viram 2 chips
    // visualmente idênticos (o 2º seria clique morto). Preserva o casing da 1ª ocorrência.
    const key = t.toLocaleLowerCase("pt-BR");
    if (t && !seen.has(key)) { seen.add(key); out.push(t); }
  }
  return out;
}

export function SlideEditor({
  slides: initial,
  kit,
  onSave,
  saving,
  index,
  onIndex,
  alternatives,
}: {
  slides: ContentSlide[];
  kit?: BrandKit;
  onSave: (slides: ContentSlide[]) => void;
  saving?: boolean;
  /** Índice controlado (opcional): sincroniza o slide em edição com a faixa de miniaturas do pai. */
  index?: number;
  onIndex?: (i: number) => void;
  /** G4 (A/B barato): opções de headline/CTA que a IA já gerou. Aplicar = pré-preenche o campo do
   *  papel (1 clique, sem regenerar). null/ausente → o editor não mostra a faixa "Alternativas". */
  alternatives?: ContentAlternatives | null;
}) {
  const [slides, setSlides] = useState<ContentSlide[]>(() => structuredClone(initial));
  const [internalI, setInternalI] = useState(0);
  const i = index ?? internalI;
  const setI = (v: number | ((p: number) => number)) => {
    const next = typeof v === "function" ? v(i) : v;
    const clamped = Math.max(0, Math.min(slides.length - 1, next));
    if (onIndex) onIndex(clamped);
    else setInternalI(clamped);
  };
  const dirtyRef = useRef(false);
  const idx = Math.min(i, slides.length - 1);
  const slide = slides[idx];
  const layers = slide?.layers ?? undefined;
  const swatches = useMemo(() => brandSwatches(kit), [kit]);
  const fonts = useMemo(() => brandFonts(kit), [kit]);

  const dirty = useMemo(() => JSON.stringify(slides) !== JSON.stringify(initial), [slides, initial]);
  dirtyRef.current = dirty;

  // C5/T (P3): rede de segurança contra perda silenciosa. Enquanto houver edição não-salva,
  // fechar/recarregar a aba dispara o aviso nativo do navegador. O `dirty` já existia mas
  // nunca era consumido para guard — agora é. (Editar "sem medo de perder", T-HUMAN-IN-LOOP.)
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  if (!slide) {
    return <p className="text-sm text-ink/65">Sem slides para editar.</p>;
  }

  // Muta o slide atual de forma imutável (clona o slide + layers).
  function updateSlide(mut: (s: ContentSlide) => void) {
    setSlides((prev) => {
      const next = structuredClone(prev);
      mut(next[idx]);
      return next;
    });
  }

  function setElementContent(role: string, content: string) {
    updateSlide((s) => {
      const L = ensureLayers(s);
      const el = L.elements!.find((e) => e.role === role && e.type !== "image");
      if (el) el.content = content;
    });
  }

  // Onda 3 — cor/fonte por elemento de texto. value null limpa o override (volta ao default do canvas).
  function setElementStyle(role: string, key: "color" | "fontFamily", value: string | null) {
    updateSlide((s) => {
      const L = ensureLayers(s);
      const el = L.elements!.find((e) => e.role === role && e.type !== "image");
      if (!el) return;
      const style = { ...(el.style ?? {}) } as Record<string, unknown>;
      if (value === null) delete style[key];
      else style[key] = value;
      el.style = style;
    });
  }

  // Onda 3 — foco da imagem de fundo (object-position via focalPoint). O canvas já honra {x,y} 0..1.
  function setFocalPoint(x: number, y: number) {
    updateSlide((s) => {
      const L = ensureLayers(s);
      const bg = L.elements!.find((e) => e.role === "background" || e.role === "image" || e.type === "image");
      if (!bg) return;
      bg.style = { ...(bg.style ?? {}), focalPoint: { x, y } };
    });
  }

  // Onda 3 — reordenar slides. Permuta o array E reescreve os `index` (o backend/canvas usam index
  // como identidade do slide; sem reescrever, a ordem visual e a salva divergiriam). Mantém o slide
  // atual em foco após mover (segue o conteúdo, não a posição). Permutação pura = reversível por Descartar.
  function moveSlide(from: number, dir: -1 | 1) {
    const to = from + dir;
    if (to < 0 || to >= slides.length) return;
    setSlides((prev) => {
      const next = structuredClone(prev);
      [next[from], next[to]] = [next[to], next[from]];
      next.forEach((s, k) => { s.index = k; });
      return next;
    });
    setI(to); // o foco segue o slide movido
  }

  function setAnchor(anchorY: AnchorY) {
    updateSlide((s) => {
      const L = ensureLayers(s) as SlideLayers & { anchorY?: AnchorY };
      L.anchorY = anchorY;
    });
  }

  function setBackgroundImage(dataUrl: string) {
    updateSlide((s) => {
      const L = ensureLayers(s);
      const bg = L.elements!.find((e) => e.role === "background" || e.role === "image" || e.type === "image");
      if (bg) {
        bg.content = dataUrl;
      } else {
        L.elements!.push({ type: "image", role: "background", content: dataUrl, style: { objectFit: "cover" } });
      }
      // Mantém ImageUrl em sincronia (preview/fallback usam o slide.imageUrl tb).
      s.imageUrl = dataUrl;
    });
  }

  async function onFile(file: File) {
    const dataUrl = await fileToDataUrl(file);
    setBackgroundImage(dataUrl);
  }

  const texts = textElems(layers);
  const bg = bgElem(layers);
  const anchor = getAnchor(layers);
  // Foco da imagem (Onda 3): só faz sentido com imagem real (data/http). Lê o focalPoint atual
  // (default centro) p/ marcar a célula ativa na grade.
  const bgHasImage = !!bg?.content && (bg.content.startsWith("data:") || bg.content.startsWith("http"));
  const fp = (bg?.style as { focalPoint?: { x?: number; y?: number } } | undefined)?.focalPoint;
  const curFocal = { x: typeof fp?.x === "number" ? fp.x : 0.5, y: typeof fp?.y === "number" ? fp.y : 0.5 };

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Preview WYSIWYG (mesmo componente do publicado) — reflete a edição em tempo real. */}
      <div>
        <div className="mx-auto max-w-xs">
          <SlideCanvas slide={withAnchor(slide, anchor)} />
        </div>
        {slides.length > 1 && (
          <>
            <div className="mt-3 flex items-center justify-between">
              <button onClick={() => setI((v) => Math.max(0, v - 1))} disabled={idx === 0}
                aria-label="Slide anterior"
                className="flex min-h-[40px] items-center gap-1 rounded-full px-3 text-sm text-ink/65 ring-1 ring-ink/10 transition hover:text-ink disabled:opacity-40">
                <IconChevronLeft size={16} aria-hidden /> Anterior
              </button>
              <span className="text-xs text-ink/65">{idx + 1} / {slides.length}</span>
              <button onClick={() => setI((v) => Math.min(slides.length - 1, v + 1))} disabled={idx === slides.length - 1}
                aria-label="Próximo slide"
                className="flex min-h-[40px] items-center gap-1 rounded-full px-3 text-sm text-ink/65 ring-1 ring-ink/10 transition hover:text-ink disabled:opacity-40">
                Próximo <IconChevronRight size={16} aria-hidden />
              </button>
            </div>
            {/* Reordenar (Onda 3) — ↑/↓ permutam a ordem do carrossel. P6 "no comando": ajusta a
                sequência sem regenerar. A ordem salva acompanha (index reescrito em moveSlide). */}
            <div className="mt-2 flex items-center justify-center gap-2">
              <span className="text-[11px] text-ink/65">Reordenar:</span>
              <button onClick={() => moveSlide(idx, -1)} disabled={idx === 0}
                aria-label="Mover slide para a esquerda"
                className="grid h-9 w-9 place-items-center rounded-full text-ink/65 ring-1 ring-ink/15 transition hover:text-ink disabled:opacity-40">
                <IconChevronLeft size={16} aria-hidden />
              </button>
              <button onClick={() => moveSlide(idx, 1)} disabled={idx === slides.length - 1}
                aria-label="Mover slide para a direita"
                className="grid h-9 w-9 place-items-center rounded-full text-ink/65 ring-1 ring-ink/15 transition hover:text-ink disabled:opacity-40">
                <IconChevronRight size={16} aria-hidden />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Controles de edição do slide atual. */}
      <div className="space-y-4">
        <p className="text-sm font-medium text-ink">Editando slide {idx + 1}</p>

        {/* Texto inline por papel + cor/fonte (Onda 3). Cada papel: textarea + paleta da marca + fonte.
            A cor/fonte editam style.{color,fontFamily} que o <SlideCanvas> já renderiza (WYSIWYG ao vivo). */}
        {texts.length > 0 ? (
          <div className="space-y-4">
            {texts.map((el) => {
              const curColor = (el.style?.color as string | undefined) ?? null;
              const curFont = (el.style?.fontFamily as string | undefined) ?? null;
              const fontId = `font-${slide.index}-${el.role}`;
              return (
                <div key={el.role} className="rounded-md border border-ink/10 p-3">
                  <label className="block">
                    {/* Nome do papel (Título/Corpo…) é protagonista do card → sobe pra sm/semibold,
                        distinguindo-se dos sub-controles "Cor"/"Fonte" (que ficam em xs). */}
                    <span className="mb-1.5 block text-sm font-semibold text-ink">{ROLE_LABEL[el.role] ?? el.role}</span>
                    <textarea
                      value={el.content}
                      onChange={(e) => setElementContent(el.role, e.target.value)}
                      rows={el.role === "body" || el.role === "bullets" || el.role === "quote" ? 3 : 1}
                      className="w-full resize-none rounded-sm border border-ink/15 bg-canvas px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-ink"
                    />
                  </label>

                  {/* G4 (A/B barato) — alternativas que a IA já gerou pra este papel (headline/cta).
                      Aplicar = pré-preenche o campo (1 clique, sem regenerar). A opção igual ao texto
                      atual vira "Em uso" (não-clicável) — evita clique morto. Faixa silenciosa
                      (de-emphasis-first APEX): chips secundários, não competem com Salvar. */}
                  {(() => {
                    const opts = altOptionsForRole(el.role, alternatives);
                    if (opts.length === 0) return null;
                    const cur = (el.content ?? "").trim();
                    return (
                      // schedio-apex (FIRE/PRODUCT_INTERFACE): faixa de opções A/B. De-emphasis-first
                      // (P3 hierarquia): container com tint leve agrupa sem competir com Salvar.
                      <div className="mt-3 rounded-sm bg-ink/[0.03] p-2.5">
                        {/* O rótulo diz o JOB ("Trocar título por…"), não a ORIGEM ("Alternativas
                            da IA") — jargão técnico trava o usuário leigo. text-ink/70 AA-safe p/
                            texto pequeno. */}
                        <span className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-ink/70">
                          <IconSparkles size={12} aria-hidden />
                          {el.role === "cta" ? "Trocar botão por uma opção da IA:" : "Trocar título por uma opção da IA:"}
                        </span>
                        <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Alternativas de ${ROLE_LABEL[el.role] ?? el.role}`}>
                          {opts.map((opt) => {
                            const inUse = opt === cur;
                            return (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => { if (!inUse) setElementContent(el.role, opt); }}
                                // QA a11y (HIG/ARIA): NÃO usar `disabled` no estado em-uso — botão disabled
                                // sai da ordem de foco, escondendo do teclado/leitor de tela QUAL opção está
                                // aplicada (estado deve ser perceptível). `aria-disabled` mantém focável e
                                // anunciável; o onClick já é no-op p/ inUse (guard acima). aria-pressed dá o
                                // toggle-state; aria-label dá o nome acessível COMPLETO (o texto trunca
                                // visualmente — truncate — e `title` é ignorado por leitores de tela).
                                aria-disabled={inUse}
                                aria-pressed={inUse}
                                aria-label={inUse ? `${opt} (em uso)` : `Usar como ${el.role === "cta" ? "botão" : "título"}: ${opt}`}
                                title={inUse ? "Em uso (opção aplicada)" : `Usar: ${opt}`}
                                // PRAGMA: min-h ≥36px (alvo tocável). KAIRÓS: active:scale = feedback físico
                                // do "escolhi" (M3 whileTap), neutralizado por prefers-reduced-motion no
                                // globals. CHROMA/MARTYR: em-uso usa text-ink sólido (não /65 sobre tint, que
                                // reprovava AA 3.83:1) + check glifo → estado signalado por MAIS que cor (AP-6).
                                className={`inline-flex min-h-[36px] max-w-full items-center gap-1 truncate rounded-full px-3 py-1.5 text-xs ring-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${
                                  inUse
                                    ? "cursor-default bg-ink/[0.06] font-medium text-ink ring-ink/20"
                                    : "bg-canvas text-ink/80 ring-ink/15 hover:text-ink hover:ring-ink/40 active:scale-[0.97]"
                                }`}
                              >
                                {inUse && <IconCheck size={13} aria-hidden />}
                                <span className="truncate">{opt}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Cor (paleta da marca + neutros). CTA tem fundo branco fixo no canvas; cor de
                      texto não se aplica a ele → escondemos para não prometer um efeito que não há. */}
                  {el.role !== "cta" && (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 text-[11px] font-medium text-ink/65">Cor</span>
                      {swatches.map((sw) => {
                        const active = (sw.value ?? null) === (curColor ?? null);
                        return (
                          <button
                            key={sw.label}
                            type="button"
                            onClick={() => setElementStyle(el.role, "color", sw.value)}
                            aria-label={`Cor ${sw.label}`}
                            aria-pressed={active}
                            title={sw.label}
                            className={`grid h-7 w-7 place-items-center rounded-full ring-1 transition ${
                              active ? "ring-2 ring-ink ring-offset-1 ring-offset-canvas" : "ring-ink/15 hover:ring-ink/40"
                            }`}
                          >
                            {sw.value === null ? (
                              // "Auto" = cor automática (o canvas decide claro/escuro p/ contraste).
                              // Antes era só "A" — jargão mudo (P1/leigo travou). Glosa explícita.
                              <span className="text-[9px] font-semibold text-ink/65">Auto</span>
                            ) : (
                              <span className="h-4 w-4 rounded-full ring-1 ring-ink/10" style={{ background: sw.value }} />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Fonte: só aparece se a marca define fontes (senão não há o que escolher). */}
                  {fonts.length > 1 && (
                    <div className="mt-3">
                      <label htmlFor={fontId} className="mb-1 block text-[11px] font-medium text-ink/65">Fonte</label>
                      <select
                        id={fontId}
                        value={curFont ?? ""}
                        onChange={(e) => setElementStyle(el.role, "fontFamily", e.target.value || null)}
                        className="w-full rounded-sm border border-ink/15 bg-canvas px-2 py-1.5 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-ink"
                      >
                        {fonts.map((f) => (
                          <option key={f.label} value={f.value ?? ""}>{f.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="rounded-md bg-ink/5 p-3 text-xs text-ink/65">
            Este slide não tem camadas de texto estruturadas (gerado antes da F1). Edite a copy no editor de texto.
          </p>
        )}

        {/* Posição da zona de texto (âncora vertical — o que o layout role-based honra) */}
        <div>
          <span className="mb-1 block text-xs font-medium text-ink/70">Posição do texto</span>
          <div className="flex gap-2">
            {(["top", "center", "bottom"] as AnchorY[]).map((a) => (
              <button
                key={a}
                onClick={() => setAnchor(a)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition ${
                  anchor === a ? "bg-ink text-canvas ring-ink" : "text-ink/65 ring-ink/15 hover:text-ink"
                }`}
              >
                {a === "top" ? "Topo" : a === "center" ? "Meio" : "Rodapé"}
              </button>
            ))}
          </div>
        </div>

        {/* Imagem de fundo: trocar por arquivo */}
        <div>
          <span className="mb-1 block text-xs font-medium text-ink/70">Imagem de fundo</span>
          <div className="flex items-center gap-2">
            <label className="cursor-pointer rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-canvas transition hover:bg-ink/90">
              Trocar imagem
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
              />
            </label>
            {bg?.content?.startsWith("data:") && <span className="text-xs text-ink/65">imagem definida</span>}
          </div>

          {/* Foco da imagem (Onda 3) — só quando há imagem real. Grade 3×3 move o object-position
              (focalPoint) p/ reenquadrar o recorte sem regenerar. O preview ao lado reflete ao vivo. */}
          {bgHasImage && (
            <div className="mt-3">
              {/* "Reenquadrar a foto" diz o JOB (P1/leigo não entendia "Foco da imagem"). */}
              <span className="mb-1 block text-[11px] font-medium text-ink/65">Reenquadrar a foto</span>
              <span className="mb-1.5 block text-[10px] text-ink/65">Mova o ponto pra escolher que parte da foto aparece.</span>
              <div className="inline-grid grid-cols-3 gap-1" role="group" aria-label="Foco da imagem">
                {FOCAL_GRID.map((g) => {
                  const active = curFocal.x === g.x && curFocal.y === g.y;
                  return (
                    <button
                      key={g.label}
                      type="button"
                      onClick={() => setFocalPoint(g.x, g.y)}
                      aria-label={g.label}
                      aria-pressed={active}
                      title={g.label}
                      className={`h-7 w-7 rounded-sm ring-1 transition ${
                        active ? "bg-ink ring-ink" : "bg-ink/5 ring-ink/15 hover:bg-ink/15"
                      }`}
                    >
                      <span className={`mx-auto block h-1.5 w-1.5 rounded-full ${active ? "bg-canvas" : "bg-ink/40"}`} />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => onSave(slides)}
            disabled={!dirty || saving}
            className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-canvas transition hover:bg-ink/90 disabled:opacity-40"
          >
            {saving ? "Salvando…" : "Salvar slide"}
          </button>
          {dirty && (
            <button
              onClick={() => setSlides(structuredClone(initial))}
              disabled={saving}
              className="flex items-center gap-1 rounded-full px-3 py-2 text-sm text-ink/65 transition hover:text-ink disabled:opacity-40"
            >
              <IconRefresh size={14} aria-hidden /> Descartar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Garante que o slide tem layers.elements para edição (clona o objeto). */
function ensureLayers(s: ContentSlide): SlideLayers {
  if (!s.layers) s.layers = { elements: [] };
  if (!s.layers.elements) s.layers.elements = [];
  return s.layers;
}

/** Injeta a âncora vertical escolhida no slide p/ o preview (o SlideCanvas lê layers.anchorY). */
function withAnchor(slide: ContentSlide, anchor: AnchorY): ContentSlide {
  if (!slide.layers) return slide;
  return { ...slide, layers: { ...slide.layers, anchorY: anchor } as SlideLayers };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
