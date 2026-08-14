"use client";

import { useEffect, useState, type ReactNode } from "react";
import { IconCheck, IconAlert, IconClose } from "@/components/icons";

// Sistema de toast on-brand, sem dependência externa. Store via módulo + listeners.
// Uso: import { toast } from "@/components/toast"; toast.success("Salvo");

export type ToastKind = "success" | "error" | "info";
export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

let counter = 0;
const listeners = new Set<(items: ToastItem[]) => void>();
let items: ToastItem[] = [];

function emit() {
  for (const l of listeners) l(items);
}

function push(kind: ToastKind, message: string, ttl = 4000) {
  const id = ++counter;
  items = [...items, { id, kind, message }];
  emit();
  if (ttl > 0) setTimeout(() => dismiss(id), ttl);
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  success: (m: string) => push("success", m),
  error: (m: string) => push("error", m, 6000),
  info: (m: string) => push("info", m),
};

const STYLES: Record<ToastKind, { ring: string; icon: ReactNode }> = {
  success: { ring: "ring-[#3E8E5E]/30", icon: <IconCheck size={16} className="text-[#3E8E5E]" /> },
  error: { ring: "ring-danger/30", icon: <IconAlert size={16} className="text-danger" /> },
  info: { ring: "ring-ink/10", icon: <IconAlert size={16} className="text-ink/65" /> },
};

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>([]);
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
    >
      {list.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className={`pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-md bg-paper px-4 py-3 text-sm text-ink shadow-lg ring-1 ${STYLES[t.kind].ring}`}
        >
          <span className="mt-0.5 shrink-0">{STYLES[t.kind].icon}</span>
          <span className="flex-1">{t.message}</span>
          <button
            onClick={() => dismiss(t.id)}
            aria-label="Fechar aviso"
            className="shrink-0 rounded-full p-0.5 text-ink/65 transition hover:text-ink"
          >
            <IconClose size={14} aria-label="Fechar aviso" />
          </button>
        </div>
      ))}
    </div>
  );
}
