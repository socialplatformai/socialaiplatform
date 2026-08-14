"use client";

import type { ReactNode } from "react";
import type { ContentReasoning } from "@/lib/content";
import { Badge, Card } from "@/components/ui";

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

// "recomendo X porque Y" no PONTO DE DECISÃO. O núcleo (brand-strategist +
// quality-validator) já produz o raciocínio (whyTemplate/whyAngle/keyInsights/qualityChecks) e ele
// JÁ viaja em Content.reasoning. Este painel SURFACE esse dado — antes vivia só no editor
// (content/[id]); extraído p/ componente compartilhado e reusado na fila de Aprovações, onde a
// decisão acontece. Não inventa nada: omite o que não veio (mock/degradado/geração antiga).

function Panel({ bare, className = "", children }: { bare?: boolean; className?: string; children: ReactNode }) {
  if (bare) return <div className={className}>{children}</div>;
  return <Card className={className}>{children}</Card>;
}

function ReasoningRow({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-xs uppercase tracking-[0.16em] text-ink/65">{term}</dt>
      <dd className="text-ink/80">{value}</dd>
    </div>
  );
}

/** Raciocínio da IA — por que cada agente decidiu assim + checks de qualidade. Só aparece se há
 *  dado (nada de placeholder). `bare` = sem o Card wrapper (quando o pai já é um Card).
 *  `collapsible` = no PONTO DE DECISÃO (fila de Aprovações) o detalhe completo é
 *  parede de texto e infla a carga cognitiva (Hick/Miller): mostra só o veredito (1 linha + saúde
 *  da qualidade) e esconde o resto atrás de um expander. No editor (default) abre tudo. */
export function ReasoningPanel({
  reasoning,
  bare,
  collapsible,
}: {
  reasoning?: ContentReasoning | null;
  bare?: boolean;
  collapsible?: boolean;
}) {
  if (!reasoning) return null;
  const { whyTemplate, whyAngle, narrativeAngle, keyInsights, narrative, qualityChecks } = reasoning;
  const hasInsights = !!keyInsights && keyInsights.length > 0;
  const hasChecks = !!qualityChecks && qualityChecks.length > 0;
  if (!whyTemplate && !whyAngle && !narrative && !hasInsights && !hasChecks) return null;

  // O veredito de 1 linha = a recomendação mais saliente p/ decidir (Ângulo > Template > Narrativa).
  const verdict = whyAngle || whyTemplate || narrative || "";
  const checksPassed = qualityChecks?.filter((c) => c.passed).length ?? 0;
  const checksTotal = qualityChecks?.length ?? 0;

  const details = (
    <dl className="mt-3 space-y-3 text-sm">
        {whyTemplate && <ReasoningRow term="Template" value={whyTemplate} />}
        {whyAngle && (
          <ReasoningRow term="Ângulo" value={narrativeAngle ? `${whyAngle} (${narrativeAngle})` : whyAngle} />
        )}
        {narrative && <ReasoningRow term="Narrativa" value={narrative} />}
        {hasInsights && (
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 text-xs uppercase tracking-[0.16em] text-ink/65">Insights</dt>
            <dd className="text-ink/80">
              <ul className="list-disc space-y-0.5 pl-4">
                {keyInsights!.map((k, i) => <li key={i}>{k}</li>)}
              </ul>
            </dd>
          </div>
        )}
        {hasChecks && (
          <div className="flex gap-3">
            <dt className="w-24 shrink-0 text-xs uppercase tracking-[0.16em] text-ink/65">Qualidade</dt>
            <dd className="space-y-1">
              {qualityChecks!.map((c, i) => (
                <div key={i} className="flex items-start gap-2 text-ink/80">
                  <Badge tone={c.passed ? "high" : c.severity === "critical" || c.severity === "error" ? "low" : "medium"}>
                    {c.passed ? "ok" : "ajustar"}
                  </Badge>
                  <span>{c.label}</span>
                </div>
              ))}
            </dd>
          </div>
        )}
    </dl>
  );

  // Ponto de decisão: veredito + saúde da qualidade visíveis; detalhe sob demanda (<details> nativo,
  // acessível por teclado, sem JS de estado). No editor: tudo aberto (comportamento anterior).
  if (collapsible) {
    return (
      <Panel bare={bare}>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium text-ink">Raciocínio da IA</p>
          {checksTotal > 0 && (
            <Badge tone={checksPassed === checksTotal ? "high" : checksPassed >= checksTotal - 1 ? "medium" : "low"}>
              {checksPassed}/{checksTotal} checks
            </Badge>
          )}
        </div>
        {verdict && <p className="mt-1 text-sm text-ink/80">{verdict}</p>}
        <details className="group mt-2">
          <summary className={`inline-flex min-h-[44px] cursor-pointer list-none items-center text-xs font-medium text-ink/65 transition hover:text-ink ${FOCUS}`}>
            <span className="group-open:hidden">Ver raciocínio completo →</span>
            <span className="hidden group-open:inline">Ocultar raciocínio ↑</span>
          </summary>
          {details}
        </details>
      </Panel>
    );
  }

  return (
    <Panel bare={bare}>
      <p className="text-sm font-medium text-ink">Raciocínio da IA</p>
      <p className="mt-0.5 text-xs text-ink/65">Por que cada agente decidiu assim nesta peça.</p>
      {details}
    </Panel>
  );
}
