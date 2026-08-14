"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  pautaApi,
  PRIORITY_LABEL,
  TYPE_LABEL,
  STATUS_LABEL,
  type PautaInput,
  type Pauta,
} from "@/lib/pautas";
import { Badge, Button, Card, EmptyState, Field, Input, Select, PageShell, PageHeader, SectionLabel } from "@/components/ui";
import { PautaForm } from "@/components/pauta-form";
import { ideaApi } from "@/lib/ideas";
import { IconSparkles } from "@/components/icons";
import { toast } from "@/components/toast";
import { validate } from "@/lib/validate";

const EMPTY: PautaInput = { title: "", priority: 1, desiredType: 0 };

// Exemplos-semente (E9.2): vivem só como texto do botão/placeholder; nunca viram
// dado salvo a menos que o operador clique "usar exemplo".
const SEED = {
  title: "5 erros que sabotam o engajamento no Instagram",
  objective: "Educar seguidores sobre boas práticas e gerar salvamentos.",
  marketingObjective: "Reconhecimento de marca",
};

export default function PautasPage() {
  // Conexão Pautas↔Ideias: quando a IA tem sugestões esperando, mostramos um atalho visível
  // (antes a relação era só uma frase na descrição). Some quando não há ideias (sem ruído).
  const { data: ideas = [] } = useQuery({ queryKey: ["ideas"], queryFn: ideaApi.list });
  const ideasCount = ideas.length;

  return (
    <PageShell width="full">
      <PageHeader
        eyebrow="Criadas por você"
        title="Pautas"
        description="Pauta é uma ideia de post que você anota para a IA transformar em conteúdo. As de prioridade mais alta são geradas primeiro."
        actions={
          ideasCount > 0 ? (
            <Link href="/ideas">
              <Button variant="ghost">
                <IconSparkles size={14} aria-hidden />
                <span className="ml-1.5">{ideasCount} {ideasCount === 1 ? "ideia da IA" : "ideias da IA"}</span>
              </Button>
            </Link>
          ) : undefined
        }
      />

      <div className="grid gap-6 min-w-0 lg:grid-cols-[360px_1fr]">
        <NewPauta />
        <PautaList />
      </div>
    </PageShell>
  );
}

function NewPauta() {
  const qc = useQueryClient();
  const [form, setForm] = useState<PautaInput>(EMPTY);
  const [attachUrl, setAttachUrl] = useState("");
  // E9.4 — só mostra erros depois de uma tentativa de submit (não polui o
  // formulário em branco). Cada campo é validado pelos validadores puros.
  const [submitted, setSubmitted] = useState(false);

  // Erros de forma (inline). Título obrigatório; anexo precisa ser URL válida.
  const errors = {
    title: validate.required(form.title),
    attachUrl: validate.url(attachUrl),
  };
  const hasErrors = Object.values(errors).some((e) => e !== null);

  const create = useMutation({
    mutationFn: () =>
      pautaApi.create({
        ...form,
        attachments: attachUrl ? [{ url: attachUrl }] : undefined,
      }),
    onSuccess: () => {
      setForm(EMPTY);
      setAttachUrl("");
      setSubmitted(false);
      qc.invalidateQueries({ queryKey: ["pautas"] });
      toast.success("Pauta criada. Gere o conteúdo dela em “Gerar”.");
    },
  });

  function submit() {
    setSubmitted(true);
    if (hasErrors) return; // bloqueia o submit enquanto houver erro de forma
    create.mutate();
  }

  return (
    <Card>
      <SectionLabel className="mb-4">Nova pauta</SectionLabel>
      {/* Fonte única do formulário (mesmo componente do modo edição). */}
      <PautaForm
        mode="create"
        value={form}
        onChange={setForm}
        onSubmit={submit}
        submitting={create.isPending}
        errors={{ title: errors.title }}
        showErrors={submitted}
        extraFields={
          <Field
            label="Anexo (URL)"
            hint="Print, depoimento, referência."
            error={submitted ? errors.attachUrl : null}
          >
            <Input
              placeholder="https://exemplo.com/referencia.png"
              value={attachUrl}
              error={submitted && !!errors.attachUrl}
              onChange={(e) => setAttachUrl(e.target.value)}
            />
          </Field>
        }
      />
    </Card>
  );
}

