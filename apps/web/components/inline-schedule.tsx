"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { scheduleApi, Frequency, FREQUENCY_OPTIONS } from "@/lib/workflow";
import { learningApi } from "@/lib/learning";
import { workspaceApi } from "@/lib/workspace";
import { validate } from "@/lib/validate";
import { Button, Field, Input, Select } from "@/components/ui";
import { toast } from "@/components/toast";

// I (propor>pedir, P3/P6): mesma régua HONESTA do Calendar — o bucket aprendido (manhã/tarde/noite)
// vira uma hora-âncora, limitada à janela de publicação que o operador configurou. Não inventa
// dia-da-semana nem precisão que o núcleo não tem.
const BUCKET_RANGE: Record<string, { startH: number; endH: number; label: string }> = {
  manhã: { startH: 6, endH: 12, label: "manhã" },
  tarde: { startH: 12, endH: 18, label: "tarde" },
  noite: { startH: 18, endH: 22, label: "noite" },
};

// R3 — molécula de AGENDAMENTO INLINE (próxima-ação; Lei de Tesler: o sistema encadeia,
// não o humano). Antes "aprovar" terminava num toast morto ("agende no calendário") e o
// operador re-navegava à mão. Aqui o agendar mora ONDE a decisão acontece. Reusa o MESMO
// contrato do calendário/create (hora de parede → backend converte pelo fuso do workspace;
// NÃO reinterpretar com new Date()). Mesma validação (validate.futureDateTime) do create.

export function InlineSchedule({
  contentId,
  onScheduled,
  compact = false,
}: {
  contentId: string;
  onScheduled?: () => void;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  // I: a IA já sabe a melhor janela e o fuso configurado — então PROPÕE um horário em vez de
  // abrir vazio. Reusa o mesmo contrato do Calendar (bucket × janela do workspace). Reversível.
  const { data: insights } = useQuery({ queryKey: ["learning-insights"], queryFn: learningApi.insights });
  const { data: settings } = useQuery({ queryKey: ["workspace-settings"], queryFn: workspaceApi.getSettings });

  const bucket = (insights?.bestWindow ?? "").toLowerCase();
  const hasRec = !!bucket && !!BUCKET_RANGE[bucket] && !insights?.insufficientData;

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
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00`;
  }, [hasRec, bucket, settings]);

  const [when, setWhen] = useState(suggestedWhen);
  const [frequency, setFrequency] = useState<number>(Frequency.None);
  const [dateError, setDateError] = useState<string | null>(null);
  // A sugestão chega depois do 1º render (insights/settings são async). Adota-a quando chegar,
  // SE o operador ainda não digitou nada (não sobrescreve escolha manual). Idiomático via effect.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched && !when && suggestedWhen) setWhen(suggestedWhen);
  }, [suggestedWhen, touched, when]);

  // mínimo = agora (hora de parede local, em formato datetime-local).
  const minDateTime = (() => {
    const n = new Date();
    n.setMinutes(n.getMinutes() - n.getTimezoneOffset());
    return n.toISOString().slice(0, 16);
  })();

  const schedule = useMutation({
    mutationFn: () => scheduleApi.schedule(contentId, when, frequency),
    onSuccess: (post) => {
      const repetia = frequency !== Frequency.None;
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["approvals-pending"] });
      setWhen(suggestedWhen); // próxima peça já abre com a sugestão de novo (não vazio)
      setTouched(false);
      setFrequency(Frequency.None);
      // T (honestidade consistente): o Calendar já avisa quando o horário cai fora da janela
      // de publicação configurada; aqui — onde o operador agenda DENTRO da aprovação — não pode
      // ser diferente. A5/ADR-0010 devolve outsideWindow no post; respeitamos o mesmo aviso suave.
      if (post?.outsideWindow) {
        toast.info("Agendado fora da janela de publicação configurada — confira em Configurações › Fuso.");
      } else {
        toast.success(
          repetia ? "Publicação agendada — vai se repetir automaticamente." : "Publicação agendada.",
        );
      }
      onScheduled?.();
    },
    onError: () => toast.error("Não foi possível agendar. Tente novamente."),
  });

  function submit() {
    const err = validate.futureDateTime(when);
    if (err) {
      setDateError(err);
      return;
    }
    setDateError(null);
    schedule.mutate();
  }

  const usouSugestao = hasRec && !!when && when === suggestedWhen;

  return (
    <div className={`flex flex-wrap items-end gap-2 ${compact ? "" : "mt-3"}`}>
      <Field
        label="Agendar para"
        hint={
          usouSugestao
            ? `Sugerido pela sua melhor janela (${BUCKET_RANGE[bucket].label}) — mude se quiser.`
            : compact ? undefined : "Data e hora futuras."
        }
        error={dateError}
      >
        <Input
          type="datetime-local"
          min={minDateTime}
          value={when}
          error={!!dateError}
          onChange={(e) => {
            setTouched(true);
            setWhen(e.target.value);
            setDateError(null);
          }}
        />
      </Field>
      <Field label="Repetir">
        <Select value={String(frequency)} onChange={(e) => setFrequency(Number(e.target.value))}>
          {FREQUENCY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      <Button variant="ghost" onClick={submit} disabled={schedule.isPending}>
        {schedule.isPending ? "Agendando…" : "Agendar"}
      </Button>
    </div>
  );
}
