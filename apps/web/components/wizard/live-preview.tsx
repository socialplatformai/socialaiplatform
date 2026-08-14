"use client";

import type { ReactNode } from "react";
import type { Content } from "@/lib/content";
import { SlideCarousel } from "@/components/slide-canvas";

/**
 * PRÉVIA AO VIVO (SoT "Gerar Conteudo v2") — o painel direito persistente do fluxo de geração.
 *
 * HONESTIDADE (invariante WYSIWYG + L5): a prévia NUNCA inventa um slide bonito-mentiroso.
 *   - ANTES de gerar (Briefing/Revisar) não existem slides → mostra o gradiente irisado da MARCA
 *     (o mesmo fallback do render) + o formato PROPOSTO, rotulado "Proposta". Comunica "é ISTO que
 *     vou criar", sem fingir conteúdo que a IA ainda não produziu.
 *   - DEPOIS de gerar, `result` presente → mostra o <SlideCarousel> REAL (o que publica).
 *
 * É content-aware (conhece Content/formato) — por isso vive em components/wizard, não na primitiva
 * de layout (ui.tsx FlowFrame, que é agnóstica). O FlowFrame dá a moldura; este dá o conteúdo do aside.
 */
export function LivePreview({
  result,
  formatLabel,
  proposalTitle,
  badge,
  footer,
}: {
  /** Conteúdo gerado. Presente → prévia real (SlideCarousel). Ausente → prévia de proposta. */
  result?: Content | null;
  /** Rótulo do formato proposto (ex.: "Carrossel") — usado só na prévia de proposta. */
  formatLabel: string;
  /** Título da pauta/tema, mostrado discretamente sob o formato na prévia de proposta. */
  proposalTitle?: string | null;
  /** Badge de estado no topo (ex.: "rascunho" / "proposta"). */
  badge?: ReactNode;
  /** Rodapé opcional (custo, dimensões, avisos) — renderizado abaixo da prévia. */
  footer?: ReactNode;
}) {
  const hasResult = !!result && result.slides.length > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-ink/65">Prévia ao vivo</p>
        {badge}
      </div>

      <div className="overflow-hidden rounded-2xl bg-paper ring-1 ring-ink/8">
        {hasResult ? (
          // Prévia REAL: o que publica. Sem faixa de miniaturas aqui (espaço do aside é estreito).
          <div className="p-3">
            <SlideCarousel slides={result!.slides} showThumbs={false} />
          </div>
        ) : (
          // Prévia de PROPOSTA: gradiente da marca + formato. Honesto, não inventa slide.
          <div className="relative aspect-[4/5] w-full" style={{ background: "var(--gradient-iris-soft)" }}>
            <div className="absolute inset-0 grid place-items-center p-6 text-center">
              <div>
                <span className="block text-[11px] uppercase tracking-[0.2em] text-ink/65">Proposta</span>
                <span className="mt-1 block font-serif text-3xl text-ink">{formatLabel}</span>
                {proposalTitle && (
                  <span className="mt-2 block text-sm text-ink/70 line-clamp-2">{proposalTitle}</span>
                )}
              </div>
            </div>
            <span className="absolute bottom-3 left-3 rounded-full bg-ink/85 px-2.5 py-1 text-[11px] font-medium text-canvas">
              1080 × 1350
            </span>
          </div>
        )}
      </div>

      {footer && <div className="space-y-3">{footer}</div>}
    </div>
  );
}
