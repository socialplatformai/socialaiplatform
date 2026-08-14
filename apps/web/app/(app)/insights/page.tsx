"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { learningApi } from "@/lib/learning";
import { TYPE_LABEL } from "@/lib/pautas";
import { Badge, Button, Card, EmptyState, PageHeader, PageShell, SectionLabel, Skeleton } from "@/components/ui";
import { IconSparkles } from "@/components/icons";
import { PostsPerformance } from "@/components/insights/posts-performance";

// C3 (ADR-0009): tela de insights de aprendizado por workspace.
// bestFormat vem do backend como string ("post"/"carousel"/"story") — exibe legível.
// Mapa local (não usa TYPE_LABEL[index], que é indexado por enum int) com fallback ao texto cru.
const FORMAT_LABEL: Record<string, string> = {
  post: TYPE_LABEL[0], // Post
  carousel: TYPE_LABEL[1], // Carrossel
  story: TYPE_LABEL[2], // Story
};

function formatLabel(raw: string | null): string {
  if (!raw) return "—";
  return FORMAT_LABEL[raw.toLowerCase()] ?? raw;
}

export default function InsightsPage() {
  const { data: insights, isLoading, isError } = useQuery({
    queryKey: ["learning-insights"],
    queryFn: learningApi.insights,
  });
  // SoT "Desempenho": a tabela densa de posts (dado real por publicação).
  const postsQ = useQuery({ queryKey: ["learning-posts"], queryFn: learningApi.posts });
  const posts = postsQ.data ?? [];

  // C3/DEC-5: a amostra é toda (ou em parte) simulada quando não há token IG real. Rotular evita
  // que o operador confie em "aprendizado" sobre números sintéticos.
  const allMock =
    !!insights && !insights.insufficientData && insights.mockSampleCount >= insights.sampleSize;
  const someMock =
    !!insights && !insights.insufficientData && insights.mockSampleCount > 0;

  return (
    <PageShell width="full">
      <PageHeader
        eyebrow="Aprendizado"
        title="Desempenho"
        actions={someMock ? <Badge tone="low">{allMock ? "Simulado" : "Parcialmente simulado"}</Badge> : undefined}
      />

      {/* Título editorial híbrido da SoT (assinatura coesa). */}
      <div className="mb-8">
        <h2 className="font-sans text-4xl font-semibold leading-[1.05] tracking-tight text-ink sm:text-5xl">
          O que <em className="font-serif italic">funciona</em>.
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink/65">
          Cada post com suas métricas reais — e o padrão que emerge delas. Encadeie “gerar mais assim”.
        </p>
      </div>

      {isLoading && <Skeleton className="h-24 w-full" />}

      {/* ── A TABELA DENSA + small-multiples (SoT "Desempenho"): o protagonista. Dado real por post
          (GET /api/learning/posts). <3 amostras = medidor honesto, nunca gráfico vazio. ── */}
      <PostsPerformance
        loading={postsQ.isLoading}
        error={postsQ.isError}
        posts={posts}
      />

      {!isLoading && isError && (
        <Card>
          <p role="alert" className="text-sm text-ink/70">
            Não foi possível carregar os insights. Tente novamente.
          </p>
        </Card>
      )}

      {someMock && !isLoading && (
        <p className="mb-6 rounded-md bg-ink/5 p-3 text-sm text-ink/70">
          {allMock
            ? "Estes números são simulados (modo de demonstração, sem conta Instagram com métricas reais). Conecte uma conta e publique para ver dados reais."
            : `${insights!.mockSampleCount} de ${insights!.sampleSize} métricas ainda são simuladas — os padrões podem mudar conforme chegam dados reais.`}
        </p>
      )}

      {!isLoading && insights && insights.insufficientData && (
        // Empty state é MENSAGEM, não painel: largura contida (não estica a 1184px deixando
        // um card largo e oco). Os cards de DADOS abaixo, sim, preenchem a largura.
        <div className="max-w-xl">
          <EmptyState
            title="Ainda sem padrões confiáveis"
            description={`Publique pelo menos 3 conteúdos para a IA aprender o que funciona. Você tem ${insights.sampleSize} até agora.`}
          />
        </div>
      )}

      {!isLoading && insights && !insights.insufficientData && (
        <div className="space-y-6">
          {/* SOTA (blueprint + QA): cada insight é frase causal acionável, MAS com honestidade
              estatística — o tom é condicionado ao sampleSize. Abaixo de 10 publicações é
              "sinal inicial / tendência", não "faixa de pico" decretada. Isso elimina a
              contradição com a MasteryBar (que prega "padrões firmes só aos 10"). */}
          <div className="grid gap-4 lg:grid-cols-2">
            {(() => {
              const firme = insights.sampleSize >= 10; // limiar de "padrão firme" (MasteryBar)
              const hedge = firme ? "" : "Sinal inicial — ";
              return (
                <>
                  <InsightCard
                    label="Melhor formato"
                    value={formatLabel(insights.bestFormat)}
                    confidence={firme ? "Padrão firme" : "Tendência"}
                    causal={`${hedge}suas peças no formato ${formatLabel(insights.bestFormat).toLowerCase()} engajam em média ${Math.round(insights.bestFormatAvgEngagement)} por publicação${firme ? " — acima dos demais" : ", a maior média até aqui"}.`}
                    cta={{
                      href: insights.bestFormat ? `/create?type=${insights.bestFormat.toLowerCase()}` : "/create",
                      label: `Gerar um ${formatLabel(insights.bestFormat).toLowerCase()}`,
                    }}
                  />
                  <InsightCard
                    label="Melhor janela"
                    value={insights.bestWindow ?? "—"}
                    confidence={insights.bestWindow ? (firme ? "Padrão firme" : "Tendência") : undefined}
                    causal={
                      insights.bestWindow
                        ? `${hedge}publicar à ${insights.bestWindow.toLowerCase()} rendeu em média ${Math.round(insights.bestWindowAvgEngagement)} de engajamento${firme ? " — sua faixa de pico" : ", o melhor horário até aqui"}.`
                        : "Ainda reunindo dados de horário para indicar sua melhor janela."
                    }
                    cta={{
                      href: insights.bestWindow ? `/calendar?window=${encodeURIComponent(insights.bestWindow.toLowerCase())}` : "/calendar",
                      label: "Agendar nessa janela",
                    }}
                  />
                </>
              );
            })()}
          </div>

          {/* Maestria da IA: materializa "fica mais esperto a cada ciclo" de forma HONESTA —
              baseado em sampleSize REAL (não série temporal fabricada). Mostra onde o
              aprendizado está e o que mais volume destrava. */}
          <MasteryBar sampleSize={insights.sampleSize} bestFormat={insights.bestFormat} />
        </div>
      )}
    </PageShell>
  );
}

