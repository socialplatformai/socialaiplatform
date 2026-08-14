"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearToken } from "@/lib/api";
import { Logo } from "@/components/ui";
import { BrandSelector } from "@/components/brand-selector";
import { NotificationBell } from "@/components/notification-bell";
import { NAV_AREAS, activeArea, activeChildren } from "@/lib/navigation";
import { IconMenu, IconClose, IconSun, IconMoon } from "@/components/icons";

// R2 — Topbar agora é uma FAIXA fina que COMPLEMENTA a sidebar (não duplica a nav):
//  - desktop: sub-nav contextual da área ativa (deep-links preservados) + ações (sino/tema/sair)
//  - mobile/tablet: a sidebar vira gaveta; este header traz o gatilho + a lista completa
// A espinha das 6 áreas vive na <Sidebar>; aqui fica o nível 2 (sub-rotas) e as ações globais.

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("sap_theme", next ? "dark" : "light");
    } catch {}
    setDark(next);
  };
  return { dark, toggle };
}

export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false); // gaveta mobile
  const { dark, toggle } = useTheme();

  const area = activeArea(pathname);
  const children = activeChildren(pathname);

  const isActive = (href: string) =>
    pathname === href || (href !== "/dashboard" && pathname.startsWith(href));

  // Fecha a gaveta ao navegar.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  function logout() {
    clearToken();
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-30 border-b border-ink/8 bg-paper/80 backdrop-blur">
      <div className="flex h-16 items-center justify-between gap-2 px-4 sm:px-6">
        {/* Esquerda: gatilho mobile + título da área / sub-nav */}
        <div className="flex min-w-0 items-center gap-2">
          {/* Gatilho da gaveta (mobile/tablet) */}
          <button
            onClick={() => setOpen(!open)}
            className={`flex h-11 w-11 items-center justify-center rounded-full text-ink ring-1 ring-ink/10 lg:hidden ${FOCUS}`}
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            aria-expanded={open}
          >
            {open ? <IconClose size={20} aria-label="Fechar menu" /> : <IconMenu size={20} aria-label="Abrir menu" />}
          </button>

          {/* Logo só no mobile (no desktop ele vive na sidebar) */}
          <Link href="/dashboard" className={`flex items-center gap-2 rounded-lg lg:hidden ${FOCUS}`}>
            <Logo size={24} />
          </Link>

          {/* Sub-nav contextual da área ativa (desktop) — o nível 2 do funil.
              Quando os itens têm `group`, insere um divisor sutil ao trocar de grupo:
              transforma uma fileira longa (ex: 10 ajustes) em famílias legíveis. */}
          {children.length > 0 && (
            <nav aria-label={`Seções de ${area?.label ?? ""}`} className="hidden items-center gap-0.5 lg:flex">
              {children.map((c, i) => {
                const newGroup = !!c.group && c.group !== children[i - 1]?.group;
                return (
                  <span key={c.href} className="flex items-center">
                    {newGroup && i > 0 && <span aria-hidden className="mx-1.5 h-4 w-px bg-ink/10" />}
                    <Link
                      href={c.href}
                      aria-current={isActive(c.href) ? "page" : undefined}
                      className={`flex min-h-[44px] items-center rounded-full px-3 text-sm font-medium transition ${FOCUS} ${
                        isActive(c.href) ? "bg-ink/10 text-ink" : "text-ink/65 hover:bg-ink/5 hover:text-ink"
                      }`}
                    >
                      {c.label}
                    </Link>
                  </span>
                );
              })}
            </nav>
          )}
          {/* Área sem sub-rotas: mostra o nome da área como contexto (desktop) */}
          {children.length === 0 && area && (
            <span className="hidden text-sm font-medium text-ink/70 lg:block">{area.label}</span>
          )}
        </div>

        {/* Direita: ações globais */}
        <div className="flex shrink-0 items-center gap-1">
          {/* Dica do command palette (Norman: signifier descobrível) — abre o Cmd-K. */}
          <button
            onClick={() => window.dispatchEvent(new Event("apex:command-palette"))}
            aria-label="Abrir paleta de comandos (Ctrl+K)"
            className={`mr-1 hidden items-center gap-1.5 rounded-full border border-ink/12 px-2.5 py-1.5 text-xs text-ink/65 transition hover:border-ink/25 hover:text-ink/70 lg:flex ${FOCUS}`}
          >
            <span>Buscar</span>
            <kbd className="rounded-sm border border-ink/15 bg-canvas px-1 py-0.5 font-mono text-[10px]">⌘K</kbd>
          </button>
          <NotificationBell />
          <button
            onClick={toggle}
            aria-label={dark ? "Mudar para tema claro" : "Mudar para tema escuro"}
            className={`flex h-11 w-11 items-center justify-center rounded-full text-ink/65 transition hover:bg-ink/5 hover:text-ink ${FOCUS}`}
          >
            {dark ? <IconSun size={18} /> : <IconMoon size={18} />}
          </button>
          <button
            onClick={logout}
            className={`hidden min-h-[44px] items-center rounded-full px-3 text-sm font-medium text-ink/65 transition hover:text-ink sm:flex ${FOCUS}`}
          >
            Sair
          </button>
        </div>
      </div>

      {/* Gaveta mobile/tablet — espinha completa (6 áreas + sub-rotas) */}
      {open && (
        <nav className="flex max-h-[80vh] flex-col gap-1 overflow-y-auto border-t border-ink/8 bg-paper p-4 lg:hidden">
          <BrandSelector className="mb-2 [&>select]:w-full" />
          {NAV_AREAS.map((a) => (
            <div key={a.id}>
              <Link
                href={a.href}
                aria-current={isActive(a.href) ? "page" : undefined}
                className={`flex min-h-[44px] items-center rounded-md px-3 py-2.5 text-sm font-semibold transition ${FOCUS} ${
                  area?.id === a.id ? "bg-ink text-canvas" : "text-ink/80 hover:bg-ink/5"
                }`}
              >
                {a.label}
              </Link>
              {a.children && area?.id === a.id && (
                <div className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-ink/10 pl-3">
                  {a.children.map((c) => (
                    <Link
                      key={c.href}
                      href={c.href}
                      aria-current={isActive(c.href) ? "page" : undefined}
                      className={`min-h-[40px] rounded-md px-3 py-2 text-sm font-medium transition ${FOCUS} ${
                        isActive(c.href) ? "bg-ink/10 text-ink" : "text-ink/65 hover:bg-ink/5"
                      }`}
                    >
                      {c.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
          <button
            onClick={toggle}
            className={`mt-1 flex min-h-[44px] items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm font-medium text-ink/70 ${FOCUS}`}
          >
            {dark ? <IconSun size={16} /> : <IconMoon size={16} />}
            {dark ? "Tema claro" : "Tema escuro"}
          </button>
          <button
            onClick={logout}
            className={`min-h-[44px] rounded-md px-3 py-2.5 text-left text-sm font-medium text-ink/65 ${FOCUS}`}
          >
            Sair
          </button>
        </nav>
      )}
    </header>
  );
}
