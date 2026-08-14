"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usageApi, type UsageSummary } from "@/lib/usage";
import { Badge, Card, Field, PageHeader, PageShell, SectionLabel, Select } from "@/components/ui";

// C (ADR-0008): painel de Uso/Custo. Mostra o total do período, a quebra por marca e por
// motivo, e o status do cap mensal (Budget.MonthlyCapUsd). Todo custo é ESTIMADO (rotulado).

const PERIODOS = [
  { id: "7", label: "Últimos 7 dias" },
  { id: "30", label: "Últimos 30 dias" },
  { id: "90", label: "Últimos 90 dias" },
];

/** Formata um valor em USD com 2 casas (estimativa — não é fatura). */
function usd(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "USD" });
}

// C/Clareza (P1 leigo): o `reason` chega como SLUG de máquina do backend — "generate:carousel",
// "loop:idea" (fonte: GenerationCostService.ReasonFor = $"generate:{formato}" e AutonomousLoopJob
// Reason="loop:idea"). Um operador não-técnico não deve ler código. Relabel para PT-BR (UI nunca
// inventa dado — apenas traduz um enum conhecido); slug desconhecido cai no texto cru (não esconde).
const REASON_LABEL: Record<string, string> = {
  "generate:post": "Geração — Post",
  "generate:carousel": "Geração — Carrossel",
  "generate:story": "Geração — Story",
  "loop:idea": "Ideia autônoma (loop)",
};

function reasonLabel(raw: string): string {
  return REASON_LABEL[raw.toLowerCase()] ?? raw;
}

export default function UsagePage() {
  const [dias, setDias] = useState("30");

  // Janela calculada no cliente (ISO) — o backend default é 30 dias, mas mandamos explícito.
  const from = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - Number(dias));
    return d.toISOString();
  }, [dias]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["usage", dias],
    queryFn: () => usageApi.summary(from),
  });

  return (
    <PageShell width="full">
      <PageHeader
        eyebrow="Configurações"
        title="Uso e custo"
        description={
          <>
            Consumo estimado de IA por período. Os valores são uma{" "}
            <span className="font-medium text-ink">estimativa</span> (tokens × tabela de preço por
            modelo) — o provedor cobra pelas regras dele. Em modo simulado (sem chave) o custo é zero.
          </>
        }
      />

      <div className="mb-6 max-w-xs">
        <Field label="Período" hint="Intervalo do consumo estimado exibido abaixo.">
          <Select value={dias} onChange={(e) => setDias(e.target.value)}>
            {PERIODOS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {isLoading ? (
        <Card>
          <p className="text-sm text-ink/65">Carregando…</p>
        </Card>
      ) : isError ? (
        <Card>
          <p role="alert" className="text-sm text-ink/70">
            Não foi possível carregar o uso. Tente novamente.
          </p>
        </Card>
      ) : data ? (
        <UsageContent data={data} />
      ) : null}
    </PageShell>
  );
}

function UsageContent({ data }: { data: UsageSummary }) {
  const capDefinido = data.monthlyCapUsd > 0;
  const restante = data.monthlyCapUsd - data.spentThisMonthUsd;
  const estourou = capDefinido && restante < 0;

  return (
    <div className="space-y-6">
      {/* Total do período + cap mensal */}
      <Card>
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <SectionLabel>Total estimado no período</SectionLabel>
            <p className="mt-1 text-3xl font-medium tracking-tight">{usd(data.totalUsd)}</p>
          </div>
          <Badge tone="low">estimado</Badge>
        </div>

        <div className="mt-6 border-t border-ink/8 pt-5">
          <SectionLabel>Limite mensal</SectionLabel>
          {capDefinido ? (
            <div className="mt-2 space-y-1 text-sm">
              <p className="text-ink/70">
                Gasto neste mês: <span className="font-medium text-ink">{usd(data.spentThisMonthUsd)}</span> de{" "}
                <span className="font-medium text-ink">{usd(data.monthlyCapUsd)}</span>
              </p>
              <p className={estourou ? "font-medium text-red-500" : "text-ink/65"}>
                {estourou
                  ? `Limite mensal ultrapassado em ${usd(Math.abs(restante))}.`
                  : `Restam ${usd(restante)} no limite deste mês.`}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink/65">
              Nenhum limite mensal definido para a sua conta.
            </p>
          )}
        </div>
      </Card>

      {/* Quebra por marca */}
      <Card>
        <SectionLabel className="mb-4">Por marca</SectionLabel>
        {data.byBrand.length === 0 ? (
          <p className="text-sm text-ink/65">Nenhum gasto registrado no período.</p>
        ) : (
          <ul className="divide-y divide-ink/8">
            {data.byBrand.map((b) => (
              <li
                key={b.brandId ?? "sem-marca"}
                className="flex items-center justify-between py-2.5 text-sm"
              >
                <span className="text-ink/75">{b.brandName ?? "Sem marca"}</span>
                <span className="font-medium text-ink">{usd(b.totalUsd)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Quebra por motivo */}
      <Card>
        <SectionLabel className="mb-4">Por motivo</SectionLabel>
        {data.byReason.length === 0 ? (
          <p className="text-sm text-ink/65">Nenhum gasto registrado no período.</p>
        ) : (
          <ul className="divide-y divide-ink/8">
            {data.byReason.map((r) => (
              <li key={r.reason} className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-ink/75">{reasonLabel(r.reason)}</span>
                <span className="font-medium text-ink">{usd(r.totalUsd)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
