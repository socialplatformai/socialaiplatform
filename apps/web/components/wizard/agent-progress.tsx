"use client";

import { IconCheck, IconAlert } from "@/components/icons";

// R5a — Visualização AI-NATIVA do pipeline de 6 agentes. Antes era "barra + checklist"
// (parecia spinner de 2010). Agora cada agente comunica O QUE FAZ em linguagem humana,
// revelado em streaming, com staging de motion (Disney-12) e voz calma (Claude/PAIR):
// o operador entende a inteligência do sistema, não só que "algo está carregando".
// Sub-council Agent-UX: HAX (expor progresso/incerteza) + Apple HIG-ML (colaborador) +
// Val Head (motion com propósito). Acessível: o agente ativo é anunciado a leitores de tela.
//
// Mantém o MESMO contrato de props (step/progress/error) — sem mudança no wizard.

// Os 6 agentes na ordem do pipeline (espelha services/agents PipelineAgentId) + a "fala"
// de cada um: o que ele faz, em 1ª pessoa calma. Mostra a substância do pipeline.
// `minProgress` = % em que este agente começa (espelha os marcos de onProgress em pipeline-v2.ts:
// 5 estrategista · 18 arquiteto · 35 copywriter · 55 compositor · 70 imagem · 85 validador).
// É o sinal ROBUSTO de estágio: job.step às vezes carrega o id do agente, às vezes a mensagem
// de progresso (em inglês) — então casar só por id falhava e o stepper "travava" no 1º agente.
// O progresso é language-neutral e monotônico → fonte de verdade do estágio ativo.
const AGENTS = [
  { id: "brand-strategist", label: "Estrategista de marca", thought: "Lendo sua marca e escolhendo o arco narrativo.", minProgress: 0 },
  { id: "story-architect", label: "Arquiteto da narrativa", thought: "Desenhando o roteiro slide a slide.", minProgress: 18 },
  { id: "copywriter", label: "Copywriter", thought: "Escrevendo a copy na voz da sua marca.", minProgress: 35 },
  { id: "visual-compositor", label: "Compositor visual", thought: "Compondo o layout de cada slide.", minProgress: 55 },
  { id: "image-generator", label: "Gerador de imagem", thought: "Criando a textura visual.", minProgress: 70 },
  { id: "quality-validator", label: "Validador de qualidade", thought: "Revisando técnica e tom antes de entregar.", minProgress: 82 },
];

/** Índice do agente ativo. Prioriza o casamento por id (quando job.step traz o id cru do agente);
 *  senão, usa o PROGRESSO (robusto, monotônico, language-neutral) — o último agente cujo limiar
 *  o progresso já cruzou. Evita o bug de travar no agente 0 quando step é uma mensagem em inglês. */
function resolveActiveIndex(step: string | null, progress: number): number {
  const byId = AGENTS.findIndex((a) => step === a.id || step?.startsWith(a.id) || step?.includes(a.id));
  if (byId >= 0) return byId;
  let idx = 0;
  for (let i = 0; i < AGENTS.length; i++) if (progress >= AGENTS[i].minProgress) idx = i;
  return idx;
}

