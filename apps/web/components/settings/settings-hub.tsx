"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { brandApi } from "@/lib/brand";
import { instagramApi } from "@/lib/instagram";
import { settingsApi } from "@/lib/settings";
import { budgetApi } from "@/lib/budget";
import { usersApi } from "@/lib/users";
import { workspaceApi } from "@/lib/workspace";
import { isAdmin } from "@/lib/api";
import { Badge, Card, SectionLabel, Skeleton } from "@/components/ui";

// SoT "TELA MARCA & AJUSTES" (Fatia 5): settings-hub — health-meter do workspace + sub-meter da
// marca + 5 cartões-resumo (Marca · Canais · IA · Equipe · Governança), cada um com badge de estado
// REAL (lido dos endpoints existentes; NUNCA inventado/simulado). O hub SUMARIZA e LINKA para os
// editores profundos; não duplica a edição.

type CardState = "ok" | "warn" | "todo" | "loading";

function badgeFor(state: CardState, labels?: { ok?: string; warn?: string; todo?: string }) {
  if (state === "loading") return <Skeleton className="h-5 w-16" />;
  if (state === "ok") return <Badge tone="high">{labels?.ok ?? "Pronto"}</Badge>;
  if (state === "warn") return <Badge tone="medium">{labels?.warn ?? "Atenção"}</Badge>;
  return <Badge tone="low">{labels?.todo ?? "Pendente"}</Badge>;
}

