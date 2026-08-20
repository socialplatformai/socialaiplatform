"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { pautaApi, TYPE_LABEL } from "@/lib/pautas";
import { contentApi, type Content, type BriefingPreview, type CreativeInput } from "@/lib/content";
import { brandApi } from "@/lib/brand";
import { settingsApi } from "@/lib/settings";
import { isAdmin } from "@/lib/api";
import { approvalApi, scheduleApi, Frequency, FREQUENCY_OPTIONS } from "@/lib/workflow";
import { Button, Card, Field, FlowFrame, Input, PageHeader, PageShell, SectionLabel, Select, Textarea } from "@/components/ui";
import { validate } from "@/lib/validate";
import { IconCheck } from "@/components/icons";
import { toast } from "@/components/toast";
import { StepIndicator } from "@/components/wizard/step-indicator";
import { AgentProgress } from "@/components/wizard/agent-progress";
import { LivePreview } from "@/components/wizard/live-preview";
import { SlideCarousel } from "@/components/slide-canvas";
import { TemplateGallery } from "@/components/template-gallery";
import { templateApi, templateName } from "@/lib/templates";
import { learningApi } from "@/lib/learning";

// CUS/SOTA (pesquisa citada — Jasper/Copy.ai/Canva Magic + NN/G): o fluxo era 6 passos FRIOS com
// nomes do SISTEMA (Origem·Formato·Template·Revisar·Gerar·Resultado). A tarefa aqui é "1 brief claro,
// custo baixo de erro" → a regra de complexidade manda BRIEF-FIRST, não stepper longo. Colapsamos os
// 3 passos de entrada (origem+formato+template) num ÚNICO "Briefing" onde o formato é PROPOSTO
// (default validável, não dropdown vazio) e o template fica em disclosure progressivo ("IA escolhe"
// por default). Nomes de passo viram palavras do USUÁRIO. 6 passos → 3 fases (Briefing→Revisar→Gerar).
// SoT "Gerar Conteudo v2": o rail FLUXO mostra as 4 FASES com sub-rótulo (palavra do usuário +
// o que aquela fase faz). Resultado deixa de ser "cauda visível de Gerar" e ganha seu degrau no rail.
const STEPS: { label: string; sub: string }[] = [
  { label: "Briefing", sub: "Origem e formato" },
  { label: "Revisar", sub: "Proposta da IA" },
  { label: "Gerar", sub: "6 agentes" },
  { label: "Resultado", sub: "Aprovar e agendar" },
];

// Mapa interno de fases (o state `step` segue inteiro para preservar o boot/poll já testado):
//   0 = Briefing (origem + formato proposto + template opcional)
//   1 = Revisar  (o que a IA vai receber + custo)
//   2 = Gerar    (poll ao vivo dos 6 agentes)
//   3 = Resultado
const PHASE = { BRIEFING: 0, REVISAR: 1, GERAR: 2, RESULTADO: 3 } as const;

// T (P5 volta-depois): chave do rascunho do wizard no localStorage. Só pré-geração (passos 0–3).
const DRAFT_KEY = "sap_create_draft";

// FASE 0: monta o creativeInput do payload a partir do state do wizard — só os campos preenchidos
// (apara espaços; vazio vira undefined). Retorna undefined quando TUDO está vazio → o payload omite
// o objeto (a API também poda, mas evitamos enviar lixo). Mantém a geração atual intacta sem direção.
function buildCreativeInput(c: { referenceUrl: string; backgroundUrl: string; cta: string; subtitle: string }): CreativeInput | undefined {
  const out: CreativeInput = {};
  if (c.referenceUrl.trim()) out.referenceUrl = c.referenceUrl.trim();
  if (c.backgroundUrl.trim()) out.backgroundUrl = c.backgroundUrl.trim();
  if (c.cta.trim()) out.cta = c.cta.trim();
  if (c.subtitle.trim()) out.subtitle = c.subtitle.trim();
  return Object.keys(out).length > 0 ? out : undefined;
}

type Origin = "pauta" | "theme";

type WizardDraft = { step?: number; origin?: Origin; pautaId?: string; theme?: string; format?: number | null; templateKey?: string | null; useLogoIdentity?: boolean; creative?: { referenceUrl: string; backgroundUrl: string; cta: string; subtitle: string } };

// T (P5 volta-depois): lê o rascunho do localStorage UMA vez, de forma SÍNCRONA, para inicializar
// o state já correto no 1º render (evita a corrida restore-vs-persist de um useEffect tardio — bug
// pego no pixel). Params de URL VENCEM o rascunho (a decisão via link é mais recente/intencional):
// se há ?pauta=/?type=/?contentId, ignoramos o rascunho. SSR-safe (sem window → null).
function readWizardDraft(): WizardDraft | null {
  if (typeof window === "undefined") return null;
  const p = new URLSearchParams(window.location.search);
  if (p.get("pauta") || p.get("type") || p.get("contentId")) return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as WizardDraft;
    const temReal = !!d && (d.theme || d.pautaId || d.format != null || d.origin === "theme");
    return temReal ? d : null;
  } catch { return null; }
}

