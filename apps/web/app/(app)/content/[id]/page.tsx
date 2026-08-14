"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { contentApi, CONTENT_STATUS_LABEL, DECIDABLE_STATUSES, type Content } from "@/lib/content";
import { brandApi } from "@/lib/brand";
import { budgetApi } from "@/lib/budget";
import { learningApi } from "@/lib/learning";
import { approvalApi, APPROVAL_MODE_LABEL } from "@/lib/workflow";
import { instagramApi } from "@/lib/instagram";
import { isAdmin } from "@/lib/api";
import { Badge, Button, Card, Field, Input, Modal, PageHeader, PageShell, Select, Skeleton, Tabs, Textarea } from "@/components/ui";
import { SlideCarousel } from "@/components/slide-canvas";
import { SlideEditor } from "@/components/slide-editor";
import { InlineSchedule } from "@/components/inline-schedule";
import { ReasoningPanel } from "@/components/reasoning-panel";
import { IconChevronLeft } from "@/components/icons";
import { toast } from "@/components/toast";
import Link from "next/link";

// E11.1/E11.3/E11.5 + E4.2 (ADR-0006) — hub de iteração sobre um conteúdo gerado:
// editar texto, baixar (ZIP), regenerar (se há pauta) e definir modo de aprovação (Admin).
// Estados editáveis = decidíveis (Draft|PendingApproval), ponto único de verdade em lib/content.

export default function ContentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const router = useRouter();
  const { data, isLoading } = useQuery({ queryKey: ["content", id], queryFn: () => contentApi.get(id) });

  if (isLoading || !data) {
    return (
      <PageShell width="form">
        <Skeleton className="h-40 w-full" />
      </PageShell>
    );
  }

  const invalidate = () => qc.invalidateQueries({ queryKey: ["content", id] });

  return (
    // WORKSPACE de 2 colunas (full): antes era uma COLUNA estreita (max-w-2xl) com ~60% de dead-space
    // à direita e o fluxo MORRIA aqui (gerava e não tinha como aprovar/agendar — só "Baixar" escondido).
    // Agora: preview GRANDE à esquerda (o ato principal) + trilho de AÇÃO à direita que FECHA o fluxo
    // (aprovar → agendar inline → publicar/baixar), com a config descendo abaixo dela.
    <PageShell width="full">
      <PageHeader
        eyebrow="Conteúdo"
        title="Conteúdo gerado"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{CONTENT_STATUS_LABEL[data.status]}</Badge>
            {data.qualityScore != null && data.qualityScore < 70 && (
              <Badge tone="low">Qualidade baixa: {data.qualityScore}/100</Badge>
            )}
          </div>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        {/* ── ESQUERDA: o ASSET é o herói. Ver primeiro (P1/leigo: a peça já veio pronta,
            não um formulário). Editar é OPCIONAL, atrás de uma aba — não o ato principal. ── */}
        <div className="min-w-0">
          {data.slides.length > 0 && <AssetPane content={data} onSaved={invalidate} />}
        </div>

        {/* ── DIREITA: UMA próxima-ação dominante + o resto QUIETO (disclosure).
            Antes: 6 cards de igual peso (P2 varreu 5 blocos pra achar a ação; carga cognitiva). ── */}
        {/* space-y-6 alinha o ritmo vertical do trilho com o gap-6 do grid externo (8pt coerente). */}
        <div className="lg:sticky lg:top-20 self-start space-y-6">
          <NextActionCard content={data} onChanged={invalidate} />

          <SecondaryRail content={data} id={id} onSaved={invalidate} />
        </div>
      </div>

      {/* "Voltar" como ghost button consistente (antes era um link sublinhado órfão, sem ícone). */}
      <button
        onClick={() => router.back()}
        className="mt-6 inline-flex min-h-[40px] items-center gap-1 rounded-full px-3 text-sm font-medium text-ink/65 ring-1 ring-ink/10 transition hover:text-ink hover:ring-ink/25"
      >
        <IconChevronLeft size={16} aria-hidden /> Voltar
      </button>
    </PageShell>
  );
}

// Panel: invólucro dos blocos do trilho. `bare` (dentro do disclosure) = sem chrome de Card —
// o pai (SecondaryRail) já dá padding + divisor. Fora do disclosure = Card normal.
function Panel({ bare, className = "", children }: { bare?: boolean; className?: string; children: React.ReactNode }) {
  if (bare) return <div className={className}>{children}</div>;
  return <Card className={className}>{children}</Card>;
}

