"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { contentApi, CONTENT_STATUS_LABEL, DECIDABLE_STATUSES, type Content } from "@/lib/content";
import { Badge, Button, Card, EmptyState, PageHeader, PageShell, Skeleton } from "@/components/ui";
import { toast } from "@/components/toast";

// A5 (ADR-0009): comparação de variações de uma pauta lado a lado + escolher.
// GET /api/content?pautaId= traz todas as variações; POST /content/{id}/choose promove a escolhida
// (conforme o modo efetivo) e arquiva as irmãs decidíveis. Estados decidíveis: DECIDABLE_STATUSES (lib/content).

function CompareInner() {
  const params = useSearchParams();
  const pautaId = params.get("pautaId") ?? "";
  const qc = useQueryClient();

  const { data = [], isLoading } = useQuery({
    queryKey: ["content-variations", pautaId],
    queryFn: () => contentApi.listByPauta(pautaId),
    enabled: !!pautaId,
  });

  // Variação recomendada = maior qualityScore ENTRE as decidíveis (as que ainda dá p/ escolher).
  // Honesto: só recomenda se há score real; sem score em nenhuma → não inventa recomendação (null).
  const bestId = (() => {
    const elegiveis = data.filter((c) => DECIDABLE_STATUSES.has(c.status) && c.qualityScore != null);
    if (elegiveis.length === 0) return null;
    return elegiveis.reduce((a, b) => (b.qualityScore! > a.qualityScore! ? b : a)).id;
  })();

  const choose = useMutation({
    mutationFn: (id: string) => contentApi.choose(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["content-variations", pautaId] });
      qc.invalidateQueries({ queryKey: ["approvals-pending"] });
      toast.success("Variação escolhida. As demais foram arquivadas.");
    },
  });

  if (!pautaId) {
    return (
      <EmptyState
        title="Pauta não informada"
        description="Abra a comparação a partir de uma pauta com variações geradas."
      />
    );
  }

  return (
    <PageShell width="full">
      <PageHeader
        eyebrow="Iterar o output"
        title="Comparar variações"
        description="Versões geradas para a mesma pauta. Escolha uma — as demais decidíveis são arquivadas automaticamente."
      />

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {!isLoading && data.length === 0 && (
        <EmptyState
          title="Sem variações"
          description="Esta pauta ainda não tem versões geradas para comparar."
          action={<Link href="/create"><Button>Gerar conteúdo</Button></Link>}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
        {data.map((c: Content) => {
          const decidivel = DECIDABLE_STATUSES.has(c.status);
          const primeiroSlide = c.slides[0];
          // Esperto-em-silêncio: a máquina sabe qual variação pontuou melhor no validador de qualidade.
          // Em vez de apresentar todas iguais, PROPÕE a de maior score como "Recomendada" (sem decidir
          // por você — todas seguem escolhíveis). Só quando há ≥2 e essa é decidível (faz sentido escolher).
          const isRecomendada = decidivel && bestId != null && c.id === bestId && data.length > 1;
          return (
            <Card key={c.id} className={`flex flex-col ${isRecomendada ? "ring-1 ring-ink/25" : ""}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge tone="neutral">{CONTENT_STATUS_LABEL[c.status]}</Badge>
                  {isRecomendada && <Badge tone="high">Recomendada</Badge>}
                </div>
                {c.qualityScore != null && (
                  <Badge tone={c.qualityScore < 70 ? "low" : "medium"}>{c.qualityScore}/100</Badge>
                )}
              </div>

              {primeiroSlide?.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={primeiroSlide.imageUrl}
                  alt={`Prévia da variação ${c.id.slice(0, 8)}`}
                  className="mb-3 aspect-[4/5] w-full rounded-lg object-cover ring-1 ring-ink/5"
                />
              ) : (
                <div className="mb-3 flex aspect-[4/5] w-full items-center justify-center rounded-lg bg-ink/5 text-xs text-ink/65">
                  Sem prévia de imagem
                </div>
              )}

              <p className="line-clamp-3 flex-1 text-sm text-ink/80">{c.caption || "(sem legenda)"}</p>

              <div className="mt-3 flex gap-2">
                <Link href={`/content/${c.id}`} className="flex-1">
                  <Button variant="ghost" className="w-full">Abrir</Button>
                </Link>
                <Button
                  onClick={() => choose.mutate(c.id)}
                  disabled={!decidivel || choose.isPending}
                  className="flex-1"
                >
                  Escolher
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </PageShell>
  );
}

export default function ComparePage() {
  // useSearchParams exige Suspense boundary no App Router (Next 15).
  return (
    <Suspense fallback={<PageShell width="full"><Skeleton className="h-64 w-full" /></PageShell>}>
      <CompareInner />
    </Suspense>
  );
}
