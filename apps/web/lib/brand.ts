import { api } from "./api";

// Espelha BrandKitDto (apps/api/Features/Brand/BrandDtos.cs). Todos os campos de identidade
// visual + texto de marca (E2/ADR-0005) são opcionais — vazios caem no preset/fallback APEX.
export interface BrandKit {
  branding: string | null;
  tone: string | null;
  editorialGuidelines: string | null;
  positioningRules: string | null;
  desiredContentTypes: string | null;
  // Identidade visual: preset + cores (hex) + fontes + logo.
  visualPreset: string | null;
  primaryColorHex: string | null;
  secondaryColorHex: string | null;
  accentColorHex: string | null;
  backgroundColorHex: string | null;
  textColorHex: string | null;
  headingFont: string | null;
  bodyFont: string | null;
  logoUrl: string | null;
  // Texto de marca que chega à engine de geração.
  targetAudience: string | null;
  copyExamples: string[] | null;
}

// Presets de design system disponíveis (DEC-4). Espelha o catálogo dos agents; preset
// desconhecido não é erro (o adapter cai no APEX). Rótulos PT-BR à prova de leigo.
export const VISUAL_PRESETS = [
  { id: "", label: "Padrão (APEX)" },
  { id: "apex", label: "APEX" },
  { id: "minimal", label: "Minimalista" },
  { id: "bold", label: "Marcante" },
] as const;

export interface Competitor {
  id: string;
  handle: string;
  notes: string | null;
}

export interface VisualReference {
  id: string;
  url: string;
  description: string | null;
}

export const brandApi = {
  getKit: () => api<BrandKit>("/api/brand/kit"),
  putKit: (kit: BrandKit) =>
    api<BrandKit>("/api/brand/kit", { method: "PUT", body: JSON.stringify(kit) }),
  getCompetitors: () => api<Competitor[]>("/api/brand/competitors"),
  addCompetitor: (handle: string, notes?: string) =>
    api<Competitor>("/api/brand/competitors", {
      method: "POST",
      body: JSON.stringify({ handle, notes }),
    }),
  deleteCompetitor: (id: string) =>
    api<void>(`/api/brand/competitors/${id}`, { method: "DELETE" }),
  getRefs: () => api<VisualReference[]>("/api/brand/visual-references"),
  addRef: (url: string, description?: string) =>
    api<VisualReference>("/api/brand/visual-references", {
      method: "POST",
      body: JSON.stringify({ url, description }),
    }),
  deleteRef: (id: string) =>
    api<void>(`/api/brand/visual-references/${id}`, { method: "DELETE" }),
};
