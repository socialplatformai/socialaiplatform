import { api, downloadBlob } from "./api";

// F1 (ADR-0014): camadas de composição de um slide (fundo + elementos posicionados). JSON opaco no
// transporte; tipado aqui p/ o `<SlideCanvas>` (F2) renderizar. Espelha SlideLayers em
// services/agents/src/types.ts. Ausente/null → slide sem camadas (cai no preview só-imagem atual).
export interface SlideLayerElement {
  type: "text" | "icon" | "image" | "shape" | "divider";
  role: string; // 'headline' | 'body' | 'stat' | 'quote' | 'bullets' | 'cta' | 'image' | ...
  content: string;
  style?: Record<string, unknown>;
  position?: { x: number; y: number; width: number; height: number | "auto" };
}

export interface SlideLayers {
  background?: { type: "solid" | "gradient" | "image"; value: string; opacity?: number };
  elements?: SlideLayerElement[];
  canvas?: { width: number; height: number };
  // F3 (ADR-0014): âncora vertical da zona de texto, editável no SlideEditor. Default 'bottom'
  // (padrão editorial). Opaco no transporte — vai junto no LayersJson. Não vem do compositor (só
  // do editor); ausente → 'bottom'.
  anchorY?: "top" | "center" | "bottom";
}

export interface ContentSlide {
  index: number;
  copy: string | null;
  imageUrl: string | null;
  // F1 (ADR-0014): camadas de composição (opaco no fio). null/ausente → sem camadas.
  layers?: SlideLayers | null;
}

export interface Content {
  id: string;
  pautaId: string | null;
  type: number;
  status: number;
  caption: string | null;
  cta: string | null;
  hashtags: string | null;
  slides: ContentSlide[];
  // S-14: score do quality-validator (0-100). null quando gerado sem pipeline de validação
  // ou em versões anteriores. Abaixo de 70 o pipeline rejeita; exibimos aviso na UI.
  qualityScore?: number | null;
  // A3 (ADR-0010): conta IG-alvo override (null = principal da marca, resolvida no worker).
  targetInstagramAccountId?: string | null;
  // F6/B3: template que o pipeline escolheu (reveal pós-geração). null em mock/degradado.
  templateName?: string | null;
  // AI-native (teatro c/ justificativa): o raciocínio real dos agentes — por que este template/
  // ângulo, a narrativa, e os checks de qualidade que não passaram. null em mock/degradado/gerações
  // antigas → a UI omite o painel "Raciocínio da IA". Espelha Content.ReasoningJson (.NET).
  reasoning?: ContentReasoning | null;
  // G4 (A/B barato): as opções de headline/CTA que a IA já gerou (2 + 2) e que antes eram
  // descartadas. Re-extraídas do envelope ReasoningJson no backend. null quando o pipeline não as
  // produziu (mock/degradado/geração antiga) → o editor omite a faixa "Alternativas". Espelha
  // ContentDto.Alternatives (.NET).
  alternatives?: ContentAlternatives | null;
}

// G4: opções A/B baratas — headlines/ctas que o operador pode aplicar ao campo do slide ativo com
// 1 clique (não regenera). Per-content. Espelha ContentAlternativesDto (.NET).
export interface ContentAlternatives {
  headlines: string[];
  ctas: string[];
}

export interface ContentReasoning {
  whyTemplate?: string | null;
  whyAngle?: string | null;
  narrativeAngle?: string | null;
  keyInsights?: string[] | null;
  narrative?: string | null;
  qualityChecks?: { label: string; passed: boolean; severity: string }[] | null;
}

export const CONTENT_STATUS_LABEL: Record<number, string> = {
  0: "Rascunho",
  1: "Gerando",
  2: "Aguardando aprovação",
  3: "Aprovado",
  4: "Rejeitado",
  5: "Agendado",
  6: "Publicado",
  7: "Publicado (efêmero)",
  8: "Falhou",
};