export function AgentProgress({
  step,
  progress,
  error,
}: {
  step: string | null;
  progress: number;
  error?: string | null;
}) {
  const activeIndex = resolveActiveIndex(step, progress);
  const done = progress >= 100 && !error;
  const active = !error && !done ? (activeIndex >= 0 ? AGENTS[activeIndex] : AGENTS[0]) : null;

  // Manchete que lê como o SISTEMA pensando (calma, não "Carregando 47%").
  const headline = error
    ? "A geração encontrou um problema"
    : done
      ? "Pronto — seu conteúdo está montado"
      : active
        ? active.thought
        : "Preparando os agentes…";

  return (
    <div className="space-y-5">
      {/* Manchete viva + leitura percentual discreta */}
      <div>
        <div className="flex items-baseline justify-between gap-3">
          {/* Visual apenas: o anúncio a leitor de tela vem do role=status sr-only abaixo
              (evita anúncio duplo). */}
          <p className="text-lg font-medium tracking-tight text-ink">{headline}</p>
          {!error && (
            <span className="shrink-0 text-sm tabular-nums text-ink/65">{Math.round(progress)}%</span>
          )}
        </div>
        {/* Trilho de progresso — fino, calmo, com easing tokenizado */}
        <div
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progresso da geração"
          className="mt-2 h-1 overflow-hidden rounded-pill bg-ink/10"
        >
          <div
            className="h-full rounded-pill bg-ink"
            style={{
              width: `${error ? 100 : progress}%`,
              backgroundColor: error ? "var(--color-danger)" : undefined,
              transition: "width var(--duration-slow) var(--ease-standard)",
            }}
          />
        </div>
      </div>

      {/* Os 6 agentes como pensamento legível — o ativo respira + revela sua fala */}
      <ul className="space-y-1" aria-label="Pipeline de agentes">
        {AGENTS.map((a, i) => {
          const isActive = !error && !done && i === activeIndex;
          const isDone = done || (activeIndex > i && activeIndex >= 0) || (progress >= 100);
          return (
            <li
              key={a.id}
              className="flex items-start gap-3 rounded-md px-3 py-2 transition-colors"
              style={{
                backgroundColor: isActive ? "var(--color-canvas-2)" : "transparent",
                transitionDuration: "var(--duration-base)",
              }}
            >
              {/* Indicador de estado: check (feito) · ponto respirando (ativo) · ponto apagado */}
              <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden>
                {isDone ? (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ink/15 text-ink">
                    <IconCheck size={11} />
                  </span>
                ) : isActive ? (
                  <span className="apex-breathe block h-2 w-2 rounded-full bg-ink" />
                ) : (
                  <span className="block h-2 w-2 rounded-full bg-ink/20" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-medium ${
                    isActive ? "text-ink" : isDone ? "text-ink/65" : "text-ink/65"
                  }`}
                >
                  {a.label}
                </p>
                {/* A "fala" do agente ativo entra em streaming (fade+slide) */}
                {isActive && (
                  <p className="apex-stream-in mt-0.5 text-xs text-ink/65">{a.thought}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Estado de erro — claro, acionável, com a tradução PT-BR honesta */}
      {error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-md bg-danger/10 p-3 text-sm text-danger dark:text-danger-on-dark">
          <span className="mt-0.5 shrink-0"><IconAlert size={15} /></span>
          <span>{friendlyGenError(error)}</span>
        </div>
      )}

      {/* Anúncio a leitor de tela do agente ativo (T1 — status anunciado) */}
      <span className="sr-only" role="status" aria-live="polite">
        {error
          ? "Erro na geração."
          : done
            ? "Geração concluída."
            : active
              ? `${active.label}: ${active.thought}`
              : "Iniciando."}
      </span>
    </div>
  );
}

// Traduz erros técnicos do pipeline em mensagens compreensíveis ao usuário.
// IMPORTANTE: só afirmar que "o texto foi criado" quando o erro é especificamente
// de geração de imagem — os agentes de texto rodam antes e já concluíram nesse caso.
// Para erros genéricos não assumimos o que foi ou não gerado (honestidade de UX, S-25).
export function friendlyGenError(error: string): string {
  const e = error.toLowerCase();
  // PRIMEIRO (maior especificidade): chave/config de IA ausente — o pipeline nem rodou,
  // NADA foi gerado. Não pode cair no ramo de imagem (que insinua "conteúdo salvo").
  if (e.includes("ausente") || e.includes("api_key") || e.includes(".env") || e.includes("não configurad"))
    return "Falta configurar a chave de IA. Nenhum conteúdo foi gerado — adicione a chave em Configurações › IA e tente novamente.";
  // Erro só de IMAGEM: os agentes de texto já concluíram; o render usa fundo provisório.
  // (Termos inequívocos de imagem/render — sem 'provider'/'api key', que pegavam erro de config.)
  if (e.includes("image") || e.includes("render"))
    return "A geração de imagem encontrou um problema. O conteúdo pode ter sido salvo com fundo provisório — verifique o resultado antes de publicar.";
  if (e.includes("gemini") || e.includes("provider"))
    return "O serviço de IA está temporariamente indisponível. Tente novamente em alguns instantes.";
  if (e.includes("timeout") || e.includes("timed out"))
    return "A geração demorou mais que o esperado. Tente novamente em instantes.";
  return "Não foi possível concluir a geração agora. Tente novamente.";
}
