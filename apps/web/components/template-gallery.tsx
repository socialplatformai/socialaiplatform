"use client";

import type { Template } from "@/lib/templates";
import { objectiveLabel, templateName, journeyStages } from "@/lib/templates";
import type { BrandKit } from "@/lib/brand";
import type { ContentSlide } from "@/lib/content";
import { SlideCanvas } from "@/components/slide-canvas";
import { SelectableCard, CheckCircle } from "@/components/ui";
import { IconCheck, IconChevronRight } from "@/components/icons";

// F6/B1+B2 — galeria de template no wizard com PREVIEW NA MARCA. O template traz só estrutura
// (nº de slides, jornada, casos de uso) — não há conteúdo/imagens gerados ainda. Então montamos
// um SLIDE-MOCK determinístico nas cores+fontes da marca via <SlideCanvas> (o mesmo render do
// preview real): zero custo de IA, instantâneo, fiel ao look que o cliente vai ver. B3 marca o
// recomendado pelo objetivo.

/** Luminância relativa de um hex (#rgb/#rrggbb) → escolhe texto claro/escuro com contraste.
 *  Fundo claro → texto escuro (#1A1A1A); fundo escuro → texto claro (#FFFFFF). Hex inválido → claro. */
function readableText(hex: string): { strong: string; soft: string } {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { strong: "#FFFFFF", soft: "#FFFFFFCC" };
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  // luminância perceptual (sRGB aproximada) — limiar 0.6 separa claro/escuro com folga.
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6
    ? { strong: "#1A1A1A", soft: "#1A1A1ACC" }
    : { strong: "#FFFFFF", soft: "#FFFFFFCC" };
}

/** Monta um ContentSlide-mock (camadas) na identidade da marca p/ o <SlideCanvas> renderizar. */
function mockSlideForBrand(template: Template, kit: BrandKit | undefined): ContentSlide {
  // Cores da marca com fallback APEX (mesma precedência do adapter dos agents).
  const bg = kit?.primaryColorHex || "#0B0B0C";
  const accent = kit?.accentColorHex || kit?.secondaryColorHex || "#FFFFFF";
  const headingFont = kit?.headingFont || undefined;
  const bodyFont = kit?.bodyFont || undefined;
  // Contraste seguro: deriva a cor do texto da luminância do fundo da marca (evita branco-no-branco
  // quando a marca tem cor primária clara). O CTA usa o accent (visível por construção do SlideCanvas).
  const text = readableText(bg);

  return {
    index: 0,
    copy: null,
    imageUrl: null,
    layers: {
      background: { type: "solid", value: bg },
      anchorY: "center",
      elements: [
        {
          type: "text",
          role: "headline",
          content: templateName(template),
          style: { color: text.strong, fontFamily: headingFont },
        },
        {
          type: "text",
          role: "subheadline",
          content: `${template.slideCount} slides`,
          style: { color: text.soft, fontFamily: bodyFont },
        },
        {
          type: "text",
          role: "cta",
          content: "Sua marca",
          style: { color: accent, fontFamily: bodyFont },
        },
      ],
    },
  };
}

