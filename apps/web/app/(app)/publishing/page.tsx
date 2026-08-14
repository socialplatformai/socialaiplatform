"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { publishingApi, type PublishFailure } from "@/lib/publishing";
import { Button, Card, EmptyState, PageHeader, PageShell, Skeleton } from "@/components/ui";
import { IconRefresh } from "@/components/icons";
import { toast } from "@/components/toast";

// G6: a UI nunca mostra erro cru/em inglês do Graph API. Se o worker já gravou uma mensagem
// PT-BR clara, mostramos; senão (vazio ou erro técnico em inglês), caímos numa mensagem neutra e
// acionável. Heurística simples: tratamos como "técnico" quando vem vazio ou claramente em inglês.
const NEUTRO = "Algo deu errado ao publicar. Tente de novo em instantes.";
function friendlyPublishError(error?: string | null): string {
  const e = (error ?? "").trim();
  if (!e) return NEUTRO;
  // Sinais de erro cru/técnico (inglês ou jargão de API) → mensagem neutra.
  const tecnico = /\b(error|invalid|unauthorized|forbidden|exception|null|undefined|timeout|failed|token|oauth|graph)\b/i;
  const temAcento = /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(e);
  if (!temAcento && tecnico.test(e)) return NEUTRO;
  return e;
}

export default function PublishingFailuresPage() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({
    queryKey: ["publishing-failures"],
    queryFn: publishingApi.failures,
  });

  // C2 (ADR-0009): re-tenta um log de erro. 409 (já publicado / não-erro) já vira toast
  // pelo MutationCache central — sem onError aqui.
  const retry = useMutation({
    mutationFn: (logId: string) => publishingApi.retry(logId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["publishing-failures"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Vamos tentar publicar de novo automaticamente.");
    },
  });

  return (
    <PageShell width="full">
      <PageHeader
        eyebrow="Operação"
        title="Falhas de publicação"
        description="Conteúdo que falhou ao publicar — re-tente quando o problema for transitório."
      />

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      <div className="space-y-3">
        {data.map((f: PublishFailure) => (
          <Card key={f.logId} className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink/80">{friendlyPublishError(f.error)}</p>
              <p className="mt-2 text-xs text-ink/65">
                {f.attempts} tentativa(s)
                {f.lastTriedAt != null && (
                  <> · última em {new Date(f.lastTriedAt).toLocaleString("pt-BR")}</>
                )}
              </p>
              <Link
                href={`/content/${f.contentId}`}
                className="mt-2 inline-block text-xs text-ink/65 underline underline-offset-2 transition hover:text-ink"
              >
                Abrir conteúdo
              </Link>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                onClick={() => retry.mutate(f.logId)}
                disabled={retry.isPending}
              >
                <span className="mr-1.5 inline-flex"><IconRefresh size={14} /></span>
                Re-tentar
              </Button>
            </div>
          </Card>
        ))}
        {!isLoading && data.length === 0 && (
          <EmptyState title="Nenhuma falha" description="Tudo publicado sem erros." />
        )}
      </div>
    </PageShell>
  );
}
