import { api, getBrandId, setBrandId } from "./api";

// Cliente de Marcas (E1-d). Espelha lib/pautas.ts. Marca é agrupador DENTRO do
// workspace; a marca ativa vai como X-Brand-Id (anexado em lib/api.ts). Aqui ficam
// o CRUD e os helpers de seleção da marca atual (localStorage.sap_brand).

export interface Brand {
  id: string;
  name: string;
  createdAt: string;
}

export interface BrandInput {
  name: string;
}

export const brandApi = {
  list: () => api<Brand[]>("/api/brands"),
  create: (input: BrandInput) =>
    api<Brand>("/api/brands", { method: "POST", body: JSON.stringify(input) }),
  rename: (id: string, input: BrandInput) =>
    api<Brand>(`/api/brands/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  remove: (id: string) => api<void>(`/api/brands/${id}`, { method: "DELETE" }),
};

// Reexporta os helpers de seleção (vivem em api.ts, junto do ponto que injeta o
// header) para quem consome marca importar tudo de um lugar só.
export { getBrandId, setBrandId };
