"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ideaApi, type Idea } from "@/lib/ideas";
import { TYPE_LABEL } from "@/lib/pautas";
import { Badge, Button, Card, EmptyState, PageHeader, PageShell, Skeleton } from "@/components/ui";
import { IconSparkles } from "@/components/icons";
import { toast } from "@/components/toast";

// E4.4 (ADR-0006) — porta de saída do loop autônomo. Lista as ideias que o loop criou
// (quando a fila de pautas esvaziou) e promove cada uma a uma Pauta na marca atual.
export default function IdeasPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { data = [], isLoading } = useQuery({ queryKey: ["ideas"], queryFn: ideaApi.list });

  const promote = useMutation({
    mutationFn: (id: string) => ideaApi.promote(id),
    // B3 (P1/Fricção) — promover é meio, não fim. Antes caía na LISTA /pautas (beco: "promovi,
    // e agora?"). promote() devolve a Pauta criada → levamos direto ao caminho de gerar
    // (/create?pauta={id}), fechando o loop sugestão-da-IA → conteúdo em 1 clique. O wizard
    // já pré-seleciona a pauta por esse param. A pauta segue salva na lista (nada se perde).
    onSuccess: (pauta) => {
      qc.invalidateQueries({ queryKey: ["ideas"] });
      qc.invalidateQueries({ queryKey: ["pautas"] });
      toast.success("Ideia promovida a pauta — vamos gerar o conteúdo.");
      router.push(`/create?pauta=${pauta.id}`);
    },
  });

  return (
    <PageShell width="full">
      <PageHeader
        eyebrow="Sugeridas pela IA"
        title="Ideias"
        description="Quando sua fila de pautas esvazia, a IA sugere ideias aqui. Promova as boas a pautas — só então entram na fila de geração. Nada vira conteúdo sem você."
      />

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      <div className="space-y-3">
        {data.map((idea: Idea) => (
          <Card key={idea.id} className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              {/* Selo de PROVENIÊNCIA — deixa óbvio que isto veio da IA (vs pauta humana).
                  É o sinal que mata a confusão Pautas×Ideias. */}
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-ink/[0.06] px-2 py-0.5 text-[11px] font-medium text-ink/65">
                  <IconSparkles size={12} /> Sugestão da IA
                </span>
                <span className="text-[11px] uppercase tracking-wide text-ink/65">{TYPE_LABEL[idea.suggestedType]}</span>
              </div>
              <h3 className="font-medium text-ink">{idea.title}</h3>
              {idea.rationale && <p className="mt-1 line-clamp-2 text-sm text-ink/65">{idea.rationale}</p>}
            </div>
            <Button onClick={() => promote.mutate(idea.id)} disabled={promote.isPending} className="shrink-0">
              {promote.isPending ? "Promovendo…" : "Promover a pauta"}
            </Button>
          </Card>
        ))}
        {!isLoading && data.length === 0 && (
          <EmptyState
            title="Nenhuma sugestão no momento"
            description="O loop autônomo sugere ideias aqui quando sua fila de pautas esvazia — e só quando está ligado nas configurações. Enquanto isso, anote suas próprias pautas: é o caminho mais rápido para gerar conteúdo."
            icon={<IconSparkles size={18} />}
            action={
              <Link href="/pautas">
                <Button>Criar uma pauta</Button>
              </Link>
            }
          />
        )}
      </div>
    </PageShell>
  );
}
