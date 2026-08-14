"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { workspaceApi, WorkspaceSettings, CREATIVE_STRATEGY, WEEKDAYS } from "@/lib/workspace";
import { weightsApi, MetricWeights, SIGNAL_LABELS } from "@/lib/weights";
import { budgetApi, BudgetStatus } from "@/lib/budget";
import { automationApi } from "@/lib/automation";
import { isAdmin } from "@/lib/api";
import { Badge, Button, Card, Field, Input, PageHeader, PageShell, SectionLabel, Select } from "@/components/ui";
import { toast } from "@/components/toast";

// Fase 2 (task 2.2) — Painel "Configurações › Automação" (o VOLANTE). Liga/desliga o robô por
// workspace, define a agenda (dias+horas), a estratégia de criativo, e a nota mínima de auto-aprovação.
// O kill-switch GLOBAL (Loop:Enabled, config de deploy) é mostrado como "sempre ativo" — nunca é
// desligável pela UI (salvaguarda soberana). Admin-only: ligar o robô é ação sensível.

export default function AutomationSettingsPage() {
  if (!isAdmin()) {
    return (
      <PageShell width="form">
        <PageHeader eyebrow="Configurações" title="Automação" />
        <Card>
          <p role="alert" className="text-sm text-ink/70">
            Apenas administradores podem configurar a automação da conta.
          </p>
        </Card>
      </PageShell>
    );
  }

  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["workspace-settings"],
    queryFn: () => workspaceApi.getSettings(),
  });

  return (
    <PageShell width="form">
      <PageHeader
        eyebrow="Configurações"
        title="Automação"
        description="Você no volante. Ligue o robô para gerar, aprovar (sob nota mínima) e agendar sozinho, dentro dos horários e do teto de gasto que você definir. Nada publica sem passar pelas salvaguardas."
      />

      {/* Freio-mestre GLOBAL — agora controlável pela tela (SystemSetting no banco). É a salvaguarda
          soberana: desligado aqui, NENHUM robô age, independente dos toggles por workspace abaixo. */}
      <MasterSwitchSection />

      {isLoading ? (
        <Card><p className="text-sm text-ink/65">Carregando…</p></Card>
      ) : isError ? (
        <Card>
          <p role="alert" className="text-sm text-ink/70">
            Não foi possível carregar a automação. Tente novamente.
          </p>
        </Card>
      ) : (
        <AutomationForm
          current={data!}
          onSaved={() => qc.invalidateQueries({ queryKey: ["workspace-settings"] })}
        />
      )}

      {/* ADR-0010/§2.4 — "inventar pauta sozinho" (o loop autônomo): o robô inventa pauta relevante
          à marca quando a fila esvazia. Ligado JUNTO com a postagem automática = AUTÔNOMO TOTAL. */}
      {!isLoading && !isError && data && <AutonomousLoopSection autoPostEnabled={data.autoPostEnabled} />}

      {/* task 4.3 — teto de gerações/dia do robô (rate-limit de custo), ajustável pela tela. */}
      <MaxPostsPerDaySection />

      {/* Fase 3 (task 3.2) — "o que é um bom post": pesos por sinal que definem sucesso. */}
      <MetricWeightsSection />
    </PageShell>
  );
}

