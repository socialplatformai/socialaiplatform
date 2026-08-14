"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  historyApi,
  type PublicationHistory,
  type GenerationHistory,
  type Page,
} from "@/lib/history";
import { mediaUrl } from "@/lib/api";
import { Badge, Button, Card, EmptyState, PageHeader, PageShell, Skeleton, Tabs } from "@/components/ui";

// C1 (ADR-0010): histórico legível sem SQL — publicações e gerações da marca ativa,
// paginadas. Brand-scoped no backend (HistoryController); aqui só apresentamos.

const PAGE_SIZE = 20;

type TabId = "publications" | "generations";

const TABS: { id: TabId; label: string }[] = [
  { id: "publications", label: "Publicações" },
  { id: "generations", label: "Gerações" },
];

export default function HistoryPage() {
  const [tab, setTab] = useState<TabId>("publications");

  return (
    <PageShell width="full">
      <PageHeader
        eyebrow="Operação"
        title="Histórico"
        description="O que esta marca já publicou e gerou — sem precisar de banco. Acompanhe resultados de publicação e o rastro de cada geração de conteúdo."
      />

      <div className="mb-6">
        <Tabs tabs={TABS} active={tab} onChange={(id) => setTab(id as TabId)} />
      </div>

      {tab === "publications" ? <PublicationsTab /> : <GenerationsTab />}
    </PageShell>
  );
}

// ── Paginação (compartilhada) ──────────────────────────────────────────────

/** Rodapé "X–Y de TOTAL" + Anterior/Próxima, desabilitados nos limites. */
function Pager({
  page,
  pageSize,
  total,
  onPrev,
  onNext,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const hasPrev = page > 1;
  const hasNext = last < total;

  return (
    <div className="mt-5 flex items-center justify-between">
      <p className="text-xs text-ink/65" aria-live="polite">
        {first}–{last} de {total}
      </p>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onPrev} disabled={!hasPrev}>
          Anterior
        </Button>
        <Button variant="ghost" onClick={onNext} disabled={!hasNext}>
          Próxima
        </Button>
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

// ── Aba: Publicações ───────────────────────────────────────────────────────

// PublishResult.ToString() → rótulo PT-BR + tom do Badge.
const RESULT_LABEL: Record<string, string> = {
  Success: "Publicado",
  Error: "Falhou",
  Pending: "Pendente",
  Skipped: "Ignorado",
};

function resultTone(result: string): "high" | "low" | "neutral" {
  if (result === "Success") return "high";
  if (result === "Error") return "low";
  return "neutral"; // Pending | Skipped | desconhecido
}

function PublicationsTab() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["history-pub", page],
    queryFn: () => historyApi.publications(page, PAGE_SIZE),
  });

  if (isLoading) return <ListSkeleton />;
  if (isError) {
    return (
      <Card>
        <p role="alert" className="text-sm text-ink/70">
          Não foi possível carregar as publicações. Tente novamente.
        </p>
      </Card>
    );
  }

  const items = data?.items ?? [];
  if (items.length === 0) {
    // Vazio-de-LISTA não é parede: dá a próxima-ação do funil (gerar → aprovar → agendar → publica).
    return (
      <EmptyState
        title="Nada publicado ainda"
        description="Suas publicações aparecem aqui assim que a primeira for ao ar. Gere uma peça e ela seguirá o fluxo até a publicação."
        action={
          <Link href="/create">
            <Button>Criar conteúdo</Button>
          </Link>
        }
      />
    );
  }

  return (
    <section aria-label="Publicações">
      <Card className="!p-0">
        <ul className="divide-y divide-ink/8">
          {items.map((p) => (
            <PublicationRow key={`${p.contentId}-${p.when}`} pub={p} />
          ))}
        </ul>
      </Card>
      <Pager
        page={data?.pageNumber ?? page}
        pageSize={data?.pageSize ?? PAGE_SIZE}
        total={data?.total ?? 0}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => p + 1)}
      />
    </section>
  );
}

function PublicationRow({ pub }: { pub: PublicationHistory }) {
  const isError = pub.result === "Error";
  return (
    <li className="flex items-start gap-4 px-6 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">
            {pub.accountUsername ? `@${pub.accountUsername}` : "—"}
          </span>
        </div>
        {pub.caption ? (
          <p className="mt-1 truncate text-sm text-ink/65">{pub.caption}</p>
        ) : (
          <p className="mt-1 text-sm text-ink/65">Sem legenda</p>
        )}
        {isError && pub.error ? (
          <p className="mt-1.5 text-xs text-ink/65">{pub.error}</p>
        ) : null}
        <p className="mt-1.5 text-xs text-ink/65">
          {new Date(pub.when).toLocaleString("pt-BR")}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        {/* Distingue publicação em demonstração (modo simulado) da publicação real no Instagram. */}
        {pub.result === "Success" && pub.publisher === "Mock" ? (
          <Badge tone="low">demonstração</Badge>
        ) : null}
        {isError ? (
          <span className="rounded-full bg-ink/5 px-2.5 py-0.5 text-xs font-medium text-red-500">
            {RESULT_LABEL.Error}
          </span>
        ) : (
          <Badge tone={resultTone(pub.result)}>
            {RESULT_LABEL[pub.result] ?? pub.result}
          </Badge>
        )}
      </div>
    </li>
  );
}

