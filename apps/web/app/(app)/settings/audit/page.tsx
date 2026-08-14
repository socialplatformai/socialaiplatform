"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { auditApi, AUDIT_ACTION_LABEL, type AuditEntry } from "@/lib/audit";
import { isAdmin } from "@/lib/api";
import { Button, Card, PageHeader, PageShell } from "@/components/ui";

// C2 (ADR-0010): trilha de auditoria — registro append-only das ações sensíveis
// (Admin). Somente leitura: não há editar/apagar; o backend já ordena do mais
// recente para o mais antigo. A UI traduz a ação técnica via AUDIT_ACTION_LABEL.

const PAGE_SIZE = 20;

export default function AuditPage() {
  const [page, setPage] = useState(1);

  // Acesso restrito: a trilha expõe quem fez o quê em todo o workspace. Membros
  // comuns nem chegam a chamar a API (evita um 403 desnecessário).
  if (!isAdmin()) {
    return (
      <PageShell width="full">
        <AuditPageHeader />
        <Card>
          <p role="alert" className="text-sm text-ink/70">
            Apenas administradores podem ver a trilha de auditoria.
          </p>
        </Card>
      </PageShell>
    );
  }

  return <AuditContent page={page} onPage={setPage} />;
}

function AuditContent({ page, onPage }: { page: number; onPage: (p: number) => void }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["audit", page],
    queryFn: () => auditApi.list(page, PAGE_SIZE),
    // Mantém a página anterior visível durante a troca — sem "pulo" de layout.
    placeholderData: keepPreviousData,
  });

  const total = data?.total ?? 0;
  const items = data?.items ?? [];
  // Faixa exibida (1-based). Quando vazio, 0–0 de 0.
  const inicio = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const fim = Math.min(page * PAGE_SIZE, total);
  const temAnterior = page > 1;
  const temProxima = page * PAGE_SIZE < total;

  return (
    <PageShell width="full">
      <AuditPageHeader />

      {isLoading ? (
        <Card>
          <p className="text-sm text-ink/65">Carregando…</p>
        </Card>
      ) : isError ? (
        <Card>
          <p role="alert" className="text-sm text-ink/70">
            Não foi possível carregar a trilha de auditoria. Tente novamente.
          </p>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <p className="text-sm font-medium text-ink">Nenhuma ação registrada ainda.</p>
          <p className="mt-1 text-sm text-ink/65">
            As ações sensíveis (aprovações, conexões, convites) passam a aparecer aqui assim que
            acontecerem.
          </p>
        </Card>
      ) : (
        <>
          <Card className="p-0">
            <ul className="divide-y divide-ink/8">
              {items.map((e) => (
                <AuditRow key={e.id} entry={e} />
              ))}
            </ul>
          </Card>

          {/* Paginação */}
          <div className="mt-5 flex items-center justify-between gap-4">
            <p className="text-xs text-ink/65" aria-live="polite">
              {inicio}–{fim} de {total}
            </p>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => onPage(page - 1)}
                disabled={!temAnterior}
                aria-label="Página anterior"
              >
                Anterior
              </Button>
              <Button
                variant="ghost"
                onClick={() => onPage(page + 1)}
                disabled={!temProxima}
                aria-label="Próxima página"
              >
                Próxima
              </Button>
            </div>
          </div>
        </>
      )}

      <p className="mt-6 text-xs text-ink/65">
        Registro permanente, somente leitura — não é possível editar ou apagar uma entrada.
      </p>
    </PageShell>
  );
}

/** Uma linha da trilha: o que aconteceu, quem fez, sobre o quê e quando. */
function AuditRow({ entry }: { entry: AuditEntry }) {
  const label = AUDIT_ACTION_LABEL[entry.action] ?? entry.action;
  const quando = new Date(entry.occurredAt).toLocaleString("pt-BR");

  return (
    <li className="flex gap-3 px-6 py-3.5">
      {/* Marcador sóbrio, monocromático — apenas ancora a linha, sem semântica de cor. */}
      <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ink/25" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">
          <span className="font-medium">{label}</span>
          <span className="text-ink/65"> · {entry.actorEmail}</span>
        </p>
        <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs text-ink/65">
          <span className="break-all">{entry.target}</span>
          <span aria-hidden className="text-ink/25">·</span>
          <time dateTime={entry.occurredAt} className="tabular-nums">
            {quando}
          </time>
        </p>
      </div>
    </li>
  );
}

function AuditPageHeader() {
  return (
    <PageHeader
      eyebrow="Configurações"
      title="Trilha de auditoria"
      description="Registro permanente de quem fez cada ação sensível na sua conta — aprovações, conexões de conta, convites e mudanças de credenciais. Da mais recente para a mais antiga."
    />
  );
}
