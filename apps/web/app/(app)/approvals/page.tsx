"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { approvalApi, APPROVAL_MODE_LABEL, type PendingContent } from "@/lib/workflow";
import { instagramApi } from "@/lib/instagram";
import { CONTENT_STATUS_LABEL, contentApi } from "@/lib/content";
import { TYPE_LABEL } from "@/lib/pautas";
import Link from "next/link";
import { Badge, Button, Card, EmptyState, FlowFrame, Skeleton, PageShell, PageHeader, SectionLabel } from "@/components/ui";
import { SlideCanvas, SlideCarousel } from "@/components/slide-canvas";
import { InlineSchedule } from "@/components/inline-schedule";
import { ReasoningPanel } from "@/components/reasoning-panel";
import { IconCheck } from "@/components/icons";
import { toast } from "@/components/toast";

// R2.5 (E7/U2) — Revisão & Agenda como FILA MASTER-DETAIL (não mais cards empilhados num tubo).
// Padrão de inbox/triage SOTA (Linear Triage, Superhuman): lista compacta à esquerda, PREVIEW GRANDE
// + decisão + agenda no painel à direita. Teclado-first: J/K navega, A aprova, R rejeita, E abre,
// X marca p/ lote. Preserva: batch (C1), agendamento inline (R3), thumb visual (F2).

