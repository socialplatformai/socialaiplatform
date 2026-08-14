"use client";

// task 2.7 — ESTEIRA DE AGENDAMENTO: a tela que liga os 3 endpoints já existentes (editar / lote /
// lookahead) ao operador. Fica abaixo da grade do calendário. Reusa scheduleApi.{lookahead,reschedule,
// scheduleBatch} de lib/workflow.ts (que já espelham o ScheduleController). PT-BR, APEX, React Query.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { scheduleApi, type ScheduledPost } from "@/lib/workflow";
import { contentApi, CONTENT_STATUS_LABEL } from "@/lib/content";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, SectionLabel } from "@/components/ui";
import { validate } from "@/lib/validate";
import { toast } from "@/components/toast";

// Converte um ISO (UTC) para o valor de <input type="datetime-local"> (hora de parede local).
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export function EsteiraPanel() {
  const qc = useQueryClient();
  const [count, setCount] = useState(10);
  const [editing, setEditing] = useState<ScheduledPost | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);

  const lookahead = useQuery({
    queryKey: ["schedule-lookahead", count],
    queryFn: () => scheduleApi.lookahead(count),
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["schedule-lookahead"] });
    qc.invalidateQueries({ queryKey: ["calendar"] });
    qc.invalidateQueries({ queryKey: ["content"] });
  }

  const posts = lookahead.data ?? [];

  return (
    <section className="mt-10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-medium text-ink">Esteira de publicação</h3>
          <p className="mt-0.5 text-sm text-ink/65">
            As próximas publicações agendadas. Edite o horário, remova, ou agende várias de uma vez.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            aria-label="Quantas publicações à frente exibir"
            className="min-h-[44px] rounded-full border border-ink/15 bg-canvas px-3 py-2 text-sm text-ink"
          >
            {[5, 10, 20, 50].map((n) => (
              <option key={n} value={n}>Próximas {n}</option>
            ))}
          </select>
          <Button variant="ghost" onClick={() => setBatchOpen(true)}>Agendar em lote</Button>
        </div>
      </div>

      <Card className="p-0">
        {posts.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="Nada agendado à frente"
              description="Agende um conteúdo aprovado no calendário acima, ou use “Agendar em lote”."
            />
          </div>
        ) : (
          <ul className="divide-y divide-ink/8">
            {posts.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{fmt(p.scheduledFor)}</p>
                  <p className="truncate text-xs text-ink/60">
                    {p.dispatched ? "Enviado para publicação" : CONTENT_STATUS_LABEL[p.contentStatus]}
                  </p>
                </div>
                {p.dispatched ? (
                  <Badge>Enviado</Badge>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Button variant="ghost" onClick={() => setEditing(p)}>Editar</Button>
                    <UnscheduleButton id={p.id} onDone={invalidate} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing && (
        <RescheduleModal post={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); invalidate(); }} />
      )}
      {batchOpen && (
        <BatchModal onClose={() => setBatchOpen(false)} onDone={() => { setBatchOpen(false); invalidate(); }} />
      )}
    </section>
  );
}

function UnscheduleButton({ id, onDone }: { id: string; onDone: () => void }) {
  const unschedule = useMutation({
    mutationFn: () => scheduleApi.unschedule(id),
    onSuccess: () => { onDone(); toast.success("Publicação removida da esteira."); },
  });
  return (
    <Button variant="ghost" onClick={() => unschedule.mutate()} disabled={unschedule.isPending}>
      Remover
    </Button>
  );
}

// EDITAR (reschedule) — muda o horário de um agendamento não-despachado. Hora de parede local.
function RescheduleModal({ post, onClose, onDone }: { post: ScheduledPost; onClose: () => void; onDone: () => void }) {
  const [when, setWhen] = useState(() => toLocalInput(post.scheduledFor));
  const [error, setError] = useState<string | null>(null);

  const minDateTime = useMemo(() => {
    const n = new Date();
    n.setMinutes(n.getMinutes() - n.getTimezoneOffset());
    return n.toISOString().slice(0, 16);
  }, []);

  const reschedule = useMutation({
    mutationFn: () => scheduleApi.reschedule(post.id, when, post.frequency),
    onSuccess: (updated) => {
      onDone();
      if (updated?.outsideWindow) toast.info("Reagendado fora da janela de publicação configurada.");
      else toast.success("Horário atualizado.");
    },
  });

  function submit() {
    const err = validate.futureDateTime(when);
    if (err) { setError(err); return; }
    setError(null);
    reschedule.mutate();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Editar horário"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={reschedule.isPending}>
            {reschedule.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      }
    >
      <Field label="Nova data e hora" hint="Data e hora futuras da publicação." error={error}>
        <Input
          type="datetime-local"
          min={minDateTime}
          value={when}
          error={!!error}
          onChange={(e) => { setWhen(e.target.value); setError(null); }}
        />
      </Field>
    </Modal>
  );
}

// AGENDAR EM LOTE — várias peças aprovadas de uma vez, espaçadas dia a dia a partir de uma data-base.
// Resultado por item (um ruim não derruba os bons). Reusa scheduleApi.scheduleBatch.
function BatchModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data: contents = [] } = useQuery({ queryKey: ["content"], queryFn: contentApi.list });
  const approved = contents.filter((c) => c.status === 3); // 3 = Approved (Enums.cs)

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
  const [hour, setHour] = useState("09:00");
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const batch = useMutation({
    mutationFn: () => {
      // Espaça um post por dia a partir de startDate, no mesmo horário. scheduledFor é enviado como ISO
      // (hora de parede local convertida) — o batch do servidor persiste em UTC pelo fuso do workspace.
      const ids = [...selected];
      const items = ids.map((contentId, i) => {
        const [y, m, d] = startDate.split("-").map(Number);
        const [hh, mm] = hour.split(":").map(Number);
        const dt = new Date(y, m - 1, d + i, hh, mm, 0, 0);
        return { contentId, scheduledFor: dt.toISOString() };
      });
      return scheduleApi.scheduleBatch(items);
    },
    onSuccess: (results) => {
      const ok = results.filter((r) => r.scheduled).length;
      const fail = results.length - ok;
      onDone();
      if (fail === 0) toast.success(`${ok} publicação(ões) agendada(s) em lote.`);
      else toast.info(`${ok} agendada(s); ${fail} ignorada(s) (já agendada ou inválida).`);
    },
  });

  function submit() {
    if (selected.size === 0) { setError("Selecione ao menos uma peça."); return; }
    if (!startDate || !hour) { setError("Informe data e hora de início."); return; }
    setError(null);
    batch.mutate();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Agendar em lote"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-ink/60">{selected.size} selecionada(s)</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button onClick={submit} disabled={batch.isPending}>
              {batch.isPending ? "Agendando…" : "Agendar selecionadas"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink/70">
          Selecione peças aprovadas. Elas serão agendadas <span className="font-medium text-ink">uma por dia</span>,
          a partir da data escolhida, no mesmo horário.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="A partir de" hint="Data da primeira publicação.">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Horário" hint="Hora de cada publicação.">
            <Input type="time" value={hour} onChange={(e) => setHour(e.target.value)} />
          </Field>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div>
          <SectionLabel className="mb-2">Peças aprovadas</SectionLabel>
          {approved.length === 0 ? (
            <p className="text-sm text-ink/60">Nenhuma peça aprovada disponível para agendar.</p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {approved.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-ink/[0.03]">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      className="h-4 w-4 rounded border-ink/25 text-ink accent-ink"
                    />
                    <span className="truncate text-sm text-ink">{c.caption?.slice(0, 48) || c.id.slice(0, 8)}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
