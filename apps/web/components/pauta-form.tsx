"use client";

import { useId, useState } from "react";
import { PRIORITY_LABEL, TYPE_LABEL, type PautaInput } from "@/lib/pautas";
import { Button, Field, Input, Select, Textarea, FieldSeed } from "@/components/ui";
import { IconChevronRight } from "@/components/icons";

// UX-SPEC §3.3 / princípio #5 (DRY com propósito) — FONTE ÚNICA do formulário de pauta.
// Antes duplicado em 2 lugares (NewPauta + modo edit do PautaCard): mesmo conjunto de ~7
// campos divergindo. Agora 1 componente → um bug/ajuste se corrige em 1 lugar. Cobre criar
// (com FieldSeed) e editar (sem seed) via a prop `mode`. a11y: ids estáveis por instância.

const SEED = {
  title: "5 erros que sabotam o engajamento no Instagram",
  objective: "Educar seguidores sobre boas práticas e gerar salvamentos.",
  marketingObjective: "Reconhecimento de marca",
};

export function PautaForm({
  value,
  onChange,
  onSubmit,
  onCancel,
  submitting,
  mode,
  /** erros de forma já calculados pelo caller (título obrigatório, etc.) — só exibidos se `showErrors`. */
  errors,
  showErrors,
  extraFields,
}: {
  value: PautaInput;
  onChange: (next: PautaInput) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  submitting?: boolean;
  mode: "create" | "edit";
  errors?: { title?: string | null };
  showErrors?: boolean;
  /** Campos extras antes dos botões (ex.: anexo só-na-criação). */
  extraFields?: React.ReactNode;
}) {
  const uid = useId();
  const set = (patch: Partial<PautaInput>) => onChange({ ...value, ...patch });
  const isCreate = mode === "create";
  const seed = isCreate; // seed só faz sentido ao criar
  // Captura progressiva (Hick + Progressive Disclosure): ao CRIAR, só o Título aparece — anotar a
  // ideia é 1 campo, não um interrogatório de 8. O resto vive atrás de "Mais detalhes" (opcional;
  // só Título é obrigatório). Ao EDITAR, tudo já aparece (o operador veio refinar de propósito).
  const [expanded, setExpanded] = useState(!isCreate);
  // Se algum campo opcional já tem valor (ex.: veio de uma ideia promovida), abre expandido — senão
  // o valor ficaria escondido e pareceria perdido (P5).
  const hasOptional = !!(value.objective || value.context || value.category || value.marketingObjective || value.suggestedDate);
  const showRest = expanded || hasOptional;

  return (
    <div className="space-y-4">
      <Field
        label="Título"
        hint="Resuma a ideia em uma frase clara. Só isto é obrigatório — a IA cuida do resto."
        error={showErrors ? errors?.title : null}
        htmlFor={`${uid}-title`}
      >
        <Input
          id={`${uid}-title`}
          placeholder={SEED.title}
          value={value.title}
          error={showErrors && !!errors?.title}
          onChange={(e) => set({ title: e.target.value })}
        />
        {seed && (
          <FieldSeed value={value.title} example={SEED.title}
            onUse={(ex) => set({ title: ex })} onClear={() => set({ title: "" })} />
        )}
      </Field>

      {/* Disclosure: revela os campos opcionais sob demanda. Só no modo criar e enquanto não há
          valor opcional pendente. Some quando expandido (vira a seção de campos). */}
      {isCreate && !showRest && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          className="flex items-center gap-1.5 text-sm font-medium text-ink/70 transition hover:text-ink"
        >
          <IconChevronRight size={14} aria-hidden />
          Mais detalhes (opcional)
        </button>
      )}

      {!showRest ? null : (
      <>
      <Field label="Objetivo" hint="O que esse conteúdo deve provocar em quem vê." htmlFor={`${uid}-obj`}>
        <Textarea id={`${uid}-obj`} placeholder={SEED.objective} value={value.objective ?? ""}
          onChange={(e) => set({ objective: e.target.value })} />
        {seed && (
          <FieldSeed value={value.objective ?? ""} example={SEED.objective}
            onUse={(ex) => set({ objective: ex })} onClear={() => set({ objective: "" })} />
        )}
      </Field>

      <Field label="Contexto" hint="Detalhes que ajudam a IA: dados, links, tom específico." htmlFor={`${uid}-ctx`}>
        <Textarea id={`${uid}-ctx`} placeholder="Ex.: lançamento da linha de verão; destacar o desconto de 20%."
          value={value.context ?? ""} onChange={(e) => set({ context: e.target.value })} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Prioridade" hint="A fila atende da mais alta para a mais baixa." htmlFor={`${uid}-prio`}>
          <Select id={`${uid}-prio`} value={value.priority} onChange={(e) => set({ priority: Number(e.target.value) })}>
            {PRIORITY_LABEL.map((l, i) => <option key={i} value={i}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Tipo" hint="Formato pretendido para o post." htmlFor={`${uid}-type`}>
          <Select id={`${uid}-type`} value={value.desiredType} onChange={(e) => set({ desiredType: Number(e.target.value) })}>
            {TYPE_LABEL.map((l, i) => <option key={i} value={i}>{l}</option>)}
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Categoria" hint="Agrupa pautas afins (ex.: dicas, bastidores)." htmlFor={`${uid}-cat`}>
          <Input id={`${uid}-cat`} placeholder="Ex.: Dicas" value={value.category ?? ""}
            onChange={(e) => set({ category: e.target.value })} />
        </Field>
        <Field label="Data sugerida" hint="Quando você gostaria de publicar (opcional)." htmlFor={`${uid}-date`}>
          <Input id={`${uid}-date`} type="date" value={(value.suggestedDate ?? "").slice(0, 10)}
            onChange={(e) => set({ suggestedDate: e.target.value || null })} />
        </Field>
      </div>

      <Field label="Objetivo de marketing" hint="Ex.: reconhecimento, conversão." htmlFor={`${uid}-mkt`}>
        <Input id={`${uid}-mkt`} placeholder={SEED.marketingObjective} value={value.marketingObjective ?? ""}
          onChange={(e) => set({ marketingObjective: e.target.value })} />
        {seed && (
          <FieldSeed value={value.marketingObjective ?? ""} example={SEED.marketingObjective}
            onUse={(ex) => set({ marketingObjective: ex })} onClear={() => set({ marketingObjective: "" })} />
        )}
      </Field>

      {extraFields}
      </>
      )}

      <div className="flex gap-2">
        <Button onClick={onSubmit} disabled={submitting}>
          {submitting ? (isCreate ? "Criando…" : "Salvando…") : isCreate ? "Criar pauta" : "Salvar"}
        </Button>
        {onCancel && <Button variant="ghost" onClick={onCancel}>Cancelar</Button>}
      </div>
    </div>
  );
}
