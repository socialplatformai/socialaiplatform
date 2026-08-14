"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { brandApi, getBrandId, setBrandId, type Brand } from "@/lib/brands";
import { Badge, Button, Card, Field, Input, Modal, PageHeader, PageShell } from "@/components/ui";
import { toast } from "@/components/toast";

// Configurações → Marcas (E1-d). Lista / cria / renomeia / remove marcas do
// workspace. O backend bloqueia remover a última marca (400) — a mensagem dele
// já é exibida pelo tratamento centralizado de erro (providers.tsx). Trocar a
// marca ativa acontece pelo seletor no topbar; aqui é a gestão do CRUD.
export default function BrandsSettingsPage() {
  const qc = useQueryClient();
  const { data: brands, isLoading } = useQuery({ queryKey: ["brands"], queryFn: brandApi.list });
  const [newName, setNewName] = useState("");
  // Confirmação de remoção (T/P3) — remover marca apaga pautas/conteúdos/aprovações/agenda dela.
  // Ação irreversível → gate de confirmação (espelha o padrão de Usuários). null = modal fechado.
  const [toRemove, setToRemove] = useState<Brand | null>(null);

  const create = useMutation({
    mutationFn: () => brandApi.create({ name: newName.trim() }),
    onSuccess: () => {
      setNewName("");
      toast.success("Marca criada.");
      qc.invalidateQueries({ queryKey: ["brands"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => brandApi.remove(id),
    onSuccess: (_data, id) => {
      // Se a marca removida era a ativa, esquece a seleção — o seletor readota a 1ª.
      if (getBrandId() === id) {
        setBrandId(null);
        qc.invalidateQueries();
      } else {
        qc.invalidateQueries({ queryKey: ["brands"] });
      }
      setToRemove(null);
      toast.success("Marca removida.");
    },
  });

  function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    create.mutate();
  }

  return (
    <PageShell width="form">
      <PageHeader
        eyebrow="Configurações"
        title="Marcas"
        description="Cada marca agrupa pautas, conteúdos, aprovações e agenda de forma isolada dentro da sua conta. Troque a marca ativa pelo seletor no topo."
      />

      <Card>
        <form onSubmit={submitCreate} className="flex items-end gap-3">
          <div className="flex-1">
            <Field label="Nova marca" hint="Nome que identifica a marca na sua conta." htmlFor="new-brand">
              <Input
                id="new-brand"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ex.: Linha Premium"
                maxLength={120}
              />
            </Field>
          </div>
          <Button type="submit" disabled={!newName.trim() || create.isPending}>
            {create.isPending ? "Criando…" : "Criar"}
          </Button>
        </form>
      </Card>

      <div className="mt-6 space-y-3">
        {isLoading ? (
          <p className="text-sm text-ink/65">Carregando…</p>
        ) : !brands || brands.length === 0 ? (
          <p className="text-sm text-ink/65">Nenhuma marca ainda.</p>
        ) : (
          brands.map((b) => (
            <BrandRow
              key={b.id}
              brand={b}
              isActive={getBrandId() === b.id}
              canRemove={brands.length > 1}
              onRemove={() => setToRemove(b)}
              removing={remove.isPending && remove.variables === b.id}
            />
          ))
        )}
      </div>

      {/* Gate de confirmação (T/P3) — remover marca é irreversível e leva junto pautas/conteúdos/
          aprovações/agenda dela. Espelha o padrão de Configurações › Usuários. */}
      <Modal
        open={!!toRemove}
        onClose={() => setToRemove(null)}
        title="Remover marca"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setToRemove(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={remove.isPending}
              aria-busy={remove.isPending}
              onClick={() => toRemove && remove.mutate(toRemove.id)}
            >
              {remove.isPending ? "Removendo…" : "Remover"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink/70">
          Remover a marca <span className="font-medium text-ink">{toRemove?.name}</span>? As pautas,
          conteúdos, aprovações e agenda associados a ela são apagados junto. Esta ação não pode ser
          desfeita.
        </p>
      </Modal>
    </PageShell>
  );
}

function BrandRow({
  brand,
  isActive,
  canRemove,
  onRemove,
  removing,
}: {
  brand: Brand;
  isActive: boolean;
  canRemove: boolean;
  onRemove: () => void;
  removing: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(brand.name);

  const rename = useMutation({
    mutationFn: () => brandApi.rename(brand.id, { name: name.trim() }),
    onSuccess: () => {
      setEditing(false);
      toast.success("Marca renomeada.");
      qc.invalidateQueries({ queryKey: ["brands"] });
    },
  });

  function submitRename(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || name.trim() === brand.name) {
      setEditing(false);
      return;
    }
    rename.mutate();
  }

  return (
    <Card>
      {editing ? (
        <form onSubmit={submitRename} className="flex items-end gap-3">
          <div className="flex-1">
            <Field label="Nome da marca" hint="Atualize o nome exibido para esta marca." htmlFor={`edit-${brand.id}`}>
              <Input
                id={`edit-${brand.id}`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Linha Premium"
                maxLength={120}
                autoFocus
              />
            </Field>
          </div>
          <Button type="submit" disabled={!name.trim() || rename.isPending}>
            {rename.isPending ? "Salvando…" : "Salvar"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setName(brand.name);
              setEditing(false);
            }}
          >
            Cancelar
          </Button>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-sm font-medium text-ink">{brand.name}</span>
            {isActive && <Badge tone="high">Ativa</Badge>}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setEditing(true)}>
              Renomear
            </Button>
            <Button
              variant="danger"
              onClick={onRemove}
              disabled={!canRemove || removing}
              title={canRemove ? undefined : "Não é possível remover a última marca da sua conta."}
            >
              {removing ? "Removendo…" : "Remover"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