// O ASSET É O HERÓI. Duas abas: "Pré-visualizar" (DEFAULT — a peça pronta, faixa de miniaturas,
// nada de formulário) e "Editar" (opcional — o editor de camadas). O leigo (P1) vê um asset
// pronto e segue pro "Próximo passo"; quem quer ajustar troca de aba. Para estados não-editáveis
// (publicado/agendado), só o preview existe — sem aba de edição que não levaria a nada.
function AssetPane({ content, onSaved }: { content: Content; onSaved: () => void }) {
  const editable = DECIDABLE_STATUSES.has(content.status);
  const [tab, setTab] = useState<"preview" | "edit">("preview");
  // Índice do slide sincronizado entre preview e editor (trocar de aba mantém o slide em foco).
  const [slideIdx, setSlideIdx] = useState(0);

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-ink">
          {editable ? "Sua peça" : "Pré-visualização"}
        </p>
        {editable && (
          <Tabs
            tabs={[{ id: "preview", label: "Pré-visualizar" }, { id: "edit", label: "Editar" }]}
            active={tab}
            onChange={(t) => setTab(t as "preview" | "edit")}
          />
        )}
      </div>

      {editable && tab === "edit" ? (
        <VisualEditor content={content} onSaved={onSaved} index={slideIdx} onIndex={setSlideIdx} />
      ) : (
        <div className="mx-auto max-w-md">
          <SlideCarousel slides={content.slides} index={slideIdx} onIndex={setSlideIdx} />
        </div>
      )}
    </Card>
  );
}

// O RESTO, QUIETO. Tudo que NÃO fecha o fluxo (legenda, raciocínio, conta, iterar, modo de
// aprovação) vive aqui, recolhido por padrão num disclosure. Antes eram 6 cards de igual peso
// competindo com a decisão (P2 varreu 5 blocos). Agora: 1 "Próximo passo" dominante + "Mais
// opções" fechado. Quem precisa, abre; o apressado e o leigo ignoram sem custo.
function SecondaryRail({ content, id, onSaved }: { content: Content; id: string; onSaved: () => void }) {
  const admin = isAdmin();
  // Apex/de-emphasis-first: o secundário NÃO é caixa-dentro-de-caixa (ring+sombra+radius repetidos
  // 5×, que faziam o trilho "parecer formulário empilhado"). Aqui o disclosure é UMA superfície
  // quieta; cada item é uma linha lisa separada por divisor. Por contraste, o "Próximo passo" emerge
  // como protagonista. Os filhos recebem `bare` → renderizam sem o chrome de Card.
  const items = [
    <ContentEditor key="cap" content={content} onSaved={onSaved} bare />,
    <ReasoningPanel key="rsn" reasoning={content.reasoning} bare />,
    <TargetAccountCard key="acc" content={content} onSaved={onSaved} bare />,
    content.pautaId ? <IterateCard key="itr" content={content} bare /> : null,
    admin ? <ApprovalModeCard key="apr" contentId={id} bare /> : null,
  ].filter(Boolean);

  return (
    <details className="group rounded-lg border border-ink/10 bg-paper">
      <summary className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-5 py-3.5 text-sm font-medium text-ink/80 transition hover:text-ink [&::-webkit-details-marker]:hidden">
        <span>Mais opções</span>
        <span className="text-xs text-ink/65 transition group-open:rotate-180">▾</span>
      </summary>
      <div className="divide-y divide-ink/8 border-t border-ink/8">
        {items.map((it, i) => (
          <div key={i} className="px-5 py-4">{it}</div>
        ))}
      </div>
    </details>
  );
}

