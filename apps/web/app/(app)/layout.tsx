"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/api";
import { Topbar } from "@/components/topbar";
import { Sidebar } from "@/components/sidebar";
import { CommandPalette } from "@/components/command-palette";

/**
 * Shell do produto (R2): sidebar (espinha das 6 áreas) + coluna com topbar (sub-nav +
 * ações) + conteúdo. Guard de autenticação client-side (token no localStorage).
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [router]);

  // Placeholder neutro até confirmar o token (evita flash de conteúdo protegido).
  if (!ready) {
    return (
      <div className="min-h-screen bg-canvas" role="status" aria-live="polite">
        <span className="sr-only">Carregando…</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Skip-link: primeiro tab leva ao conteúdo (WCAG 2.4.1). */}
      <a href="#main" className="focusable-sr">
        Pular para o conteúdo
      </a>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        {children}
      </div>
      <CommandPalette />
    </div>
  );
}