export default function CreatePage() {
  // Lê o rascunho UMA vez (lazy) — usado para inicializar cada campo já no 1º render.
  const draft0Ref = useRef<WizardDraft | null | undefined>(undefined);
  if (draft0Ref.current === undefined) draft0Ref.current = readWizardDraft();
  const d0 = draft0Ref.current;

  // Pré-geração agora é uma fase só (Briefing=0). Rascunho de versões antigas (step 0..3) cai em 0.
  const [step, setStep] = useState<number>(() => (d0 && d0.step === 0 ? 0 : 0));
  const [origin, setOrigin] = useState<Origin>(() => (d0?.origin === "theme" ? "theme" : "pauta"));
  const [pautaId, setPautaId] = useState(() => d0?.pautaId ?? "");
  const [theme, setTheme] = useState(() => d0?.theme ?? "");
  // CUS/SOTA — PROPOR > pedir (NN/G: pré-preencher pra VALIDAR > pedir do zero). O formato mais
  // comum (Carrossel=1) vem PRÉ-SELECIONADO; o operador valida ou troca inline no Briefing — em vez
  // de um passo dedicado com 3 cards vazios. A proposta é VISÍVEL e reversível (não default silencioso:
  // o seletor de formato fica à vista no Briefing). Rascunho antigo com formato salvo vence.
  const [format, setFormat] = useState<number>(() => (d0 && d0.format != null ? d0.format : 1));
  // F6/B1: template escolhido na galeria. null = "deixar a IA escolher" (default, não-regressão).
  const [templateKey, setTemplateKey] = useState<string | null>(() => d0?.templateKey ?? null);
  // Toggle "usar identidade do logo": estampa o logo da marca nos slides. Default false (não-regressão).
  const [useLogoIdentity, setUseLogoIdentity] = useState<boolean>(() => d0?.useLogoIdentity ?? false);
  // FASE 0: direção criativa por-geração (referência/fundo por URL + CTA + subtítulo). Tudo opcional;
  // vazio = comportamento atual. Persistido no rascunho como o restante do Briefing.
  const [creative, setCreative] = useState<{ referenceUrl: string; backgroundUrl: string; cta: string; subtitle: string }>(
    () => d0?.creative ?? { referenceUrl: "", backgroundUrl: "", cta: "", subtitle: "" },
  );

  // Estado da geração async
  const [job, setJob] = useState<{ jobId: string; contentId: string } | null>(null);
  const [result, setResult] = useState<Content | null>(null);

  const { data: pautas = [], isFetched: pautasFetched } = useQuery({ queryKey: ["pautas", "wizard"], queryFn: () => pautaApi.list() });
  // I (tese central — propor, não pedir): a fila priorizada diz QUAL pauta a IA geraria a seguir.
  // O wizard abria pedindo "Selecione…" (formulário) mesmo já sabendo a próxima. Aqui carregamos a
  // fila para PROPOR a próxima (1 clique pra aceitar) — sem auto-selecionar (herança "sem default
  // silencioso"): a proposta é visível e reversível (o Select continua para trocar).
  const { data: queue = [] } = useQuery({ queryKey: ["pautas", "queue", "wizard"], queryFn: () => pautaApi.queue() });
  const proposedPauta = queue[0];

  // Loop "aprende→gera": o sistema MEDIA o formato que performa
  // (insights.bestFormat) mas a UI ignorava — o default era cravado em Carrossel. Aqui carregamos
  // os insights e, quando há um vencedor confiável (amostra ≥3), PRÉ-SELECIONAMOS esse formato e
  // ROTULAMOS o porquê ("recomendado pelo que performou"). É proposta visível e reversível (não
  // default silencioso). bestFormat ("Post"/"Carousel"/"Story") → índice (ContentType: Post=0…).
  const { data: insights } = useQuery({ queryKey: ["learning-insights", "wizard"], queryFn: learningApi.insights });
  const formatToIndex = (raw?: string | null): number | null => {
    const bf = raw?.toLowerCase();
    if (!bf) return null;
    if (bf.includes("post")) return 0;
    if (bf.includes("carousel") || bf.includes("carrossel")) return 1;
    if (bf.includes("story")) return 2;
    return null;
  };
  // A7: recomendação por PERFORMANCE real (dado de publicação). A8: fallback PROVISÓRIO pela qualidade
  // das peças quando não há performance ainda (todo workspace fresco) — rotulado distinto p/ não
  // confundir provisório com aprendizado real. Performance vence quando existe.
  const perfFormat = !insights?.insufficientData ? formatToIndex(insights?.bestFormat) : null;
  const provisionalFormat = insights?.insufficientData ? formatToIndex(insights?.provisionalBestFormat) : null;
  const recommendedFormat: number | null = perfFormat ?? provisionalFormat;
  const recommendationKind: "performance" | "provisional" | null =
    perfFormat != null ? "performance" : provisionalFormat != null ? "provisional" : null;

  // Leigo sem pautas: oferecer "Escolher pauta" (lista vazia) é um beco — ele trava.
  // Quando carregou e não há nenhuma pauta (e não veio via ?pauta=), o caminho óbvio é
  // "Tema livre". Só muda o default uma vez, no passo 0, sem atrapalhar quem escolheu.
  const themedDefaultRef = useRef(false);
  useEffect(() => {
    if (themedDefaultRef.current || !pautasFetched || step !== 0) return;
    const cameWithPauta = new URLSearchParams(window.location.search).get("pauta");
    if (!cameWithPauta && pautas.length === 0) {
      setOrigin("theme");
      themedDefaultRef.current = true;
    }
  }, [pautasFetched, pautas.length, step]);

  // A7: aplica o formato recomendado UMA vez, e só quando o usuário ainda não decidiu — rascunho
  // salvo, deep-link ?type= ou troca manual vencem (sem sobrescrever escolha). Fecha o loop sem
  // roubar o controle: a recomendação é o ponto de partida, não uma trava.
  // BUG (corrigido): os insights chegam ASSÍNCRONOS — recommendedFormat resolvia DEPOIS do clique
  // nas chips, e a guarda antiga (`userJaEscolheu`) só olhava rascunho/?type=, NÃO o clique. Resultado:
  // a reco (sempre Carrossel = o que "performou") sobrescrevia "Post"/"Story" e o operador gerava
  // carrossel de 7 slides sem ter pedido. userDecidedRef registra o clique manual (setado no onClick
  // da chip) → a reco nunca mais sobrepõe uma escolha explícita. É o que a linha 138 já PRETENDIA.
  const userDecidedRef = useRef(false);
  const recoAppliedRef = useRef(false);
  useEffect(() => {
    if (recoAppliedRef.current || recommendedFormat == null) return;
    const params = new URLSearchParams(window.location.search);
    const userJaEscolheu = userDecidedRef.current || (d0 && d0.format != null) || params.has("type");
    if (!userJaEscolheu) setFormat(recommendedFormat);
    recoAppliedRef.current = true;
  }, [recommendedFormat]);

  // R3 — pauta → "Gerar" em 1 clique: /create?pauta=<id> pré-seleciona a pauta e o origin,
  // matando o re-seleciona-no-Select. Lê do URL no client (rota é client-guarded; sem Suspense).
  // C3 — insights → "Gerar mais assim": /create?type=carousel pré-seleciona o formato
  // (fecha o loop aprender→gerar: o que performou melhor já vem escolhido).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // B1 (P5/Confiança) — RETOMAR uma geração JÁ EM VOO. O editor (content/[id]) dispara
    // regenerar/variações — que já COBRARAM e devolveram {contentId, jobId} — e navega para cá.
    // Sem ler esses params, o operador caía no passo 0 vazio, sem poll: pagava e a geração
    // sumia (dado órfão). Aqui o boot detecta o job em andamento, monta o estado e pula direto
    // para "Gerar" (passo 4), onde o GeneratePoll mostra os 6 agentes ao vivo. Se a geração já
    // tiver terminado enquanto navegava, o poll vê "done" e segue para o Resultado naturalmente.
    // Precedência: um job em voo vence qualquer ?pauta=/?type= (a decisão já foi tomada e paga).
    // Exige AMBOS contentId+jobId (um só = URL malformada → ignora, segue fluxo normal).
    const contentId = params.get("contentId");
    const jobId = params.get("jobId");
    if (contentId && jobId) {
      setJob({ contentId, jobId });
      setStep(PHASE.GERAR);
      return;
    }

    const pid = params.get("pauta");
    if (pid) {
      setOrigin("pauta");
      setPautaId(pid);
    }
    const typeParam = params.get("type");
    let hasType = false;
    if (typeParam) {
      const idx: Record<string, number> = { post: 0, carousel: 1, story: 2 };
      const f = idx[typeParam.toLowerCase()];
      if (f !== undefined) { setFormat(f); hasType = true; }
    }
    // QA/Fricção (P2): MODO EXPRESSO REAL. Quando a decisão já vem completa pela URL
    // (pauta + formato — vindo do dashboard/insights/pautas), pular direto para REVISAR.
    // O briefing + custo carregam e o botão "Gerar" fica a 1 clique — em vez de obrigar
    // o operador a passar pelo Briefing cuja resposta já foi dada. Quem entra sem
    // params completos segue o fluxo manual normal a partir do Briefing.
    if (pid && hasType) setStep(PHASE.REVISAR);
    // (A retomada do rascunho NÃO vive aqui: foi inicializada de forma síncrona no useState lazy
    //  acima — readWizardDraft() — para não correr contra o persist. Aqui só o aviso honesto.)
  }, []);

  // T (P5): aviso HONESTO de retomada — a persona sabe que o sistema lembrou (Norman: feedback).
  // Dispara uma vez se o state nasceu de um rascunho (d0 != null). StrictMode dupla-invoca effects
  // em dev; o ref garante 1 toast só.
  const draftToastedRef = useRef(false);
  useEffect(() => {
    if (d0 && !draftToastedRef.current) {
      draftToastedRef.current = true;
      toast.info("Rascunho retomado de onde você parou.");
    }
  }, []);

  // T (P5): PERSISTE o rascunho a cada mudança do pré-geração (passos 0–3). Como o state já nasce
  // do rascunho (lazy init), persistir no 1º render apenas regrava o mesmo valor — sem corrida.
  // A partir de "Gerar" (passo 4) a recuperação é via ?contentId+jobId (job já pago).
  useEffect(() => {
    if (step > PHASE.BRIEFING) return; // só o Briefing é rascunhável (Revisar+ já decidiu)
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ step, origin, pautaId, theme, format, templateKey, useLogoIdentity, creative }));
    } catch { /* quota/privado → ignora */ }
  }, [step, origin, pautaId, theme, format, templateKey, useLogoIdentity, creative]);
  const { data: kit } = useQuery({ queryKey: ["brand-kit"], queryFn: brandApi.getKit });
  // F6/B1: galeria de template (lazy seed no backend). Carrega sempre — barato e cacheado.
  const { data: templates = [], isLoading: templatesLoading, isError: templatesError } = useQuery({
    queryKey: ["templates"],
    queryFn: templateApi.list,
  });

  // F6/B3: objetivo de marketing da pauta selecionada → destaca o template recomendado.
  const selectedPauta = origin === "pauta" ? pautas.find((p) => p.id === pautaId) : undefined;
  const objective = selectedPauta?.marketingObjective ?? null;

  // Briefing → Revisar: basta a ORIGEM válida (formato já vem proposto; template é opcional).
  const briefingReady = origin === "pauta" ? !!pautaId : theme.trim().length > 2;

  const start = useMutation({
    mutationFn: () =>
      contentApi.generateAsync({
        pautaId: origin === "pauta" ? pautaId : undefined,
        theme: origin === "theme" ? theme : undefined,
        format, // sempre definido (proposto no Briefing, validável)
        templateKey: templateKey ?? undefined, // F6/B1: força o template escolhido (ausente = IA escolhe)
        useLogoIdentity: useLogoIdentity || undefined, // estampar o logo da marca (ausente = não)
        creativeInput: buildCreativeInput(creative), // FASE 0: direção criativa (undefined se tudo vazio)
      }),
    onSuccess: (r) => {
      setJob(r);
      setResult(null);
      setStep(PHASE.GERAR); // → Gerar
      // T (P5): o rascunho foi CONSUMIDO (virou geração paga) — limpa para não re-propor
      // um rascunho velho na próxima visita. A recuperação a partir daqui é via ?contentId+jobId.
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    },
  });

  function goGenerate() {
    start.mutate();
  }

  // SoT "Gerar Conteudo v2" — título editorial híbrido por fase: o termo-chave em serif itálico
  // (Satoshi + Instrument Serif). Comunica a FASE como uma frase, não um rótulo de sistema.
  const phaseHero: Record<number, { eyebrow: string; lead: ReactNode; sub: string }> = {
    [PHASE.BRIEFING]: {
      eyebrow: "Briefing",
      lead: <>Transformar ideia em <em className="font-serif italic">{["post", "carrossel", "story"][format] ?? "conteúdo"}</em>.</>,
      sub: "A IA propõe ângulo, template e estrutura a partir daqui. A prévia ao lado se forma em tempo real.",
    },
    [PHASE.REVISAR]: {
      eyebrow: "Revisar",
      lead: <>Revisar a <em className="font-serif italic">proposta</em>.</>,
      sub: "A IA montou isto a partir do seu briefing. Ajuste antes de gerar — a prévia ao lado é o que será criado.",
    },
    [PHASE.GERAR]: {
      eyebrow: "Gerar",
      lead: <>Os 6 agentes <em className="font-serif italic">trabalhando</em>.</>,
      sub: "Cada agente decide uma camada da peça. Acompanhe ao vivo — a prévia aparece quando ficar pronta.",
    },
    [PHASE.RESULTADO]: {
      eyebrow: "Resultado",
      lead: <>Pronto para <em className="font-serif italic">publicar</em>.</>,
      sub: "Reveja a peça, ajuste a legenda e aprove. Depois é só agendar.",
    },
  };
  const hero = phaseHero[step] ?? phaseHero[PHASE.BRIEFING];

  // Prévia ao vivo (aside persistente): proposta (gradiente da marca) antes de gerar; slides REAIS
  // depois. Estado (rascunho/proposta/pronto) reflete a fase — nada hardcoded.
  const previewBadge =
    step === PHASE.RESULTADO ? <PreviewBadge tone="ready">pronto</PreviewBadge>
      : step === PHASE.REVISAR ? <PreviewBadge tone="active">proposta</PreviewBadge>
        : <PreviewBadge tone="draft">rascunho</PreviewBadge>;

  const aside = (
    <PreviewAside
      result={step === PHASE.RESULTADO ? result : null}
      format={format}
      proposalTitle={origin === "pauta" ? pautas.find((p) => p.id === pautaId)?.title : (theme || undefined)}
      badge={previewBadge}
      // O custo/avisos só fazem sentido antes de gerar (Briefing/Revisar).
      showContext={step <= PHASE.REVISAR}
      pautaId={origin === "pauta" ? pautaId : undefined}
      theme={origin === "theme" ? theme : undefined}
      kitMissing={!kit?.tone && !kit?.editorialGuidelines}
    />
  );

  return (
    // App-frame full (UX-SPEC §1 — nunca coluna centrada estreita). O frame de 3 zonas (rail FLUXO +
    // conteúdo + prévia) é a SoT; a largura por-fase antiga sai (o FlowFrame já organiza o espaço).
    <PageShell width="full" className="pb-28">
      <PageHeader
        eyebrow={hero.eyebrow}
        title="Gerar conteúdo"
      />

      <FlowFrame
        railLabel="Etapas da geração"
        asideLabel="Prévia da peça"
        rail={<StepIndicator steps={STEPS} current={step} orientation="vertical" />}
        aside={aside}
      >
        {/* Título editorial híbrido da fase (Satoshi + serif itálico no termo-chave). */}
        <div className="mb-8">
          <h2 className="font-sans text-4xl font-semibold leading-[1.05] tracking-tight text-ink sm:text-5xl">
            {hero.lead}
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink/65">{hero.sub}</p>
        </div>

        {/* FASE 1 — BRIEFING (origem + formato proposto + template opcional) */}
        {step === PHASE.BRIEFING && (
          <BriefingStep
            origin={origin}
            setOrigin={setOrigin}
            pautas={pautas}
            pautaId={pautaId}
            setPautaId={setPautaId}
            proposedPauta={proposedPauta}
            theme={theme}
            setTheme={setTheme}
            format={format}
            // O clique numa chip de formato é uma DECISÃO explícita — trava a reco assíncrona
            // (que chega depois e sobrescreveria). Marca o ref ANTES de mudar o estado.
            setFormat={(f) => { userDecidedRef.current = true; setFormat(f); }}
            recommendedFormat={recommendedFormat}
            recommendedAvg={insights?.bestFormatAvgEngagement ?? 0}
            recommendationKind={recommendationKind}
            templateKey={templateKey}
            setTemplateKey={setTemplateKey}
            templates={templates}
            templatesLoading={templatesLoading}
            templatesError={templatesError}
            kit={kit}
            objective={objective}
            useLogoIdentity={useLogoIdentity}
            setUseLogoIdentity={setUseLogoIdentity}
            creative={creative}
            setCreative={setCreative}
          />
        )}

        {/* FASE 2 — REVISAR (E9.5: transparência do briefing que a IA vai receber) */}
        {step === PHASE.REVISAR && (
          <BriefingReview
            pautaId={origin === "pauta" ? pautaId : undefined}
            theme={origin === "theme" ? theme : undefined}
            format={format ?? 0}
          />
        )}

        {/* FASE 3 — Gerar (ao vivo) */}
        {step === PHASE.GERAR && job && (
          <Card>
            <GeneratePoll
              jobId={job.jobId}
              contentId={job.contentId}
              onDone={(content) => {
                setResult(content);
                setStep(PHASE.RESULTADO);
              }}
              onCancel={() => {
                setJob(null);
                start.reset();
                setStep(PHASE.REVISAR);
              }}
            />
          </Card>
        )}
        {step === PHASE.GERAR && start.isError && (
          <Card>
            <p role="alert" className="text-sm text-ink/75">
              Não foi possível iniciar a geração. Tente novamente.
            </p>
            <div className="mt-4 flex gap-3">
              <Button onClick={() => { start.reset(); setStep(PHASE.REVISAR); }}>Tentar de novo</Button>
              <Button variant="ghost" onClick={() => { start.reset(); setStep(PHASE.REVISAR); }}>
                Voltar para revisão
              </Button>
            </div>
          </Card>
        )}

        {/* FASE 4 — Resultado */}
        {step === PHASE.RESULTADO && result && (
          <ResultStep content={result} objective={objective} templateForced={templateKey !== null} />
        )}
      </FlowFrame>

      {/* Navegação sticky — Briefing→Revisar→Gerar. Gerar/Resultado sem nav (poll/ações próprias). */}
      {step <= PHASE.REVISAR && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink/8 bg-paper/90 backdrop-blur pb-[env(safe-area-inset-bottom)]">
          <div className="mr-auto flex max-w-[1600px] items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
            <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === PHASE.BRIEFING}>
              Voltar
            </Button>
            {step === PHASE.BRIEFING && (
              <Button onClick={() => setStep(PHASE.REVISAR)} disabled={!briefingReady}>
                Revisar proposta →
              </Button>
            )}
            {step === PHASE.REVISAR && (
              <Button onClick={goGenerate} disabled={start.isPending}>
                {start.isPending ? "Iniciando…" : "Gerar"}
              </Button>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}

/** Badge de estado da prévia (rascunho/proposta/pronto) — sinaliza a fase sem inventar dado. */
function PreviewBadge({ tone, children }: { tone: "draft" | "active" | "ready"; children: ReactNode }) {
  const styles = {
    draft: "bg-ink/5 text-ink/65",
    active: "bg-ink/10 text-ink",
    ready: "bg-ink text-canvas",
  }[tone];
  return <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${styles}`}>{children}</span>;
}

/**
 * Aside da prévia ao vivo. Owna o contexto pré-geração (custo estimado + pré-flight honesto de IA)
 * e o repassa ao <LivePreview> como rodapé — antes esses dados viviam dentro do split do Revisar;
 * agora valem para Briefing E Revisar (a prévia é persistente). Pós-geração mostra os slides reais.
 */
function PreviewAside({
  result,
  format,
  proposalTitle,
  badge,
  showContext,
  pautaId,
  theme,
  kitMissing,
}: {
  result?: Content | null;
  format: number;
  proposalTitle?: string | null;
  badge?: ReactNode;
  showContext: boolean;
  pautaId?: string;
  theme?: string;
  kitMissing: boolean;
}) {
  const formatLabel = ["Post", "Carrossel", "Story"][format] ?? "Conteúdo";

  // P3/Confiança: custo estimado ANTES de gerar (read-only, tabela por formato — não chama IA).
  const cost = useQuery({
    queryKey: ["estimate", format],
    queryFn: () => contentApi.estimate(format, 1),
    enabled: showContext,
  });
  // Pré-flight honesto de IA (admin-only; só sinaliza modo simulado, não afirma falha). Onda 4.
  const admin = isAdmin();
  const ai = useQuery({
    queryKey: ["ai-config"],
    queryFn: settingsApi.getAi,
    enabled: admin && showContext,
    retry: false,
  });
  const aiUnconfigured = admin && ai.data?.configured === false;

  // Evita variável não usada quando o preview real está ativo (theme/pautaId só rotulam a proposta).
  void pautaId; void theme;

  const footer = showContext ? (
    <>
      <div className="flex items-end justify-between gap-3 px-1">
        <div>
          <h3 className="text-sm font-medium text-ink">A IA monta copy + visual juntos.</h3>
          <p className="text-xs text-ink/65">Você revisa antes de publicar.</p>
        </div>
        {cost.data && (
          <div
            className="text-right"
            title={cost.data.isEstimate
              ? "Estimativa de consumo do saldo de IA do mês. Não é cobrança no cartão."
              : "Consumo do saldo de IA do mês por peça."}
          >
            <span className="block text-[10px] uppercase tracking-wider text-ink/65">
              {cost.data.isEstimate ? "Uso estimado" : "Uso do saldo"}
            </span>
            <span className="text-lg font-medium tabular-nums text-ink">
              {cost.data.currency === "USD" ? "US$" : cost.data.currency} {cost.data.totalCostUsd.toFixed(2)}
            </span>
          </div>
        )}
      </div>

      {kitMissing && (
        <p className="rounded-md bg-pastel-cream p-2.5 text-xs text-ink/75">
          Marca não configurada — pode sair genérico.{" "}
          <Link href="/brand" className="font-medium text-ink underline-offset-2 hover:underline">Configurar marca</Link>
        </p>
      )}
      {aiUnconfigured && (
        <p className="rounded-md bg-pastel-cream p-2.5 text-xs text-ink/75">
          IA não configurada — geração sai em <span className="font-medium text-ink">modo simulado</span>.{" "}
          <Link href="/settings/ai" className="font-medium text-ink underline-offset-2 hover:underline">Configurar IA</Link>
        </p>
      )}
    </>
  ) : null;

  return (
    <LivePreview
      result={result}
      formatLabel={formatLabel}
      proposalTitle={proposalTitle}
      badge={badge}
      footer={footer}
    />
  );
}

// CUS/SOTA — A TELA DE BRIEFING (a fase 1 inteira numa tela só). Pesquisa citada:
// brief-first de baixa fricção + PROPOR > pedir + disclosure progressivo pro que é pesado.
//   1) O QUE (origem): pauta da fila (proposta, 1 clique) ou tema livre — o input HERÓI.
//   2) FORMATO: proposto (Carrossel por default), validável inline em chips — não um passo só.
//   3) TEMPLATE: "IA escolhe" por default; a galeria abre sob demanda (disclosure) — não força.
// Personas: P1/leigo vê 1 campo + IA cuida do resto; P2/apressado aceita a proposta e segue;
// P6/power troca formato/template num gesto. Tudo visível, reversível, sem dropdown vazio.
function BriefingStep({
  origin, setOrigin, pautas, pautaId, setPautaId, proposedPauta, theme, setTheme,
  format, setFormat, recommendedFormat, recommendedAvg, recommendationKind, templateKey, setTemplateKey, templates, templatesLoading, templatesError,
  kit, objective, useLogoIdentity, setUseLogoIdentity, creative, setCreative,
}: {
  origin: Origin;
  setOrigin: (o: Origin) => void;
  pautas: { id: string; title: string }[];
  pautaId: string;
  setPautaId: (id: string) => void;
  proposedPauta?: { id: string; title: string };
  theme: string;
  setTheme: (t: string) => void;
  format: number;
  setFormat: (f: number) => void;
  recommendedFormat: number | null;
  recommendedAvg: number;
  recommendationKind: "performance" | "provisional" | null;
  templateKey: string | null;
  setTemplateKey: (k: string | null) => void;
  templates: import("@/lib/templates").Template[];
  templatesLoading: boolean;
  templatesError: boolean;
  kit: import("@/lib/brand").BrandKit | undefined;
  objective?: string | null;
  useLogoIdentity: boolean;
  setUseLogoIdentity: (v: boolean) => void;
  creative: { referenceUrl: string; backgroundUrl: string; cta: string; subtitle: string };
  setCreative: (v: { referenceUrl: string; backgroundUrl: string; cta: string; subtitle: string }) => void;
}) {
  // Disclosure do template: fechado por default (IA escolhe). Abre se o operador já forçou um.
  const [templateOpen, setTemplateOpen] = useState(templateKey !== null);
  const chosenTemplate = templateKey ? templates.find((t) => t.key === templateKey) : undefined;

  // FASE 0: disclosure da direção criativa. Fechado por default (a IA cuida de tudo); abre se o
  // operador já preencheu algo (rascunho restaurado). Conta quantos campos têm valor (badge "N em uso").
  const creativeCount = [creative.referenceUrl, creative.backgroundUrl, creative.cta, creative.subtitle]
    .filter((v) => v.trim()).length;
  const [creativeOpen, setCreativeOpen] = useState(creativeCount > 0);

  const FORMAT_HINT = ["Imagem única", "Vários slides", "Story vertical 24h"];

  return (
    <div className="space-y-5">
      {/* ── 1) O QUE: a origem é o input HERÓI (único bloco com chrome de Card + sombra) ── */}
      <Card className="ring-ink/10">
        {/* Título de verdade (lg), não SectionLabel uppercase — cria o protagonista que faltava
            (3 SectionLabels iguais davam monotonia, sem hierarquia). */}
        <h2 className="mb-3 text-lg font-medium text-ink">O que você quer criar</h2>
        <div className="mb-4 flex gap-1 rounded-full bg-ink/5 p-1" role="tablist" aria-label="Origem do conteúdo">
          <button
            role="tab" aria-selected={origin === "pauta"}
            onClick={() => setOrigin("pauta")}
            className={`flex-1 rounded-full px-4 py-1.5 text-sm font-medium transition ${origin === "pauta" ? "bg-paper text-ink shadow-sm" : "text-ink/65"}`}
          >
            De uma pauta
          </button>
          <button
            role="tab" aria-selected={origin === "theme"}
            onClick={() => setOrigin("theme")}
            className={`flex-1 rounded-full px-4 py-1.5 text-sm font-medium transition ${origin === "theme" ? "bg-paper text-ink shadow-sm" : "text-ink/65"}`}
          >
            De um tema livre
          </button>
        </div>

        {origin === "pauta" ? (
          <Field label="Pauta" hint="Uma ideia já cadastrada vira post. A IA cuida da copy e do visual.">
            {/* PROPOR > pedir: a IA já sabe a próxima da fila — propõe (1 clique aceita). */}
            {!pautaId && proposedPauta && (
              <button
                type="button"
                onClick={() => setPautaId(proposedPauta.id)}
                className="mb-2 flex w-full items-center gap-3 rounded-lg border border-ink/12 bg-ink/[0.02] px-3 py-2.5 text-left transition hover:border-ink/25 hover:bg-ink/[0.04]"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink text-[11px] font-medium text-canvas">1ª</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] uppercase tracking-wider text-ink/65">Próxima da fila</span>
                  <span className="block truncate text-sm font-medium text-ink">{proposedPauta.title}</span>
                </span>
                <span className="shrink-0 text-xs font-medium text-ink/70">Usar esta →</span>
              </button>
            )}
            <Select value={pautaId} onChange={(e) => setPautaId(e.target.value)}>
              <option value="">Selecione…</option>
              {pautas.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </Select>
            <p className="mt-2 text-xs text-ink/65">
              {pautaId
                ? <>Selecionada: <span className="font-medium text-ink">{pautas.find((p) => p.id === pautaId)?.title}</span>.</>
                : proposedPauta
                  ? "Aceite a próxima da fila acima — ou escolha outra."
                  : "Escolha uma pauta para continuar."}
            </p>
          </Field>
        ) : (
          <Field label="Tema" hint="Escreva com suas palavras o que o post deve falar — a IA cuida do resto.">
            <Textarea
              placeholder="Ex.: como montar uma rotina matinal produtiva em 15 minutos"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
            />
            <p className="mt-2 text-xs text-ink/65">
              {theme.trim().length > 2 ? "Pronto para revisar." : "Escreva ao menos 3 caracteres."}
            </p>
          </Field>
        )}
      </Card>

      {/* ── 2) FORMATO proposto — ZONA secundária (sem caixa: de-emphasis-first; só o brief é Card) ── */}
      <div className="px-1">
        <div className="mb-2.5 flex items-baseline justify-between gap-3">
          <SectionLabel>Formato</SectionLabel>
          {/* A7/A8: o hint diz POR QUE o formato é recomendado (loop visível — "recomendo X porque Y").
              performance = dado de publicação real · provisional = qualidade das peças (pré-publicação,
              rotulado distinto p/ honestidade de proveniência) · null = "Sugerido" honesto. */}
          <span className="text-xs text-ink/65">
            {recommendationKind === "performance"
              ? `Recomendado pelo que performou${recommendedAvg > 0 ? ` (média ${Math.round(recommendedAvg)} de engajamento)` : ""} — troque se quiser`
              : recommendationKind === "provisional"
                ? "Recomendado pela qualidade das suas peças (ainda sem dados de publicação) — troque se quiser"
                : "Sugerido — troque se quiser"}
          </span>
        </div>
        <div role="radiogroup" aria-label="Formato do conteúdo" className="flex flex-wrap gap-2">
          {TYPE_LABEL.map((label, i) => {
            const selected = format === i;
            const recommended = recommendedFormat === i;
            return (
              <button
                key={i}
                role="radio"
                aria-checked={selected}
                onClick={() => setFormat(i)}
                className={`flex min-h-[44px] items-center gap-2 rounded-full px-4 py-2 text-sm font-medium ring-1 transition ${
                  selected ? "bg-ink text-canvas ring-ink" : "bg-paper text-ink/70 ring-ink/15 hover:text-ink hover:ring-ink/30"
                }`}
              >
                {selected && <IconCheck size={13} aria-hidden />}
                {label}
                {/* hint subordina (não compete) mas mantém AA: ink/65 passa contraste em bg-paper. */}
                <span className={`text-xs font-normal ${selected ? "text-canvas/80" : "text-ink/65"}`}>· {FORMAT_HINT[i]}</span>
                {/* A7/A8: marca o formato recomendado (mesmo que o usuário troque) — o sinal fica
                    visível. ★ performou = dado real · ◐ qualidade = provisório (pré-publicação). */}
                {recommended && !selected && (
                  <span className="rounded-full bg-ink/10 px-1.5 py-0.5 text-[10px] font-medium text-ink/70">
                    {recommendationKind === "performance" ? "★ performou" : "◐ qualidade"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── 3) TEMPLATE — ZONA secundária em disclosure (IA escolhe por default) ── */}
      <div className="px-1">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <SectionLabel>Template</SectionLabel>
            <p className="mt-1 text-sm text-ink/70">
              {chosenTemplate
                ? <>Você escolheu <span className="font-medium text-ink">{templateName(chosenTemplate)}</span>.</>
                : "A IA escolhe o melhor template pela sua pauta e objetivo."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {chosenTemplate && (
              <button
                onClick={() => { setTemplateKey(null); setTemplateOpen(false); }}
                className="text-xs font-medium text-ink/65 underline-offset-2 hover:text-ink hover:underline"
              >
                Deixar a IA
              </button>
            )}
            <Button variant="ghost" onClick={() => setTemplateOpen((v) => !v)} aria-expanded={templateOpen}>
              {templateOpen ? "Fechar" : chosenTemplate ? "Trocar" : "Escolher template"}
            </Button>
          </div>
        </div>

        {templateOpen && (
          <div className="mt-4 border-t border-ink/8 pt-4">
            {templatesLoading ? (
              <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="rounded-lg ring-1 ring-ink/10 p-3">
                    <div className="flex gap-3">
                      <div className="h-20 w-20 shrink-0 animate-pulse rounded-lg bg-ink/8" />
                      <div className="flex-1 space-y-2 py-1">
                        <div className="h-4 w-2/3 animate-pulse rounded bg-ink/8" />
                        <div className="h-3 w-full animate-pulse rounded bg-ink/5" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : templatesError ? (
              <p className="text-sm text-ink/75">
                Não foi possível carregar os templates. Sem problema — a IA escolhe o melhor pela sua pauta.
              </p>
            ) : (
              <TemplateGallery
                templates={templates}
                kit={kit}
                objective={objective}
                selectedId={templateKey}
                onSelect={(k) => { setTemplateKey(k); if (k === null) setTemplateOpen(false); }}
              />
            )}
          </div>
        )}
      </div>

      {/* ── 4) IDENTIDADE — estampar o logo da marca (toggle por geração) ── */}
      <div className="px-1">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <SectionLabel>Identidade</SectionLabel>
            <p className="mt-1 text-sm text-ink/70">
              {kit?.logoUrl
                ? "Estampa o seu logo nos slides gerados."
                : <>Cadastre o seu logo em <span className="font-medium text-ink">Marca</span> para usá-lo nos criativos.</>}
            </p>
          </div>
          {/* role=switch acessível; desabilitado sem logo (nada a estampar). */}
          <button
            type="button"
            role="switch"
            aria-checked={kit?.logoUrl ? useLogoIdentity : false}
            aria-label="Usar a identidade do meu logo"
            disabled={!kit?.logoUrl}
            onClick={() => setUseLogoIdentity(!useLogoIdentity)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors
              ${!kit?.logoUrl ? "cursor-not-allowed bg-ink/10" : useLogoIdentity ? "bg-ink" : "bg-ink/20"}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-canvas transition-transform
                ${kit?.logoUrl && useLogoIdentity ? "translate-x-6" : "translate-x-1"}`}
            />
          </button>
        </div>
      </div>

      {/* ── 5) DIREÇÃO CRIATIVA (Fase 0) — referência/fundo por URL + CTA + subtítulo (disclosure) ── */}
      <div className="px-1">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <SectionLabel>Direção criativa</SectionLabel>
            <p className="mt-1 text-sm text-ink/70">
              {creativeCount > 0
                ? `Você definiu ${creativeCount} ${creativeCount === 1 ? "direção" : "direções"} — a IA vai considerá-las.`
                : "Opcional — guie o visual e a copy: imagem de referência, fundo, CTA e subtítulo."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {creativeCount > 0 && (
              <span className="rounded-full bg-ink/10 px-1.5 py-0.5 text-[10px] font-medium text-ink/70">
                {creativeCount} em uso
              </span>
            )}
            <Button variant="ghost" onClick={() => setCreativeOpen((v) => !v)} aria-expanded={creativeOpen}>
              {creativeOpen ? "Fechar" : "Adicionar direção"}
            </Button>
          </div>
        </div>

        {creativeOpen && (
          <div className="mt-4 space-y-4 border-t border-ink/8 pt-4">
            <Field label="Imagem de referência (link)" hint="Cole o link (http/https) de uma imagem que inspire o visual. A IA a usa como referência.">
              <Input
                type="url"
                placeholder="https://…/referencia.jpg"
                value={creative.referenceUrl}
                onChange={(e) => setCreative({ ...creative, referenceUrl: e.target.value })}
              />
            </Field>
            <Field label="Fundo desejado (link)" hint="Link de uma imagem de fundo. A IA a considera como direção, mantendo a identidade da sua marca.">
              <Input
                type="url"
                placeholder="https://…/fundo.jpg"
                value={creative.backgroundUrl}
                onChange={(e) => setCreative({ ...creative, backgroundUrl: e.target.value })}
              />
            </Field>
            <Field label="CTA (chamada para ação)" hint="A frase de ação que você quer no post (ex.: “Garanta o seu”). A IA a usa em vez de inventar outra.">
              <Input
                placeholder="Ex.: Garanta o seu"
                value={creative.cta}
                onChange={(e) => setCreative({ ...creative, cta: e.target.value })}
              />
            </Field>
            <Field label="Subtítulo / linha de apoio" hint="Uma linha curta de apoio que reforça a mensagem (ex.: “Edição limitada de inverno”).">
              <Input
                placeholder="Ex.: Edição limitada de inverno"
                value={creative.subtitle}
                onChange={(e) => setCreative({ ...creative, subtitle: e.target.value })}
              />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}

/** Poll do job: mostra os agentes ao vivo até done/error. Oferece escape se travar. */
function GeneratePoll({
  jobId,
  contentId,
  onDone,
  onCancel,
}: {
  jobId: string;
  contentId: string;
  onDone: (c: Content) => void;
  onCancel: () => void;
}) {
  const [finished, setFinished] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Conta o tempo decorrido para oferecer cancelar se a geração travar.
  useEffect(() => {
    if (finished) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [finished]);

  const { data, isError } = useQuery({
    queryKey: ["job", jobId],
    queryFn: async () => {
      const status = await contentApi.getJob(jobId, contentId);
      if (status.status === "done" && !finished) {
        setFinished(true);
        const content = await contentApi.get(contentId);
        onDone(content);
      }
      return status;
    },
    // QA/enhance: para de pollar quando o job some (404 — agents reiniciou e perdeu o job-store
    // em memória). Sem isto o poll insistiria num jobId morto até o stall de 75s, opaco.
    retry: 1,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      if (q.state.status === "error") return false; // job perdido → não insiste
      return s === "done" || s === "error" ? false : 1500;
    },
  });

  // Job perdido (404): o agents reiniciou. A peça NÃO se perde — o reaper do worker reconcilia
  // (>10min) OU ela aparece em Aprovações quando concluir. Mensagem honesta, não spinner infinito.
  const jobLost = isError && !finished;
  const stalled = elapsed > 75 && data?.status !== "done";

  const healthyRunning = !finished && !stalled && !jobLost && data?.status !== "error";

  return (
    <div className="space-y-4">
      <AgentProgress
        step={data?.step ?? null}
        progress={data?.progress ?? 0}
        error={data?.error}
        debugDetail={data?.debugDetail}
      />
      {jobLost && (
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-pastel-cream p-3">
          <p className="text-sm text-ink/75">
            Perdemos o acompanhamento ao vivo desta geração (o serviço reiniciou). Sua peça não se
            perde — ela aparece em <span className="font-medium text-ink">Revisão &amp; Agenda</span> quando concluir.
          </p>
          <Link href="/approvals" className="text-sm font-medium text-ink underline-offset-2 hover:underline">
            Ver aprovações →
          </Link>
        </div>
      )}
      {(stalled || data?.status === "error") && !jobLost && (
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-ink/5 p-3">
          <p className="text-sm text-ink/70">
            {data?.status === "error"
              ? "A geração não pôde ser concluída."
              : "Está demorando mais que o normal."}
          </p>
          <Button variant="ghost" onClick={onCancel}>
            Cancelar e voltar
          </Button>
        </div>
      )}
      {/* Escape sempre disponível durante a geração saudável — o operador nunca fica preso nos
          60-120s do pipeline. O texto deixa CLARO que a geração não para: ela segue no backend
          e a peça aparece em Aprovações quando ficar pronta. */}
      {healthyRunning && (
        <div className="flex flex-col items-center gap-1">
          <button
            onClick={onCancel}
            className="text-xs font-medium text-ink/65 underline-offset-2 hover:text-ink hover:underline"
          >
            Voltar — a geração continua em segundo plano
          </button>
          <span className="text-[11px] text-ink/65">A peça aparece em “Revisão &amp; Agenda” quando ficar pronta.</span>
        </div>
      )}
    </div>
  );
}

function ResultStep({
  content,
  objective,
  templateForced,
}: {
  content: Content;
  objective?: string | null;
  templateForced: boolean;
}) {
  const qc = useQueryClient();
  const [when, setWhen] = useState("");
  const [frequency, setFrequency] = useState<number>(Frequency.None);
  const [dateError, setDateError] = useState<string | null>(null);

  const minDateTime = (() => {
    const n = new Date();
    n.setMinutes(n.getMinutes() - n.getTimezoneOffset());
    return n.toISOString().slice(0, 16);
  })();

  const approve = useMutation({
    mutationFn: () => approvalApi.decide(content.id, true),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals-pending"] });
      toast.success("Conteúdo aprovado. Agende abaixo ou no calendário.");
    },
  });
  const schedule = useMutation({
    // G6/G5: 'when' é a hora de PAREDE local (datetime-local) — passa CRU (o backend converte pelo
    // fuso do workspace). NÃO reinterpretar com new Date().toISOString() (bug de offset do navegador,
    // igual ao caminho do calendário). frequency opcional (default None = publica 1×).
    mutationFn: () => scheduleApi.schedule(content.id, when, frequency),
    onSuccess: () => {
      const repetia = frequency !== Frequency.None;
      qc.invalidateQueries({ queryKey: ["calendar"] });
      setWhen("");
      setFrequency(Frequency.None);
      toast.success(
        repetia ? "Publicação agendada — vai se repetir automaticamente." : "Publicação agendada.",
      );
    },
  });

  // "Publicar agora": sem escolher data — o servidor agenda para agora e o worker publica em ≤60s.
  // Mesmo gate de aprovação do agendamento (o backend recusa não-aprovado com 409 → toast central).
  const publishNow = useMutation({
    mutationFn: () => scheduleApi.publishNow(content.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["history-generations"] });
      toast.success("Enviado para publicação — sai em instantes.");
    },
  });

  function submitSchedule() {
    if (!when) return;
    // E9.4 — usa o validador puro compartilhado em vez da checagem ad-hoc.
    const err = validate.futureDateTime(when);
    if (err) {
      setDateError(err);
      return;
    }
    setDateError(null);
    schedule.mutate();
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-pastel-cream p-3 text-sm text-ink/75">
        Conteúdo gerado e salvo — está aguardando sua aprovação.
      </div>

      {/* F6/B3: reveal do template usado. HONESTO: só atribui a escolha ao objetivo quando foi a IA
          que escolheu (templateForced=false). Se o operador forçou na galeria, diz "(sua escolha)" —
          não inventa uma causalidade que não houve. Omitido em mock/degradado (templateName null). */}
      {content.templateName && (
        <div className="rounded-md bg-ink/5 px-3 py-2 text-sm text-ink/75">
          Template usado: <span className="font-medium text-ink">{content.templateName}</span>
          {templateForced ? (
            <> <span className="text-ink/65">(sua escolha)</span>.</>
          ) : objective ? (
            <> — escolhido pela IA para o objetivo <span className="font-medium text-ink">{objective}</span>.</>
          ) : null}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <SlideCarousel slides={content.slides} />
        <Card>
          <dl className="space-y-2 text-sm">
            <Row label="Legenda" value={content.caption} />
            <Row label="Chamada para ação" value={content.cta} />
            <Row label="Hashtags" value={content.hashtags} />
          </dl>
        </Card>
      </div>

      <Card>
        <SectionLabel className="mb-3">Ações</SectionLabel>
        <div className="flex flex-wrap items-end gap-3">
          <Button
            onClick={() => approve.mutate()}
            disabled={approve.isPending || approve.isSuccess}
          >
            {approve.isSuccess ? "Aprovado" : approve.isPending ? "Aprovando…" : "Aprovar"}
          </Button>
          {/* Publicar agora: caminho direto (sem agendar). Habilita após aprovar — o backend exige
              conteúdo aprovado (modo manual). O worker publica em ≤60s. status===3 é Approved
              (enums .NET crus, sem contrato compartilhado — ver libs/SocialAi.Core/Domain/Enums.cs). */}
          <Button
            onClick={() => publishNow.mutate()}
            disabled={publishNow.isPending || publishNow.isSuccess || (!approve.isSuccess && content.status !== 3)}
            title={!approve.isSuccess && content.status !== 3 ? "Aprove o conteúdo antes de publicar." : undefined}
          >
            {publishNow.isSuccess
              ? "Enviado"
              : publishNow.isPending
                ? "Publicando…"
                : "Publicar agora"}
          </Button>
          <div className="flex items-end gap-2">
            <Field label="Agendar para" hint="Data e hora futuras da publicação." error={dateError}>
              <Input
                type="datetime-local"
                min={minDateTime}
                value={when}
                error={!!dateError}
                onChange={(e) => {
                  setWhen(e.target.value);
                  setDateError(null);
                }}
              />
            </Field>
            <Field label="Repetir" hint="Publica de novo automaticamente.">
              <Select
                value={String(frequency)}
                onChange={(e) => setFrequency(Number(e.target.value))}
              >
                {FREQUENCY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Button variant="ghost" onClick={submitSchedule} disabled={schedule.isPending}>
              {schedule.isPending ? "Agendando…" : "Agendar"}
            </Button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-4 border-t border-ink/8 pt-3 text-sm">
          <Link href="/approvals" className="font-medium text-ink underline-offset-2 hover:underline">
            Ver em Aprovações →
          </Link>
          <Link href="/create" className="text-ink/65 underline-offset-2 hover:underline">
            Gerar outro
          </Link>
        </div>
      </Card>
    </div>
  );
}

/**
 * E9.5 (ADR-0007) — passo Revisar: mostra exatamente O QUE A IA VAI RECEBER, buscando o
 * MESMO payload da geração via GET /api/content/briefing/preview (read-only, sem gerar).
 * Evita o drift de montar o resumo no front (o backend é a fonte única — ver ADR).
 */
function BriefingReview({
  pautaId,
  theme,
  format,
}: {
  pautaId?: string;
  theme?: string;
  format: number;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["briefing-preview", pautaId ?? null, theme ?? null, format],
    queryFn: () => contentApi.briefingPreview({ pautaId, theme, format }),
  });

  // Conteúdo da fase Revisar (zona central do FlowFrame): o briefing LEGÍVEL que a IA vai usar.
  // O preview vivo + custo + avisos honestos vivem no aside persistente (PreviewAside) — aqui só
  // a leitura do contexto, sem duplicar o que o frame já mostra à direita.
  return (
    <Card>
      <div className="mb-4">
        <h3 className="font-serif text-2xl text-ink">Confira o briefing</h3>
        <p className="mt-0.5 text-sm text-ink/65">
          Os 6 agentes usarão exatamente este contexto. Ajuste em Marca ou na Pauta se algo faltar.
        </p>
      </div>

      {isLoading && <BriefingSkeleton />}
      {isError && (
        <div role="alert" className="rounded-md bg-pastel-cream p-3 text-sm text-ink/75">
          Não foi possível montar o briefing agora — pode ser conexão. Você ainda pode gerar mesmo
          assim (a IA usa o contexto disponível da marca e da pauta).
        </div>
      )}
      {data && <BriefingDetails briefing={data} />}
    </Card>
  );
}

/** Skeleton do briefing — espelha o grid final (3 seções) sem reflow (Doherty). */
function BriefingSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      {[0, 1, 2].map((s) => (
        <div key={s}>
          <div className="mb-2.5 h-3 w-20 animate-pulse rounded bg-ink/8" />
          <div className="space-y-2.5">
            {[0, 1, 2].map((r) => (
              <div key={r} className="flex gap-3">
                <div className="h-3 w-24 shrink-0 animate-pulse rounded bg-ink/5" />
                <div className="h-3 w-full animate-pulse rounded bg-ink/5" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Renderiza o briefing legível (objetivo, categoria, objetivo de marketing, anexos,
 *  concorrentes, identidade visual e resumo de aprendizado). Campos null → "(não configurado)". */
function BriefingDetails({ briefing }: { briefing: BriefingPreview }) {
  const { brandContext: bc, pauta, format } = briefing;
  const visual = bc.visualIdentity;
  // Apex/Tufte+ritmo: agrupar os 14 campos em 3 SEÇÕES (Conteúdo · Marca · Aprendizado) com respiro
  // entre elas — antes era uma parede <dl> de 14 linhas (parecia planilha). Cada seção = um cluster
  // semântico, separado por divisor; dá ritmo e deixa a "proposta" legível em vez de log.
  const identidade = visual
    ? [visual.preset, visual.headingFont, visual.bodyFont, visual.colors?.primary].filter(Boolean).join(" · ") || "(definida)"
    : null;

  // A Revisão existe pra dar CONFIANÇA, não pra cobrar preenchimento. Antes,
  // 6+ campos vazios apareciam como "—" → a persona ("campo visível = obrigatório") lia como
  // "deixei coisas em branco" e hesitava. Agora cada seção mostra só o PREENCHIDO; os vazios ficam
  // num disclosure quieto ("+ N que a IA completa"). Transparência preservada (dá pra ver tudo), sem
  // a fricção emocional de pendência falsa. Dado real — só muda a moldura.
  return (
    <div className="space-y-5">
      <BriefingSection title="Conteúdo" rows={[
        { label: "Título", value: pauta.title },
        { label: "Formato", value: formatPt(format) },
        { label: "Objetivo", value: pauta.objective },
        { label: "Categoria", value: pauta.category },
        { label: "Obj. marketing", value: pauta.marketingObjective },
        { label: "Anexos", value: listValue(pauta.attachments) },
      ]} />

      <BriefingSection title="Marca" rows={[
        { label: "Tom da marca", value: bc.tone },
        { label: "Diretrizes", value: bc.guidelines },
        { label: "Público-alvo", value: bc.targetAudience },
        { label: "Concorrentes", value: listValue(bc.competitors) },
        { label: "Perfil do Instagram", value: bc.handle },
        { label: "Identidade visual", value: identidade },
      ]} />

      <BriefingSection title="Aprendizado" rows={[
        { label: "Histórico", value: bc.learningSummary },
      ]} />
    </div>
  );
}

/** Uma seção do briefing: rótulo + linhas PREENCHIDAS visíveis; vazias colapsadas num disclosure
 *  quieto ("+ N que a IA completa"). Se a seção inteira está vazia, mostra a linha-resumo honesta. */
function BriefingSection({ title, rows }: { title: string; rows: { label: string; value: string | null }[] }) {
  const [showEmpty, setShowEmpty] = useState(false);
  const filled = rows.filter((r) => !!(r.value && r.value.trim()));
  const empty = rows.filter((r) => !(r.value && r.value.trim()));
  return (
    <div>
      <SectionLabel className="mb-2.5 border-t border-ink/8 pt-3">{title}</SectionLabel>
      <dl className="space-y-2.5 text-sm">
        {filled.map((r) => <Row key={r.label} label={r.label} value={r.value} />)}
        {filled.length === 0 && (
          <p className="text-sm text-ink/65">A IA completa esta parte sozinha.</p>
        )}
        {showEmpty && empty.map((r) => <Row key={r.label} label={r.label} value={r.value} />)}
      </dl>
      {empty.length > 0 && filled.length > 0 && (
        <button
          type="button"
          onClick={() => setShowEmpty((v) => !v)}
          className="mt-2 text-xs font-medium text-ink/65 underline-offset-2 hover:text-ink hover:underline"
        >
          {showEmpty ? "Ocultar vazios" : `+ ${empty.length} ${empty.length === 1 ? "campo" : "campos"} que a IA completa`}
        </button>
      )}
    </div>
  );
}

/** Lista → texto curto; vazio/null → null (vira "—" no Row). */
function listValue(items: string[] | null | undefined): string | null {
  if (!items || items.length === 0) return null;
  return items.join(", ");
}

// O BriefingPreview devolve o `format` como token cru dos agentes
// ("carousel"/"post"/"story", em inglês). A tela é PT-only; mostrar "carousel" no resumo que "os 6
// agentes vão usar" faz a persona-leiga (jargão=obrigação) hesitar em Gerar. Mapa de DISPLAY → PT
// (não inventa dado). Fallback ao texto cru se vier algo inesperado.
const FORMAT_PT: Record<string, string> = { post: "Post", carousel: "Carrossel", story: "Story" };
function formatPt(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return FORMAT_PT[raw.toLowerCase()] ?? raw;
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-xs uppercase tracking-[0.18em] text-ink/65">{label}</dt>
      <dd className="text-ink/80">{value || "—"}</dd>
    </div>
  );
}
