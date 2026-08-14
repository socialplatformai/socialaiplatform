"use client";

import { IconCheck } from "@/components/icons";

export type Step = string | { label: string; sub?: string };

function stepLabel(s: Step): string {
  return typeof s === "string" ? s : s.label;
}
function stepSub(s: Step): string | undefined {
  return typeof s === "string" ? undefined : s.sub;
}

/**
 * Stepper de fluxo. DUAS orientações (a SoT "Gerar Conteudo v2" usa o rail VERTICAL numerado com
 * sub-rótulos — "Briefing / Origem e formato"). Horizontal é o default (não-regressão das telas
 * que já usam). Aceita `Step` string (compat) OU `{label, sub}` (rail SoT).
 *
 * Estados por passo: done (✓), active (preenchido), pending (mudo). aria-current="step" no ativo.
 */
export function StepIndicator({
  steps,
  current,
  orientation = "horizontal",
}: {
  steps: Step[];
  current: number;
  orientation?: "horizontal" | "vertical";
}) {
  if (orientation === "vertical") return <VerticalRail steps={steps} current={current} />;
  return <HorizontalBar steps={steps} current={current} />;
}

function stateOf(i: number, current: number) {
  return i < current ? "done" : i === current ? "active" : "pending";
}

function Bullet({ state, n }: { state: "done" | "active" | "pending"; n: number }) {
  return (
    <span
      aria-current={state === "active" ? "step" : undefined}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium transition ${
        state === "active"
          ? "bg-ink text-canvas"
          : state === "done"
            ? "bg-ink/15 text-ink"
            : "bg-ink/5 text-ink/65"
      }`}
    >
      {state === "done" ? <IconCheck size={13} aria-hidden /> : n}
    </span>
  );
}

/** Rail vertical numerado (SoT). Cada item: bullet + label + sub-rótulo; conector entre bullets. */
function VerticalRail({ steps, current }: { steps: Step[]; current: number }) {
  return (
    <ol className="flex flex-col gap-1">
      {steps.map((s, i) => {
        const state = stateOf(i, current);
        const last = i === steps.length - 1;
        return (
          <li key={i} className="flex gap-3">
            {/* coluna do bullet + conector vertical */}
            <div className="flex flex-col items-center">
              <Bullet state={state} n={i + 1} />
              {!last && (
                <span className={`my-1 w-px flex-1 ${i < current ? "bg-ink/25" : "bg-ink/10"}`} aria-hidden />
              )}
            </div>
            <div className={`min-w-0 ${last ? "" : "pb-4"}`}>
              <span className={`block text-sm font-medium ${state === "pending" ? "text-ink/65" : "text-ink"}`}>
                {stepLabel(s)}
              </span>
              {stepSub(s) && (
                <span className="mt-0.5 block text-xs text-ink/65">{stepSub(s)}</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Barra horizontal (default, comportamento original preservado). */
function HorizontalBar({ steps, current }: { steps: Step[]; current: number }) {
  return (
    <div>
      <ol className="flex items-center gap-2">
        {steps.map((s, i) => {
          const state = stateOf(i, current);
          return (
            <li key={i} className="flex flex-1 items-center gap-2">
              <Bullet state={state} n={i + 1} />
              <span
                className={`hidden text-xs font-medium sm:block ${
                  state === "pending" ? "text-ink/65" : "text-ink/70"
                }`}
              >
                {stepLabel(s)}
              </span>
              {i < steps.length - 1 && (
                <span className="mx-1 hidden h-px flex-1 bg-ink/10 sm:block" />
              )}
            </li>
          );
        })}
      </ol>
      {/* Mobile: rótulo do passo atual, já que os nomes ficam ocultos. */}
      <p className="mt-2 text-sm font-medium text-ink sm:hidden">
        Passo {current + 1} de {steps.length} — {stepLabel(steps[current])}
      </p>
    </div>
  );
}