/** SOTA: insight como frase causal acionável (não número órfão). Valor grande (data-ink) +
 *  a razão ("X rende +Y") + 1 gancho de ação que fecha o loop aprender→fazer. */
function InsightCard({
  label,
  value,
  causal,
  cta,
  confidence,
}: {
  label: string;
  value: string;
  causal: string;
  cta: { href: string; label: string };
  // QA: etiqueta de confiança honesta — "Tendência" (amostra pequena) vs "Padrão firme" (≥10).
  confidence?: string;
}) {
  return (
    <Card className="flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>{label}</SectionLabel>
        {confidence && (
          <span className="rounded-pill bg-ink/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink/65">
            {confidence}
          </span>
        )}
      </div>
      <p className="mt-2 font-serif text-3xl leading-tight tracking-tight text-ink">{value}</p>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-ink/70">{causal}</p>
      <Link href={cta.href} className="mt-4 inline-block">
        <Button>
          <span className="mr-2 inline-flex">
            <IconSparkles size={16} />
          </span>
          {cta.label}
        </Button>
      </Link>
    </Card>
  );
}

/** Maestria da IA — "fica mais esperto a cada ciclo" tornado VISÍVEL e HONESTO. Usa o
 *  sampleSize REAL (não série temporal fabricada): mostra o estágio do aprendizado e o
 *  próximo marco que mais volume destrava. Tinta, sem cor (APEX sóbrio). */
function MasteryBar({ sampleSize, bestFormat }: { sampleSize: number; bestFormat: string | null }) {
  // Marcos honestos do aprendizado (limiares reais do PerformanceAnalyzer: ≥3 = 1ª recomendação).
  const MARCOS = [
    { n: 3, label: "Primeiras recomendações" },
    { n: 10, label: "Padrões de formato e janela firmes" },
    { n: 30, label: "Leitura fina do que funciona" },
  ];
  const teto = MARCOS[MARCOS.length - 1].n;
  const pct = Math.min(100, Math.round((sampleSize / teto) * 100));
  const proximo = MARCOS.find((m) => sampleSize < m.n);
  // F (fricção→ação): o caminho para o próximo marco é PUBLICAR mais. Fechamos o loop com um
  // atalho direto — gera o melhor formato aprendido (o dado já está aqui), sem voltar aos cards.
  const proxHref = bestFormat ? `/create?type=${bestFormat.toLowerCase()}` : "/create";
  const proxCta = bestFormat ? `Gerar um ${formatLabel(bestFormat).toLowerCase()}` : "Gerar conteúdo";

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SectionLabel>Maestria da IA</SectionLabel>
        <span className="text-sm text-ink/70">
          {sampleSize} {sampleSize === 1 ? "publicação aprendida" : "publicações aprendidas"}
        </span>
      </div>
      {/* trilho de progresso — preenchimento por tinta, marcos como divisores */}
      <div className="relative mt-3 h-2 w-full overflow-hidden rounded-pill bg-ink/10">
        <div className="h-full rounded-pill bg-ink transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-ink/65">
        {MARCOS.map((m) => (
          <span key={m.n} className={sampleSize >= m.n ? "font-medium text-ink" : ""}>
            {sampleSize >= m.n ? "✓ " : ""}
            {m.n}
          </span>
        ))}
      </div>
      <p className="mt-3 text-sm text-ink/70">
        {proximo ? (
          <>
            Faltam <span className="font-medium text-ink">{proximo.n - sampleSize}</span>{" "}
            {proximo.n - sampleSize === 1 ? "publicação" : "publicações"} para:{" "}
            <span className="font-medium text-ink">{proximo.label.toLowerCase()}</span>.
          </>
        ) : (
          <>A IA já tem leitura fina do que funciona para esta conta. Cada nova peça refina ainda mais.</>
        )}
      </p>
      {proximo && (
        <Link href={proxHref} className="mt-3 inline-block">
          <Button variant="ghost">
            <span className="mr-2 inline-flex">
              <IconSparkles size={16} />
            </span>
            {proxCta}
          </Button>
        </Link>
      )}
    </Card>
  );
}