function PautaList() {
  const qc = useQueryClient();
  const [queueOnly, setQueueOnly] = useState(false);
  const [priority, setPriority] = useState<number | undefined>(undefined);
  const [category, setCategory] = useState<string>("");
  // E12.1: busca por título. O campo controla `search`; `debounced` (com ~300ms de
  // atraso) é o que entra na query key — evita uma request por tecla digitada.
  const [search, setSearch] = useState<string>("");
  const [debounced, setDebounced] = useState<string>("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const { data = [] } = useQuery({
    queryKey: ["pautas", queueOnly, priority, category, debounced],
    queryFn: () =>
      queueOnly
        ? pautaApi.queue()
        : pautaApi.list(undefined, priority, category || undefined, debounced || undefined),
  });
  // E3.5: categorias da marca atual para o filtro.
  const { data: categories = [] } = useQuery({
    queryKey: ["pauta-categories"],
    queryFn: pautaApi.categories,
  });
  const del = useMutation({
    mutationFn: (id: string) => pautaApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pautas"] });
      toast.success("Pauta removida.");
    },
    onError: () => toast.error("Não foi possível remover a pauta. Tente novamente."),
  });

  const tone = (p: number): "high" | "medium" | "low" =>
    p === 2 ? "high" : p === 1 ? "medium" : "low";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant={queueOnly ? "solid" : "ghost"} onClick={() => setQueueOnly(!queueOnly)}>
          {queueOnly ? "Fila priorizada" : "Ver fila"}
        </Button>
        {!queueOnly && (
          <Input
            type="search"
            placeholder="Buscar por título…"
            aria-label="Buscar pautas por título"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48"
          />
        )}
        {!queueOnly && (
          <Select
            value={priority ?? ""}
            onChange={(e) => setPriority(e.target.value === "" ? undefined : Number(e.target.value))}
            className="w-auto"
            aria-label="Filtrar por prioridade"
          >
            <option value="">Todas prioridades</option>
            {PRIORITY_LABEL.map((l, i) => (
              <option key={i} value={i}>{l}</option>
            ))}
          </Select>
        )}
        {!queueOnly && categories.length > 0 && (
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-auto"
            aria-label="Filtrar por categoria"
          >
            <option value="">Todas categorias</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        )}
      </div>

      {/* Fila como herói (P6/Tufte): no modo fila, deixa explícito que a ORDEM = ordem de geração
          (prioridade alta primeiro). A posição #1 é "próxima a gerar". Tira a ambiguidade de "qual sai antes". */}
      {queueOnly && data.length > 0 && (
        <p className="mb-3 text-xs text-ink/65">
          Ordem de geração — a IA atende de cima para baixo (prioridade mais alta primeiro).
        </p>
      )}

      <div className="space-y-3">
        {data.map((p, i) => (
          <PautaCard
            key={p.id}
            pauta={p}
            onRemove={() => del.mutate(p.id)}
            tone={tone}
            queuePosition={queueOnly ? i + 1 : undefined}
          />
        ))}
        {data.length === 0 && (
          <EmptyState
            title="Nenhuma pauta ainda"
            description="Cadastre sua primeira ideia de conteúdo no formulário “Nova pauta” — a IA a transforma em post."
          />
        )}
      </div>
    </div>
  );
}