export function TemplateGallery({
  templates,
  kit,
  objective,
  selectedId,
  onSelect,
}: {
  templates: Template[];
  kit: BrandKit | undefined;
  // F6/B3: objetivo de marketing da pauta (recommendedFor casa com isto → marca "Recomendado").
  objective?: string | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const obj = (objective ?? "").trim().toLowerCase();

  return (
    <div className="space-y-3">
      {/* auto-rows-fr: todas as linhas com a mesma altura → bases dos cards ALINHADAS mesmo com
          descrições/jornadas de tamanhos diferentes (Müller-Brockmann: a grade reticular). */}
      <div className="grid gap-3 sm:grid-cols-2 sm:auto-rows-fr">
        {/* Opção "Deixar a IA escolher" (default) — o brand-strategist decide pela pauta. */}
        <AutoChoiceCard selected={selectedId === null} onSelect={() => onSelect(null)} />

        {templates.map((t) => {
          const recommended = obj.length > 0 && t.recommendedFor.some((r) => r.toLowerCase() === obj);
          const selected = selectedId === t.id;
          const ptName = templateName(t);
          return (
            <SelectableCard
              key={t.id}
              selected={selected}
              onSelect={() => onSelect(t.id)}
              ariaLabel={ptName}
              fill
            >
              <div className="flex gap-3">
                {/* Preview na marca: mock determinístico via o MESMO <SlideCanvas> do preview real —
                    dá o LOOK (cores/fontes da marca); a JORNADA abaixo dá a ESTRUTURA. */}
                <div className="w-24 shrink-0">
                  <SlideCanvas slide={mockSlideForBrand(t, kit)} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    {/* Nome = protagonista: sobe ½ degrau na escala + semibold (LOGOS: 3 tiers reais). */}
                    <p className="text-[15px] font-semibold leading-snug text-ink">{ptName}</p>
                    <CheckCircle selected={selected} icon={<IconCheck size={12} />} />
                  </div>
                  {recommended && (
                    <span className="mt-1 inline-block rounded-full bg-pastel-cream px-2 py-0.5 text-[11px] font-medium text-ink/75">
                      Recomendado para {objectiveLabel(obj)}
                    </span>
                  )}
                  {t.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-ink/65">{t.description}</p>
                  )}
                  {/* "Use quando…" — exemplo concreto do bestFor (já vem no DTO, antes não renderizado).
                      Persona P1/leigo não sabia QUANDO usar cada arquétipo; o exemplo resolve. */}
                  {t.bestFor.length > 0 && (
                    <p className="mt-1.5 text-[11px] text-ink/70">
                      <span className="text-ink/65">Use quando: </span>{t.bestFor[0]}
                    </p>
                  )}
                  {/* Meta cai abaixo (ink/45) — 3 estratos: nome > descrição/uso > meta. */}
                  <p className="mt-1 text-[11px] text-ink/65">{t.slideCount} slides</p>
                </div>
              </div>

              {/* A JORNADA — o que torna o template inteligível: capa→problema→solução→prova→CTA.
                  Antes os cards eram indistinguíveis (só o nome num retângulo). Reconhecer > lembrar.
                  mt-auto: empurra a faixa pra BASE → as faixas alinham entre cards (grade reticular). */}
              <JourneyStrip journey={t.journey} />
            </SelectableCard>
          );
        })}
      </div>
    </div>
  );
}

/** A jornada do template como faixa de etapas (capa→problema→solução→prova→CTA). É o sinal que
 *  torna um template distinguível do outro de relance. Sem dado de jornada (API antiga) → não
 *  renderiza nada (degrada honesto, o resto do card continua útil). */
function JourneyStrip({ journey }: { journey?: string[] }) {
  const { stages, truncated } = journeyStages(journey);
  if (stages.length === 0) return null;
  return (
    // mt-auto empurra a faixa pra base do card (com grid auto-rows-fr → faixas alinhadas entre cards).
    <div className="mt-auto border-t border-ink/5 pt-3">
      {/* Rótulo recua (ink/45): é etiqueta, não conteúdo — não compete com os chips (de-emphasis). */}
      <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.14em] text-ink/65">
        Estrutura
      </span>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
        {stages.map((s, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-[11px] font-medium text-ink/70">
              {s}
            </span>
            {(i < stages.length - 1 || truncated) && (
              <IconChevronRight size={11} className="text-ink/30" aria-hidden />
            )}
          </span>
        ))}
        {truncated && <span className="text-[11px] text-ink/65">…</span>}
      </div>
    </div>
  );
}

function AutoChoiceCard({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
  return (
    // Espelha o layout dos cards reais (flex gap-3 + tile à esquerda) p/ pertencer ao MESMO conjunto
    // visual — antes era texto solto, órfão à esquerda (Gestalt: quebrava a coesão da galeria).
    <SelectableCard selected={selected} onSelect={onSelect} ariaLabel="Deixar a IA escolher" fill>
      <div className="flex gap-3">
        {/* Tile gradiente irisado (o token da marca) no lugar do preview — sinaliza "a IA decide". */}
        <div
          className="grid aspect-[4/5] w-24 shrink-0 place-items-center rounded-[20px] ring-1 ring-ink/5"
          style={{ background: "var(--gradient-iris-soft)" }}
          aria-hidden
        >
          <span className="text-2xl">✦</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[15px] font-semibold leading-snug text-ink">Deixar a IA escolher</p>
            <CheckCircle selected={selected} icon={<IconCheck size={12} />} />
          </div>
          <p className="mt-1 text-xs text-ink/65">
            O estrategista de marca seleciona o melhor template pela sua pauta e objetivo.
          </p>
        </div>
      </div>
    </SelectableCard>
  );
}