export default function ApprovalsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { data: rawData = [], isLoading } = useQuery({
    queryKey: ["approvals-pending"],
    queryFn: approvalApi.pending,
  });
  // P6/Inteligência: triagem por RISCO, não cronológica. As peças de menor qualityScore (mais
  // arriscadas) sobem ao topo — o power-user decide o que importa primeiro e pode "varrer" o
  // resto com confiança. Itens sem score vão ao fim (nada a sinalizar). Estável (preserva a
  // ordem de chegada dentro do mesmo score).
  const data = useMemo(() => {
    const score = (c: PendingContent) => (typeof c.qualityScore === "number" ? c.qualityScore : 999);
    return [...rawData]
      .map((c, i) => ({ c, i }))
      .sort((a, b) => score(a.c) - score(b.c) || a.i - b.i)
      .map((x) => x.c);
  }, [rawData]);
  // C4/T (P3): honestidade-de-simulação NO ponto de decisão. Sem Instagram conectado, a
  // publicação roda em MockPublisher (nada vai ao ar). O selo responde "isso é real?" onde
  // o operador decide — não só no dashboard.
  const ig = useQuery({ queryKey: ["dash-ig"], queryFn: instagramApi.status });
  const igConnected = ig.data?.connected ?? false;

  // Item em FOCO (o que o painel de detalhe mostra). Mantém por id (sobrevive a refetch/reordenação).
  // Boot a partir de ?focus=<id> — assim voltar do editor (Abrir & editar) RETOMA o mesmo item
  // em vez de resetar pro 1º (atrito repetido na triagem em volume).
  const [focusedId, setFocusedId] = useState<string | null>(
    () => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("focus")),
  );

  // Espelha o foco na URL (replaceState — sem reload, sem entrada no histórico). Quando o
  // operador abre o editor e volta (router.back), o ?focus= restaura o item focado.
  useEffect(() => {
    if (typeof window === "undefined" || !focusedId) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("focus") !== focusedId) {
      url.searchParams.set("focus", focusedId);
      window.history.replaceState(null, "", url.toString());
    }
  }, [focusedId]);
  const focusedIndex = useMemo(
    () => Math.max(0, data.findIndex((c: PendingContent) => c.contentId === focusedId)),
    [data, focusedId],
  );
  const focused: PendingContent | undefined = data[focusedIndex];

  // Seleção p/ LOTE (C1) — distinta do foco. Set de ids marcados (tecla X / checkbox).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const clearSelection = () => setSelected(new Set());

  // P6/Inteligência: triagem em volume. As peças "seguras" (qualityScore alto) podem ir ao
  // lote de uma vez — o power-user revisa as arriscadas (topo da fila por risco) e aprova o
  // bloco seguro num gesto, em vez de 50 toggles. SAFE_THRESHOLD espelha o piso do quality-validator.
  const SAFE_THRESHOLD = 80;
  const safeIds = useMemo(
    () => data.filter((c: PendingContent) => (c.qualityScore ?? 0) >= SAFE_THRESHOLD).map((c) => c.contentId),
    [data],
  );
  const selectSafe = () => setSelected(new Set(safeIds));

  // Aprovados durante a visita atual → agendam inline no detalhe (evita um toast sem ação).
  const [justApproved, setJustApproved] = useState<Set<string>>(new Set());

  // Foca o 1º item quando a lista chega (ou quando o focado sai da lista).
  useEffect(() => {
    if (data.length === 0) { setFocusedId(null); return; }
    if (!focusedId || !data.some((c: PendingContent) => c.contentId === focusedId)) {
      setFocusedId(data[0].contentId);
    }
  }, [data, focusedId]);

  // Higiene: poda justApproved dos ids que saíram de pendente (evita estado morto crescente).
  useEffect(() => {
    setJustApproved((prev) => {
      if (prev.size === 0) return prev;
      const ids = new Set(data.map((c: PendingContent) => c.contentId));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["approvals-pending"] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };

  const decide = useMutation({
    mutationFn: ({ id, approved }: { id: string; approved: boolean }) => approvalApi.decide(id, approved),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      if (v.approved) {
        setJustApproved((prev) => new Set(prev).add(v.id));
        toast.success("Aprovado. Agende ao lado — sem sair daqui.");
      } else {
        invalidate();
        toast.success("Conteúdo rejeitado.");
      }
    },
    // T (erro-silencioso): o avanço de foco é otimista (acontece antes da resposta). Se o
    // backend recusa (409/403 — ex.: a peça já saiu de pendente), o operador achava que tinha
    // decidido e não tinha. Aqui dizemos a verdade E re-sincronizamos a fila (invalidate traz a
    // peça de volta se a decisão não pegou) — e tiramos o "aprovado" otimista desse id.
    onError: (_e, v) => {
      setJustApproved((prev) => {
        if (!prev.has(v.id)) return prev;
        const next = new Set(prev);
        next.delete(v.id);
        return next;
      });
      invalidate();
      toast.error(
        v.approved
          ? "Não foi possível aprovar — o estado da peça mudou. Confira a fila."
          : "Não foi possível rejeitar — o estado da peça mudou. Confira a fila.",
      );
    },
  });

  const batch = useMutation({
    mutationFn: ({ action }: { action: "approve" | "reject" }) => approvalApi.batch([...selected], action),
    onSuccess: (r, v) => {
      const verbo = v.action === "approve" ? "aprovado(s)" : "rejeitado(s)";
      // C (skipped invisível): antes o toast só dizia "2 ignorado(s)" — o operador não sabia
      // QUAIS nem por quê. O backend devolve os ids ignorados (BatchResult.Skipped); aqui os
      // mapeamos para o título e damos o motivo real e único deste endpoint: já não estavam
      // pendentes (saíram de Draft/PendingApproval). Não inventamos motivo por-item que a API
      // não dá — declaramos o motivo verdadeiro. Limita a 2 nomes + contagem (não estoura o toast).
      if (r.skipped.length > 0) {
        const nomes = r.skipped
          .map((id) => rawData.find((c: PendingContent) => c.contentId === id)?.caption?.slice(0, 28))
          .filter(Boolean) as string[];
        const lista =
          nomes.length === 0
            ? `${r.skipped.length} item(ns)`
            : nomes.length <= 2
              ? nomes.map((n) => `“${n}”`).join(", ")
              : `“${nomes[0]}”, “${nomes[1]}” +${r.skipped.length - 2}`;
        toast.info(
          `${r.applied.length} ${verbo}. ${lista} ignorado(s) — já não estava(m) pendente(s).`,
        );
      } else {
        toast.success(`${r.applied.length} ${verbo}.`);
      }
      invalidate();
      clearSelection();
    },
    onError: () => toast.error("Não foi possível concluir a ação em lote. Tente novamente."),
  });

  const remove = useMutation({
    mutationFn: () => contentApi.batchDelete([...selected]),
    onSuccess: (r) => {
      invalidate();
      clearSelection();
      toast.success(`${r.applied.length} excluído(s).`);
    },
  });

  const busy = batch.isPending || remove.isPending;

  // ── Teclado-first (E7/U2): J/K navega · A aprova · R rejeita · X marca lote · E abre ──
  const moveFocus = (delta: number) => {
    if (data.length === 0) return;
    const i = Math.min(data.length - 1, Math.max(0, focusedIndex + delta));
    setFocusedId(data[i].contentId);
  };

  // Rejeição é IRREVERSÍVEL (estado terminal na máquina de estado do backend), então
  // exige confirmação em 2 tempos — sem modal pesado (anti-KISS): o 1º R/clique ARMA,
  // o 2º confirma. Navegar/aprovar/Esc desarma. Velocidade de teclado preservada.
  const [armedReject, setArmedReject] = useState<string | null>(null);

  // Aprovar (não-destrutivo): imediato + avança. Guard duplo-disparo/já-aprovado.
  const approveAndAdvance = () => {
    if (!focused || decide.isPending || justApproved.has(focused.contentId)) return;
    setArmedReject(null);
    decide.mutate({ id: focused.contentId, approved: true });
    moveFocus(1);
  };

  // Rejeitar (destrutivo/irreversível): arma na 1ª vez, confirma na 2ª, aí avança.
  const rejectWithConfirm = () => {
    if (!focused || decide.isPending) return;
    if (armedReject !== focused.contentId) { setArmedReject(focused.contentId); return; }
    setArmedReject(null);
    decide.mutate({ id: focused.contentId, approved: false });
    moveFocus(1);
  };

  // Trocar de item desarma a confirmação pendente (evita rejeitar o item errado).
  const moveAndDisarm = (delta: number) => { setArmedReject(null); moveFocus(delta); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // não intercepta enquanto digita num campo (agenda inline, etc.)
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (!focused) return;
      switch (e.key.toLowerCase()) {
        case "j": e.preventDefault(); moveAndDisarm(1); break;
        case "k": e.preventDefault(); moveAndDisarm(-1); break;
        case "a": e.preventDefault(); approveAndAdvance(); break;
        case "r": e.preventDefault(); rejectWithConfirm(); break;
        case "x": e.preventDefault(); setArmedReject(null); toggle(focused.contentId); break;
        case "e": e.preventDefault(); router.push(`/content/${focused.contentId}`); break;
        case "escape": e.preventDefault(); setArmedReject(null); break;
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [focused, focusedIndex, data, justApproved, decide.isPending, armedReject]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fatia 1 da SoT (FlowFrame railWidth="list"): a FILA vira o rail navegável; o PREVIEW GRANDE +
  // decisão + agenda é o protagonista (children); o ASIDE leva o contexto de triagem (lote + atalhos).
  // Toda a lógica (teclado J/K/A/R/E/X, batch, agendamento inline, triagem por risco, ?focus=) é
  // preservada — muda a composição (3 zonas SoT), não a estrutura.
  const queueRail = (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between">
        <SectionLabel>{focusedIndex + 1} / {data.length} na fila</SectionLabel>
        {selected.size > 0 ? (
          <button onClick={clearSelection} className="text-xs text-ink/65 hover:text-ink">
            Limpar ({selected.size})
          </button>
        ) : (
          data.length > 1 &&
          data.some((c: PendingContent) => typeof c.qualityScore === "number") && (
            <span className="text-[11px] text-ink/65" title="As peças de menor pontuação de qualidade aparecem primeiro, para você decidir o que importa antes.">
              ↑ por risco
            </span>
          )
        )}
      </div>
      {selected.size === 0 && safeIds.length >= 2 && (
        <button
          onClick={selectSafe}
          className="mb-2 inline-flex items-center gap-1.5 rounded-pill bg-ink/5 px-3 py-1 text-xs font-medium text-ink/80 transition hover:bg-ink/10"
        >
          Selecionar {safeIds.length} seguras (≥ {SAFE_THRESHOLD})
        </button>
      )}
      <div
        className="space-y-1.5"
        role="listbox"
        aria-label="Fila de aprovação"
        aria-activedescendant={focusedId ? `queue-opt-${focusedId}` : undefined}
      >
        {data.map((c: PendingContent) => (
          <QueueRow
            key={c.contentId}
            content={c}
            focused={c.contentId === focusedId}
            selectedForBatch={selected.has(c.contentId)}
            approved={justApproved.has(c.contentId)}
            onFocus={() => setFocusedId(c.contentId)}
            onToggleBatch={() => toggle(c.contentId)}
          />
        ))}
      </div>
    </div>
  );

  // Aside: contexto de triagem — dicas de teclado (no ponto de uso, Norman) + ações de LOTE quando
  // há seleção (a barra flutuante vira um cartão estável no aside, sem tapar o conteúdo).
  const triageAside = (
    <div className="space-y-4">
      {selected.size > 0 ? (
        <Card className="ring-ink/10">
          <SectionLabel className="mb-2">Lote — {selected.size} selecionado(s)</SectionLabel>
          <div className="flex flex-col gap-2">
            <Button onClick={() => batch.mutate({ action: "approve" })} disabled={busy}>Aprovar selecionados</Button>
            <Button variant="ghost" onClick={() => batch.mutate({ action: "reject" })} disabled={busy}>Rejeitar selecionados</Button>
            <button onClick={() => remove.mutate()} disabled={busy}
              className="text-xs font-medium text-ink/65 underline-offset-2 hover:text-danger hover:underline disabled:opacity-50">
              Excluir selecionados
            </button>
            <button onClick={clearSelection} disabled={busy}
              className="text-xs text-ink/65 underline-offset-2 hover:text-ink hover:underline disabled:opacity-50">
              Limpar seleção
            </button>
          </div>
        </Card>
      ) : (
        <div className="rounded-lg bg-ink/[0.03] p-4 ring-1 ring-ink/8">
          <SectionLabel className="mb-2">Atalhos</SectionLabel>
          <ul className="space-y-1.5 text-xs text-ink/70">
            <li><Kbd>J</Kbd> / <Kbd>K</Kbd> navegar a fila</li>
            <li><Kbd>A</Kbd> aprovar e avançar</li>
            <li><Kbd>R</Kbd> rejeitar (2× confirma)</li>
            <li><Kbd>X</Kbd> marcar para o lote</li>
            <li><Kbd>E</Kbd> abrir e editar</li>
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-ink/65">
            Triagem sem tirar a mão do teclado — revise o preview, decida, agende.
          </p>
        </div>
      )}
    </div>
  );

  return (
    <PageShell width="full">
      <PageHeader eyebrow="Fluxo de publicação" title="Revisão & Agenda" />

      {/* Título editorial híbrido da SoT (assinatura coesa com /create). */}
      <div className="mb-8">
        <h2 className="font-sans text-4xl font-semibold leading-[1.05] tracking-tight text-ink sm:text-5xl">
          Revisar e <em className="font-serif italic">agendar</em>.
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink/65">
          Triagem rápida: revise o preview real, decida e agende — sem sair da fila.
        </p>
      </div>

      {isLoading && (
        <div className="grid gap-10 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)_minmax(300px,360px)]">
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
          <Skeleton className="h-[480px] w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {!isLoading && data.length === 0 && (
        <EmptyState
          title="Nada aguardando você"
          description="Quando você gerar conteúdo, ele aparece aqui para revisão."
          action={<Link href="/create"><Button>Gerar conteúdo</Button></Link>}
        />
      )}

      {!isLoading && data.length > 0 && (
        <FlowFrame
          railWidth="list"
          railLabel="Fila de aprovação"
          asideLabel="Contexto de triagem"
          rail={queueRail}
          aside={triageAside}
        >
          {focused && (
            <DetailPane
              key={focused.contentId}
              content={focused}
              approved={justApproved.has(focused.contentId)}
              armed={armedReject === focused.contentId}
              igConnected={igConnected}
              onApprove={approveAndAdvance}
              onReject={rejectWithConfirm}
              deciding={decide.isPending}
              onScheduled={invalidate}
            />
          )}
        </FlowFrame>
      )}
    </PageShell>
  );
}

function Kbd({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd className={`rounded-sm border border-ink/15 bg-canvas px-1.5 py-0.5 font-mono text-[10px] font-medium text-ink/65 ${className}`}>
      {children}
    </kbd>
  );
}

/** Linha compacta da fila — resumo vertical (não colunas), thumb + título + sinais. */
function QueueRow({
  content: c,
  focused,
  selectedForBatch,
  approved,
  onFocus,
  onToggleBatch,
}: {
  content: PendingContent;
  focused: boolean;
  selectedForBatch: boolean;
  approved: boolean;
  onFocus: () => void;
  onToggleBatch: () => void;
}) {
  // A11y (QA): o checkbox é IRMÃO do role="option", não filho — um option não pode conter
  // controle interativo (nested-interactive). O wrapper flex é neutro; o option é só o resumo
  // clicável (com teclado Enter/Space + roving tabIndex + id p/ aria-activedescendant do listbox).
  // role="option" no wrapper EXTERNO (filho direto do role="listbox") — exigência ARIA.
  // O checkbox vira aria-hidden e a seleção de lote acontece via teclado/clique no próprio
  // option (toggle no botão dedicado fora do alvo de foco do leitor) — sem nested-interactive
  // porque o botão NÃO está dentro de outro role interativo: o option é o wrapper, o botão é
  // posicionado mas semanticamente fora do fluxo de leitura via aria-hidden + label no option.
  return (
    <div
      id={`queue-opt-${c.contentId}`}
      role="option"
      aria-selected={focused}
      aria-label={`${c.caption || "Sem legenda"}${
        c.qualityScore != null ? `, qualidade ${c.qualityScore}` : ""
      }${selectedForBatch ? ", marcado para o lote" : ""}`}
      tabIndex={focused ? 0 : -1}
      onClick={onFocus}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); onFocus(); }
        if (e.key === "x" || e.key === "X") { e.preventDefault(); onToggleBatch(); }
      }}
      className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 outline-none transition focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-1 focus-visible:ring-offset-canvas ${
        focused ? "border-ink/30 bg-paper shadow-sm" : "border-transparent hover:bg-ink/5"
      }`}
    >
      {/* Checkbox visual: aria-hidden (a seleção de lote é anunciada no aria-label do option e
          acionada por tecla X); evita controle interativo aninhado no option. */}
      <span
        onClick={(e) => { e.stopPropagation(); onToggleBatch(); }}
        aria-hidden="true"
        // a11y: ícone visual de 20px, mas ÁREA DE TOQUE ≥44px via pseudo-elemento `before:`
        // absoluto e centrado (WCAG 2.5.5) — sem inflar o layout do item da fila. stopPropagation já
        // garante que o toque na área expandida alterna o lote (não foca o option).
        className={`relative grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-sm border transition before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] ${
          selectedForBatch ? "border-ink bg-ink text-canvas" : "border-ink/25 text-transparent hover:border-ink/50"
        }`}
      >
        <IconCheck size={11} />
      </span>
      <ApprovalThumb contentId={c.contentId} compact />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{c.caption || "(sem legenda)"}</p>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="text-[11px] text-ink/65">{TYPE_LABEL[c.type]}</span>
          {approved && <span className="text-[11px] font-medium text-success dark:text-success-on-dark">· aprovado</span>}
          {c.qualityScore != null && c.qualityScore < 70 && (
            <span className="text-[11px] font-medium text-warning dark:text-warning-on-dark">· qualidade {c.qualityScore}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Painel de detalhe — o preview GRANDE + a decisão + a agenda inline (próxima-ação no mesmo plano). */
function DetailPane({
  content: c,
  approved,
  armed,
  igConnected,
  onApprove,
  onReject,
  deciding,
  onScheduled,
}: {
  content: PendingContent;
  approved: boolean;
  armed: boolean;
  igConnected: boolean;
  onApprove: () => void;
  onReject: () => void;
  deciding: boolean;
  onScheduled: () => void;
}) {
  const { data } = useQuery({ queryKey: ["content", c.contentId], queryFn: () => contentApi.get(c.contentId) });
  const slides = data?.slides ?? [];
  return (
    <Card className="overflow-hidden">
      {/* No frame de 3 zonas (SoT) a coluna central é a do preview PROTAGONISTA. O preview e a
          decisão EMPILHAM (preview em cima, metadados+decisão+agenda embaixo) — o split lado-a-lado
          antigo (300px+1fr) espremia e CORTAVA o botão Aprovar dentro da coluna central. Empilhar é
          o SOTA aqui: o preview respira na largura toda, a ação fica logo abaixo (próxima-ação clara).
          Em telas MUITO largas (2xl) volta ao lado-a-lado, onde há espaço de sobra. */}
      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        {/* Preview grande (carrossel real — fim da aprovação às cegas) */}
        <div className="min-w-0 mx-auto w-full max-w-[420px] 2xl:max-w-none">
          {slides.length > 0 ? (
            <SlideCarousel slides={slides} />
          ) : (
            <div className="aspect-[4/5] w-full rounded-lg bg-canvas-2 ring-1 ring-ink/5" />
          )}
        </div>

        {/* Metadados + decisão + agenda */}
        <div className="min-w-0">
          {/* Hierarquia de badges (schedio D4: hierarquia = cognição): STATUS é o sinal
              primário (alto contraste se aprovado / atenção se qualidade baixa); tipo e
              modo são metadados de apoio (texto fino, não badges competindo). */}
          <div className="mb-1 flex flex-wrap items-center gap-2">
            {approved ? (
              <Badge tone="high">Aprovado ✓</Badge>
            ) : (
              <Badge tone="medium">{CONTENT_STATUS_LABEL[c.status]}</Badge>
            )}
            {c.qualityScore != null && c.qualityScore < 70 && (
              <Badge tone="low">Qualidade {c.qualityScore}/100</Badge>
            )}
          </div>
          <p className="mb-3 text-xs text-ink/65">
            {TYPE_LABEL[c.type]} · {APPROVAL_MODE_LABEL[c.effectiveMode]}
          </p>

          {/* C4/T (P3): diz a VERDADE no ponto de decisão — desconectado = simulação, nada
              vai ao ar no perfil real. Honestidade-de-simulação onde o operador decide. */}
          {!igConnected && (
            <div className="mb-3 flex items-start gap-2 rounded-md border border-ink/12 bg-ink/[0.03] px-3 py-2">
              <Badge tone="low">Simulado</Badge>
              <p className="text-xs text-ink/70">
                Instagram desconectado: ao publicar, esta peça roda em simulação — nada vai ao ar.{" "}
                <Link href="/settings/instagram" className="font-medium text-ink underline-offset-2 hover:underline">
                  Conectar Instagram
                </Link>
              </p>
            </div>
          )}

          <p className="text-sm leading-relaxed text-ink/80">{c.caption || "(sem legenda)"}</p>

          {/* "recomendo X porque Y" NO PONTO DE DECISÃO. O raciocínio dos
              agentes + os checks de qualidade já viajam em Content.reasoning (carregado acima); aqui
              eles aparecem ANTES de Aprovar/Rejeitar — o operador decide informado, não às cegas.
              Omitido honesto quando não há reasoning (mock/degradado). */}
          {data?.reasoning && (
            <div className="mt-4 rounded-lg border border-ink/8 bg-ink/[0.02] p-3">
              <ReasoningPanel reasoning={data.reasoning} bare collapsible />
            </div>
          )}

          {!approved ? (
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {/* Aprovar = ÚNICA ação primária (ui-ux-pro-max primary-action). Rejeitar é
                  destrutivo IRREVERSÍVEL → subordinado + confirmação em 2 tempos (sem modal):
                  1º clique arma ("Confirmar rejeição?"), 2º confirma. Editar = ghost neutro. */}
              <Button onClick={onApprove} disabled={deciding}>
                Aprovar <Kbd className="ml-1.5 border-canvas/25 bg-transparent text-canvas/70">A</Kbd>
              </Button>
              <button
                onClick={onReject}
                disabled={deciding}
                aria-label={armed ? "Confirmar rejeição (irreversível)" : "Rejeitar"}
                className={`inline-flex min-h-[40px] items-center rounded-full px-4 py-2 text-sm font-medium ring-1 transition disabled:opacity-50 ${
                  armed
                    ? "bg-danger/10 text-danger ring-danger/40 dark:text-danger-on-dark"
                    : "text-ink/65 ring-ink/15 hover:bg-danger/10 hover:text-danger hover:ring-danger/30 dark:hover:text-danger-on-dark"
                }`}
              >
                {armed ? "Confirmar rejeição?" : <>Rejeitar <Kbd className="ml-1.5">R</Kbd></>}
              </button>
              <Link href={`/content/${c.contentId}`} className="ml-auto">
                <Button variant="ghost">Abrir &amp; editar <Kbd className="ml-1.5">E</Kbd></Button>
              </Link>
            </div>
          ) : (
            <div className="mt-5 border-t border-ink/8 pt-4">
              <p className="mb-2 text-sm text-ink/70">
                Aprovado. Agende a publicação — ou{" "}
                <Link href="/calendar" className="font-medium text-ink underline-offset-2 hover:underline">ver no calendário</Link>.
              </p>
              <InlineSchedule contentId={c.contentId} onScheduled={onScheduled} compact />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * F2 (ADR-0014/G5): thumbnail visual de um conteúdo pendente. Busca sob demanda (cacheado pela
 * mesma key do detalhe). `compact` = miniatura da fila; senão tamanho padrão.
 */
function ApprovalThumb({ contentId, compact = false }: { contentId: string; compact?: boolean }) {
  const { data } = useQuery({ queryKey: ["content", contentId], queryFn: () => contentApi.get(contentId) });
  const first = data?.slides?.[0];
  return (
    <div className={compact ? "w-10 shrink-0" : "w-20 shrink-0 sm:w-24"}>
      {first ? (
        <SlideCanvas slide={first} />
      ) : (
        <div className="aspect-[4/5] w-full rounded-sm bg-canvas-2 ring-1 ring-ink/5" />
      )}
    </div>
  );
}
