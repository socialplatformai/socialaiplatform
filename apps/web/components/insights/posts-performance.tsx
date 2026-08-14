"use client";

import Link from "next/link";
import { type PostMetric } from "@/lib/learning";
import { TYPE_LABEL } from "@/lib/pautas";
import { Badge, Button, Card, SectionLabel, Skeleton } from "@/components/ui";

// SoT "Desempenho" (Fatia 3) — a tabela densa de posts + small-multiples + medidor de amostra.
// Vive em components/ (não na page) porque o App Router proíbe export nomeado em page.tsx; assim a
// tela e o teste de componente importam do mesmo ponto. Dado REAL por publicação (PerformanceMetric).

const FORMAT_LABEL: Record<string, string> = {
  post: TYPE_LABEL[0],
  carousel: TYPE_LABEL[1],
  story: TYPE_LABEL[2],
};
function formatLabel(raw: string | null): string {
  if (!raw) return "—";
  return FORMAT_LABEL[raw.toLowerCase()] ?? raw;
}

/** A tabela densa de posts + small-multiples + medidor de amostra honesto.
 *  <3 amostras → medidor (não gráfico vazio). */
export function PostsPerformance({
  loading,
  error,
  posts,
}: {
  loading: boolean;
  error: boolean;
  posts: PostMetric[];
}) {
  if (loading) {
    return <Card className="mb-6"><SectionLabel>Posts</SectionLabel><Skeleton className="mt-3 h-48 w-full" /></Card>;
  }
  if (error) {
    return (
      <Card className="mb-6">
        <p role="alert" className="text-sm text-ink/70">Não foi possível carregar o desempenho dos posts.</p>
      </Card>
    );
  }
  // Honestidade (SoT): com <3 amostras, não há padrão — medidor de amostra, não tabela/gráfico oco.
  if (posts.length < 3) {
    return <SampleMeter have={posts.length} need={3} />;
  }

  const mockCount = posts.filter((p) => p.isMock).length;
  return (
    <div className="mb-6 space-y-6">
      {/* Small-multiples: engajamento médio por FORMATO e por JANELA (derivados da mesma lista real). */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SmallMultiple
          title="Engajamento por formato"
          groups={groupAvg(posts, (p) => formatLabel(p.type.toLowerCase()), (p) => p.engagement)}
        />
        <SmallMultiple
          title="Engajamento por janela"
          groups={groupAvg(posts, (p) => p.window, (p) => p.engagement)}
        />
      </div>

      {/* A tabela densa. tabular-nums p/ colunas numéricas alinharem (Tufte: densidade legível). */}
      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between px-5 pt-5">
          <SectionLabel>Posts ({posts.length})</SectionLabel>
          {mockCount > 0 && <Badge tone="low">{mockCount === posts.length ? "Simulado" : `${mockCount} simulado(s)`}</Badge>}
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-y border-ink/8 text-left text-[11px] uppercase tracking-wider text-ink/65">
                <th className="px-5 py-2 font-medium">Post</th>
                <th className="px-3 py-2 text-right font-medium">Alcance</th>
                <th className="px-3 py-2 text-right font-medium">Engaj.</th>
                <th className="px-3 py-2 text-right font-medium">Likes</th>
                <th className="px-3 py-2 text-right font-medium">Saves</th>
                <th className="px-3 py-2 text-right font-medium">Qual.</th>
                <th className="px-5 py-2 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {posts.map((p) => (
                <tr key={p.contentId} className="border-b border-ink/5 transition-colors hover:bg-ink/[0.02]">
                  <td className="max-w-[260px] px-5 py-2.5">
                    <span className="block truncate text-ink/85">{p.caption?.trim() || "Sem legenda"}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink/65">
                      {formatLabel(p.type.toLowerCase())} · {p.window}
                      {p.isMock && <span className="rounded bg-ink/5 px-1 text-[10px] text-ink/65">sim.</span>}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink/80">{p.reach.toLocaleString("pt-BR")}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-medium text-ink">{p.engagement.toLocaleString("pt-BR")}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink/80">{p.likes.toLocaleString("pt-BR")}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink/80">{p.saves.toLocaleString("pt-BR")}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink/70">{p.qualityScore ?? "—"}</td>
                  <td className="px-5 py-2.5 text-right">
                    {/* Cada linha encadeia "Gerar mais assim" (SoT): deep-link c/ o formato vencedor. */}
                    <Link
                      href={`/create?type=${p.type.toLowerCase()}`}
                      className="whitespace-nowrap text-xs font-medium text-ink/65 underline-offset-2 hover:text-ink hover:underline"
                    >
                      Gerar mais assim →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/** Small-multiple: barras horizontais de média por grupo (formato/janela). Tinta, sem cor (APEX). */
function SmallMultiple({ title, groups }: { title: string; groups: { key: string; avg: number; n: number }[] }) {
  const max = Math.max(1, ...groups.map((g) => g.avg));
  return (
    <Card>
      <SectionLabel>{title}</SectionLabel>
      <div className="mt-3 space-y-2.5">
        {groups.map((g) => (
          <div key={g.key} className="flex items-center gap-3">
            <span className="w-20 shrink-0 truncate text-xs text-ink/70">{g.key}</span>
            <div className="h-5 flex-1 overflow-hidden rounded-sm bg-ink/[0.06]">
              <div
                className="h-full rounded-sm bg-ink/70"
                style={{ width: `${Math.max(4, Math.round((g.avg / max) * 100))}%` }}
                title={`${g.key}: média ${Math.round(g.avg)} (${g.n} post${g.n === 1 ? "" : "s"})`}
              />
            </div>
            <span className="w-12 shrink-0 text-right text-xs tabular-nums font-medium text-ink">{Math.round(g.avg)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Medidor de amostra honesto (SoT): com <N posts, mostra o progresso — nunca gráfico vazio. */
function SampleMeter({ have, need }: { have: number; need: number }) {
  return (
    <Card className="mb-6">
      <SectionLabel>Amostra de desempenho</SectionLabel>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-pill bg-ink/10">
          <div className="h-full rounded-pill bg-ink transition-[width] duration-500" style={{ width: `${Math.round((have / need) * 100)}%` }} />
        </div>
        <span className="text-sm tabular-nums font-medium text-ink">{have}/{need}</span>
      </div>
      <p className="mt-3 text-sm text-ink/70">
        Publique pelo menos <span className="font-medium text-ink">{need}</span> conteúdos para a tabela de
        desempenho e os padrões aparecerem. Você tem <span className="font-medium text-ink">{have}</span> até agora —
        sem dado suficiente, não mostramos gráfico vazio.
      </p>
      <Link href="/create" className="mt-4 inline-block">
        <Button>Gerar conteúdo</Button>
      </Link>
    </Card>
  );
}

/** Agrupa por chave e calcula a média de um valor — base dos small-multiples. Ordenado desc. */
function groupAvg(posts: PostMetric[], keyFn: (p: PostMetric) => string, valFn: (p: PostMetric) => number) {
  const map = new Map<string, { sum: number; n: number }>();
  for (const p of posts) {
    const k = keyFn(p);
    const cur = map.get(k) ?? { sum: 0, n: 0 };
    cur.sum += valFn(p);
    cur.n += 1;
    map.set(k, cur);
  }
  return [...map.entries()]
    .map(([key, v]) => ({ key, avg: v.sum / v.n, n: v.n }))
    .sort((a, b) => b.avg - a.avg);
}
