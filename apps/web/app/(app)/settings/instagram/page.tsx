"use client";

import { Suspense, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { instagramApi, type InstagramAccount } from "@/lib/instagram";
import { ApiError, isAdmin } from "@/lib/api";
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, PageShell, SectionLabel, Skeleton } from "@/components/ui";
import { toast } from "@/components/toast";

// Wrapper necessário porque useSearchParams precisa de Suspense no App Router.
export default function InstagramSettingsPage() {
  return (
    <Suspense fallback={<PageShell width="form"><Skeleton className="h-40 w-full" /></PageShell>}>
      <InstagramSettingsInner />
    </Suspense>
  );
}

function InstagramSettingsInner() {
  const qc = useQueryClient();
  const params = useSearchParams();
  // A2: N contas por marca (a marca corrente é o X-Brand-Id que lib/api.ts injeta).
  const { data: accounts, isLoading } = useQuery({
    queryKey: ["ig-accounts"],
    queryFn: instagramApi.accounts,
  });

  // S-25: lê resultado do callback OAuth (Meta redireciona de volta com ?connected=1 ou ?error=...).
  useEffect(() => {
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected === "1") {
      toast.success("Conta Instagram conectada com sucesso.");
      window.history.replaceState(null, "", window.location.pathname);
      qc.invalidateQueries({ queryKey: ["ig-accounts"] });
    } else if (error) {
      const msg =
        error === "access_denied"
          ? "Permissão negada pelo usuário no Instagram."
          : `Erro ao conectar com o Instagram: ${error}`;
      toast.error(msg);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [params, qc]);

  const connect = useMutation({
    mutationFn: instagramApi.connectUrl,
    onSuccess: (r) => {
      window.location.href = r.url; // inicia o OAuth da Meta (marca fixada no state)
    },
  });

  const list = accounts ?? [];
  const hasAny = list.length > 0;

  return (
    <PageShell width="form">
      <PageHeader
        eyebrow="Configurações"
        title="Contas Instagram"
        description="Conecte uma ou mais contas Instagram Business a esta marca. A conta principal é o destino padrão das publicações — você pode escolher outra conta por pauta no agendamento."
      />

      {/* App Meta — credenciais cadastradas no app, cifradas no servidor (admin). */}
      {isAdmin() && <MetaAppConfigCard />}

      <Card>
        {isLoading ? (
          <p className="text-sm text-ink/65">Carregando…</p>
        ) : !hasAny ? (
          <EmptyState
            title="Nenhuma conta conectada"
            description="Conecte a primeira conta Instagram Business desta marca. A primeira vira a principal automaticamente."
            action={
              <Button onClick={() => connect.mutate()} disabled={connect.isPending}>
                {connect.isPending ? "Abrindo…" : "Conectar conta Instagram"}
              </Button>
            }
          />
        ) : (
          <div className="space-y-4">
            <ul className="divide-y divide-ink/8">
              {list.map((acct) => (
                <AccountRow
                  key={acct.id}
                  account={acct}
                  hasOthers={list.length > 1}
                  onReconnect={() => connect.mutate()}
                  reconnecting={connect.isPending}
                />
              ))}
            </ul>
            <div className="pt-1">
              <Button variant="ghost" onClick={() => connect.mutate()} disabled={connect.isPending}>
                {connect.isPending ? "Abrindo…" : "+ Conectar outra conta"}
              </Button>
            </div>
          </div>
        )}

        {connect.isError && (
          <p role="alert" className="mt-4 rounded-md bg-ink/5 p-3 text-sm text-ink/75">
            {connect.error instanceof ApiError && connect.error.status === 503
              ? isAdmin()
                ? "App Meta ainda não configurado. Cadastre o App ID e o App Secret no card acima."
                : "A conexão com o Instagram ainda não foi habilitada pelo administrador da sua conta. Fale com ele."
              : "Não foi possível iniciar a conexão. Tente novamente."}
          </p>
        )}
      </Card>

      <p className="mt-4 text-xs text-ink/65">
        Enquanto a aprovação da Meta (App Review) não sai, a publicação roda em modo de demonstração
        — o fluxo completo funciona do início ao fim.
      </p>
    </PageShell>
  );
}

/** Uma conta na lista: @, validade do token, badge principal, ações (tornar principal / reconectar / desconectar). */
function AccountRow({
  account,
  hasOthers,
  onReconnect,
  reconnecting,
}: {
  account: InstagramAccount;
  hasOthers: boolean;
  onReconnect: () => void;
  reconnecting: boolean;
}) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["ig-accounts"] });
  // Reconectar é útil quando: desconectada, OU token expirado/expirando (≤7 dias). O auditor achou
  // que o aviso "Reconecte a conta" não tinha AÇÃO — agora tem (reusa o mesmo OAuth; o backend casa
  // pela identidade da conta e renova o token, sem perder a conta).
  const daysLeft = account.tokenExpiresAt
    ? Math.ceil((new Date(account.tokenExpiresAt).getTime() - Date.now()) / 86400000)
    : null;
  const precisaReconectar = !account.isConnected || (daysLeft != null && daysLeft <= 7);

  const setPrimary = useMutation({
    mutationFn: () => instagramApi.setPrimary(account.id),
    onSuccess: () => {
      toast.success("Conta definida como principal.");
      invalidate();
    },
    onError: () => toast.error("Não foi possível definir como principal."),
  });
  const disconnect = useMutation({
    mutationFn: () => instagramApi.disconnect(account.id),
    onSuccess: () => {
      toast.success("Conta desconectada.");
      invalidate();
    },
    onError: () => toast.error("Não foi possível desconectar."),
  });

  return (
    <li className="flex items-center justify-between gap-4 py-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">
            {account.username ? `@${account.username}` : "Conta sem usuário"}
          </span>
          {account.isPrimary && <Badge tone="high">Principal</Badge>}
          {!account.isConnected && <Badge tone="low">Desconectada</Badge>}
        </div>
        {account.isConnected && account.tokenExpiresAt && (
          <TokenExpiry expiresAt={account.tokenExpiresAt} />
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {precisaReconectar && (
          <Button onClick={onReconnect} disabled={reconnecting}>
            {reconnecting ? "Abrindo…" : "Reconectar"}
          </Button>
        )}
        {account.isConnected && !account.isPrimary && (
          <Button
            variant="ghost"
            onClick={() => setPrimary.mutate()}
            disabled={setPrimary.isPending}
          >
            {setPrimary.isPending ? "…" : "Tornar principal"}
          </Button>
        )}
        {account.isConnected && (
          <Button
            variant="danger"
            onClick={() => disconnect.mutate()}
            disabled={disconnect.isPending}
            // Não bloqueia desconectar a principal, mas avisa se for a única (perde o destino).
            title={!hasOthers ? "Esta é a única conta — a marca ficará sem destino de publicação." : undefined}
          >
            {disconnect.isPending ? "…" : "Desconectar"}
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * Exibe validade do token Instagram em dias corridos.
 * Usa tom de alerta quando faltam ≤ 7 dias para o operador agir a tempo.
 */
function TokenExpiry({ expiresAt }: { expiresAt: string }) {
  const expiryDate = new Date(expiresAt);
  const msLeft = expiryDate.getTime() - Date.now();
  const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));

  if (daysLeft <= 0) {
    return (
      <p className="mt-1 text-xs font-medium text-red-500">
        Token expirado em {expiryDate.toLocaleDateString("pt-BR")}. Reconecte a conta.
      </p>
    );
  }

  return (
    <p className={`mt-1 text-xs ${daysLeft <= 7 ? "font-medium text-amber-600" : "text-ink/65"}`}>
      Token válido por mais {daysLeft} {daysLeft === 1 ? "dia" : "dias"}{" "}
      (até {expiryDate.toLocaleDateString("pt-BR")}).
    </p>
  );
}

/**
 * Cadastro do App Meta (App ID + App Secret) DENTRO do app.
 * Persistido cifrado (AES-GCM) no servidor. O App Secret nunca é exibido de volta:
 * o GET só informa se está configurado e qual o App ID.
 */
function MetaAppConfigCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["meta-app-config"],
    queryFn: instagramApi.getAppConfig,
  });

  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [editing, setEditing] = useState(false);

  const save = useMutation({
    mutationFn: () => instagramApi.saveAppConfig(appId.trim(), appSecret.trim()),
    onSuccess: () => {
      setAppSecret("");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["meta-app-config"] });
    },
  });
  const remove = useMutation({
    mutationFn: instagramApi.deleteAppConfig,
    onSuccess: () => {
      setAppId("");
      setAppSecret("");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["meta-app-config"] });
    },
  });

  const configured = data?.configured ?? false;
  const showForm = editing || !configured;

  return (
    <Card className="mb-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <SectionLabel>App Meta (administrador)</SectionLabel>
          <p className="mt-1 text-sm text-ink/65">
            Credenciais do app criado em developers.facebook.com. Guardadas cifradas no servidor.
          </p>
        </div>
        <Badge tone={configured ? "high" : "low"}>
          {configured ? "Configurado" : "Não configurado"}
        </Badge>
      </div>

      {isLoading ? (
        <p className="text-sm text-ink/65">Carregando…</p>
      ) : showForm ? (
        <div className="space-y-4">
          <Field label="App ID" hint="Número do app criado em developers.facebook.com.">
            <Input
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              placeholder={data?.appId ?? "Ex.: 1234567890123456"}
            />
          </Field>
          <Field label="App Secret" hint="Só é enviado ao salvar; nunca exibido de volta.">
            <Input
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              placeholder="••••••••••••••••"
            />
          </Field>

          {save.isError && (
            <p className="rounded-md bg-ink/5 p-3 text-sm text-ink/70">
              {save.error instanceof ApiError && save.error.status === 403
                ? "Apenas administradores podem alterar as credenciais."
                : "Não foi possível salvar. Confira App ID e App Secret."}
            </p>
          )}

          <div className="flex gap-3">
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending || !appId.trim() || !appSecret.trim()}
            >
              {save.isPending ? "Salvando…" : "Salvar credenciais"}
            </Button>
            {configured && (
              <Button variant="ghost" onClick={() => setEditing(false)} disabled={save.isPending}>
                Cancelar
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink/70">
            App ID: <span className="font-medium text-ink">{data?.appId}</span>
          </p>
          <div className="flex gap-3">
            <Button
              variant="ghost"
              onClick={() => {
                setAppId(data?.appId ?? "");
                setAppSecret("");
                setEditing(true);
              }}
            >
              Editar
            </Button>
            <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
              {remove.isPending ? "Removendo…" : "Remover"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