// O CARD QUE FECHA O FLUXO. Antes a tela gerava uma peça e dava num beco: pra aprovar o operador
// saía pra /approvals, pra agendar saía pro /calendar. Aqui a próxima-ação mora ONDE a peça está:
// Draft/PendingApproval → Aprovar (+ rejeitar com gate) → ao aprovar, Agendar inline (com horário
// sugerido) — ou Baixar. Estado terminal (publicado/rejeitado) → só Baixar + link p/ histórico.
function NextActionCard({ content, onChanged }: { content: Content; onChanged: () => void }) {
  const decidable = DECIDABLE_STATUSES.has(content.status);
  const approved = content.status === 3; // Approved
  const scheduled = content.status === 5; // Scheduled
  const [armedReject, setArmedReject] = useState(false);

  const decide = useMutation({
    mutationFn: (ok: boolean) => approvalApi.decide(content.id, ok),
    onSuccess: (_d, ok) => {
      toast.success(ok ? "Aprovado. Agende a publicação abaixo." : "Conteúdo rejeitado.");
      onChanged();
    },
    onError: () => toast.error("Não foi possível concluir — o estado da peça mudou."),
  });

  return (
    <Card className="border-ink/15 bg-ink/[0.02]">
      {/* Protagonista do trilho: sobe na escala (base/semibold) p/ dominar o secundário (LOGOS). */}
      <p className="text-base font-semibold text-ink">Próximo passo</p>

      {/* Pendente de decisão → APROVAR (primária) / rejeitar (2-tempos) */}
      {decidable && (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-ink/65">Revise os slides ao lado e decida. Nada vai ao ar sem você.</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => decide.mutate(true)} disabled={decide.isPending}>
              {decide.isPending ? "…" : "Aprovar"}
            </Button>
            <button
              type="button"
              onClick={() => { if (!armedReject) { setArmedReject(true); return; } setArmedReject(false); decide.mutate(false); }}
              onBlur={() => setArmedReject(false)}
              disabled={decide.isPending}
              className={`inline-flex min-h-[40px] items-center rounded-full px-4 py-2 text-sm font-medium ring-1 transition disabled:opacity-50 ${
                armedReject
                  ? "bg-danger/10 text-danger ring-danger/40 dark:text-danger-on-dark"
                  : "text-ink/65 ring-ink/15 hover:bg-danger/10 hover:text-danger hover:ring-danger/30 dark:hover:text-danger-on-dark"
              }`}
            >
              {armedReject ? "Confirmar rejeição?" : "Rejeitar"}
            </button>
            <DownloadButton id={content.id} />
          </div>
        </div>
      )}

      {/* Aprovado → AGENDAR inline (fecha o loop sem sair da tela) */}
      {approved && (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-ink/65">
            Aprovado. Agende a publicação aqui — ou{" "}
            <Link href="/calendar" className="font-medium text-ink underline-offset-2 hover:underline">ver no calendário</Link>.
          </p>
          <InlineSchedule contentId={content.id} onScheduled={onChanged} compact />
          {/* T/P3: promete a reversibilidade no PONTO DE DECISÃO (o cauteloso agenda sem medo).
              O desagendar já existe (DELETE /schedule); aqui a UI passa a prometê-lo. */}
          <p className="text-xs text-ink/65">Você pode reagendar ou cancelar no calendário até a publicação.</p>
          <DownloadButton id={content.id} />
        </div>
      )}

      {/* Estados terminais → só baixar + atalho */}
      {!decidable && !approved && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-ink/65">
            {scheduled
              ? "Agendado. Acompanhe no calendário."
              : `Status: ${CONTENT_STATUS_LABEL[content.status]}.`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <DownloadButton id={content.id} />
            <Link href={scheduled ? "/calendar" : "/history"}>
              <Button variant="ghost">{scheduled ? "Ver no calendário" : "Ver no histórico"}</Button>
            </Link>
          </div>
        </div>
      )}
    </Card>
  );
}

// F3 (ADR-0014): editor visual de camadas — salva `layers` por slide via updateText. Preserva
// caption/cta/hashtags atuais (só toca slides). onSaved revalida o conteúdo (reabrir mantém = gate F3).
// O kit da marca alimenta os controles de cor/fonte (Onda 3): o operador estiliza com a paleta/fontes
// reais da marca, não um seletor livre (Simon/satisfice — propor o sensato, não N opções).
function VisualEditor({ content, onSaved, index, onIndex }: { content: Content; onSaved: () => void; index?: number; onIndex?: (i: number) => void }) {
  const { data: kit } = useQuery({ queryKey: ["brand-kit"], queryFn: brandApi.getKit });
  const save = useMutation({
    mutationFn: (slides: typeof content.slides) =>
      contentApi.updateText(content.id, {
        caption: content.caption,
        cta: content.cta,
        hashtags: content.hashtags,
        slides: slides.map((s) => ({ index: s.index, copy: s.copy, layers: s.layers ?? null })),
      }),
    onSuccess: () => { toast.success("Edição salva."); onSaved(); },
    onError: () => toast.error("Não foi possível salvar a edição."),
  });
  return <SlideEditor slides={content.slides} kit={kit} saving={save.isPending} onSave={(s) => save.mutate(s)} index={index} onIndex={onIndex} alternatives={content.alternatives} />;
}

