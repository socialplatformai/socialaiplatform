"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { approvalApi, scheduleApi, type PendingContent } from "@/lib/workflow";
import { instagramApi } from "@/lib/instagram";
import { brandApi } from "@/lib/brand";
import { pautaApi } from "@/lib/pautas";
import { learningApi } from "@/lib/learning";
import { contentApi } from "@/lib/content";
import { Badge, Button, Card, FlowFrame, Skeleton, PageShell, PageHeader, SectionLabel } from "@/components/ui";
import { SlideCanvas } from "@/components/slide-canvas";
import { IconCheck, IconSparkles, IconLayers, IconChart, IconCalendar, IconArrowRight } from "@/components/icons";

// SoT "TELA INÍCIO": tira de SINAIS (falhas re-tentáveis · token IG expirando ≤7d · órfãs).
// HONESTIDADE/sem-simular: só sinalizo o que o backend REALMENTE expõe —
//   • token IG ≤7d  ← instagramApi.status.tokenExpiresAt (real)
//   • falhas        ← contentApi.list() status=8 Failed (real)
//   • órfãs (Generating >10min) → o backend NÃO expõe timestamp por conteúdo (Content sem createdAt)
//     → OMITIDO honestamente (declaro no doc), em vez de inventar/simular.
const DAY_MS = 86_400_000;
const FAILED_STATUS = 8;

export default function DashboardPage() {
  const pending = useQuery({ queryKey: ["dash-pending"], queryFn: approvalApi.pending });
  const upcoming = useQuery({
    queryKey: ["dash-calendar"],
    queryFn: () => {
      const now = new Date();
      const to = new Date(now.getTime() + 7 * 86400000);
      return scheduleApi.calendar(now.toISOString(), to.toISOString());
    },
  });
  const ig = useQuery({ queryKey: ["dash-ig"], queryFn: instagramApi.status });
  const kit = useQuery({ queryKey: ["brand-kit"], queryFn: brandApi.getKit });
  const pautas = useQuery({ queryKey: ["pautas"], queryFn: () => pautaApi.list() });
  // C7: fecha o loop "fica mais esperto e MOSTRA" no ponto de decisão (a home), consumindo
  // o contrato que /api/learning/insights JÁ expõe (bestFormat/bestWindow). Sem dado suficiente,
  // o card não aparece — nada de inteligência fabricada (L4/DEC-5).
  const learning = useQuery({ queryKey: ["dash-learning"], queryFn: learningApi.insights });
  // SINAIS (SoT): falhas re-tentáveis = conteúdos em status Failed(8). Dado REAL via /api/content.
  const allContent = useQuery({ queryKey: ["dash-content"], queryFn: contentApi.list });

  const pendingList = pending.data ?? [];
  const pendingCount = pendingList.length;
  const upcomingList = upcoming.data?.filter((p) => !p.dispatched) ?? [];
  const upcomingCount = upcomingList.length;
  const connected = ig.data?.connected ?? false;

  // Sinal: token do Instagram expirando em ≤7 dias (real — derivado de tokenExpiresAt). >0 = alerta.
  const tokenExpiresAt = ig.data?.tokenExpiresAt ? new Date(ig.data.tokenExpiresAt) : null;
  const tokenDaysLeft = tokenExpiresAt && connected
    ? Math.ceil((tokenExpiresAt.getTime() - Date.now()) / DAY_MS)
    : null;
  const tokenExpiringSoon = tokenDaysLeft != null && tokenDaysLeft <= 7;
  // Sinal: falhas re-tentáveis (status Failed). Lista real, não contagem inventada.
  const failedItems = (allContent.data ?? []).filter((c) => c.status === FAILED_STATUS);

  // Onboarding: o workspace está "vazio"? (marca sem voz, IG off, sem pautas)
  const hasBrand = !!(kit.data && (kit.data.tone || kit.data.branding || kit.data.editorialGuidelines));
  const hasPautas = (pautas.data?.length ?? 0) > 0;
  const steps = [hasBrand, connected, hasPautas];
  const doneCount = steps.filter(Boolean).length;
  const setupDone = doneCount === 3;
  const setupLoading = kit.isLoading || ig.isLoading || pautas.isLoading;

  // Aside da SoT: a TIRA DE SINAIS + status da conta + atalhos. Só dado REAL (sem simular).
  const signalsAside = (
    <div className="space-y-4">
      <SignalsStrip
        loading={ig.isLoading || allContent.isLoading}
        tokenDaysLeft={tokenExpiringSoon ? tokenDaysLeft : null}
        failedItems={failedItems}
      />
      <AccountStatus
        igLoading={ig.isLoading}
        igError={ig.isError}
        connected={connected}
        username={ig.data?.username ?? null}
      />
      <QuickActions />
    </div>
  );

  return (
    <PageShell width="full">
      <PageHeader eyebrow="Painel" title="Início" />

      {/* Título editorial híbrido da SoT (assinatura coesa com /create e /approvals). */}
      <div className="mb-8">
        <h2 className="font-sans text-4xl font-semibold leading-[1.05] tracking-tight text-ink sm:text-5xl">
          O que precisa de <em className="font-serif italic">você</em>.
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink/65">
          Visão do dia: o que espera sua decisão, o que está agendado e o status da conta.
        </p>
      </div>

      {/* ── BRIEFING DO DIA: a síntese-cérebro. Compõe dados reais numa frase. Largura cheia
          (acima do frame): é o "o que importa agora" antes do detalhe. ── */}
      {!setupLoading && (
        <DailyBriefing
          setupDone={setupDone}
          remaining={3 - doneCount}
          pendingCount={pendingCount}
          pendingError={pending.isError}
          learning={learning.data}
          upcomingCount={upcomingCount}
          upcomingError={upcoming.isError}
        />
      )}

      {/* ── Onboarding: faixa COMPACTA acima do frame (não rouba o protagonismo do trabalho). ── */}
      {!setupLoading && (
        <div className="mb-6">
          <SetupBar steps={{ hasBrand, connected, hasPautas }} done={doneCount} setupDone={setupDone} />
        </div>
      )}

      {/* SoT "TELA INÍCIO": conteúdo (mini-fila protagonista + herói + timeline 7 dias) + aside
          (tira de sinais + status + atalhos). FlowFrame de 2 zonas (sem rail — dashboard não é fluxo). */}
      <FlowFrame asideLabel="Sinais e status da conta" aside={signalsAside}>
        <div className="space-y-6">
          {/* HOT-PATH: o trabalho-núcleo do dia — mini-fila concreta COM thumb real (WYSIWYG). */}
          <ReviewSpotlight
            loading={pending.isLoading}
            error={pending.isError}
            items={pendingList}
            count={pendingCount}
          />

          {/* HERÓI: o verbo #1 (GERAR), tile-protagonista. Conta-zero re-rotula p/ "primeiro post". */}
          <GenerateHero firstTime={!setupLoading && doneCount === 0} />

          {/* TIMELINE 7 DIAS (SoT): a cadência visível — não só um número, a linha do tempo real. */}
          <SevenDayTimeline
            loading={upcoming.isLoading}
            error={upcoming.isError}
            items={upcomingList}
          />

          {/* APRENDIZADO como VETOR de próxima ação. Só aparece com amostra real. */}
          {learning.data && !learning.data.insufficientData && learning.data.bestFormat && (
            <LearningSpotlight insights={learning.data} />
          )}
        </div>
      </FlowFrame>
    </PageShell>
  );
}