// ── Freio-mestre global (o kill-switch soberano). Agora ligável pela tela, não por env-var. ────────
function MasterSwitchSection() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["master-switch"],
    queryFn: () => automationApi.getMasterSwitch(),
  });

  const save = useMutation({
    mutationFn: (enabled: boolean) => automationApi.saveMasterSwitch(enabled),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["master-switch"] });
      toast.success(res.enabled ? "Robô LIGADO globalmente." : "Robô DESLIGADO globalmente.");
    },
  });

  const on = data?.enabled ?? false;

  return (
    <Card>
      <div className="flex items-center justify-between gap-4">
        <div>
          <SectionLabel>Freio-mestre do robô</SectionLabel>
          <p className="mt-1 text-sm text-ink/65">
            Interruptor soberano de toda a automação deste ambiente. Desligado aqui, <strong>nenhum
            robô age</strong> — nem inventar pauta, nem publicar — independente do que estiver marcado
            abaixo. Ligue para liberar a automação; as salvaguardas por workspace (teto de gasto, nota
            mínima) continuam valendo.
          </p>
        </div>
        {!isLoading && <Badge tone={on ? "high" : "medium"}>{on ? "Ligado" : "Desligado"}</Badge>}
      </div>

      {isError ? (
        <p role="alert" className="mt-3 text-sm text-ink/70">Não foi possível carregar o freio-mestre.</p>
      ) : (
        <div className="mt-4">
          <Button
            onClick={() => save.mutate(!on)}
            disabled={isLoading || save.isPending}
            variant={on ? "danger" : "solid"}
          >
            {save.isPending ? "Salvando…" : on ? "Desligar robô globalmente" : "Ligar robô globalmente"}
          </Button>
          {save.isError && (
            <p role="alert" className="mt-2 text-sm text-red-500">Não foi possível salvar. Tente novamente.</p>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Teto de gerações/dia do robô (task 4.3) — rate-limit de custo, ajustável pela tela. ────────────
function MaxPostsPerDaySection() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["max-posts-per-day"],
    queryFn: () => automationApi.getMaxPostsPerDay(),
  });

  const [val, setVal] = useState("1");
  useEffect(() => {
    if (data) setVal(String(data.value));
  }, [data]);

  const num = Number(val);
  const valido = Number.isInteger(num) && num >= 1;

  const save = useMutation({
    mutationFn: () => automationApi.saveMaxPostsPerDay(num),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["max-posts-per-day"] });
      toast.success("Limite de gerações por dia salvo.");
    },
  });

  const mudou = data ? valido && num !== data.value : false;

  return (
    <Card>
      <div className="mb-2">
        <SectionLabel>Máximo de gerações por dia</SectionLabel>
        <p className="mt-1 text-sm text-ink/65">
          Quantas peças o robô pode gerar por dia (salvaguarda de custo — cada geração consome IA).
          Mesmo com vários horários definidos, o robô não passa deste teto. Mínimo 1.
        </p>
      </div>
      {isLoading ? (
        <p className="text-sm text-ink/65">Carregando…</p>
      ) : isError ? (
        <p role="alert" className="text-sm text-ink/70">Não foi possível carregar. Tente novamente.</p>
      ) : (
        <div className="mt-3 space-y-3">
          <Field label="Gerações por dia" hint="Inteiro maior ou igual a 1. Ex.: 3 para gerar até três peças por dia.">
            <Input
              type="number"
              min={1}
              step={1}
              value={val}
              onChange={(e) => setVal(e.target.value)}
            />
          </Field>
          {!valido && (
            <p role="alert" className="text-sm text-red-500">Informe um número inteiro maior ou igual a 1.</p>
          )}
          <Button onClick={() => save.mutate()} disabled={!mudou || save.isPending}>
            {save.isPending ? "Salvando…" : "Salvar"}
          </Button>
          {save.isError && (
            <p role="alert" className="mt-1 text-sm text-red-500">Não foi possível salvar. Tente novamente.</p>
          )}
        </div>
      )}
    </Card>
  );
}

// ── "Inventar pauta sozinho" — o cérebro do loop. Liga a flag AutonomousLoopEnabled (Budget). ──────
function AutonomousLoopSection({ autoPostEnabled }: { autoPostEnabled: boolean }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["budget"], queryFn: () => budgetApi.get() });

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-4">
        <SectionLabel>Inventar pauta sozinho</SectionLabel>
        {data && (
          <Badge tone={data.autonomousLoopEnabled ? "high" : "medium"}>
            {data.autonomousLoopEnabled ? "Ligado" : "Desligado"}
          </Badge>
        )}
      </div>
      <p className="mt-1 text-sm text-ink/65">
        Quando a sua fila de pautas esvazia, o robô inventa uma nova pauta relevante ao que a sua marca
        faz (usando a identidade e as diretrizes que você preencheu em Marca). Precisa de uma chave de
        IA e de um teto de gasto definido.
      </p>
      {isLoading ? (
        <p className="mt-4 text-sm text-ink/65">Carregando…</p>
      ) : data ? (
        <LoopForm current={data} autoPostEnabled={autoPostEnabled} onSaved={() => qc.invalidateQueries({ queryKey: ["budget"] })} />
      ) : (
        <p role="alert" className="mt-4 text-sm text-ink/70">Não foi possível carregar. Tente novamente.</p>
      )}
    </Card>
  );
}