// Estados decidíveis: Draft(0) | PendingApproval(2). Espelha o conjunto do backend
// (ContentController: choose/edit operam só sobre Draft|PendingApproval). Ponto único de
// verdade na UI — manter em sincronia com Enums.cs se um 3º estado decidível surgir.
export const DECIDABLE_STATUSES = new Set<number>([0, 2]);

export interface GenerateStart {
  contentId: string;
  jobId: string;
}

// FASE 0 (auditoria — fundação de input criativo): direção criativa por-geração que o operador
// fornece no wizard. Tudo opcional → ausente = comportamento atual. referenceUrl/backgroundUrl são
// links de imagem (Fase 0 = por URL; upload é evolução do Pilar I); cta/subtitle fixam a copy.
export interface CreativeInput {
  referenceUrl?: string;
  backgroundUrl?: string;
  cta?: string;
  subtitle?: string;
}

// C1 (ADR-0009): resultado de ação em lote — ids aplicados vs. ignorados (outra marca/estado inválido).
export interface BatchResult {
  applied: string[];
  skipped: string[];
}

export interface JobStatus {
  contentId: string;
  status: "queued" | "running" | "done" | "error";
  progress: number;
  step: string | null;
  error: string | null;
}

// E9.5 (ADR-0007): preview do briefing — o MESMO payload que a geração envia aos agentes,
// serializado em camelCase (JsonSerializerDefaults.Web). Read-only: não cria Content nem job.
export interface BriefingVisualIdentity {
  preset: string | null;
  colors: {
    primary: string | null;
    secondary: string | null;
    accent: string | null;
    background: string | null;
    text: string | null;
  } | null;
  headingFont: string | null;
  bodyFont: string | null;
  logoUrl: string | null;
}

export interface BriefingBrandContext {
  workspaceId: string;
  branding: string | null;
  tone: string | null;
  guidelines: string | null;
  competitors: string[];
  visualReferences: string[];
  learningSummary: string | null;
  handle: string | null;
  positioningRules: string | null;
  desiredContentTypes: string | null;
  visualIdentity: BriefingVisualIdentity | null;
  targetAudience: string | null;
  copyExamples: string[] | null;
}

export interface BriefingPauta {
  id: string;
  title: string;
  objective: string | null;
  context: string | null;
  category: string | null;
  attachments: string[] | null;
  marketingObjective: string | null;
}

export interface BriefingPreview {
  brandContext: BriefingBrandContext;
  pauta: BriefingPauta;
  format: string;
}

// B2 (ADR-0009): estimativa de custo por formato (fail-safe não-zero), ANTES de gerar.
export interface CostEstimate {
  unitCostUsd: number;
  count: number;
  totalCostUsd: number;
  currency: string;
  isEstimate: boolean;
}