// Legenda & metadados do POST (não dos slides). O texto DOS SLIDES é editado no
// Editor visual acima (com preview) — antes este card duplicava esses campos, o que
// confundia (dois lugares pra mesma edição). Agora cada um tem uma responsabilidade:
// Editor visual = slides; este = legenda/CTA/hashtags que acompanham a publicação.
function ContentEditor({ content, onSaved, bare }: { content: Content; onSaved: () => void; bare?: boolean }) {
  const editable = DECIDABLE_STATUSES.has(content.status);
  const [caption, setCaption] = useState(content.caption ?? "");
  const [cta, setCta] = useState(content.cta ?? "");
  const [hashtags, setHashtags] = useState(content.hashtags ?? "");

  const save = useMutation({
    mutationFn: () =>
      contentApi.updateText(content.id, {
        caption, cta, hashtags,
        // preserva o texto/camadas atuais dos slides (este card não os toca).
        slides: content.slides.map((s) => ({ index: s.index, copy: s.copy, layers: s.layers ?? null })),
      }),
    onSuccess: () => { toast.success("Legenda salva."); onSaved(); },
    onError: () => toast.error("Não foi possível salvar a legenda."),
  });

  return (
    <Panel bare={bare}>
      <p className="mb-3 text-sm font-medium text-ink">Legenda &amp; metadados</p>
      {!editable && (
        <p className="mb-4 rounded-md bg-ink/5 p-3 text-sm text-ink/65">
          Este conteúdo está em “{CONTENT_STATUS_LABEL[content.status]}” e não pode ser editado.
        </p>
      )}
      <div className="space-y-4">
        <Field label="Legenda" hint="Texto que acompanha a publicação (não aparece nos slides)." htmlFor="caption">
          <Textarea id="caption" placeholder="Escreva a legenda do post…" value={caption} onChange={(e) => setCaption(e.target.value)} disabled={!editable} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="CTA" hint="Chamada para ação (ex.: salve, comente)." htmlFor="cta">
            <Input id="cta" placeholder="Ex.: Salve este post" value={cta} onChange={(e) => setCta(e.target.value)} disabled={!editable} />
          </Field>
          <Field label="Hashtags" hint="Separadas por espaço, com #." htmlFor="hashtags">
            <Input id="hashtags" placeholder="#marketing #conteudo" value={hashtags} onChange={(e) => setHashtags(e.target.value)} disabled={!editable} />
          </Field>
        </div>
        {editable && (
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Salvando…" : "Salvar legenda"}
          </Button>
        )}
      </div>
    </Panel>
  );
}

