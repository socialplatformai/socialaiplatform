"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usersApi, UserRole, type AppUser } from "@/lib/users";
import { ApiError, isAdmin } from "@/lib/api";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, PageShell, SectionLabel, Select } from "@/components/ui";
import { toast } from "@/components/toast";

// B1/B2 (ADR-0010): membros & convites por workspace. Admin-only — o backend
// retorna 403 para Member; a UI também esconde a tela e mostra um aviso claro.
// Não há entrega de e-mail nesta fase: o convite vira um LINK copiável que o
// Admin envia manualmente ao convidado (que cria a conta em /accept-invite).

export default function UsersSettingsPage() {
  // Admin-only: sem permissão, nada de gestão — apenas o aviso honesto.
  if (!isAdmin()) {
    return (
      <PageShell width="full">
        <PageHeader eyebrow="Configurações" title="Membros &amp; convites" />
        <Card>
          <p role="alert" className="text-sm text-ink/70">
            Apenas administradores podem gerenciar membros.
          </p>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell width="full">
      <PageHeader
        eyebrow="Configurações"
        title="Membros &amp; convites"
        description="Convide pessoas para a sua conta e gerencie quem tem acesso. Administradores podem convidar e remover; membros usam a plataforma sem acessar estas configurações."
      />

      <div className="space-y-6">
        <InviteCard />
        <MembersCard />
      </div>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* Convidar — gera token+link copiável (sem envio automático de e-mail) */
/* ------------------------------------------------------------------ */

function InviteCard() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<number>(UserRole.Member);
  const [link, setLink] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: () => usersApi.invite(email.trim(), role),
    onSuccess: (res) => {
      setLink(res.link);
      setEmail("");
      setRole(UserRole.Member);
      toast.success("Convite gerado. Copie o link e envie ao convidado.");
    },
  });

  const podeConvidar = /\S+@\S+\.\S+/.test(email.trim()) && !invite.isPending;

  async function copiarLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copiado.");
    } catch {
      toast.error("Não foi possível copiar. Selecione o link e copie manualmente.");
    }
  }

  return (
    <Card>
      <SectionLabel className="mb-5">Convidar</SectionLabel>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (podeConvidar) invite.mutate();
        }}
      >
        <Field
          label="E-mail do convidado"
          htmlFor="invite-email"
          hint="Para onde o acesso será direcionado. A entrega por e-mail virá depois; por enquanto copie e envie o link ao convidado."
        >
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="pessoa@empresa.com"
            autoComplete="off"
            required
          />
        </Field>

        <Field label="Papel" htmlFor="invite-role" hint="Administradores também gerenciam membros e configurações.">
          <Select id="invite-role" value={role} onChange={(e) => setRole(Number(e.target.value))}>
            <option value={UserRole.Member}>Membro</option>
            <option value={UserRole.Admin}>Administrador</option>
          </Select>
        </Field>

        <div className="pt-1">
          <Button type="submit" disabled={!podeConvidar} aria-busy={invite.isPending}>
            {invite.isPending ? "Gerando…" : "Gerar convite"}
          </Button>
        </div>

        {invite.isError && (
          <p role="alert" className="text-sm text-red-500">
            Não foi possível gerar o convite. Verifique o e-mail e tente novamente.
          </p>
        )}
      </form>

      {link && (
        <div className="mt-6 rounded-md bg-ink/5 p-4">
          <SectionLabel>Link de convite</SectionLabel>
          <p className="mt-1 text-xs text-ink/65">
            Uso único, expira em 7 dias. Envie ao convidado — ele cria a conta por este link.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <label htmlFor="invite-link" className="sr-only">
              Link de convite gerado
            </label>
            <Input
              id="invite-link"
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono text-xs"
            />
            <span className="shrink-0">
              <Button type="button" variant="ghost" onClick={copiarLink}>
                Copiar
              </Button>
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Membros — lista + remoção com confirmação (409 = último Admin)      */
/* ------------------------------------------------------------------ */

function MembersCard() {
  const qc = useQueryClient();
  const [aRemover, setARemover] = useState<AppUser | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["users"],
    queryFn: () => usersApi.list(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => {
      setARemover(null);
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.success("Membro removido.");
    },
    onError: (err) => {
      setARemover(null);
      if (err instanceof ApiError && err.status === 409) {
        toast.error("Não é possível remover o último administrador.");
      } else {
        toast.error("Não foi possível remover o membro. Tente novamente.");
      }
    },
  });

  return (
    <Card>
      <SectionLabel className="mb-5">Membros</SectionLabel>

      {isLoading ? (
        <p className="text-sm text-ink/65">Carregando…</p>
      ) : isError ? (
        <p role="alert" className="text-sm text-ink/70">
          Não foi possível carregar os membros. Tente novamente.
        </p>
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="Nenhum membro ainda"
          description="Gere um convite acima para trazer alguém para a sua conta."
        />
      ) : (
        <ul className="divide-y divide-ink/8">
          {data.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{u.name || u.email}</p>
                {u.name && <p className="truncate text-xs text-ink/65">{u.email}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Badge tone={u.role === "Admin" ? "high" : "neutral"}>
                  {u.role === "Admin" ? "Administrador" : "Membro"}
                </Badge>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => setARemover(u)}
                  aria-label={`Remover ${u.name || u.email}`}
                >
                  Remover
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={!!aRemover}
        onClose={() => setARemover(null)}
        title="Remover membro"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setARemover(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={remove.isPending}
              aria-busy={remove.isPending}
              onClick={() => aRemover && remove.mutate(aRemover.id)}
            >
              {remove.isPending ? "Removendo…" : "Remover"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink/70">
          Remover{" "}
          <span className="font-medium text-ink">{aRemover?.name || aRemover?.email}</span> da sua
          conta? A pessoa perde o acesso imediatamente. Esta ação não pode ser desfeita.
        </p>
      </Modal>
    </Card>
  );
}
