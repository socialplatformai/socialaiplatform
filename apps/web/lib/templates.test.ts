import { describe, it, expect } from "vitest";
import { templateName, journeyStage, journeyStages } from "./templates";

// CUS/templates-SOTA — a galeria mostra a ESTRUTURA (jornada) e nomes PT-BR, não rótulos em inglês
// num retângulo. Estes testes travam a tradução, a compactação da jornada e a degradação honesta.

describe("templateName — nome PT-BR pela key", () => {
  it("traduz as keys built-in conhecidas", () => {
    expect(templateName({ key: "product-launch", name: "Product Launch" })).toBe("Lançamento de produto");
    expect(templateName({ key: "social-proof", name: "Social Proof" })).toBe("Prova social");
    expect(templateName({ key: "announcement", name: "Announcement" })).toBe("Anúncio / Novidade");
  });
  it("key desconhecida → cai no name original (degrada honesto, não quebra)", () => {
    expect(templateName({ key: "custom-x", name: "Meu Template" })).toBe("Meu Template");
  });
});

describe("journeyStage — tipo de slide → etapa PT-BR", () => {
  it("mapeia os tipos do catálogo", () => {
    expect(journeyStage("cover")).toBe("Capa");
    expect(journeyStage("problem")).toBe("Problema");
    expect(journeyStage("cta")).toBe("CTA");
    expect(journeyStage("social-proof")).toBe("Prova");
  });
  it("tipo desconhecido → capitaliza (nunca quebra)", () => {
    expect(journeyStage("mistério")).toBe("Mistério");
  });
});

describe("journeyStages — compacta a sequência pra um chip-strip", () => {
  it("colapsa repetições adjacentes (3 'features' = 1 etapa 'Conteúdo')", () => {
    const j = ["cover", "problem", "features", "features", "features", "cta"];
    const { stages, truncated } = journeyStages(j);
    expect(stages).toEqual(["Capa", "Problema", "Conteúdo", "CTA"]);
    expect(truncated).toBe(false);
  });
  it("trunca em `max` etapas distintas e sinaliza", () => {
    const j = ["cover", "problem", "agitation", "solution", "benefits", "social-proof", "cta"];
    const { stages, truncated } = journeyStages(j, 5);
    expect(stages).toHaveLength(5);
    expect(truncated).toBe(true);
    expect(stages[0]).toBe("Capa");
  });
  it("sem jornada (API antiga / sem slides) → vazio, sem truncar (degrada honesto)", () => {
    expect(journeyStages(undefined)).toEqual({ stages: [], truncated: false });
    expect(journeyStages([])).toEqual({ stages: [], truncated: false });
  });
});