// AI-native: revela o RACIOCÍNIO real dos agentes (proposta justificada, não caixa-preta). Cada
function DownloadButton({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  async function baixar() {
    setBusy(true);
    try {
      const blob = await contentApi.downloadExport(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `conteudo-${id}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Não foi possível baixar o conteúdo.");
    } finally {
      setBusy(false);
    }
  }
  return <Button variant="ghost" onClick={baixar} disabled={busy}>{busy ? "Baixando…" : "Baixar"}</Button>;
}

// A1/A3/A5/B3 (ADR-0009): hub de iteração. Regenerar com instrução livre (A1), refazer um slide
// específico (A3 — conteúdo inteiro com instrução dirigida ao slide, D2: não regen isolada in-place),
// e gerar N variações com teto+saldo via modal de custo (B3). Todas levam ao wizard para acompanhar o poll.
function IterateCard({ content, bare }: { content: Content; bare?: boolean }) {
  const router = useRouter();
  const [instruction, setInstruction] = useState("");
  const [slideIndex, setSlideIndex] = useState<number | "">("");
  const [showVariations, setShowVariations] = useState(false);

  // A4 (ADR-0009): mostra o último motivo de rejeição da pauta para dar contexto antes de regenerar.
  // O backend já injeta esse feedback no briefing automaticamente; aqui é a transparência ao operador.
  const { data: feedback } = useQuery({
    queryKey: ["reject-feedback", content.pautaId],
    queryFn: () => learningApi.rejectFeedback(content.pautaId!),
    enabled: !!content.pautaId,
  });

  const irParaPoll = (r: { contentId: string; jobId: string }) =>
    router.push(`/create?contentId=${r.contentId}&jobId=${r.jobId}`);

  const regen = useMutation({
    mutationFn: () =>
      contentApi.regenerate(content.id, {
        instruction: instruction.trim() || undefined,
        slideIndex: slideIndex === "" ? undefined : Number(slideIndex),
      }),
    onSuccess: (r) => {
      toast.success("Regenerando… acompanhe o progresso.");
      irParaPoll(r);
    },
  });

  return (
    <Panel bare={bare}>
      <p className="text-sm font-medium text-ink">Gerar outra versão com a IA</p>
      <p className="mt-0.5 text-xs text-ink/65">
        Cria uma <strong className="font-medium text-ink/75">nova</strong> peça a partir da mesma pauta —{" "}
        esta aqui fica intacta. Salve suas edições acima antes, caso queira mantê-las.
      </p>

      {/* A4: contexto da rejeição anterior (o briefing da regeneração já o considera automaticamente). */}
      {feedback?.comments && (
        <p className="mt-3 rounded-md bg-ink/5 p-3 text-sm text-ink/70">
          A versão anterior desta pauta foi rejeitada porque:{" "}
          <span className="font-medium text-ink">“{feedback.comments}”</span>
        </p>
      )}

      <div className="mt-4 space-y-3">
        <Field
          label="Instrução de regeneração"
          hint="Opcional. Ex.: “mais curto”, “tom mais informal”, “foco no benefício principal”."
          htmlFor="regen-instruction"
        >
          <Textarea
            id="regen-instruction"
            placeholder="Diga o que mudar na próxima versão…"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
        </Field>

        {content.slides.length > 0 && (
          <Field
            label="Refazer um slide específico"
            hint="Opcional. A nova versão prioriza esse slide, mantendo o resto (refaz o conteúdo inteiro — não troca só 1 slide no lugar)."
            htmlFor="regen-slide"
          >
            <Select
              id="regen-slide"
              value={slideIndex}
              onChange={(e) => setSlideIndex(e.target.value === "" ? "" : Number(e.target.value))}
            >
              <option value="">Todos os slides</option>
              {content.slides.map((s) => (
                <option key={s.index} value={s.index}>
                  Priorizar slide {s.index + 1}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => regen.mutate()} disabled={regen.isPending}>
            {regen.isPending ? "Iniciando…" : "Regenerar"}
          </Button>
          <Button variant="ghost" onClick={() => setShowVariations(true)}>
            Gerar variações…
          </Button>
        </div>
      </div>

      {showVariations && content.pautaId && (
        <VariationsModal
          pautaId={content.pautaId}
          format={content.type}
          onClose={() => setShowVariations(false)}
          onStarted={(r) => irParaPoll(r[0])}
        />
      )}
    </Panel>
  );
}

// B3 (ADR-0009): modal de "gerar variações" — mostra custo estimado + saldo do mês e exige confirmação.
// O gate real (teto/saldo) é do backend: 400 sem confirm/teto, 402 saldo insuficiente — o toast central
// mostra o motivo. Aqui antecipamos a estimativa para transparência antes do clique.
function VariationsModal({
  pautaId,
  format,
  onClose,
  onStarted,
}: {
  pautaId: string;
  format: number;
  onClose: () => void;
  onStarted: (r: { contentId: string; jobId: string }[]) => void;
}) {
  const [count, setCount] = useState(2);

  const { data: estimate } = useQuery({
    queryKey: ["estimate", format, count],
    queryFn: () => contentApi.estimate(format, count),
  });
  const { data: budget } = useQuery({ queryKey: ["budget"], queryFn: budgetApi.get });

  const total = estimate?.totalCostUsd ?? 0;
  const saldo = budget?.remainingUsd ?? 0;
  const semSaldo = budget != null && total > saldo;

  const gerar = useMutation({
    mutationFn: () => contentApi.variations({ pautaId, format, count, confirm: true }),
    onSuccess: (r) => {
      toast.success(`${r.length} variação(ões) em geração.`);
      onClose();
      onStarted(r);
    },
  });

  const fmtUsd = (v: number) => `US$ ${v.toFixed(2)}`;

  return (
    <Modal
      open
      onClose={onClose}
      title="Gerar variações"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => gerar.mutate()} disabled={gerar.isPending || semSaldo || !estimate}>
            {gerar.isPending ? "Gerando…" : "Confirmar e gerar"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink/65">
        Gera várias versões da mesma pauta de uma vez, para você comparar e escolher a melhor.
      </p>

      <div className="mt-4">
        <Field
          label="Quantas variações"
          hint="Cada variação é uma geração completa — o custo soma por variação."
          htmlFor="var-count"
        >
          <Select id="var-count" value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{n} variações</option>
            ))}
          </Select>
        </Field>
      </div>

      <dl className="mt-4 space-y-1.5 rounded-md bg-ink/5 p-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-ink/65">Custo estimado</dt>
          <dd className="font-medium text-ink">{estimate ? fmtUsd(total) : "…"}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink/65">Saldo do mês</dt>
          <dd className="font-medium text-ink">{budget ? fmtUsd(saldo) : "…"}</dd>
        </div>
      </dl>

      {semSaldo && (
        <p className="mt-3 rounded-md bg-danger/10 p-3 text-sm text-danger dark:text-danger-on-dark">
          Saldo insuficiente para esta quantidade. Reduza o número de variações ou ajuste o teto mensal.
        </p>
      )}
      <p className="mt-2 text-xs text-ink/65">Estimativa por formato — o custo real pode variar.</p>
    </Modal>
  );
}

function ApprovalModeCard({ contentId, bare }: { contentId: string; bare?: boolean }) {
  const qc = useQueryClient();
  const { data: effective } = useQuery({
    queryKey: ["content-mode", contentId],
    queryFn: () => approvalApi.getEffectiveMode(contentId),
  });
  // -1 = herdar (override null); 0/1 = forçado. Começa em "herdar" (o efetivo é exibido ao lado).
  const [choice, setChoice] = useState<number>(-1);

  const set = useMutation({
    mutationFn: (mode: number) => approvalApi.setContentMode(contentId, mode < 0 ? null : mode),
    onSuccess: () => { toast.success("Modo de aprovação atualizado."); qc.invalidateQueries({ queryKey: ["content-mode", contentId] }); },
  });

  return (
    <Panel bare={bare}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink">Modo de aprovação deste conteúdo</p>
          <p className="mt-0.5 text-xs text-ink/65">
            Efetivo agora: <strong>{effective != null ? APPROVAL_MODE_LABEL[effective] : "…"}</strong> (sobrepõe o padrão da sua conta).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={choice} onChange={(e) => setChoice(Number(e.target.value))} className="w-auto" aria-label="Modo de aprovação">
            <option value={-1}>Herdar</option>
            <option value={0}>Manual</option>
            <option value={1}>Automático</option>
          </Select>
          <Button variant="ghost" onClick={() => set.mutate(choice)} disabled={set.isPending}>Aplicar</Button>
        </div>
      </div>
    </Panel>
  );
}

/**
 * A3 (ADR-0010): conta IG-alvo desta publicação. Override opcional da conta principal da marca —
 * "" = padrão (worker resolve principal → 1ª conectada). Só faz sentido com ≥2 contas na marca.
 */
function TargetAccountCard({ content, onSaved, bare }: { content: Content; onSaved: () => void; bare?: boolean }) {
  const { data: accounts } = useQuery({ queryKey: ["ig-accounts"], queryFn: instagramApi.accounts });
  const [choice, setChoice] = useState<string>(content.targetInstagramAccountId ?? "");

  useEffect(() => {
    setChoice(content.targetInstagramAccountId ?? "");
  }, [content.targetInstagramAccountId]);

  const save = useMutation({
    mutationFn: () => contentApi.setTargetAccount(content.id, choice || null),
    onSuccess: () => {
      toast.success("Conta de publicação atualizada.");
      onSaved();
    },
    onError: () => toast.error("Não foi possível definir a conta-alvo."),
  });

  const list = accounts ?? [];
  // Sem conta ou com só 1: a escolha não agrega (tudo cai na principal). Não polui a UI.
  if (list.length < 2) return null;

  const primary = list.find((a) => a.isPrimary);
  const changed = (content.targetInstagramAccountId ?? "") !== choice;

  return (
    <Panel bare={bare}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink">Conta de publicação</p>
          <p className="mt-0.5 text-xs text-ink/65">
            Padrão: <strong>{primary?.username ? `@${primary.username}` : "conta principal da marca"}</strong>.
            Escolha outra só para esta publicação.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            className="w-auto"
            aria-label="Conta de publicação"
          >
            <option value="">Conta principal (padrão)</option>
            {list.map((a) => (
              <option key={a.id} value={a.id}>
                {a.username ? `@${a.username}` : a.id.slice(0, 8)}
                {a.isPrimary ? " — principal" : ""}
                {!a.isConnected ? " (desconectada)" : ""}
              </option>
            ))}
          </Select>
          <Button variant="ghost" onClick={() => save.mutate()} disabled={save.isPending || !changed}>
            Aplicar
          </Button>
        </div>
      </div>
    </Panel>
  );
}
