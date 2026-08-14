"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { notificationsApi, type AppNotification } from "@/lib/notifications";
import { IconBell } from "@/components/icons";

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

// C4 (ADR-0009): sino de notificações in-app. Projeção de estado (sem tabela): aprovações
// pendentes, falhas de publicação, token IG expirando. Poll a cada 60s. Item de falha aponta
// para o conteúdo; demais são agregados por tipo (Ref=null) e levam à tela correspondente.
function destinoDe(n: AppNotification): string {
  switch (n.kind) {
    case "approval_pending":
      return "/approvals";
    case "publish_failed":
      return "/publishing";
    case "ig_token_expiring":
      return "/settings/instagram";
    default:
      return "/dashboard";
  }
}

const SEVERITY_DOT: Record<string, string> = {
  error: "bg-danger-solid",
  warning: "bg-[#C77B2B]",
  info: "bg-ink/40",
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: notificationsApi.list,
    refetchInterval: 60_000,
  });

  // Fecha ao clicar fora ou no Esc (consistente com o Modal — a11y de teclado).
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = data.length;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={count > 0 ? `Notificações (${count})` : "Notificações"}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`relative flex h-11 w-11 items-center justify-center rounded-full text-ink/65 transition hover:bg-ink/5 hover:text-ink ${FOCUS}`}
      >
        <IconBell size={18} />
        {count > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-solid px-1 text-[10px] font-semibold leading-none text-canvas">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[calc(100vw-2rem)] max-w-80 overflow-hidden rounded-lg bg-paper shadow-xl ring-1 ring-ink/10 sm:w-80">
          <div className="border-b border-ink/8 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-ink/65">Notificações</p>
          </div>
          {count === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink/65">Nada por aqui. Tudo em dia.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-ink/5 overflow-y-auto">
              {data.map((n, i) => (
                <li key={`${n.kind}-${n.ref ?? i}`}>
                  <Link
                    href={destinoDe(n)}
                    onClick={() => setOpen(false)}
                    className={`flex items-start gap-3 px-4 py-3 transition hover:bg-ink/5 ${FOCUS}`}
                  >
                    <span
                      aria-hidden
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[n.severity] ?? "bg-ink/40"}`}
                    />
                    <span className="text-sm text-ink">{n.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