export function SettingsHub() {
  const admin = isAdmin();
  const kit = useQuery({ queryKey: ["brand-kit"], queryFn: brandApi.getKit });
  const ig = useQuery({ queryKey: ["dash-ig"], queryFn: instagramApi.status });
  const ai = useQuery({ queryKey: ["ai-config"], queryFn: settingsApi.getAi, enabled: admin, retry: false });
  const budget = useQuery({ queryKey: ["budget"], queryFn: budgetApi.get, enabled: admin, retry: false });
  const users = useQuery({ queryKey: ["users"], queryFn: usersApi.list, enabled: admin, retry: false });
  const wsSettings = useQuery({ queryKey: ["workspace-settings"], queryFn: workspaceApi.getSettings, enabled: admin, retry: false });

  // Estado REAL de cada área (sem inventar):
  // Marca: o "essencial" (branding+tone+público) está preenchido?
  const brandReady = !!(kit.data && kit.data.branding && kit.data.tone && kit.data.targetAudience);
  const brandState: CardState = kit.isLoading ? "loading" : brandReady ? "ok" : "todo";

  // Canais: Instagram conectado? (token expirando ≤7d = atenção)
  const connected = ig.data?.connected ?? false;
  const tokenExp = ig.data?.tokenExpiresAt ? new Date(ig.data.tokenExpiresAt) : null;
  const tokenSoon = !!(connected && tokenExp && (tokenExp.getTime() - Date.now()) / 86_400_000 <= 7);
  const canalState: CardState = ig.isLoading ? "loading" : !connected ? "todo" : tokenSoon ? "warn" : "ok";

  // IA: chave do workspace configurada? (admin-only; não-admin não vê o estado → "—")
  const aiState: CardState = !admin ? "todo" : ai.isLoading ? "loading" : ai.data?.configured ? "ok" : "todo";

  // Equipe: nº de membros (admin-only).
  const memberCount = users.data?.length ?? 0;
  const equipeState: CardState = !admin ? "todo" : users.isLoading ? "loading" : memberCount > 0 ? "ok" : "todo";

  // Governança: orçamento mensal definido? loop autônomo? (admin-only)
  const hasCap = (budget.data?.monthlyCapUsd ?? 0) > 0;
  const govState: CardState = !admin ? "todo" : budget.isLoading ? "loading" : hasCap ? "ok" : "warn";

  // Automação (Fase 2/task 2.2): o robô está ligado? (admin-only)
  const robotOn = wsSettings.data?.autoPostEnabled ?? false;
  const autoState: CardState = !admin ? "todo" : wsSettings.isLoading ? "loading" : robotOn ? "ok" : "todo";

  // Health do workspace: quantas das áreas essenciais (Marca·Canais·IA) estão prontas.
  const essentials = [brandState === "ok", canalState === "ok" || canalState === "warn", aiState === "ok"];
  const healthDone = essentials.filter(Boolean).length;
  const healthLoading = kit.isLoading || ig.isLoading || (admin && ai.isLoading);

  const cards: {
    key: string; title: string; href: string; state: CardState; detail: string;
    labels?: { ok?: string; warn?: string; todo?: string };
  }[] = [
    {
      key: "marca", title: "Marca", href: "#editor-marca", state: brandState,
      detail: brandReady ? "Essencial preenchido — a IA cria com a sua cara." : "Falta o essencial (negócio, voz, público).",
      labels: { ok: "Pronta", todo: "Incompleta" },
    },
    {
      key: "canais", title: "Canais", href: "/settings/instagram", state: canalState,
      detail: !connected ? "Instagram desconectado — sem publicar de verdade." : tokenSoon ? "Token expira em breve — reconecte." : `Conectado${ig.data?.username ? ` · @${ig.data.username}` : ""}.`,
      labels: { ok: "Conectado", warn: "Expira ≤7d", todo: "Desconectado" },
    },
    {
      key: "ia", title: "IA", href: "/settings/ai", state: aiState,
      detail: !admin ? "Visível só para administradores." : ai.data?.configured ? "Chave configurada — geração real." : "Sem chave do workspace — geração em modo simulado.",
      labels: { ok: "Configurada", todo: admin ? "Modo simulado" : "—" },
    },
    {
      key: "equipe", title: "Equipe", href: "/settings/users", state: equipeState,
      detail: !admin ? "Visível só para administradores." : memberCount > 0 ? `${memberCount} ${memberCount === 1 ? "membro" : "membros"} no workspace.` : "Convide sua equipe.",
      labels: { ok: `${memberCount} membro${memberCount === 1 ? "" : "s"}`, todo: admin ? "Só você" : "—" },
    },
    {
      key: "governanca", title: "Governança", href: "/settings/approval", state: govState,
      detail: !admin ? "Visível só para administradores." : hasCap ? `Teto mensal US$ ${budget.data!.monthlyCapUsd.toFixed(0)}${budget.data!.autonomousLoopEnabled ? " · loop ligado" : ""}.` : "Sem teto de gasto definido — recomendado antes do loop.",
      labels: { ok: "Definida", warn: "Sem teto", todo: "—" },
    },
    {
      key: "automacao", title: "Automação", href: "/settings/automation", state: autoState,
      detail: !admin ? "Visível só para administradores." : robotOn ? "Robô ligado — gera e agenda nos horários definidos." : "Robô desligado — você no controle manual.",
      labels: { ok: "Robô ligado", todo: "Desligado" },
    },
  ];

  return (
    <div className="space-y-6">
      {/* Health-meter do workspace (SoT): quantas áreas essenciais estão prontas. */}
      <Card className="ring-ink/10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <SectionLabel>Saúde do workspace</SectionLabel>
            <p className="mt-1 text-sm text-ink/70">
              {healthLoading
                ? "Verificando o estado das áreas…"
                : healthDone === 3
                  ? "Tudo pronto — marca, canal e IA configurados."
                  : `${healthDone}/3 áreas essenciais prontas (marca · canal · IA).`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex gap-1" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span key={i} className={`h-1.5 w-8 rounded-pill ${i < healthDone ? "bg-ink" : "bg-ink/12"}`} />
              ))}
            </span>
            <span className="text-sm tabular-nums font-medium text-ink">{healthLoading ? "—" : `${healthDone}/3`}</span>
          </div>
        </div>
      </Card>

      {/* 5 cartões-resumo, cada um com badge de estado REAL + link pro editor profundo. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => {
          const inPage = c.href.startsWith("#");
          const body = (
            <Card className="h-full ring-1 ring-ink/8 transition hover:ring-ink/20">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-medium text-ink">{c.title}</h3>
                {badgeFor(c.state, c.labels)}
              </div>
              <p className="mt-2 text-sm leading-relaxed text-ink/65">{c.detail}</p>
              <span className="mt-3 inline-block text-xs font-medium text-ink/70">
                {inPage ? "Editar abaixo ↓" : "Abrir →"}
              </span>
            </Card>
          );
          return inPage ? (
            <a key={c.key} href={c.href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink rounded-lg">{body}</a>
          ) : (
            <Link key={c.key} href={c.href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink rounded-lg">{body}</Link>
          );
        })}
      </div>
    </div>
  );
}
