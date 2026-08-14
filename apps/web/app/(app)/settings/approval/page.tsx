"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { approvalApi } from "@/lib/workflow";
import { isAdmin } from "@/lib/api";
import { Badge, Button, Card, Field, PageHeader, PageShell, SectionLabel, Select } from "@/components/ui";
import { toast } from "@/components/toast";

// Modo de aprovação PADRÃO da conta (workspace). Define se o conteúdo gerado precisa de
// aprovação humana antes de poder ser agendado (Manual) ou pode ser agendado direto
// (Automático). Conteúdos e campanhas podem sobrepor este padrão. Admin-only (o backend
// gateia o PUT; definir Automático desliga o gate de moderação humana — ação sensível).

// Valores do enum ApprovalMode (.NET): Manual=0, Automatic=1.
const MANUAL = 0;
const AUTOMATIC = 1;

export default function ApprovalSettingsPage() {
  if (!isAdmin()) {
    return (
      <PageShell width="form">
        <PageHeader eyebrow="Configurações" title="Aprovação de conteúdo" />
        <Card>
          <p role="alert" className="text-sm text-ink/70">
            Apenas administradores podem mudar o modo de aprovação da conta.
          </p>
        </Card>
      </PageShell>
    );
  }

  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["approval-workspace-mode"],
    queryFn: () => approvalApi.getWorkspaceMode(),
  });

  return (
    <PageShell width="form">
      <PageHeader
        eyebrow="Configurações"
        title="Aprovação de conteúdo"
        description="Define o padrão da sua conta: se o conteúdo gerado precisa da sua aprovação antes de ser agendado, ou se pode ir direto. Conteúdos específicos podem ter um modo próprio."
      />

      {isLoading ? (
        <Card>
          <p className="text-sm text-ink/65">Carregando…</p>
        </Card>
      ) : isError ? (
        <Card>
          <p role="alert" className="text-sm text-ink/70">
            Não foi possível carregar o modo de aprovação. Tente novamente.
          </p>
        </Card>
      ) : (
        <ApprovalModeForm
          current={data!.mode}
          onSaved={() => qc.invalidateQueries({ queryKey: ["approval-workspace-mode"] })}
        />
      )}
    </PageShell>
  );
}

function ApprovalModeForm({ current, onSaved }: { current: number; onSaved: () => void }) {
  const [mode, setMode] = useState<number>(current);

  useEffect(() => {
    setMode(current);
  }, [current]);

  const save = useMutation({
    mutationFn: () => approvalApi.setWorkspaceMode(mode),
    onSuccess: () => {
      onSaved();
      toast.success("Modo de aprovação salvo.");
    },
  });

  const mudou = mode !== current;

  return (
    <Card>
      <div className="mb-5 flex items-center justify-between gap-4">
        <SectionLabel>Modo padrão</SectionLabel>
        <Badge tone={current === AUTOMATIC ? "high" : "medium"}>
          {current === AUTOMATIC ? "Automático" : "Manual"}
        </Badge>
      </div>

      <Field
        label="Como o conteúdo é liberado"
        hint="Manual: você revisa e aprova antes de agendar. Automático: o conteúdo pode ser agendado sem revisão."
      >
        <Select value={String(mode)} onChange={(e) => setMode(Number(e.target.value))}>
          <option value={MANUAL}>Manual — eu aprovo antes de agendar</option>
          <option value={AUTOMATIC}>Automático — agendar sem revisão</option>
        </Select>
      </Field>

      {mode === AUTOMATIC && (
        <p className="mt-3 rounded-md bg-amber-50/60 p-3 text-sm text-ink/75 dark:bg-amber-400/5">
          No modo automático, o conteúdo gerado pode ser agendado sem a sua revisão. Use com cuidado —
          a publicação ainda exige agendar, mas pula a etapa de aprovação humana.
        </p>
      )}

      <div className="mt-5">
        <Button onClick={() => save.mutate()} disabled={!mudou || save.isPending}>
          {save.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </div>

      {save.isError && (
        <p role="alert" className="mt-2 text-sm text-red-500">
          Não foi possível salvar. Tente novamente.
        </p>
      )}
    </Card>
  );
}
