import { api } from "./api";

// F6/B1 — espelha TemplateDto (apps/api/Features/Templates/TemplatesController.cs). A galeria do
// wizard usa estes metadados (nº de slides, casos de uso, objetivos recomendados) p/ o operador
// escolher na cara da marca. bestFor/recommendedFor podem vir vazios (template sem esses campos).
export interface Template {
  id: string;
  key: string;
  name: string;
  description: string | null;
  builtIn: boolean;
  slideCount: number;
  bestFor: string[];
  recommendedFor: string[];
  // CUS/templates-SOTA: a JORNADA (sequência de tipos de slide: cover, problem, solution, cta…).
  // A galeria mostra a ESTRUTURA do template, não só o nome (reconhecer > lembrar). Pode vir
  // ausente de uma API antiga → tratamos como [] (degrada honesto: mostra o resto sem a faixa).
  journey?: string[];
}

// CUS/templates-SOTA — rótulos PT-BR dos NOMES de template (a fonte/agents está em inglês:
// "Product Launch", "Social Proof"…). App é PT-BR; a UI traduz pela `key` (estável), caindo no
// próprio name quando a key é desconhecida (degrada honesto). Decisão L2: mapear na UI (reversível,
// não-destrutivo) em vez de re-seedar a fonte — o name segue ponto único de verdade no catálogo.
export const TEMPLATE_NAME_PTBR: Record<string, string> = {
  "product-launch": "Lançamento de produto",
  "educational": "Educativo / Tutorial",
  "social-proof": "Prova social",
  "announcement": "Anúncio / Novidade",
};

export function templateName(t: Pick<Template, "key" | "name">): string {
  return TEMPLATE_NAME_PTBR[t.key] ?? t.name;
}

// CUS/templates-SOTA — cada tipo de slide (en, do catálogo dos agents) → 1 rótulo curto de ETAPA
// em PT-BR p/ a faixa de jornada. Tipo desconhecido cai num rótulo capitalizado (nunca quebra).
const JOURNEY_STAGE_PTBR: Record<string, string> = {
  cover: "Capa",
  problem: "Problema",
  agitation: "Tensão",
  solution: "Solução",
  benefits: "Benefícios",
  features: "Conteúdo",
  "social-proof": "Prova",
  stats: "Números",
  offer: "Oferta",
  cta: "CTA",
};

export function journeyStage(type: string): string {
  return JOURNEY_STAGE_PTBR[type] ?? (type.charAt(0).toUpperCase() + type.slice(1));
}

// Comprime a jornada bruta (1 por slide, com repetições — ex.: 3 "features" seguidos) numa sequência
// de ETAPAS distintas e legível pra um chip-strip (capa→problema→solução→prova→cta). Mantém a ordem,
// colapsa repetições adjacentes (3 dicas = 1 etapa "Conteúdo"), e limita a 5 etapas + "…" se exceder.
export function journeyStages(journey: string[] | undefined, max = 5): { stages: string[]; truncated: boolean } {
  if (!journey || journey.length === 0) return { stages: [], truncated: false };
  const compact: string[] = [];
  for (const t of journey) {
    const label = journeyStage(t);
    if (compact[compact.length - 1] !== label) compact.push(label);
  }
  return compact.length > max
    ? { stages: compact.slice(0, max), truncated: true }
    : { stages: compact, truncated: false };
}

export const templateApi = {
  // F6/B1: lista os templates do workspace (lazy seed dos built-in no backend).
  list: () => api<Template[]>("/api/templates"),
};

// F6/B3 — rótulos PT-BR dos objetivos de marketing (recommendedFor do template). O id vem do
// catálogo dos agents (en); a UI traduz. Objetivo desconhecido cai no próprio id (degrada honesto).
export const OBJECTIVE_LABEL: Record<string, string> = {
  conversion: "Conversão",
  awareness: "Awareness",
  engagement: "Engajamento",
  education: "Educação",
  trust: "Confiança",
  retention: "Retenção",
  traffic: "Tráfego",
};

export function objectiveLabel(id: string): string {
  return OBJECTIVE_LABEL[id] ?? id;
}
