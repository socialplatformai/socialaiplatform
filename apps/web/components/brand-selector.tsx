"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { brandApi, getBrandId, setBrandId } from "@/lib/brands";

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

/**
 * Seletor de marca ativa (E1-d). Lista as marcas do workspace, troca a marca
 * corrente (persistida em localStorage.sap_brand via setBrandId) e invalida todas
 * as queries — assim a área inteira recarrega já com o X-Brand-Id novo.
 *
 * Aceite da FASE 2: criar pauta na marca A não aparece na marca B pela UI. O que
 * garante isso aqui é (1) persistir a marca antes de invalidar e (2) invalidar
 * tudo, forçando refetch escopado ao novo X-Brand-Id.
 */
export function BrandSelector({
  className = "",
  showSingle = false,
}: {
  className?: string;
  // showSingle: na sidebar (espinha multi-tenant), mostra o nome da marca mesmo com 1 marca
  // — o operador SEMPRE vê em qual marca está (contexto nunca ambíguo). No topbar fica false
  // (não poluir com um seletor de 1 opção).
  showSingle?: boolean;
}) {
  const qc = useQueryClient();
  const { data: brands } = useQuery({ queryKey: ["brands"], queryFn: brandApi.list });

  const active = getBrandId();

  // Sem marca selecionada (1º acesso) → adota a 1ª marca assim que a lista chega.
  // Mantém a UI honesta sobre qual marca está ativa (o backend já cairia na default,
  // mas o seletor precisa refletir uma seleção concreta).
  useEffect(() => {
    if (!brands || brands.length === 0) return;
    if (!getBrandId() || !brands.some((b) => b.id === getBrandId())) {
      setBrandId(brands[0].id);
      qc.invalidateQueries();
    }
  }, [brands, qc]);

  function switchTo(brandId: string) {
    if (brandId === getBrandId()) return;
    // Ordem load-bearing: persiste ANTES de invalidar, senão o refetch sai com a
    // marca antiga e os dados da marca errada aparecem.
    setBrandId(brandId);
    qc.invalidateQueries();
  }

  // Carregando: nada (evita flash).
  if (!brands || brands.length === 0) return null;

  // Uma marca só: no topbar não polui (null); na sidebar mostra o nome read-only
  // (contexto multi-tenant sempre visível, sem gap vazio na espinha).
  if (brands.length === 1) {
    if (!showSingle) return null;
    return (
      <div className={`flex items-center ${className}`}>
        <span
          className="block min-h-[40px] w-full truncate rounded-full border border-ink/10 bg-canvas/60 px-3 py-2 text-sm font-medium text-ink/70"
          title={brands[0].name}
        >
          {brands[0].name}
        </span>
      </div>
    );
  }

  return (
    <label className={`flex items-center ${className}`}>
      <span className="sr-only">Marca ativa</span>
      <select
        aria-label="Marca ativa"
        value={active ?? brands[0].id}
        onChange={(e) => switchTo(e.target.value)}
        className={`min-h-[40px] max-w-[12rem] rounded-full border border-ink/15 bg-canvas px-3 text-sm font-medium text-ink transition hover:border-ink/30 ${FOCUS}`}
      >
        {brands.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}
