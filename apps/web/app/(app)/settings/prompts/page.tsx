"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { promptsApi, PROMPT_AGENTS, type PromptOverrides } from "@/lib/prompts";
import { isAdmin } from "@/lib/api";
import { Badge, Button, Card, Field, PageHeader, PageShell, Textarea } from "@/components/ui";

// ADR-0013: editor das instruções de cada agente de IA, por workspace. Admin-only (o backend
// retorna 403 para Member). O texto VOLTA do backend (é asset de edição, não segredo). A
// instrução personalizada só passa a valer quando o operador ativa o recurso no servidor — por
// isso o aviso. Sem personalização, cada agente usa a instrução-padrão da plataforma.

export default function PromptsSettingsPage() {
  // Admin-only: sem permissão, nada de edição — apenas o aviso honesto (o backend também
  // retorna 403). Mesmo padrão de settings/users e settings/audit.
  if (!isAdmin()) {
    return (
      <PageShell width="form">
        <PageHeader eyebrow="Configurações" title="Instruções da IA" />
        <Card>
          <p role="alert" className="text-sm text-ink/70">
            Apenas administradores podem reescrever as instruções dos agentes de IA.
          </p>
        </Card>
      </PageShell>
    );
  }

  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["settings", "prompts"],
    queryFn: () => promptsApi.list(),
  });

  return (
    <PageShell width="form">
      <PageHeader
        eyebrow="Configurações"
        title="Instruções da IA"
        description={
          <>
            Cada conteúdo passa por cinco agentes de IA, cada um com uma{" "}
            <span className="font-medium text-ink">instrução-padrão</span> que define como ele trabalha.
            Aqui você pode reescrever a instrução de um agente para ajustar o jeito da sua marca. Deixe em
            branco para usar o padrão.
          </>
        }
      />

      {/* Aviso de poder perigoso + nota de ativação pelo operador (a flag do servidor). */}
      <Card className="mb-6 border-amber-300/60 bg-amber-50/60 dark:border-amber-400/30 dark:bg-amber-400/5">
        <div className="flex items-start gap-3">
          <Badge tone="medium">atenção</Badge>
          <p className="text-sm text-ink/75">
            Reescrever uma instrução muda diretamente como a IA gera o conteúdo — uma instrução mal
            escrita pode piorar o resultado. Por segurança, suas instruções personalizadas só passam a
            valer depois que <span className="font-medium text-ink">o responsável técnico ativa o
            recurso no servidor</span>. Até lá, a plataforma usa as instruções-padrão. Se algo der
            errado, use <span className="font-medium text-ink">"Voltar ao padrão"</span> a qualquer
            momento.
          </p>
        </div>
      </Card>

      {isLoading ? (
        <Card>
          <p className="text-sm text-ink/65">Carregando…</p>
        </Card>
      ) : isError ? (
        <Card>
          <p role="alert" className="text-sm text-ink/70">
            Não foi possível carregar as instruções. Tente novamente.
          </p>
        </Card>
      ) : (
        <div className="space-y-5">
          {PROMPT_AGENTS.map((agent) => (
            <AgentPromptCard
              key={agent.key}
              agent={agent}
              data={data!}
              onChanged={() => qc.invalidateQueries({ queryKey: ["settings", "prompts"] })}
            />
          ))}
        </div>
      )}
    </PageShell>
  );
}

function AgentPromptCard({
  agent,
  data,
  onChanged,
}: {
  agent: (typeof PROMPT_AGENTS)[number];
  data: PromptOverrides;
  onChanged: () => void;
}) {
  const saved = data.overrides.find((o) => o.agentKey === agent.key)?.promptText ?? "";
  const [text, setText] = useState(saved);

  // Ressincroniza quando os dados recarregam (ex.: após salvar/voltar ao padrão).
  useEffect(() => {
    setText(saved);
  }, [saved]);

  const save = useMutation({
    mutationFn: () => promptsApi.save(agent.key, text.trim()),
    onSuccess: onChanged,
  });

  const reset = useMutation({
    mutationFn: () => promptsApi.reset(agent.key),
    onSuccess: () => {
      setText("");
      onChanged();
    },
  });

  const personalizado = saved.length > 0;
  const muitoLongo = text.length > data.maxLength;
  const podeSalvar = text.trim().length > 0 && !muitoLongo && text.trim() !== saved;

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-medium tracking-tight">{agent.label}</h2>
          <p className="mt-0.5 text-sm text-ink/65">{agent.desc}</p>
        </div>
        {personalizado ? (
          <Badge tone="medium">personalizado</Badge>
        ) : (
          <Badge tone="low">padrão</Badge>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (podeSalvar) save.mutate();
        }}
      >
        <Field
          label="Instrução do agente"
          hint="Em branco, este agente usa a instrução-padrão da plataforma."
          error={muitoLongo ? `Texto longo demais (máximo ${data.maxLength} caracteres).` : undefined}
        >
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder="Descreva como este agente deve trabalhar para a sua marca…"
            error={muitoLongo}
          />
        </Field>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!podeSalvar || save.isPending}>
            {save.isPending ? "Salvando…" : "Salvar"}
          </Button>
          {personalizado && (
            <Button
              type="button"
              variant="ghost"
              disabled={reset.isPending}
              onClick={() => reset.mutate()}
            >
              {reset.isPending ? "Voltando…" : "Voltar ao padrão"}
            </Button>
          )}
        </div>

        {save.isError && (
          <p role="alert" className="mt-2 text-sm text-red-500">
            Não foi possível salvar a instrução. Tente novamente.
          </p>
        )}
      </form>
    </Card>
  );
}