/** Tira de SINAIS (SoT) — só o que o backend expõe de verdade. Sem alerta = estado calmo honesto. */
function SignalsStrip({
  loading,
  tokenDaysLeft,
  failedItems,
}: {
  loading: boolean;
  tokenDaysLeft: number | null;
  failedItems: import("@/lib/content").Content[];
}) {
  if (loading) {
    return (
      <Card>
        <SectionLabel>Sinais</SectionLabel>
        <Skeleton className="mt-3 h-5 w-40" />
      </Card>
    );
  }
  const hasTokenSignal = tokenDaysLeft != null;
  const hasFailures = failedItems.length > 0;
  const calm = !hasTokenSignal && !hasFailures;

  return (
    <Card className={calm ? "" : "border-warning/30 bg-warning/[0.04]"}>
      {/* Rótulo escopado p/ NÃO ser lido como "nada a fazer" (a fila de
          aprovação fica no card protagonista; aqui são só ANOMALIAS — falhas/token). Antes "Sinais"
          + "Nada exige atenção" era ambíguo perto do contador de pendências. */}
      <SectionLabel>Sinais da conta</SectionLabel>
      {calm ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-ink/65">
          <span aria-hidden className="grid h-5 w-5 place-items-center rounded-full bg-success-solid/15 text-success">
            <IconCheck size={12} />
          </span>
          Sem falhas nem pendências de conta.
        </p>
      ) : (
        <ul className="mt-2 space-y-2.5 text-sm">
          {hasFailures && (
            <li className="flex items-start gap-2">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />
              <span className="text-ink/80">
                <span className="font-medium text-ink">{failedItems.length}</span>{" "}
                {failedItems.length === 1 ? "peça falhou" : "peças falharam"} — pode tentar de novo.{" "}
                <Link href="/approvals" className="font-medium text-ink underline-offset-2 hover:underline">Ver</Link>
              </span>
            </li>
          )}
          {hasTokenSignal && (
            <li className="flex items-start gap-2">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
              <span className="text-ink/80">
                Token do Instagram expira em{" "}
                <span className="font-medium text-ink">
                  {tokenDaysLeft <= 0 ? "breve" : `${tokenDaysLeft} ${tokenDaysLeft === 1 ? "dia" : "dias"}`}
                </span>.{" "}
                <Link href="/settings/instagram" className="font-medium text-ink underline-offset-2 hover:underline">Reconectar</Link>
              </span>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

/** Status da conta (Instagram) — mantém o cartão honesto do estado de publicação. */
function AccountStatus({
  igLoading,
  igError,
  connected,
  username,
}: {
  igLoading: boolean;
  igError: boolean;
  connected: boolean;
  username: string | null;
}) {
  return (
    <Card>
      <SectionLabel>Instagram</SectionLabel>
      <div className="mt-2 flex items-center gap-2">
        {igLoading ? (
          <Skeleton className="h-6 w-28" />
        ) : (
          <>
            <Badge tone={connected ? "high" : "low"}>{connected ? "Conectado" : "Desconectado"}</Badge>
            {connected && username && <span className="text-sm text-ink/70">@{username}</span>}
          </>
        )}
      </div>
      <p className="mt-2 text-sm text-ink/65">
        {igError ? "Não foi possível carregar." : connected ? "Pronto para publicar." : "Conecte para publicar suas peças."}
      </p>
      <Link href="/settings/instagram" className="mt-4 inline-block">
        <Button variant={connected ? "ghost" : "solid"}>{connected ? "Gerenciar" : "Conectar"}</Button>
      </Link>
    </Card>
  );
}

/** Timeline 7 dias (SoT) — a cadência VISUAL: 7 colunas (hoje→+6d), cada uma com os posts
 *  agendados daquele dia. Dado real (scheduleApi.calendar). Vazio = honesto ("nada agendado"). */
function SevenDayTimeline({
  loading,
  error,
  items,
}: {
  loading: boolean;
  error: boolean;
  items: { scheduledFor: string; dispatched: boolean }[];
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today.getTime() + i * DAY_MS);
    const count = items.filter((p) => {
      const sd = new Date(p.scheduledFor);
      sd.setHours(0, 0, 0, 0);
      return sd.getTime() === d.getTime();
    }).length;
    return { d, count };
  });
  const total = items.length;
  const weekday = (d: Date) => ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][d.getDay()];

  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <SectionLabel>Próximos 7 dias</SectionLabel>
        <Link href="/calendar" className="text-xs font-medium text-ink/65 underline-offset-2 hover:text-ink hover:underline">
          Ver calendário →
        </Link>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-20 w-full" />
      ) : error ? (
        <p className="mt-3 text-sm text-ink/65">Não foi possível carregar a agenda.</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-7 gap-1.5">
            {days.map(({ d, count }, i) => {
              const isToday = i === 0;
              return (
                <div key={i} className="flex flex-col items-center gap-1.5">
                  <span className={`text-[10px] uppercase tracking-wider ${isToday ? "text-ink" : "text-ink/65"}`}>
                    {weekday(d)}
                  </span>
                  {/* Coluna: altura/preenchimento sinaliza presença de posts (não gráfico falso —
                      é contagem real). Vazio = traço sutil; com posts = bloco ink + número. */}
                  <div
                    className={`flex h-16 w-full flex-col items-center justify-end rounded-md ring-1 ${
                      count > 0 ? "bg-ink/[0.04] ring-ink/12" : "ring-ink/8"
                    }`}
                    title={`${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}: ${count} post(s)`}
                  >
                    {count > 0 && (
                      <span className="mb-1 grid h-6 w-6 place-items-center rounded-full bg-ink text-xs font-medium text-canvas">
                        {count}
                      </span>
                    )}
                  </div>
                  <span className={`text-[11px] tabular-nums ${isToday ? "font-medium text-ink" : "text-ink/65"}`}>
                    {d.getDate()}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-sm text-ink/65">
            {total === 0
              ? "Nada agendado para os próximos 7 dias."
              : <><span className="font-medium text-ink">{total}</span> post(s) agendado(s) nesta semana.</>}
          </p>
        </>
      )}
    </Card>
  );
}

/** Herói da home: o verbo #1 (GERAR). Tile grande, ação primária, 1 clique → /create.
 *  Conta-zero (nada configurado) re-rotula para "Criar meu primeiro post" — onboarding como
 *  protagonista, sem inventar passos. Fitts: alvo grande no canto de entrada do scan-Z. */
function GenerateHero({ firstTime }: { firstTime: boolean }) {
  return (
    <Card className="flex flex-col justify-between border-ink/15 bg-ink/[0.03]">
      <div>
        <span aria-hidden className="grid h-11 w-11 place-items-center rounded-full bg-ink text-canvas">
          <IconSparkles size={20} />
        </span>
        <h2 className="mt-3 font-serif text-2xl tracking-tight text-ink">
          {firstTime ? "Criar meu primeiro post" : "Gerar conteúdo"}
        </h2>
        <p className="mt-1 max-w-sm text-sm text-ink/65">
          {firstTime
            ? "Diga o tema (ou escolha uma pauta) e a IA monta o carrossel — você só revisa."
            : "De uma pauta ou um tema livre a um carrossel pronto, em minutos — você revisa antes de publicar."}
        </p>
      </div>
      <Link href="/create" className="mt-5 inline-block">
        <Button>{firstTime ? "Começar agora" : "Gerar conteúdo"}</Button>
      </Link>
    </Card>
  );
}

/** Atalhos rápidos aos demais verbos (1 clique cada) — densidade útil sem o operador caçar na
 *  sidebar nem descobrir o Cmd+K. Rams: só os 4 destinos mais usados; o resto vive no Cmd+K/sidebar. */
function QuickActions() {
  const actions = [
    { label: "Nova pauta", hint: "anotar ideia", href: "/pautas", icon: <IconLayers size={16} /> },
    { label: "Insights", hint: "o que aprendi", href: "/insights", icon: <IconChart size={16} /> },
    { label: "Calendário", hint: "agenda", href: "/calendar", icon: <IconCalendar size={16} /> },
    { label: "Histórico", hint: "o que já saiu", href: "/history", icon: <IconArrowRight size={16} /> },
  ];
  return (
    <Card>
      <SectionLabel>Atalhos</SectionLabel>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {actions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="group flex items-center gap-2.5 rounded-md p-2.5 ring-1 ring-ink/10 transition hover:bg-ink/[0.03] hover:ring-ink/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          >
            <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink/5 text-ink/70 transition group-hover:text-ink">
              {a.icon}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-ink">{a.label}</span>
              <span className="block truncate text-xs text-ink/65">{a.hint}</span>
            </span>
          </Link>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink/65">
        Dica: <kbd className="rounded bg-ink/5 px-1.5 py-0.5 font-sans text-[11px] text-ink/70">⌘K</kbd> abre tudo de qualquer tela.
      </p>
    </Card>
  );
}

/** Briefing do dia — a síntese-cérebro [UI hoje]. Compõe pendências + melhor janela aprendida
 *  + agenda numa frase de uma linha. NÃO prevê (narra o presente); cada cláusula só entra se o
 *  dado existe. Conta-nova → frase de setup. Honesto: se a janela vem de amostra simulada, rotula. */
function DailyBriefing({
  setupDone, remaining, pendingCount, pendingError, learning, upcomingCount, upcomingError,
}: {
  setupDone: boolean;
  remaining: number;
  pendingCount: number;
  pendingError: boolean;
  learning?: import("@/lib/learning").LearningInsights;
  upcomingCount: number;
  upcomingError: boolean;
}) {
  // Conta-nova: sem setup pronto, o briefing é o convite a preparar a conta (não inventa cérebro).
  if (!setupDone) {
    return (
      <Card className="mb-6 border-ink/12 bg-ink/[0.02]">
        <p className="text-sm text-ink">
          <span className="font-medium">Vamos preparar sua conta</span> — {remaining}{" "}
          {remaining === 1 ? "passo restante" : "passos restantes"} para a IA criar com a sua cara.
        </p>
      </Card>
    );
  }

  // Cláusulas condicionais (ordem = urgência decrescente). Só entra a que tem dado real.
  const parts: React.ReactNode[] = [];
  if (!pendingError) {
    parts.push(
      pendingCount > 0
        ? <><span className="font-medium text-ink">{pendingCount} {pendingCount === 1 ? "peça espera" : "peças esperam"}</span> sua decisão</>
        : <>fila de aprovação vazia</>,
    );
  }
  const hasWindow = learning && !learning.insufficientData && learning.bestWindow;
  if (hasWindow) {
    parts.push(
      <>melhor janela: <span className="font-medium text-ink">{learning!.bestWindow}</span>{learning!.mockSampleCount > 0 ? " (simulado)" : ""}</>,
    );
  }
  if (!upcomingError) {
    parts.push(
      upcomingCount > 0
        ? <><span className="font-medium text-ink">{upcomingCount}</span> agendado(s) p/ 7 dias</>
        : <>nada agendado p/ os próximos 7 dias</>,
    );
  }
  if (parts.length === 0) return null;

  return (
    <Card className="mb-6 border-ink/12 bg-ink/[0.02]">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-ink/75">
        {parts.map((p, i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            {i > 0 && <span className="text-ink/30">·</span>}
            {p}
          </span>
        ))}
      </p>
    </Card>
  );
}

/** O card-protagonista: o que está aguardando aprovação, com mini-fila concreta. */
function ReviewSpotlight({
  loading,
  error,
  items,
  count,
}: {
  loading: boolean;
  error: boolean;
  items: PendingContent[];
  count: number;
}) {
  if (loading) {
    return (
      <Card>
        <SectionLabel>Aguardando sua aprovação</SectionLabel>
        <Skeleton className="mt-3 h-9 w-64" />
        <Skeleton className="mt-3 h-14 w-full" />
      </Card>
    );
  }

  // Caminho frio: nada pendente. Honesto, sem dead-end — aponta o próximo passo.
  if (error || count === 0) {
    return (
      <Card>
        <SectionLabel>Aguardando sua aprovação</SectionLabel>
        <p className="mt-2 text-2xl font-medium tracking-tight text-ink">
          {error ? "—" : "Tudo em dia"}
        </p>
        <p className="mt-1 text-sm text-ink/65">
          {error
            ? "Não foi possível carregar a fila de aprovação."
            : "Nenhuma peça aguardando agora. Gere conteúdo para alimentar a fila."}
        </p>
        {!error && (
          <Link href="/create" className="mt-4 inline-block">
            <Button>Gerar conteúdo</Button>
          </Link>
        )}
      </Card>
    );
  }

  // Caminho quente: há peças. Protagonista — número grande + mini-fila + CTA forte.
  // Mini-fila ordenada por risco (pior qualityScore primeiro) — a home destaca o que mais
  // precisa de olho, coerente com a triagem por risco da fila de aprovação. Sem score → ao fim.
  const preview = [...items]
    .sort((a, b) => (a.qualityScore ?? 999) - (b.qualityScore ?? 999))
    .slice(0, 3);
  return (
    <Card className="border-ink/15 bg-ink/[0.03]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <SectionLabel>Aguardando sua aprovação</SectionLabel>
          <p className="mt-1 text-3xl font-medium tracking-tight text-ink">
            {count} {count === 1 ? "peça" : "peças"}{" "}
            <span className="text-lg font-normal text-ink/65">
              {count === 1 ? "aguarda sua decisão" : "aguardam sua decisão"}
            </span>
          </p>
        </div>
        <Link href="/approvals">
          <Button>Revisar agora</Button>
        </Link>
      </div>

      {/* Mini-fila COM thumb real (SoT mostra miniaturas) — WYSIWYG via SlideCanvas do 1º slide,
          buscado sob demanda e cacheado (mesma key do detalhe; sem backend novo). */}
      <ul className="mt-4 divide-y divide-ink/8 border-t border-ink/8">
        {preview.map((it) => (
          <li key={it.contentId}>
            <Link
              href={`/approvals?focus=${it.contentId}`}
              className="flex items-center gap-3 py-2.5 text-sm transition-colors hover:bg-ink/[0.02]"
            >
              <DashThumb contentId={it.contentId} />
              <span className="min-w-0 flex-1 truncate text-ink/80">
                {it.caption?.trim() || "Sem legenda ainda"}
              </span>
              {typeof it.qualityScore === "number" && (
                <Badge tone={it.qualityScore >= 70 ? "medium" : "low"}>
                  {it.qualityScore}
                </Badge>
              )}
            </Link>
          </li>
        ))}
      </ul>
      {count > preview.length && (
        <p className="mt-2 text-xs text-ink/65">
          + {count - preview.length} {count - preview.length === 1 ? "outra" : "outras"} na fila
        </p>
      )}
    </Card>
  );
}

/** Faixa de onboarding compacta. A 3/3 colapsa numa faixa "tudo pronto" (sem
 *  dead-end, ADR-0007); incompleto, mostra "N/3" + só os passos que faltam. */
function SetupBar({
  steps,
  done,
  setupDone,
}: {
  steps: { hasBrand: boolean; connected: boolean; hasPautas: boolean };
  done: number;
  setupDone: boolean;
}) {
  // 3/3 — faixa colapsada que NÃO some e leva direto ao gerador.
  if (setupDone) {
    return (
      <Card className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-success-solid text-white">
            <IconCheck size={14} />
          </span>
          <p className="text-sm font-medium text-ink">Configuração concluída — tudo pronto para gerar conteúdo.</p>
        </div>
        <Link href="/create" className="shrink-0">
          <Button>Gerar conteúdo</Button>
        </Link>
      </Card>
    );
  }

  const remaining = [
    { done: steps.hasBrand, title: "Configurar a marca", href: "/brand", cta: "Configurar" },
    { done: steps.connected, title: "Conectar o Instagram", href: "/settings/instagram", cta: "Conectar" },
    { done: steps.hasPautas, title: "Criar a primeira pauta", href: "/pautas", cta: "Criar pauta" },
  ].filter((s) => !s.done);

  return (
    <Card className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-ink/65">
            Configuração
          </span>
          <span className="text-sm font-medium text-ink">{done}/3 concluídos</span>
          <span className="flex gap-1" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={`h-1.5 w-6 rounded-pill ${i < done ? "bg-ink" : "bg-ink/12"}`}
              />
            ))}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {remaining.map((s) => (
            <Link key={s.href} href={s.href}>
              <Button variant="ghost">{s.cta}: {s.title.replace("Configurar a ", "").replace("Conectar o ", "").replace("Criar a primeira ", "")}</Button>
            </Link>
          ))}
        </div>
      </div>
    </Card>
  );
}

/** C7 — surfacing da recomendação aprendida na home. Verbaliza "recomendo X porque Y"
 *  (I-LOOP-VISÍVEL) e leva direto ao gerador com o formato vencedor pré-selecionado
 *  (deep-link ?type=). Rotula amostra simulada (T-HONESTIDADE-DE-SIMULAÇÃO). */
function LearningSpotlight({ insights }: { insights: import("@/lib/learning").LearningInsights }) {
  const { bestFormat, bestWindow, bestFormatAvgEngagement, sampleSize, mockSampleCount } = insights;
  const simulado = mockSampleCount > 0;
  // Sem formato vencedor não há recomendação acionável — não renderiza ruído.
  if (!bestFormat) return null;
  const eng = Math.round(bestFormatAvgEngagement);
  return (
    <Card className="mt-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <SectionLabel>O que aprendi com seus resultados</SectionLabel>
            {simulado && <Badge tone="low">Simulado</Badge>}
          </div>
          <p className="mt-1 text-sm text-ink/80">
            <span className="font-medium text-ink">{bestFormat}</span> é seu formato de melhor
            desempenho{eng > 0 ? <> (engajamento médio {eng})</> : null}
            {bestWindow ? <> · melhor janela: <span className="font-medium text-ink">{bestWindow}</span></> : null}.
          </p>
          <p className="mt-1 text-xs text-ink/65">
            Baseado em {sampleSize} {sampleSize === 1 ? "publicação" : "publicações"}.
          </p>
        </div>
        <Link href={`/create?type=${encodeURIComponent(bestFormat)}`} className="shrink-0">
          <Button>Gerar um {bestFormat}</Button>
        </Link>
      </div>
    </Card>
  );
}

/** Miniatura WYSIWYG (1º slide) da peça pendente na mini-fila da home. Busca cacheada (mesma
 *  key do detalhe em /approvals e /content) — sem backend novo, sem N+1 perceptível. */
function DashThumb({ contentId }: { contentId: string }) {
  const { data } = useQuery({ queryKey: ["content", contentId], queryFn: () => contentApi.get(contentId) });
  const first = data?.slides?.[0];
  return (
    <span className="block w-9 shrink-0 overflow-hidden rounded-sm">
      {first ? (
        <SlideCanvas slide={first} />
      ) : (
        <span className="block aspect-[4/5] w-full rounded-sm bg-canvas-2 ring-1 ring-ink/5" />
      )}
    </span>
  );
}
