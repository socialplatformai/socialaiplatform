"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { brandApi, getBrandId, setBrandId } from "@/lib/brands";
import { NAV_AREAS } from "@/lib/navigation";

// R2.5 (E7/U4) — Command Palette (Cmd/Ctrl-K). A "superfície cognitiva" do 2026: uma caixa
// que faz NAVEGAR (6 áreas + sub-rotas), TROCAR DE MARCA (multi-tenant), e as AÇÕES do núcleo
// (Gerar, Revisar). Serve a Marina (poder/velocidade por teclado) sem tirar a calma do Léo
// (ele nunca precisa abrir). Deriva de lib/navigation.ts → nunca diverge da sidebar.
// Norman: um caminho único e previsível pra qualquer destino. Tesler: o sistema encadeia.

type Command = {
  id: string;
  label: string;
  hint?: string;
  group: "Ações" | "Ir para" | "Trocar de marca";
  run: () => void;
  keywords?: string;
};

export function CommandPalette() {
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Marcas só carregam quando o palette abre (barato, cacheado).
  const { data: brands = [] } = useQuery({ queryKey: ["brands"], queryFn: brandApi.list, enabled: open });

  // Abre com Cmd/Ctrl-K de qualquer lugar, OU via evento (o botão-dica do topbar).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("apex:command-palette", onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("apex:command-palette", onOpen);
    };
  }, []);

  // Foco no input + reset ao abrir.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // microtask para o input já estar montado
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const close = () => setOpen(false);

  const commands: Command[] = useMemo(() => {
    const go = (href: string) => () => { close(); router.push(href); };
    const cmds: Command[] = [];

    // Ações do núcleo (primeiras — o que o operador mais faz).
    cmds.push({ id: "act-gerar", label: "Gerar conteúdo", hint: "novo post", group: "Ações", run: go("/create"), keywords: "criar novo gerar wizard" });
    cmds.push({ id: "act-revisar", label: "Revisar & aprovar", hint: "fila", group: "Ações", run: go("/approvals"), keywords: "aprovar revisar fila pendente" });
    cmds.push({ id: "act-pauta", label: "Nova pauta", hint: "ideia", group: "Ações", run: go("/pautas"), keywords: "pauta ideia briefing" });

    // Navegar — áreas + sub-rotas (fonte única: NAV_AREAS).
    for (const area of NAV_AREAS) {
      cmds.push({ id: `nav-${area.id}`, label: area.label, group: "Ir para", run: go(area.href), keywords: area.id });
      for (const c of area.children ?? []) {
        cmds.push({ id: `nav-${area.id}-${c.href}`, label: c.label, hint: area.label, group: "Ir para", run: go(c.href), keywords: `${area.label} ${c.label}` });
      }
    }

    // Trocar de marca (multi-tenant) — só as outras marcas.
    const activeBrand = getBrandId();
    for (const b of brands) {
      if (b.id === activeBrand) continue;
      cmds.push({
        id: `brand-${b.id}`,
        label: b.name,
        hint: "trocar de marca",
        group: "Trocar de marca",
        keywords: `marca brand ${b.name}`,
        run: () => { setBrandId(b.id); qc.invalidateQueries(); close(); },
      });
    }
    return cmds;
  }, [brands, router, qc]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filtro simples por substring (label + keywords). Mantém a ordem por grupo.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => `${c.label} ${c.hint ?? ""} ${c.keywords ?? ""}`.toLowerCase().includes(q));
  }, [commands, query]);

  // Mantém o índice ativo dentro do range quando o filtro muda.
  useEffect(() => { setActive(0); }, [query]);

  // Navegação por teclado dentro do palette.
  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(filtered.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); filtered[active]?.run(); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  };

  // Rola o item ativo pra dentro da vista.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    // guard: scrollIntoView pode não existir (ambientes de teste/headless) — nunca quebrar a paleta.
    el?.scrollIntoView?.({ block: "nearest" });
  }, [active, open]);

  if (!open) return null;

  // Agrupa preservando a ordem de aparição.
  const groups: { name: Command["group"]; items: { cmd: Command; idx: number }[] }[] = [];
  filtered.forEach((cmd, idx) => {
    let g = groups.find((x) => x.name === cmd.group);
    if (!g) { g = { name: cmd.group, items: [] }; groups.push(g); }
    g.items.push({ cmd, idx });
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={close}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-lg bg-paper shadow-xl ring-1 ring-ink/10"
        style={{ animation: "apex-stream-in var(--duration-fast) var(--ease-decel) both" }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKey}
          placeholder="Buscar ação, página ou marca…"
          aria-label="Buscar comando"
          className="w-full border-b border-ink/8 bg-transparent px-4 py-3.5 text-sm text-ink outline-none placeholder:text-ink/65"
        />
        <ul ref={listRef} className="max-h-[50vh] overflow-y-auto p-1.5" role="listbox" aria-label="Comandos">
          {filtered.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-ink/65">Nada encontrado.</li>
          )}
          {groups.map((g) => (
            <li key={g.name}>
              <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.16em] text-ink/65">{g.name}</p>
              <ul>
                {g.items.map(({ cmd, idx }) => (
                  <li key={cmd.id} data-idx={idx}>
                    <button
                      role="option"
                      aria-selected={idx === active}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => cmd.run()}
                      className={`flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm transition ${
                        idx === active ? "bg-ink text-canvas" : "text-ink/80 hover:bg-ink/5"
                      }`}
                    >
                      <span className="truncate font-medium">{cmd.label}</span>
                      {cmd.hint && (
                        <span className={`shrink-0 text-xs ${idx === active ? "text-canvas/60" : "text-ink/65"}`}>{cmd.hint}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-ink/8 px-3 py-2 text-[11px] text-ink/65">
          <span>↑↓ navegar · ↵ abrir · esc fechar</span>
          <span>⌘K</span>
        </div>
      </div>
    </div>
  );
}