export const contentApi = {
  list: () => api<Content[]>("/api/content"),
  // A5 (ADR-0009): variações de uma pauta (comparação lado a lado).
  listByPauta: (pautaId: string) => api<Content[]>(`/api/content?pautaId=${pautaId}`),
  // H3/S-22: o endpoint síncrono /generate foi removido (geração nunca é síncrona —
  // o pipeline de 60-120s estoura timeout). Use sempre generateAsync + poll.
  /** Inicia geração async (pauta OU tema livre). F6/B1: templateKey opcional força o template
   *  escolhido na galeria (ausente = a IA escolhe). useLogoIdentity: estampa o logo da marca nos
   *  slides (toggle do wizard; só efetivo se há logo cadastrado). creativeInput (Fase 0): direção
   *  criativa por-geração — referência/fundo por URL + CTA + subtítulo (tudo opcional). Retorna
   *  contentId+jobId p/ poll. */
  generateAsync: (input: {
    pautaId?: string;
    theme?: string;
    format: number;
    templateKey?: string;
    useLogoIdentity?: boolean;
    creativeInput?: CreativeInput;
  }) =>
    api<GenerateStart>("/api/content/generate/async", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getJob: (jobId: string, contentId: string) =>
    api<JobStatus>(`/api/content/jobs/${jobId}?contentId=${contentId}`),
  // E9.5 (ADR-0007): preview do briefing que a IA vai receber (pauta OU tema). Read-only —
  // reusa a montagem da geração no backend, sem chamar agents nem criar Content/job.
  briefingPreview: (input: { pautaId?: string; theme?: string; format: number }) => {
    const q = new URLSearchParams();
    if (input.pautaId) q.set("pautaId", input.pautaId);
    if (input.theme) q.set("theme", input.theme);
    q.set("format", String(input.format));
    return api<BriefingPreview>(`/api/content/briefing/preview?${q.toString()}`);
  },
  get: (id: string) => api<Content>(`/api/content/${id}`),
  // E11.1 + A2/A3 (ADR-0009): regenera (nova geração da mesma pauta). instruction = instrução livre;
  // slideIndex (0-based) = "refaz priorizando o slide N" (D2: conteúdo inteiro com instrução dirigida,
  // não regen isolada in-place). Retorna contentId+jobId p/ poll.
  regenerate: (id: string, body?: { instruction?: string; slideIndex?: number }) =>
    api<GenerateStart>(`/api/content/${id}/regenerate`, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),
  // B2 (ADR-0009): custo estimado ANTES de gerar (tabela por formato, sem chamar IA).
  estimate: (format: number, count: number) =>
    api<CostEstimate>(`/api/content/estimate?format=${format}&count=${count}`),
  // B3 (ADR-0009): gera N variações com teto+saldo. confirm obrigatório; 400 (sem confirm/teto) ou
  // 402 (saldo) viram ApiError tratado pelo toast central. Retorna [{contentId, jobId}] p/ poll.
  variations: (body: { pautaId: string; format: number; count: number; confirm: boolean }) =>
    api<GenerateStart[]>("/api/content/variations", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  // A5 (ADR-0009): escolhe uma variação (promove conforme modo; arquiva irmãs decidíveis). 204.
  choose: (id: string) => api<void>(`/api/content/${id}/choose`, { method: "POST" }),
  // A6 (ADR-0009): "testar marca" — gera 1 exemplo (IsSample, fora da listagem). Retorna contentId+jobId.
  testSample: () => api<GenerateStart>("/api/brand/test-sample", { method: "POST" }),
  // C1 (ADR-0009): exclusão em lote (cascata de slides). Retorna { applied, skipped }.
  batchDelete: (ids: string[]) =>
    api<BatchResult>("/api/content/batch-delete", {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  // E11.3 + F3 (ADR-0014): edita o conteúdo. Copy por slide + caption/cta/hashtags. O editor visual
  // (F3) também envia `layers` por slide (composição editada); o editor de texto omite e só muda copy.
  updateText: (
    id: string,
    body: {
      caption?: string | null;
      cta?: string | null;
      hashtags?: string | null;
      slides: { index: number; copy: string | null; layers?: SlideLayers | null }[];
    },
  ) => api<void>(`/api/content/${id}/slides`, { method: "PUT", body: JSON.stringify(body) }),
  // E11.5: baixa o ZIP (imagens JPEG + legenda) via fetch autenticado (Blob), nunca <a href> cru.
  downloadExport: (id: string) => downloadBlob(`/api/content/${id}/export.zip`),
  // A3 (ADR-0010): define/limpa a conta IG-alvo do conteúdo. null = volta ao default
  // (principal da marca → 1ª conectada). Conta de outra marca → 400 no backend.
  setTargetAccount: (id: string, targetInstagramAccountId: string | null) =>
    api<void>(`/api/content/${id}/target-account`, {
      method: "PUT",
      body: JSON.stringify({ targetInstagramAccountId }),
    }),
};
