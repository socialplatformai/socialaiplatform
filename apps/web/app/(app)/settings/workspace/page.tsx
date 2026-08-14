"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  workspaceApi,
  COMMON_TIMEZONES,
  type WorkspaceSettings,
} from "@/lib/workspace";
import { ApiError } from "@/lib/api";
import { Button, Card, Field, Input, PageHeader, PageShell, SectionLabel, Select, Skeleton } from "@/components/ui";
import { toast } from "@/components/toast";

// A5 (ADR-0010): Fuso horário & janela de publicação do workspace.
// Config operacional (não exige Admin). O backend grava horários em UTC; o fuso
// daqui define apenas como os horários LOCAIS de agendamento são interpretados.
//
// Contrato de horas: o input nativo type="time" fala "HH:mm"; o backend fala
// "HH:mm:ss" (TimeOnly). Convertemos nas duas pontas — corta para "HH:mm" ao
// carregar, anexa ":00" ao salvar — e tratamos vazio como `null` (não usar janela).

/** "HH:mm:ss" | "HH:mm" | null → "HH:mm" para o <input type="time">. */
function toTimeInput(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 5); // "08:30:00" → "08:30"; já "HH:mm" fica intacto
}

/** "HH:mm" do input → "HH:mm:00" para o backend; vazio → null (sem janela). */
function fromTimeInput(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  return v.length === 5 ? `${v}:00` : v; // "08:30" → "08:30:00"
}

export default function WorkspaceSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["workspace-settings"],
    queryFn: () => workspaceApi.getSettings(),
  });

  return (
    <PageShell width="form">
      <PageHeader
        eyebrow="Configurações"
        title="Fuso horário & janela"
        description="Define como os horários de agendamento da sua conta são interpretados — e, opcionalmente, a faixa do dia em que você costuma publicar."
      />

      {isLoading ? (
        <Card>
          <div className="space-y-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-10 w-full" />
          </div>
        </Card>
      ) : isError ? (
        <Card>
          <p role="alert" className="text-sm text-ink/70">
            Não foi possível carregar as configurações da sua conta. Tente novamente.
          </p>
        </Card>
      ) : (
        <SettingsForm
          settings={data!}
          onSaved={() => qc.invalidateQueries({ queryKey: ["workspace-settings"] })}
        />
      )}
    </PageShell>
  );
}

function SettingsForm({
  settings,
  onSaved,
}: {
  settings: WorkspaceSettings;
  onSaved: () => void;
}) {
  const [timeZoneId, setTimeZoneId] = useState(settings.timeZoneId);
  const [windowStart, setWindowStart] = useState(toTimeInput(settings.publishWindowStart));
  const [windowEnd, setWindowEnd] = useState(toTimeInput(settings.publishWindowEnd));

  // Ressincroniza os campos quando a config recarregada muda (ex.: após salvar).
  useEffect(() => {
    setTimeZoneId(settings.timeZoneId);
    setWindowStart(toTimeInput(settings.publishWindowStart));
    setWindowEnd(toTimeInput(settings.publishWindowEnd));
  }, [settings]);

  const save = useMutation({
    mutationFn: () =>
      workspaceApi.saveSettings({
        // Preserva os campos de automação (Fase 2) — esta tela edita só fuso + janela; sem o spread
        // eles chegariam undefined ao backend (que é patch-friendly, mas a UI local perderia o valor).
        ...settings,
        timeZoneId,
        publishWindowStart: fromTimeInput(windowStart),
        publishWindowEnd: fromTimeInput(windowEnd),
      }),
    onSuccess: () => {
      toast.success("Configurações salvas.");
      onSaved();
    },
    onError: (e) => {
      // 400 = fuso inválido (o backend valida o ID IANA). Demais erros já viram
      // toast central; aqui damos a mensagem específica e acionável do fuso.
      if (e instanceof ApiError && e.status === 400) {
        toast.error("Fuso horário inválido.");
      }
    },
  });

  // O fuso salvo pode não estar na lista curada (ex.: definido por outro caminho).
  // Garante que ele apareça como opção para não "sumir" silenciosamente do Select.
  const hasCurrentTz = COMMON_TIMEZONES.some((tz) => tz.id === timeZoneId);

  // Validação local da janela: só vale se AMBOS preenchidos; início precisa ser antes do fim
  // (faixa do mesmo dia). Antes salvava invertido em silêncio — agora avisa e bloqueia o submit.
  const windowInvalida = !!windowStart && !!windowEnd && windowStart >= windowEnd;

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!save.isPending) save.mutate();
      }}
    >
      <Card>
        <SectionLabel>Fuso horário</SectionLabel>
        <p className="mt-2 mb-5 text-sm text-ink/65">
          Define como os horários de agendamento são interpretados. As publicações são
          gravadas em <span className="font-medium text-ink">UTC</span> internamente — trocar
          o fuso não move o que já está agendado, apenas como novos horários são lidos.
        </p>

        <Field
          label="Fuso"
          htmlFor="tz"
          hint="Use o fuso onde a sua audiência (e a sua operação) vive."
        >
          <Select
            id="tz"
            value={timeZoneId}
            onChange={(e) => setTimeZoneId(e.target.value)}
          >
            {!hasCurrentTz && timeZoneId && (
              <option value={timeZoneId}>{timeZoneId} (atual)</option>
            )}
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz.id} value={tz.id}>
                {tz.label}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      <Card>
        <SectionLabel>Janela de publicação (opcional)</SectionLabel>
        <p className="mt-2 mb-5 text-sm text-ink/65">
          A faixa do dia, em hora <span className="font-medium text-ink">local</span>, em que
          você prefere publicar. O <span className="font-medium text-ink">Calendário</span> usa
          essa faixa para pré-preencher o horário sugerido ao agendar.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Início"
            htmlFor="window-start"
            hint="Hora local. Em branco = sem janela."
          >
            <Input
              id="window-start"
              type="time"
              value={windowStart}
              onChange={(e) => setWindowStart(e.target.value)}
            />
          </Field>

          <Field
            label="Fim"
            htmlFor="window-end"
            hint="Hora local. Em branco = sem janela."
          >
            <Input
              id="window-end"
              type="time"
              value={windowEnd}
              onChange={(e) => setWindowEnd(e.target.value)}
            />
          </Field>
        </div>

        {windowInvalida && (
          <p role="alert" className="mt-3 text-sm text-danger dark:text-danger-on-dark">
            A hora de início precisa ser anterior à de fim.
          </p>
        )}

        <p className="mt-4 text-xs text-ink/65">
          Aviso suave — fora da janela você ainda pode agendar, só recebe um lembrete. Deixe
          ambos os campos em branco para não usar nenhuma janela.
        </p>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={save.isPending || windowInvalida} aria-busy={save.isPending}>
          {save.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </form>
  );
}
