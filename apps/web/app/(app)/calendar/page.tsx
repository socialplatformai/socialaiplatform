"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  scheduleApi,
  type ScheduledPost,
  Frequency,
  FREQUENCY_OPTIONS,
  FREQUENCY_LABEL,
} from "@/lib/workflow";
import { contentApi, CONTENT_STATUS_LABEL } from "@/lib/content";
import { learningApi } from "@/lib/learning";
import { workspaceApi } from "@/lib/workspace";
import { Badge, Button, Card, EmptyState, Field, FlowFrame, Input, PageHeader, PageShell, Select, SectionLabel } from "@/components/ui";
import { validate } from "@/lib/validate";
import { IconChevronLeft, IconChevronRight } from "@/components/icons";
import { toast } from "@/components/toast";
import { EsteiraPanel } from "./EsteiraPanel";

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// Mapa bucket→faixa horária do dia (honesto: BestWindow é grosso; a hora FINA vem da janela
// de publicação que o operador configurou — não inventamos precisão que o núcleo não tem).
const BUCKET_RANGE: Record<string, { startH: number; endH: number; label: string }> = {
  manhã: { startH: 6, endH: 12, label: "manhã" },
  tarde: { startH: 12, endH: 18, label: "tarde" },
  noite: { startH: 18, endH: 22, label: "noite" },
};