// ── Aba: Gerações ──────────────────────────────────────────────────────────

// ContentStatus.ToString() → rótulo PT-BR. Espelha Domain/Enums.cs (ContentStatus).
// CONTENT_STATUS_LABEL de @/lib/content é keyed por inteiro; aqui o status chega como
// string (ToString()), então mantemos um mapa próprio por nome.
const GEN_STATUS_LABEL: Record<string, string> = {
  Draft: "Rascunho",
  Generating: "Gerando",
  PendingApproval: "Aguardando aprovação",
  Approved: "Aprovado",
  Rejected: "Rejeitado",
  Scheduled: "Agendado",
  Published: "Publicado",
  EphemeralPublished: "Publicado (efêmero)",
  Failed: "Falhou",
};

function genStatusTone(status: string): "high" | "low" | "neutral" {
  if (status === "Published" || status === "EphemeralPublished" || status === "Approved")
    return "high";
  if (status === "Failed" || status === "Rejected") return "low";
  return "neutral";
}

function GenerationsTab() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["history-gen", page],
    queryFn: () => historyApi.generations(page, PAGE_SIZE),
  });

  if (isLoading) return <ListSkeleton />;
  if (isError) {
    return (
      <Card>
        <p role="alert" className="text-sm text-ink/70">
          Não foi possível carregar as gerações. Tente novamente.
        </p>
      </Card>
    );
  }

  const items = data?.items ?? [];
  if (items.length === 0) {
    // Vazio-de-LISTA com saída: gerar começa por uma pauta — leva o operador ao início do funil.
    return (
      <EmptyState
        title="Nada gerado ainda"
        description="As peças que a IA criar para esta marca aparecem aqui. Comece anotando uma pauta — a IA transforma em conteúdo."
        action={
          <Link href="/create">
            <Button>Gerar conteúdo</Button>
          </Link>
        }
      />
    );
  }

  return (
    <section aria-label="Gerações">
      <Card className="!p-0">
        <ul className="divide-y divide-ink/8">
          {items.map((g) => (
            <GenerationRow key={`${g.contentId}-${g.when}`} gen={g} />
          ))}
        </ul>
      </Card>
      <Pager
        page={data?.pageNumber ?? page}
        pageSize={data?.pageSize ?? PAGE_SIZE}
        total={data?.total ?? 0}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => p + 1)}
      />
    </section>
  );
}

function GenerationRow({ gen }: { gen: GenerationHistory }) {
  const lowQuality = gen.qualityScore != null && gen.qualityScore < 70;
  const cover = mediaUrl(gen.coverImageUrl);
  return (
    <li className="flex items-start gap-4 px-6 py-4">
      {/* Miniatura da peça gerada (capa = 1º slide com imagem). Mantém proporção 4:5 do feed.
          Sem imagem (só-texto, gerando, falhou) → placeholder discreto. */}
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cover}
          alt={gen.pautaTitle ? `Capa: ${gen.pautaTitle}` : "Capa da geração"}
          className="h-20 w-16 shrink-0 rounded-md border border-ink/10 object-cover"
          loading="lazy"
        />
      ) : (
        <div
          className="flex h-20 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-ink/15 text-[10px] text-ink/40"
          aria-hidden
        >
          sem imagem
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">
          {gen.pautaTitle ?? "Sem pauta"}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink/65">
          {gen.qualityScore != null && (
            <span className={lowQuality ? "font-medium text-amber-600" : "text-ink/65"}>
              Qualidade {gen.qualityScore}/100
            </span>
          )}
          {/* G6: o identificador técnico da geração (jobId/UUID) não é exibido — não diz nada ao
              operador. O título da pauta + data já identificam a geração. */}
          <span>{new Date(gen.when).toLocaleString("pt-BR")}</span>
        </div>
      </div>
      <div className="shrink-0 pt-0.5">
        <Badge tone={genStatusTone(gen.status)}>
          {GEN_STATUS_LABEL[gen.status] ?? gen.status}
        </Badge>
      </div>
    </li>
  );
}
