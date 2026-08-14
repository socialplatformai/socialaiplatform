"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { brandApi, type BrandKit, VISUAL_PRESETS } from "@/lib/brand";
import { Button, Card, Field, Input, PageHeader, PageShell, Select, SectionLabel, Skeleton, Textarea } from "@/components/ui";
import { SettingsHub } from "@/components/settings/settings-hub";
import { toast } from "@/components/toast";

// Estado inicial vazio do brand-kit (todos os campos opcionais). O GET preenche via setForm.
const EMPTY_KIT: BrandKit = {
  branding: "", tone: "", editorialGuidelines: "", positioningRules: "", desiredContentTypes: "",
  visualPreset: "", primaryColorHex: "", secondaryColorHex: "", accentColorHex: "",
  backgroundColorHex: "", textColorHex: "", headingFont: "", bodyFont: "", logoUrl: "",
  targetAudience: "", copyExamples: [],
};

// Chips de tom (P1): clicar pré-preenche o campo `tone` com um texto pronto — mata o medo de
// "como descrever meu tom?" com um clique. O operador edita depois se quiser.
const TONE_CHIPS = [
  { label: "Calorosa e próxima", text: "Acolhedora e próxima, como uma conversa de amiga. Linguagem simples, carinhosa e sem formalidade." },
  { label: "Elegante e sofisticada", text: "Refinada e elegante, transmitindo cuidado e exclusividade. Tom confiante, sereno e premium." },
  { label: "Animada e divertida", text: "Leve, animada e divertida, com bom humor. Linguagem solta, espontânea e cheia de energia." },
];

// Os 3 campos do mínimo viável (P1 não abandona): se a marca tem ISTO, a IA já cria com a cara dela.
const ESSENTIAL_KEYS: (keyof BrandKit)[] = ["branding", "tone", "targetAudience"];