function LoopForm({
  current,
  autoPostEnabled,
  onSaved,
}: {
  current: BudgetStatus;
  autoPostEnabled: boolean;
  onSaved: () => void;
}) {
  const [loopOn, setLoopOn] = useState(current.autonomousLoopEnabled);
  // Teto mensal (USD) — editável AQUI porque é a salvaguarda de custo que o robô exige (>0) para
  // gerar. A tela Uso & custos só EXIBE; a escrita vive junto do loop (mesmo budgetApi). String no
  // input p/ permitir apagar/digitar sem saltar pra 0; parse na hora de salvar.
  const [cap, setCap] = useState(String(current.monthlyCapUsd ?? 0));
  useEffect(() => {
    setLoopOn(current.autonomousLoopEnabled);
    setCap(String(current.monthlyCapUsd ?? 0));
  }, [current]);

  const capNum = Number(cap);
  const capValido = Number.isFinite(capNum) && capNum >= 0;

  const save = useMutation({
    mutationFn: () => budgetApi.save({ autonomousLoopEnabled: loopOn, monthlyCapUsd: capNum }),
    onSuccess: () => {
      onSaved();
      toast.success("Automação salva (teto mensal + invenção de pauta).");
    },
  });

  const mudou =
    loopOn !== current.autonomousLoopEnabled || (capValido && capNum !== current.monthlyCapUsd);
  const semTeto = capNum <= 0;
  // AUTÔNOMO TOTAL = as duas chaves ligadas: inventa pauta E publica sozinho, sem clique.
  const autonomoTotal = loopOn && autoPostEnabled;

  return (
    <div className="mt-4 space-y-4">
      <Field
        label="Teto de gasto mensal (USD)"
        hint="O robô só gera/publica sozinho enquanto o gasto do mês está abaixo deste teto (salvaguarda de custo). Precisa ser maior que zero para o robô agir — 0 mantém tudo pausado."
      >
        <Input
          type="number"
          min={0}
          step="0.5"
          placeholder="10"
          value={cap}
          onChange={(e) => setCap(e.target.value)}
        />
      </Field>
      {!capValido && (
        <p role="alert" className="text-sm text-red-500">O teto deve ser um número maior ou igual a zero.</p>
      )}

      <Field
        label="Inventar pauta quando a fila esvaziar"
        hint="Ligado: o robô cria uma pauta nova (relevante à marca) sempre que não houver pauta na fila. Desligado: a fila vazia simplesmente pausa o robô até você adicionar pautas."
      >
        <Select value={loopOn ? "1" : "0"} onChange={(e) => setLoopOn(e.target.value === "1")}>
          <option value="0">Desligado — eu abasteço a fila de pautas</option>
          <option value="1">Ligado — o robô inventa pauta sozinho</option>
        </Select>
      </Field>

      {semTeto && (
        <p role="alert" className="rounded-md bg-amber-50/60 p-3 text-sm text-ink/75 dark:bg-amber-400/5">
          Com <strong>teto zero</strong>, o robô fica pausado (salvaguarda de custo) — nem gera, nem
          inventa. Defina um teto acima para liberá-lo.
        </p>
      )}

      {/* Painel de status do modo — deixa explícito o que está ligado, sem inventar um 3º estado. */}
      <div className="rounded-md border border-ink/10 p-3 text-sm">
        <p className="font-medium text-ink">
          {autonomoTotal
            ? "🤖 Autônomo total"
            : loopOn
              ? "Sugerir e esperar seu OK"
              : "Manual"}
        </p>
        <p className="mt-1 text-ink/65">
          {autonomoTotal
            ? "O robô inventa a pauta, gera, aprova (sob a nota mínima) e publica — sem clique seu. Desligue qualquer uma das duas chaves para retomar o controle."
            : loopOn
              ? "O robô inventa a pauta como sugestão. Ela espera a sua aprovação antes de virar publicação. Para autônomo total, ligue também a Postagem automática acima."
              : "Nada acontece sozinho. Ligue a Postagem automática (acima) e a invenção de pauta (aqui) para o robô rodar de ponta a ponta."}
        </p>
      </div>

      <Button onClick={() => save.mutate()} disabled={!mudou || !capValido || save.isPending}>
        {save.isPending ? "Salvando…" : "Salvar"}
      </Button>
      {save.isError && (
        <p role="alert" className="mt-2 text-sm text-red-500">Não foi possível salvar. Tente novamente.</p>
      )}
    </div>
  );
}