// E4.1 (editar) + E4.3 (detalhe). Card com 3 modos: resumo, detalhe (todos os campos +
// anexos) e edição (reusa PautaInput). Edição via PUT /api/pautas/{id}.
function PautaCard({
  pauta,
  onRemove,
  tone,
  queuePosition,
}: {
  pauta: Pauta;
  onRemove: () => void;
  tone: (p: number) => "high" | "medium" | "low";
  /** Posição na fila de geração (1 = próxima). undefined fora do modo fila. */
  queuePosition?: number;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"summary" | "detail" | "edit">("summary");
  const [form, setForm] = useState<PautaInput>(toInput(pauta));
  // T (irreversibilidade-sem-gate): remover é terminal. Mesmo padrão de 2 tempos da rejeição
  // em Aprovações (sem modal pesado — KISS): o 1º clique ARMA ("Confirmar?"), o 2º remove.
  // Sair do card / editar desarma. Consistência de gate para ações destrutivas (herança).
  const [armedRemove, setArmedRemove] = useState(false);

  const update = useMutation({
    mutationFn: () => pautaApi.update(pauta.id, form),
    onSuccess: () => {
      setMode("detail");
      qc.invalidateQueries({ queryKey: ["pautas"] });
      qc.invalidateQueries({ queryKey: ["pauta-categories"] });
      toast.success("Pauta atualizada.");
    },
  });

  // Status acionável (não mais badge mudo): mover a pauta pelo funil (Backlog→Na fila→…). O endpoint
  // setStatus já existe; a fila priorizada ("Ver fila") reflete a mudança. Optimistic-friendly via invalidate.
  const setStatus = useMutation({
    mutationFn: (status: number) => pautaApi.setStatus(pauta.id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pautas"] });
      toast.success("Status da pauta atualizado.");
    },
  });

  if (mode === "edit") {
    return (
      <Card>
        {/* Mesmo <PautaForm/> da criação (fonte única) — modo edit (sem seed). */}
        <PautaForm
          mode="edit"
          value={form}
          onChange={setForm}
          onSubmit={() => form.title && update.mutate()}
          onCancel={() => { setForm(toInput(pauta)); setMode("detail"); }}
          submitting={update.isPending}
          extraFields={pauta.attachments.length > 0 ? (
            <p className="text-xs text-ink/65">
              Esta pauta tem {pauta.attachments.length} anexo(s). Os anexos são definidos na criação —
              para trocá-los, crie uma nova pauta.
            </p>
          ) : undefined}
        />
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <button
          type="button"
          onClick={() => setMode(mode === "detail" ? "summary" : "detail")}
          className="min-w-0 flex-1 text-left"
          aria-expanded={mode === "detail"}
        >
          <div className="mb-1 flex flex-wrap items-center gap-2">
            {queuePosition !== undefined && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  queuePosition === 1 ? "bg-ink text-canvas" : "bg-ink/8 text-ink/70"
                }`}
                title={queuePosition === 1 ? "Próxima a ser gerada" : `Posição ${queuePosition} na fila`}
              >
                {queuePosition === 1 ? "Próxima" : `#${queuePosition}`}
              </span>
            )}
            <Badge tone={tone(pauta.priority)}>{PRIORITY_LABEL[pauta.priority]}</Badge>
            <Badge tone="neutral">{TYPE_LABEL[pauta.desiredType]}</Badge>
          </div>
          <h3 className="truncate font-medium text-ink">{pauta.title}</h3>
          {pauta.objective && mode !== "detail" && (
            <p className="mt-1 line-clamp-2 text-sm text-ink/65">{pauta.objective}</p>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {/* R3 — próxima-ação óbvia: pauta → Gerar em 1 clique (pré-seleciona via ?pauta=id).
              Gerar = primária. Editar = ghost. Remover = destrutivo subordinado (só ganha
              cor de perigo no hover), não compete com a primária. */}
          <Link href={`/create?pauta=${pauta.id}`}>
            <Button>Gerar</Button>
          </Link>
          <Button variant="ghost" onClick={() => { setArmedRemove(false); setForm(toInput(pauta)); setMode("edit"); }}>Editar</Button>
          <button
            type="button"
            onClick={() => {
              if (!armedRemove) { setArmedRemove(true); return; }
              setArmedRemove(false);
              onRemove();
            }}
            onBlur={() => setArmedRemove(false)}
            aria-label={armedRemove ? "Confirmar remoção da pauta (irreversível)" : "Remover pauta"}
            className={`inline-flex min-h-[40px] items-center rounded-full px-3 py-2 text-sm font-medium ring-1 transition ${
              armedRemove
                ? "bg-danger/10 text-danger ring-danger/40 dark:text-danger-on-dark"
                : "text-ink/65 ring-transparent hover:bg-danger/10 hover:text-danger hover:ring-danger/30 dark:hover:text-danger-on-dark"
            }`}
          >
            {armedRemove ? "Confirmar?" : "Remover"}
          </button>
        </div>
      </div>

      {/* Status ACIONÁVEL — mover a pauta pelo funil (era badge mudo). Fica FORA do botão de expandir
          (evita controle interativo aninhado). Mudança chama setStatus; a fila priorizada reflete. */}
      <div className="mt-2 flex items-center gap-2">
        <span className="text-xs text-ink/65">Status:</span>
        <Select
          value={pauta.status}
          onChange={(e) => setStatus.mutate(Number(e.target.value))}
          disabled={setStatus.isPending}
          aria-label={`Status da pauta ${pauta.title}`}
          className="w-auto py-1 text-xs"
        >
          {STATUS_LABEL.map((label, i) => (
            <option key={i} value={i}>{label}</option>
          ))}
        </Select>
      </div>

      {mode === "detail" && (
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-ink/8 pt-4 text-sm">
          <Detail term="Objetivo" value={pauta.objective} full />
          <Detail term="Contexto" value={pauta.context} full />
          <Detail term="Categoria" value={pauta.category} />
          <Detail term="Objetivo de marketing" value={pauta.marketingObjective} />
          <Detail term="Tipo" value={TYPE_LABEL[pauta.desiredType]} />
          <Detail term="Data sugerida" value={pauta.suggestedDate ? new Date(pauta.suggestedDate).toLocaleDateString("pt-BR") : null} />
          {pauta.attachments.length > 0 && (
            <div className="col-span-2">
              <dt className="text-xs font-medium uppercase tracking-[0.18em] text-ink/65">Anexos</dt>
              <dd className="mt-1 space-y-1">
                {pauta.attachments.map((a) => (
                  <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="block truncate text-ink/70 underline">
                    {a.fileName || a.url}
                  </a>
                ))}
              </dd>
            </div>
          )}
        </dl>
      )}
    </Card>
  );
}

function Detail({ term, value, full }: { term: string; value?: string | null; full?: boolean }) {
  if (!value) return null;
  return (
    <div className={full ? "col-span-2" : ""}>
      <dt className="text-xs font-medium uppercase tracking-[0.18em] text-ink/65">{term}</dt>
      <dd className={`mt-0.5 text-ink/75${full ? " line-clamp-3" : ""}`}>{value}</dd>
    </div>
  );
}

// Pauta (DTO de leitura) → PautaInput (form de edição).
function toInput(p: Pauta): PautaInput {
  return {
    title: p.title,
    objective: p.objective ?? undefined,
    context: p.context ?? undefined,
    priority: p.priority,
    category: p.category ?? undefined,
    desiredType: p.desiredType,
    suggestedDate: p.suggestedDate,
    marketingObjective: p.marketingObjective ?? undefined,
  };
}
