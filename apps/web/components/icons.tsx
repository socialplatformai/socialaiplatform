"use client";

import type { SVGProps } from "react";

/**
 * Ícones SVG da marca — substituem os glifos de texto (✕ ≡ ✓ ‹ ›) que renderizavam
 * inconsistentes entre fontes/SO e não eram acessíveis. Sem dependência externa.
 * Decorativos por padrão (aria-hidden); passe aria-label + role="img" quando o ícone
 * for o único conteúdo de um controle.
 */
export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": props["aria-label"] ? undefined : true,
    ...props,
  };
}

export const IconMenu = (p: IconProps) => (
  <svg {...base(p)}><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
);
export const IconClose = (p: IconProps) => (
  <svg {...base(p)}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
);
export const IconCheck = (p: IconProps) => (
  <svg {...base(p)}><polyline points="20 6 9 17 4 12" /></svg>
);
export const IconBell = (p: IconProps) => (
  <svg {...base(p)}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
);
export const IconRefresh = (p: IconProps) => (
  <svg {...base(p)}><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
);
export const IconSparkles = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" /></svg>
);
export const IconChevronLeft = (p: IconProps) => (
  <svg {...base(p)}><polyline points="15 18 9 12 15 6" /></svg>
);
export const IconChevronRight = (p: IconProps) => (
  <svg {...base(p)}><polyline points="9 18 15 12 9 6" /></svg>
);
export const IconSun = (p: IconProps) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="4" /><line x1="12" y1="2" x2="12" y2="4" /><line x1="12" y1="20" x2="12" y2="22" /><line x1="4.2" y1="4.2" x2="5.6" y2="5.6" /><line x1="18.4" y1="18.4" x2="19.8" y2="19.8" /><line x1="2" y1="12" x2="4" y2="12" /><line x1="20" y1="12" x2="22" y2="12" /><line x1="4.2" y1="19.8" x2="5.6" y2="18.4" /><line x1="18.4" y1="5.6" x2="19.8" y2="4.2" /></svg>
);
export const IconMoon = (p: IconProps) => (
  <svg {...base(p)}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
);
export const IconArrowRight = (p: IconProps) => (
  <svg {...base(p)}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
);
export const IconAlert = (p: IconProps) => (
  <svg {...base(p)}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
);

// ── Ícones da espinha de navegação (R2 — uma área do ciclo de vida cada) ───────
/** Início — casa/command center. */
export const IconHome = (p: IconProps) => (
  <svg {...base(p)}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9 21v-6h6v6" /></svg>
);
/** Conteúdo — camadas (pauta→gerar→slides). */
export const IconLayers = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 3 3 8l9 5 9-5-9-5z" /><path d="M3 13l9 5 9-5" /><path d="M3 18l9 5 9-5" /></svg>
);
/** Revisão & Agenda — check em círculo. */
export const IconCheckCircle = (p: IconProps) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><polyline points="8.5 12.2 11 14.7 16 9.5" /></svg>
);
/** Desempenho — gráfico de barras (Few: monitoramento at-a-glance). */
export const IconChart = (p: IconProps) => (
  <svg {...base(p)}><line x1="4" y1="20" x2="20" y2="20" /><rect x="6" y="11" width="3" height="6" /><rect x="11" y="7" width="3" height="10" /><rect x="16" y="13" width="3" height="4" /></svg>
);
/** Publicação — envio (send). */
export const IconSend = (p: IconProps) => (
  <svg {...base(p)}><line x1="21" y1="3" x2="10" y2="14" /><polygon points="21 3 14.5 21 10 14 3 9.5 21 3" /></svg>
);
/** Ajustes — engrenagem. */
export const IconSettings = (p: IconProps) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></svg>
);
/** Calendário — sub-view de Revisão & Agenda. */
export const IconCalendar = (p: IconProps) => (
  <svg {...base(p)}><rect x="3" y="4.5" width="18" height="16.5" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="8" y1="2.5" x2="8" y2="6.5" /><line x1="16" y1="2.5" x2="16" y2="6.5" /></svg>
);