function MetricWeightsSection() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["metric-weights"], queryFn: () => weightsApi.get() });

  return (
    <Card>
      <div className="mb-2">
        <SectionLabel>O que é um bom post</SectionLabel>
        <p className="mt-1 text-sm text-ink/65">
          Ajuste o peso de cada sinal (0–10). É a régua que o sistema usa para aprender o que funciona e
          priorizar os próximos posts — sua definição de sucesso, não uma fixa.
        </p>
      </div>
      {isLoading ? (
        <p className="text-sm text-ink/65">Carregando…</p>
      ) : (
        <WeightsForm
          current={data!}
          onSaved={() => qc.invalidateQueries({ queryKey: ["metric-weights"] })}
        />
      )}
    </Card>
  );
}

function WeightsForm({ current, onSaved }: { current: MetricWeights; onSaved: () => void }) {
  const [w, setW] = useState<MetricWeights>(current);
  useEffect(() => setW(current), [current]);

  const save = useMutation({
    mutationFn: () => weightsApi.save(w),
    onSuccess: () => {
      onSaved();
      toast.success("Régua de sucesso salva.");
    },
  });

  const mudou = SIGNAL_LABELS.some((s) => w[s.key] !== current[s.key]);

  return (
    <div className="mt-4 space-y-4">
      {SIGNAL_LABELS.map((s) => (
        <div key={s.key}>
          <div className="flex items-center justify-between">
            <label htmlFor={`w-${s.key}`} className="text-sm font-medium text-ink">{s.label}</label>
            <span className="text-sm tabular-nums text-ink/70">{w[s.key]}</span>
          </div>
          <input
            id={`w-${s.key}`}
            type="range"
            min={0}
            max={10}
            value={w[s.key]}
            onChange={(e) => setW((prev) => ({ ...prev, [s.key]: Number(e.target.value) }))}
            className="mt-1 w-full accent-ink"
          />
          <p className="text-xs text-ink/55">{s.hint}</p>
        </div>
      ))}
      <Button onClick={() => save.mutate()} disabled={!mudou || save.isPending}>
        {save.isPending ? "Salvando…" : "Salvar régua"}
      </Button>
      {save.isError && (
        <p role="alert" className="mt-2 text-sm text-red-500">Não foi possível salvar. Tente novamente.</p>
      )}
    </div>
  );
}