export default function CalendarPage() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });

  const range = useMemo(() => {
    const from = new Date(month.getFullYear(), month.getMonth(), 1);
    const to = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [month]);

  const { data: posts = [] } = useQuery({
    queryKey: ["calendar", range.from, range.to],
    queryFn: () => scheduleApi.calendar(range.from, range.to),
  });
  const { data: contents = [] } = useQuery({ queryKey: ["content"], queryFn: contentApi.list });
  const approved = contents.filter((c) => c.status === 3);
  const insights = useQuery({ queryKey: ["learning-insights"], queryFn: learningApi.insights });
  const settings = useQuery({ queryKey: ["workspace-settings"], queryFn: workspaceApi.getSettings });

  // ?window=noite vindo de Insights ("Agendar nessa janela") — força o bucket explícito.
  const urlWindow = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("window") : null;

  const byDay = useMemo(() => {
    const out: Record<number, ScheduledPost[]> = {};
    for (const p of posts) {
      const d = new Date(p.scheduledFor);
      if (d.getMonth() === month.getMonth() && d.getFullYear() === month.getFullYear()) {
        (out[d.getDate()] ??= []).push(p);
      }
    }
    return out;
  }, [posts, month]);

  const grid = useMemo(() => buildGrid(month), [month]);
  const monthLabel = month.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const todayKey = keyOf(new Date());

  // Aside da SoT: o agendador (sticky). Gate-stepper quando não há aprovado; senão o form.
  const scheduleAside =
    approved.length === 0 ? (
      <GateStepper hasContent={contents.length > 0} />
    ) : (
      <ScheduleForm
        approved={approved}
        insights={insights.data}
        settings={settings.data}
        urlWindow={urlWindow}
        onScheduled={() => {
          qc.invalidateQueries({ queryKey: ["calendar"] });
          qc.invalidateQueries({ queryKey: ["content"] });
        }}
      />
    );

  return (
    <PageShell width="full">
      <PageHeader eyebrow="Fluxo de publicação" title="Calendário" />

      {/* Título editorial híbrido da SoT (assinatura coesa). */}
      <div className="mb-8">
        <h2 className="font-sans text-4xl font-semibold leading-[1.05] tracking-tight text-ink sm:text-5xl">
          Calendário <em className="font-serif italic">editorial</em>.
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink/65">
          A cadência das suas publicações. Agende uma peça aprovada — vai ao ar no horário, sozinha.
        </p>
      </div>

      {/* SoT: grade mensal (cadência visível) é o PROTAGONISTA no conteúdo; o agendador é o aside
          sticky. FlowFrame de 2 zonas (sem rail — calendário não é fluxo numerado). */}
      <FlowFrame asideLabel="Agendar publicação" aside={scheduleAside}>
        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-medium capitalize text-ink">{monthLabel}</h3>
            <div className="flex gap-1">
              <Button variant="ghost" onClick={() => setMonth(addMonths(month, -1))} aria-label="Mês anterior">
                <IconChevronLeft size={16} aria-label="Mês anterior" />
              </Button>
              <Button variant="ghost" onClick={() => { const n = new Date(); setMonth(new Date(n.getFullYear(), n.getMonth(), 1)); }}>
                Hoje
              </Button>
              <Button variant="ghost" onClick={() => setMonth(addMonths(month, 1))} aria-label="Próximo mês">
                <IconChevronRight size={16} aria-label="Próximo mês" />
              </Button>
            </div>
          </div>

          <Card className="p-3 sm:p-4">
            <div className="grid grid-cols-7 gap-1">
              {DIAS.map((d) => (
                <div key={d} className="pb-1 text-center text-[10px] font-medium uppercase tracking-wider text-ink/65">{d}</div>
              ))}
              {grid.map((cell, idx) => {
                if (!cell) return <div key={`e${idx}`} className="min-h-[60px] sm:min-h-[88px] rounded-lg" />;
                const items = byDay[cell] || [];
                const isToday = keyOf(new Date(month.getFullYear(), month.getMonth(), cell)) === todayKey;
                return (
                  <div key={cell} className={`min-h-[60px] sm:min-h-[88px] rounded-lg border p-1.5 ${isToday ? "border-ink/30 bg-ink/[0.03]" : "border-ink/8"}`}>
                    <div className={`mb-1 text-xs font-medium ${isToday ? "text-ink" : "text-ink/65"}`}>{cell}</div>
                    <div className="space-y-1">
                      {items.map((p) => <DayChip key={p.id} post={p} />)}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {posts.length === 0 && (
            <div className="mt-6">
              <EmptyState title="Nenhuma publicação neste mês" description="Agende um conteúdo aprovado ao lado para vê-lo no calendário." />
            </div>
          )}
        </div>
      </FlowFrame>

      {/* task 2.7 — esteira: lookahead + editar + agendar em lote (endpoints já existiam; esta é a UI). */}
      <EsteiraPanel />
    </PageShell>
  );
}

/** Stepper do gate (P2): quando não há conteúdo aprovado, mostra o caminho ANTES do muro —
 *  Gerar → Aprovar → Agendar (você está aqui) — com CTA no passo que falta. */
function GateStepper({ hasContent }: { hasContent: boolean }) {
  const steps = [
    { n: 1, label: "Gerar conteúdo", done: hasContent },
    { n: 2, label: "Aprovar", done: false },
    { n: 3, label: "Agendar", here: true },
  ];
  return (
    <Card>
      <SectionLabel className="mb-3">Agendar</SectionLabel>
      <ol className="space-y-2.5">
        {steps.map((s) => (
          <li key={s.n} className="flex items-center gap-2.5">
            <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${
              s.done ? "bg-success-solid text-white" : s.here ? "bg-ink text-canvas" : "bg-ink/10 text-ink/65"
            }`}>
              {s.done ? "✓" : s.n}
            </span>
            <span className={`text-sm ${s.here ? "font-medium text-ink" : s.done ? "text-ink/70" : "text-ink/65"}`}>
              {s.label}{s.here && " — você está aqui"}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-sm text-ink/70">
        {hasContent
          ? "Você ainda não tem conteúdo aprovado para agendar."
          : "Você ainda não gerou nenhum conteúdo."}
      </p>
      <Link href={hasContent ? "/approvals" : "/create"} className="mt-3 inline-block">
        <Button>{hasContent ? "Ir para Aprovações" : "Gerar conteúdo"}</Button>
      </Link>
    </Card>
  );
}

/** Form de agendamento com SLOT PRÉ-PREENCHIDO honesto + recomendação de janela (I sobe de 1→4). */
function ScheduleForm({
  approved,
  insights,
  settings,
  urlWindow,
  onScheduled,
}: {
  approved: { id: string; caption: string | null }[];
  insights?: import("@/lib/learning").LearningInsights;
  settings?: import("@/lib/workspace").WorkspaceSettings;
  urlWindow: string | null;
  onScheduled: () => void;
}) {
  const qc = useQueryClient();
  // Bucket-alvo: o ?window= explícito do Insights tem prioridade; senão o bestWindow aprendido.
  const bucket = (urlWindow || insights?.bestWindow || "").toLowerCase();
  const hasRec = !!bucket && !!BUCKET_RANGE[bucket] && !insights?.insufficientData;

  // Hora sugerida HONESTA: a janela de publicação do workspace (hora real que ELE configurou),
  // limitada ao período do bucket. Sem janela configurada → âncora do bucket. Nunca inventa dia-da-semana.
  const suggestedWhen = useMemo(() => {
    if (!hasRec) return "";
    const r = BUCKET_RANGE[bucket];
    let hour = r.startH + 1; // âncora dentro do bucket (ex.: noite → 19h)
    const ws = settings?.publishWindowStart; // "HH:mm"
    if (ws) {
      const h = parseInt(ws.split(":")[0], 10);
      if (h >= r.startH && h < r.endH) hour = h; // usa a janela do operador se cai no bucket
    }
    const d = new Date();
    d.setDate(d.getDate() + 1); // próximo dia (não inventa dia-da-semana específico)
    d.setHours(hour, 0, 0, 0);
    // formato datetime-local "YYYY-MM-DDTHH:mm" (hora de parede local)
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00`;
  }, [hasRec, bucket, settings]);

  // P2/Fricção: com 1 só peça aprovada (o caso que acabou de destravar o gate), pré-seleciona —
  // elimina o último clique de pensamento. Com várias, deixa o operador escolher.
  const [contentId, setContentId] = useState(approved.length === 1 ? approved[0].id : "");
  const [when, setWhen] = useState(suggestedWhen);
  const [frequency, setFrequency] = useState<number>(Frequency.None);
  const [dateError, setDateError] = useState<string | null>(null);
  const edited = when !== suggestedWhen;

  const minDateTime = useMemo(() => {
    const n = new Date();
    n.setMinutes(n.getMinutes() - n.getTimezoneOffset());
    return n.toISOString().slice(0, 16);
  }, []);

  const schedule = useMutation({
    mutationFn: () => scheduleApi.schedule(contentId, when, frequency),
    onSuccess: (post) => {
      const repetia = frequency !== Frequency.None;
      setContentId(""); setWhen(suggestedWhen); setFrequency(Frequency.None); setDateError(null);
      onScheduled();
      if (post?.outsideWindow) toast.info("Agendado fora da janela de publicação configurada — confira em Configurações › Fuso.");
      else if (repetia) toast.success("Publicação agendada — vai se repetir automaticamente.");
      else toast.success("Publicação agendada.");
    },
  });

  function submit() {
    if (!contentId || !when) return;
    const err = validate.futureDateTime(when);
    if (err) { setDateError(err); return; }
    setDateError(null);
    schedule.mutate();
  }

  return (
    <Card>
      <SectionLabel className="mb-3">Agendar publicação</SectionLabel>

      {urlWindow && hasRec && (
        <p className="mb-3 rounded-md bg-ink/5 px-3 py-2 text-xs text-ink/70">
          Você veio de Desempenho — agendando na sua janela da <span className="font-medium text-ink">{BUCKET_RANGE[bucket].label}</span>.
        </p>
      )}

      <div className="space-y-4">
        <Field label="Conteúdo aprovado" hint="Escolha uma peça já aprovada para agendar.">
          <Select value={contentId} onChange={(e) => setContentId(e.target.value)}>
            <option value="">Selecione…</option>
            {approved.map((c) => (
              <option key={c.id} value={c.id}>{c.caption?.slice(0, 40) || c.id.slice(0, 8)}</option>
            ))}
          </Select>
        </Field>

        <Field label="Data e hora" hint="Data e hora futuras da publicação." error={dateError}>
          <Input
            type="datetime-local"
            min={minDateTime}
            value={when}
            error={!!dateError}
            onChange={(e) => { setWhen(e.target.value); setDateError(null); }}
          />
        </Field>

        {/* I sobe de 1→4: a recomendação aparece NO ponto de decisão, com o porquê e o n real. */}
        {hasRec && (
          <div className="rounded-md border border-ink/8 bg-ink/[0.02] px-3 py-2.5">
            <p className="text-sm text-ink">
              <span aria-hidden>⭐ </span>Recomendado: <span className="font-medium">{BUCKET_RANGE[bucket].label}</span>
            </p>
            <p className="mt-0.5 text-xs text-ink/65">
              {insights && insights.bestWindowAvgEngagement > 0
                ? `Posts nessa janela renderam em média ${Math.round(insights.bestWindowAvgEngagement)} de engajamento (${insights.sampleSize} ${insights.sampleSize === 1 ? "publicação" : "publicações"}).`
                : "Sua melhor janela com base no histórico até agora."}
              {insights && insights.mockSampleCount > 0 ? " · dados simulados" : ""}
            </p>
            {edited && (
              <button type="button" onClick={() => setWhen(suggestedWhen)} className="mt-1.5 text-xs font-medium text-ink underline-offset-2 hover:underline">
                ↩ usar minha melhor janela
              </button>
            )}
          </div>
        )}
        {insights?.insufficientData && (
          <p className="text-xs text-ink/65">
            Ainda sem dados suficientes para recomendar horário ({insights.sampleSize} publicações). Publique mais para a IA aprender sua melhor janela.
          </p>
        )}

        <Field label="Repetir" hint="Publica de novo automaticamente nesse intervalo.">
          <Select value={String(frequency)} onChange={(e) => setFrequency(Number(e.target.value))}>
            {FREQUENCY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </Field>

        <Button onClick={submit} disabled={schedule.isPending} className="w-full">
          {schedule.isPending ? "Agendando…" : "Agendar"}
        </Button>
      </div>
    </Card>
  );
}

/** Chip de um post agendado no dia — hora + recorrência. */
function DayChip({ post: p }: { post: ScheduledPost }) {
  const qc = useQueryClient();
  const unschedule = useMutation({
    mutationFn: (id: string) => scheduleApi.unschedule(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["calendar"] }); toast.success("Publicação desagendada."); },
  });
  return (
    <div
      title={(p.dispatched ? "Enviado para publicação" : CONTENT_STATUS_LABEL[p.contentStatus]) + (p.frequency ? ` · repete: ${FREQUENCY_LABEL[p.frequency]}` : "")}
      className={`group flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] ${p.dispatched ? "bg-ink/10 text-ink/75" : "bg-ink text-canvas"}`}
    >
      <span className="truncate">{formatTime(p.scheduledFor)}</span>
      {p.frequency ? <span aria-hidden="true">↻</span> : null}
      {!p.dispatched && (
        // O controle de DESAGENDAR fica sempre alcançável (não escondido atrás de hover, que morre no
        // toque): quieto por padrão (opacity-70), pleno no hover/foco. O ícone visual é pequeno (cabe no
        // chip de 10px), mas a ÁREA DE TOQUE é ampliada via pseudo-elemento `before:` para o mínimo
        // confortável no celular. A expansão é ASSIMÉTRICA — só para a direita/cima/baixo (espaço livre
        // na célula do dia), com a borda ESQUERDA alinhada ao botão (`left-0`): assim a área de toque
        // NÃO cobre o texto da hora à esquerda, evitando desagendar por engano ao tocar no horário.
        <button
          onClick={() => unschedule.mutate(p.id)}
          aria-label="Desagendar"
          className="relative ml-auto grid h-5 w-5 shrink-0 place-items-center rounded text-canvas/70 opacity-70 transition before:absolute before:left-0 before:-right-2 before:-top-2 before:-bottom-2 before:content-[''] hover:bg-canvas/15 hover:text-canvas hover:opacity-100 focus-visible:opacity-100"
        >
          ×
        </button>
      )}
    </div>
  );
}

function buildGrid(month: Date): (number | null)[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const lead = first.getDay();
  const cells: (number | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
function addMonths(d: Date, n: number): Date { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
function keyOf(d: Date): string { return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function formatTime(iso: string): string { return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