export default function BrandPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["brand-kit"], queryFn: brandApi.getKit });
  const [form, setForm] = useState<BrandKit>(EMPTY_KIT);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    if (data && !hydrated.current) {
      setForm({ ...EMPTY_KIT, ...data });
      hydrated.current = true;
    }
  }, [data]);

  const set = <K extends keyof BrandKit>(key: K, value: BrandKit[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    mutationFn: (kit: BrandKit) => brandApi.putKit(kit),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brand-kit"] });
      // Marca de "salvo automaticamente" — P5 (volta-depois) nunca perde o que fez.
      setSavedAt(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
    },
  });

  // Autosave com debounce: enquanto o operador digita, o sistema guarda sozinho. Só dispara
  // após a hidratação inicial (não re-salva o que acabou de carregar) e quando há mudança real.
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (!hydrated.current) return;
    dirtyRef.current = true;
    const t = setTimeout(() => {
      if (dirtyRef.current) { save.mutate(form); dirtyRef.current = false; }
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  // Completude: o "essencial" pronto = pode gerar com a cara da marca. O "refino" é progresso extra.
  const essentialDone = ESSENTIAL_KEYS.every((k) => String(form[k] ?? "").trim().length > 0);
  const refineKeys: (keyof BrandKit)[] = ["editorialGuidelines", "positioningRules", "desiredContentTypes", "primaryColorHex", "headingFont", "logoUrl", "copyExamples"];
  const refineDone = refineKeys.filter((k) => {
    const v = form[k];
    return Array.isArray(v) ? v.length > 0 : String(v ?? "").trim().length > 0;
  }).length;

  if (isLoading) {
    return (
      <PageShell width="full">
        <PageHeader eyebrow="Configuração estratégica" title="Marca" description="O contexto permanente que a IA usa para criar com a cara da sua marca." />
        <Card><div className="space-y-4"><Skeleton className="h-4 w-24" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div></Card>
      </PageShell>
    );
  }

  return (
    <PageShell width="full">
      <PageHeader
        eyebrow="Configuração estratégica"
        title="Marca & Ajustes"
        actions={
          // F/Doherty + A/WCAG 4.1.3: feedback de sincronização EM TEMPO REAL (não só o estado
          // terminal). Enquanto o POST do autosave corre, "Sincronizando…"; ao concluir, "Salvo
          // automaticamente · HH:MM". aria-live="polite" anuncia ambos a leitores de tela.
          (save.isPending || savedAt) ? (
            <span aria-live="polite" className="inline-flex items-center gap-1.5 text-xs text-ink/65">
              {save.isPending ? (
                <>
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink/40" />
                  Sincronizando…
                </>
              ) : (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-success-solid" />
                  Salvo automaticamente · {savedAt}
                </>
              )}
            </span>
          ) : undefined
        }
      />

      {/* Título editorial híbrido da SoT (assinatura coesa). */}
      <div className="mb-8">
        <h2 className="font-sans text-4xl font-semibold leading-[1.05] tracking-tight text-ink sm:text-5xl">
          Marca &amp; <em className="font-serif italic">ajustes</em>.
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink/65">
          A saúde do workspace num relance — e o contexto permanente que a IA usa para criar com a sua cara.
        </p>
      </div>

      {/* SoT "TELA MARCA & AJUSTES": health-meter do workspace + 5 cartões-resumo com estado REAL. */}
      <SettingsHub />

      {/* Editor profundo da MARCA (a área "Marca" do hub, expandida). Âncora p/ o card "Editar abaixo". */}
      <div id="editor-marca" className="mt-10 scroll-mt-8">
        <SectionLabel className="mb-3">Marca — o contexto que a IA usa</SectionLabel>
      </div>

      {/* Barra de completude (P5+P6): estado num relance — essencial pronto + quanto de refino. */}
      <CompletenessBar essentialDone={essentialDone} refineDone={refineDone} refineTotal={refineKeys.length} />

      {/* Layout 2 colunas (≥lg): à esquerda os campos (ancorados), à direita o preview-fantasma
          fixo. Em telas menores, empilha (preview vai pro topo como prova imediata). */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6 lg:order-1 order-2">
          {/* ── ZONA ESSENCIAL: o mínimo para a IA criar. P1 vê isto primeiro e basta. ── */}
          <Card>
            <SectionLabel className="mb-4">O essencial — é só isto para começar</SectionLabel>
            <div className="space-y-5">
              <Field label="O que o seu negócio faz?" hint="Conte em uma ou duas frases, como você explicaria para um cliente novo.">
                <Textarea
                  placeholder="Ex.: Salão de beleza no centro, especializado em cortes femininos, coloração e tratamentos."
                  value={form.branding ?? ""}
                  onChange={(e) => set("branding", e.target.value)}
                />
              </Field>

              <Field label="Como você quer soar nas redes?" hint="Escolha um atalho abaixo ou escreva do seu jeito.">
                <div className="mb-2 flex flex-wrap gap-2">
                  {TONE_CHIPS.map((chip) => {
                    const active = form.tone === chip.text;
                    return (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={() => set("tone", active ? "" : chip.text)}
                        className={`rounded-pill px-3 py-1.5 text-xs font-medium ring-1 transition ${
                          active ? "bg-ink text-canvas ring-ink" : "text-ink/75 ring-ink/15 hover:ring-ink/40"
                        }`}
                      >
                        {chip.label}
                      </button>
                    );
                  })}
                </div>
                <Textarea
                  placeholder="Ex.: Acolhedora e próxima, como uma conversa de amiga — sem formalidade."
                  value={form.tone ?? ""}
                  onChange={(e) => set("tone", e.target.value)}
                />
              </Field>

              <Field label="Para quem você fala?" hint="Pense nos seus clientes de sempre: idade, o que eles buscam.">
                <Textarea
                  placeholder="Ex.: Mulheres de 25 a 45 anos da região, que cuidam do visual e gostam de se sentir bem."
                  value={form.targetAudience ?? ""}
                  onChange={(e) => set("targetAudience", e.target.value)}
                />
              </Field>
            </div>
          </Card>

          {/* ── ZONA REFINAR: tudo opcional, colapsado. "Esconder sem esconder": accordion com
              contador, não aba oculta. Cada um diz "a IA já cria sem isso" — remove a culpa. ── */}
          <div>
            <SectionLabel className="mb-3">Refinar (opcional)</SectionLabel>
            <div className="space-y-3">
              <Accordion title="Regras e estilo de conteúdo" filled={!!(form.editorialGuidelines || form.positioningRules || form.desiredContentTypes)}>
                <div className="space-y-5">
                  <Field label="Tem algo que você sempre quer (ou nunca quer) dizer?" hint="Opcional — a IA já cria sem isso.">
                    <Textarea placeholder="Ex.: Sempre falar que o atendimento é com hora marcada. Nunca prometer resultado garantido." value={form.editorialGuidelines ?? ""} onChange={(e) => set("editorialGuidelines", e.target.value)} />
                  </Field>
                  <Field label="O que torna o seu negócio diferente dos outros?" hint="Opcional — a IA já cria sem isso.">
                    <Textarea placeholder="Ex.: Único salão do bairro com produtos veganos e café cortesia." value={form.positioningRules ?? ""} onChange={(e) => set("positioningRules", e.target.value)} />
                  </Field>
                  <Field label="Que tipo de post você gosta de fazer?" hint="Opcional — a IA já cria sem isso.">
                    <Input placeholder="Ex.: Antes e depois, dicas de cuidado, promoções da semana." value={form.desiredContentTypes ?? ""} onChange={(e) => set("desiredContentTypes", e.target.value)} />
                  </Field>
                </div>
              </Accordion>

              <Accordion title="Visual — cores, letras e logo" filled={!!(form.primaryColorHex || form.headingFont || form.logoUrl)}>
                <div className="space-y-5">
                  <Field label="Estilo do visual" hint="Um ponto de partida para o visual das artes.">
                    <Select value={form.visualPreset ?? ""} onChange={(e) => set("visualPreset", e.target.value)}>
                      {VISUAL_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </Select>
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <ColorField label="Cor principal" value={form.primaryColorHex} onChange={(v) => set("primaryColorHex", v)} />
                    <ColorField label="Cor de destaque" value={form.accentColorHex} onChange={(v) => set("accentColorHex", v)} />
                    <ColorField label="Cor de fundo" value={form.backgroundColorHex} onChange={(v) => set("backgroundColorHex", v)} />
                    <ColorField label="Cor do texto" value={form.textColorHex} onChange={(v) => set("textColorHex", v)} />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Letra dos títulos" hint="Nome da fonte (ex.: Satoshi).">
                      <Input placeholder="Ex.: Satoshi" value={form.headingFont ?? ""} onChange={(e) => set("headingFont", e.target.value)} />
                    </Field>
                    <Field label="Letra do texto" hint="Nome da fonte do corpo.">
                      <Input placeholder="Ex.: Inter" value={form.bodyFont ?? ""} onChange={(e) => set("bodyFont", e.target.value)} />
                    </Field>
                  </div>
                  <Field label="Sua logomarca" hint="Opcional — a IA já cria sem isso. Link de uma imagem (http/https).">
                    <Input type="url" placeholder="https://…/logo.png" value={form.logoUrl ?? ""} onChange={(e) => set("logoUrl", e.target.value)} />
                  </Field>
                  {/* O logo JÁ é estampado nos criativos (toggle "usar identidade do logo" no Criar).
                      Extrair cor/estilo da imagem segue como próximo passo — declarado, nunca simulado. */}
                  {form.logoUrl ? (
                    <p className="text-xs text-ink/65">
                      Ative “usar identidade do logo” ao criar para estampá-lo nos slides.
                      Em breve: extrair cores e estilo direto da imagem.
                    </p>
                  ) : null}
                </div>
              </Accordion>

              <Accordion title="Frases que combinam com você" filled={(form.copyExamples ?? []).length > 0}>
                <CopyExamplesField value={form.copyExamples ?? []} onChange={(list) => set("copyExamples", list)} />
              </Accordion>

              <Accordion title="Referências e concorrentes" filled={false}>
                <div className="grid gap-6 sm:grid-cols-2">
                  <RefsTab />
                  <CompetitorsTab />
                </div>
              </Accordion>
            </div>
          </div>

          {essentialDone && (
            <Link href="/settings/instagram" className="inline-block text-sm font-medium text-ink underline-offset-2 hover:underline">
              Próximo: conectar Instagram →
            </Link>
          )}
        </div>

        {/* Preview-fantasma: prova viva (P3). Em ≥lg fica fixo ao lado; em mobile vai pro topo. */}
        <div className="lg:order-2 order-1 lg:sticky lg:top-20 self-start">
          <Card>
            <BrandGhostPreview form={form} />
          </Card>
        </div>
      </div>
    </PageShell>
  );
}

/** Barra de completude: estado glanceável (P5+P6). Essencial pronto = "pode gerar"; refino = extra. */
function CompletenessBar({ essentialDone, refineDone, refineTotal }: { essentialDone: boolean; refineDone: number; refineTotal: number }) {
  return (
    <Card className="mt-1 flex flex-wrap items-center gap-x-6 gap-y-2">
      <div className="flex items-center gap-2">
        <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${essentialDone ? "bg-success-solid text-white" : "bg-ink/10 text-ink/65"}`}>
          {essentialDone ? "✓" : "1"}
        </span>
        <span className="text-sm font-medium text-ink">{essentialDone ? "Essencial pronto — a IA já cria com a sua cara" : "Preencha o essencial para começar"}</span>
      </div>
      <div className="flex items-center gap-2 text-sm text-ink/65">
        <span>Refino {refineDone}/{refineTotal}</span>
        <span className="flex gap-1" aria-hidden>
          {Array.from({ length: refineTotal }).map((_, i) => (
            <span key={i} className={`h-1.5 w-4 rounded-pill ${i < refineDone ? "bg-ink" : "bg-ink/12"}`} />
          ))}
        </span>
      </div>
    </Card>
  );
}

/** Accordion sóbrio: "esconder sem esconder" — colapsado mostra título + se está preenchido. */
function Accordion({ title, filled, children }: { title: string; filled: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="p-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left outline-none transition hover:bg-ink/[0.02] focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-inset"
      >
        <span className="flex items-center gap-2.5">
          <span className={`h-1.5 w-1.5 rounded-full ${filled ? "bg-ink" : "bg-ink/20"}`} />
          <span className="text-sm font-medium text-ink">{title}</span>
          {filled && <span className="text-[11px] text-ink/65">preenchido</span>}
        </span>
        <span className={`text-ink/40 transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
      </button>
      {open && <div className="border-t border-ink/8 px-5 py-5">{children}</div>}
    </Card>
  );
}

/** BrandGhostPreview — "Como a IA vê sua marca". Espelha o form em tempo real: cores, fonte e
 *  tom já aparecem como uma peça-fantasma 4:5 (a silhueta da arte real 1080×1350). Prova viva (P3).
 *  Fallback honesto: sem cor → gradiente iridescente APEX (o mesmo do render-engine). */
function BrandGhostPreview({ form }: { form: BrandKit }) {
  const bg = form.backgroundColorHex ? { background: form.backgroundColorHex } : { background: "var(--gradient-iris-grad)" };
  const titleColor = form.textColorHex || "var(--color-ink)";
  const headingFont = form.headingFont ? `'${form.headingFont}', var(--font-serif)` : "var(--font-serif)";
  const bodyFont = form.bodyFont ? `'${form.bodyFont}', var(--font-body)` : "var(--font-body)";
  const accent = form.accentColorHex || "var(--color-ink)";
  // Trunca por PALAVRA (não no meio) com reticências limpas — texto cortado no meio lê como bug
  // e quebra a confiança do preview (achado P3).
  const headline = (() => {
    const raw = form.branding?.trim();
    if (!raw) return "Sua headline aparece aqui";
    if (raw.length <= 52) return raw;
    const cut = raw.slice(0, 52);
    const lastSpace = cut.lastIndexOf(" ");
    return (lastSpace > 24 ? cut.slice(0, lastSpace) : cut).replace(/[\s—–-]+$/, "") + "…";
  })();
  const toneLine = form.tone?.trim()
    ? `“${form.tone.trim().split(/(?<=[.!?])\s/)[0].slice(0, 80)}”`
    : "Defina a voz para ditar o estilo das legendas.";

  const links = [
    { on: !!(form.tone || "").trim(), label: "Voz", effect: "estilo das legendas" },
    { on: !!(form.backgroundColorHex || form.accentColorHex), label: "Cores", effect: "fundo e destaques" },
    { on: !!(form.headingFont || form.bodyFont), label: "Letras", effect: "títulos e corpo" },
    { on: !!form.logoUrl, label: "Logo", effect: "marca d’água" },
  ];

  return (
    <div className="space-y-3">
      <SectionLabel>Como a IA vê sua marca</SectionLabel>
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-[20px] border border-ink/8 shadow-sm" style={bg}>
        {form.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={form.logoUrl} alt="" className="absolute right-4 top-4 h-7 w-7 rounded-md object-contain opacity-90" />
        ) : null}
        <div className="absolute inset-0 flex flex-col justify-between p-6">
          <h3 className="max-w-[85%] text-[22px] font-semibold leading-tight" style={{ color: titleColor, fontFamily: headingFont }}>
            {headline}
          </h3>
          <div className="space-y-2">
            <span className="block h-1 w-10 rounded-full" style={{ background: accent }} />
            <p className="text-[13px] leading-snug opacity-80" style={{ color: titleColor, fontFamily: bodyFont }}>
              {toneLine}
            </p>
          </div>
        </div>
      </div>
      <ul className="space-y-1.5 text-[12px] text-ink/65">
        {links.map((r) => (
          <li key={r.label} className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full transition-colors ${r.on ? "bg-ink" : "bg-ink/20"}`} />
            <span className={r.on ? "text-ink" : ""}>{r.label}</span>
            <span className="text-ink/30">→</span>
            <span>{r.effect}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Campo de cor: seletor nativo + caixa de hex (aceita colar). Vazio = sem cor (cai no preset).
function ColorField({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string) => void }) {
  const hex = value ?? "";
  const swatch = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#000000";
  const hexId = useId();
  return (
    <Field label={label} hint="Toque para escolher. Em branco usa o padrão." htmlFor={hexId}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} (seletor de cor)`}
          value={swatch}
          onChange={(e) => onChange(e.target.value)}
          /* A (WCAG 2.5.5 Target Size): alvo ≥44×44px — era 36×40, pequeno para toque/mobile. */
          className="h-11 w-11 shrink-0 cursor-pointer rounded-lg border border-ink/15 bg-canvas p-0.5 outline-none transition focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        />
        <Input id={hexId} aria-label={label} placeholder="#1B1F2E" value={hex} onChange={(e) => onChange(e.target.value)} />
      </div>
    </Field>
  );
}

// Lista de exemplos de copy on-brand: adiciona/remove strings. Chega à engine como copyExamples.
function CopyExamplesField({ value, onChange }: { value: string[]; onChange: (list: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    onChange([...value, t]);
    setDraft("");
  };
  return (
    <Field label="Frases que combinam com você" hint="Opcional — a IA já cria sem isso. Cole 1 ou 2 frases que você usaria.">
      <div className="space-y-2">
        <div className="flex gap-2">
          <Input
            placeholder="Ex.: Seu cabelo merece esse carinho."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          />
          <Button type="button" variant="ghost" onClick={add} disabled={!draft.trim()}>Adicionar</Button>
        </div>
        {value.length > 0 && (
          <ul className="divide-y divide-ink/5 rounded-lg border border-ink/10">
            {value.map((ex, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-sm text-ink/80">{ex}</span>
                <button
                  type="button"
                  aria-label={`Remover frase: ${ex.length > 40 ? ex.slice(0, 40) + "…" : ex}`}
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                  className="shrink-0 rounded text-ink/65 outline-none transition hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >×</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Field>
  );
}

function CompetitorsTab() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["competitors"], queryFn: brandApi.getCompetitors });
  const [handle, setHandle] = useState("");
  const add = useMutation({
    mutationFn: () => brandApi.addCompetitor(handle),
    onSuccess: () => { setHandle(""); qc.invalidateQueries({ queryKey: ["competitors"] }); },
  });
  const del = useMutation({ mutationFn: (id: string) => brandApi.deleteCompetitor(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["competitors"] }) });
  return (
    <div>
      <Field label="Concorrentes" hint="Perfis (@) que você acompanha.">
        <div className="flex gap-2">
          <Input placeholder="@perfil" value={handle} onChange={(e) => setHandle(e.target.value)} />
          <Button type="button" variant="ghost" onClick={() => handle && add.mutate()} disabled={add.isPending}>Adicionar</Button>
        </div>
      </Field>
      <ul className="mt-2 divide-y divide-ink/5">
        {data.map((c) => (
          <li key={c.id} className="flex items-center justify-between py-2">
            <span className="text-sm text-ink">{c.handle}</span>
            <button type="button" onClick={() => del.mutate(c.id)} className="text-xs text-ink/65 hover:text-danger">remover</button>
          </li>
        ))}
        {data.length === 0 && <li className="py-3 text-sm text-ink/65">Nenhum ainda.</li>}
      </ul>
    </div>
  );
}

function RefsTab() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["visual-refs"], queryFn: brandApi.getRefs });
  const [url, setUrl] = useState("");
  const add = useMutation({
    mutationFn: () => brandApi.addRef(url),
    onSuccess: () => { setUrl(""); qc.invalidateQueries({ queryKey: ["visual-refs"] }); },
  });
  const del = useMutation({ mutationFn: (id: string) => brandApi.deleteRef(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["visual-refs"] }) });
  return (
    <div>
      <Field label="Referências visuais" hint="Perfis/sites cujo visual você curte.">
        <div className="flex gap-2">
          <Input placeholder="URL da referência" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button type="button" variant="ghost" onClick={() => url && add.mutate()} disabled={add.isPending}>Adicionar</Button>
        </div>
      </Field>
      <ul className="mt-2 divide-y divide-ink/5">
        {data.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-2">
            <span className="truncate text-sm text-ink/80">{r.url}</span>
            <button type="button" onClick={() => del.mutate(r.id)} className="shrink-0 text-xs text-ink/65 hover:text-danger">remover</button>
          </li>
        ))}
        {data.length === 0 && <li className="py-3 text-sm text-ink/65">Nenhuma ainda.</li>}
      </ul>
    </div>
  );
}