function AutomationForm({ current, onSaved }: { current: WorkspaceSettings; onSaved: () => void }) {
  const [autoPost, setAutoPost] = useState(current.autoPostEnabled);
  const [days, setDays] = useState<Set<number>>(() => parseDays(current.postingScheduleDays));
  const [times, setTimes] = useState(current.postingScheduleTimes);
  const [strategy, setStrategy] = useState<number>(current.creativeStrategy);
  const [threshold, setThreshold] = useState<number>(current.autoApprovalThreshold);

  useEffect(() => {
    setAutoPost(current.autoPostEnabled);
    setDays(parseDays(current.postingScheduleDays));
    setTimes(current.postingScheduleTimes);
    setStrategy(current.creativeStrategy);
    setThreshold(current.autoApprovalThreshold);
  }, [current]);

  const save = useMutation({
    mutationFn: () =>
      workspaceApi.saveSettings({
        ...current, // preserva timeZoneId + janela de publicação (esta tela não os edita)
        autoPostEnabled: autoPost,
        postingScheduleDays: serializeDays(days),
        postingScheduleTimes: times.trim(),
        creativeStrategy: strategy,
        autoApprovalThreshold: threshold,
      }),
    onSuccess: () => {
      onSaved();
      toast.success("Automação salva.");
    },
  });

  const thresholdValido = threshold >= 0 && threshold <= 100;

  return (
    <Card>
      <div className="mb-5 flex items-center justify-between gap-4">
        <SectionLabel>Robô de publicação</SectionLabel>
        <Badge tone={autoPost ? "high" : "medium"}>{autoPost ? "Ligado" : "Desligado"}</Badge>
      </div>

      <Field
        label="Postagem automática"
        hint="Ligado: o robô gera, agenda (e auto-aprova sob a nota mínima) nos horários abaixo. Desligado: nada automático — você segue no controle manual."
      >
        <Select value={autoPost ? "1" : "0"} onChange={(e) => setAutoPost(e.target.value === "1")}>
          <option value="0">Desligado — eu faço tudo manualmente</option>
          <option value="1">Ligado — o robô cuida nos horários definidos</option>
        </Select>
      </Field>

      {/* Dias da semana como chips clicáveis (multi-seleção). */}
      <div className="mt-5">
        <SectionLabel>Dias de publicação</SectionLabel>
        <div className="mt-2 flex flex-wrap gap-2">
          {WEEKDAYS.map((d) => {
            const on = days.has(d.value);
            return (
              <button
                key={d.value}
                type="button"
                aria-pressed={on}
                onClick={() => setDays((prev) => toggle(prev, d.value))}
                className={
                  "rounded-full border px-3 py-1 text-sm transition " +
                  (on
                    ? "border-ink bg-ink text-canvas"
                    : "border-ink/20 text-ink/70 hover:border-ink/40")
                }
              >
                {d.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-5">
        <Field
          label="Horários (separados por vírgula)"
          hint='Formato "HH:mm" — ex.: 09:00, 18:00. O robô publica nesses horários, nos dias marcados.'
        >
          <Input
            value={times}
            onChange={(e) => setTimes(e.target.value)}
            placeholder="09:00, 18:00"
          />
        </Field>
      </div>

      <div className="mt-5">
        <Field
          label="Estratégia de criativo"
          hint="Híbrido: a IA decide por slide (recomendado). Ou force sempre foto / sempre composição gráfica."
        >
          <Select value={String(strategy)} onChange={(e) => setStrategy(Number(e.target.value))}>
            <option value={CREATIVE_STRATEGY.Hybrid}>Híbrido — a IA decide por slide</option>
            <option value={CREATIVE_STRATEGY.AlwaysPhoto}>Sempre foto</option>
            <option value={CREATIVE_STRATEGY.AlwaysGraphic}>Sempre composição gráfica</option>
          </Select>
        </Field>
      </div>

      <div className="mt-5">
        <Field
          label="Nota mínima para auto-aprovar (0–100)"
          hint="Só o conteúdo com nota de qualidade igual ou acima disso é aprovado sem revisão. Abaixo, fica para você revisar."
        >
          <Input
            type="number"
            min={0}
            max={100}
            placeholder="70"
            value={String(threshold)}
            onChange={(e) => setThreshold(Number(e.target.value))}
          />
        </Field>
        {!thresholdValido && (
          <p role="alert" className="mt-1 text-sm text-red-500">A nota deve estar entre 0 e 100.</p>
        )}
      </div>

      {autoPost && (
        <p className="mt-5 rounded-md bg-amber-50/60 p-3 text-sm text-ink/75 dark:bg-amber-400/5">
          Com o robô ligado, ele age sozinho nos horários definidos — sempre dentro do teto de gasto do
          workspace e do freio global. Conteúdo abaixo da nota mínima ainda espera a sua revisão.
        </p>
      )}

      <div className="mt-5">
        <Button onClick={() => save.mutate()} disabled={!thresholdValido || save.isPending}>
          {save.isPending ? "Salvando…" : "Salvar automação"}
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

// ── helpers puros de (de)serialização do CSV de dias ──────────────────────────
function parseDays(csv: string): Set<number> {
  const set = new Set<number>();
  for (const tok of (csv ?? "").split(",")) {
    const n = Number(tok.trim());
    if (Number.isInteger(n) && n >= 0 && n <= 6) set.add(n);
  }
  return set;
}
function serializeDays(days: Set<number>): string {
  return [...days].sort((a, b) => a - b).join(",");
}
function toggle(set: Set<number>, value: number): Set<number> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
