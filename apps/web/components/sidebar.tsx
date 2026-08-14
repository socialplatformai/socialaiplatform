"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/ui";
import { BrandSelector } from "@/components/brand-selector";
import { NAV_AREAS, activeArea } from "@/lib/navigation";
import {
  IconHome,
  IconLayers,
  IconCheckCircle,
  IconChart,
  IconSend,
  IconSettings,
  type IconProps,
} from "@/components/icons";

// R2 — a ESPINHA do funil (sidebar). Substitui a lista plana de 19 destinos do topbar
// por 6 áreas na ordem do ciclo de vida (lib/navigation.ts). O operador SEMPRE vê onde
// está no funil: a área ativa é destacada e o trilho mostra a progressão de estágio.
// Linear/Vercel: spine enxuta, densidade calma, 1 accent (o ink ativo). Brand switcher
// é 1ª classe no topo (multi-tenant: o contexto de marca nunca é ambíguo).

const ICONS: Record<string, (p: IconProps) => React.ReactElement> = {
  IconHome,
  IconLayers,
  IconCheckCircle,
  IconChart,
  IconSend,
  IconSettings,
};

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper";

export function Sidebar() {
  const pathname = usePathname();
  const active = activeArea(pathname);

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-ink/8 bg-paper lg:flex">
      {/* Marca do produto */}
      <Link
        href="/dashboard"
        className={`flex h-16 shrink-0 items-center gap-2.5 px-5 ${FOCUS}`}
      >
        <Logo size={26} />
        <span className="text-sm font-medium tracking-tight text-ink">Social AI</span>
      </Link>

      {/* Contexto de marca (multi-tenant) — 1ª classe, SEMPRE visível (showSingle):
          mostra o nome mesmo com 1 marca, então o operador nunca fica sem saber onde está. */}
      <div className="px-3 pb-3">
        <BrandSelector showSingle className="w-full [&>select]:w-full [&>select]:max-w-none" />
      </div>

      {/* As 6 áreas, na ordem do funil. O trilho à esquerda comunica progressão. */}
      <nav aria-label="Navegação principal" className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {NAV_AREAS.map((area) => {
          const Icon = ICONS[area.icon] ?? IconHome;
          const isActive = active?.id === area.id;
          return (
            <Link
              key={area.id}
              href={area.href}
              aria-current={isActive ? "page" : undefined}
              className={`group flex min-h-[44px] items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${FOCUS} ${
                isActive
                  ? "bg-ink text-canvas"
                  : "text-ink/65 hover:bg-ink/5 hover:text-ink"
              }`}
              style={{ transitionDuration: "var(--duration-fast)" }}
            >
              <Icon
                size={18}
                className={isActive ? "text-canvas" : "text-ink/65 group-hover:text-ink"}
              />
              <span className="min-w-0 flex-1 truncate">{area.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Rodapé: estágio do funil legível ("onde estou") */}
      <div className="shrink-0 border-t border-ink/8 px-5 py-3">
        <FunnelTrail current={active?.stage ?? 0} />
      </div>
    </aside>
  );
}

/** Trilho do funil — pontos por estágio; o atual cheio, os passados em ink, futuros vazios. */
function FunnelTrail({ current }: { current: number }) {
  const stages = NAV_AREAS.map((a) => a.stage);
  const max = Math.max(...stages);
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium uppercase tracking-[0.18em] text-ink/65">
        Ciclo
      </p>
      <div className="flex items-center gap-1" aria-hidden>
        {Array.from({ length: max + 1 }, (_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-pill transition-colors ${
              i < current ? "bg-ink/30" : i === current ? "bg-ink" : "bg-ink/10"
            }`}
            style={{ transitionDuration: "var(--duration-base)" }}
          />
        ))}
      </div>
    </div>
  );
}
