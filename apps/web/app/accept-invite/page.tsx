"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { usersApi } from "@/lib/users";
import { setRole, setRefreshToken, setToken, ApiError } from "@/lib/api";
import { Button, Card, Field, Input, Logo } from "@/components/ui";

// B1 (ADR-0010) — Aceitar convite. Página PÚBLICA: o convidado ainda não tem conta,
// então vive FORA do route group (app)/ (que tem o guard de auth). O link chega por
// fora (o Admin copia-e-cola o link com ?token=…); aqui o convidado define a senha,
// a conta nasce e a sessão é persistida — sem passar pelo /login.

const MIN_PASSWORD = 8;

export default function AcceptInvitePage() {
  // useSearchParams exige Suspense no App Router (a leitura da query é client-side).
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
      <AcceptInviteInner />
    </Suspense>
  );
}

function AcceptInviteInner() {
  const params = useSearchParams();
  const token = params.get("token");

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const accept = useMutation({
    mutationFn: () => usersApi.acceptInvite(token as string, password, name.trim() || undefined),
    onSuccess: (r) => {
      // Sessão pós-aceite: o convidado já entra logado, sem desvio pelo /login.
      setToken(r.accessToken);
      if (r.refreshToken) setRefreshToken(r.refreshToken);
      setRole(r.role ?? null);
      window.location.assign("/dashboard");
    },
    // onError central já dispara toast; aqui só refinamos a mensagem inline (abaixo).
  });

  // Validação client-side: evita round-trip e dá feedback imediato (espelha o /login).
  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit =
    !!token &&
    password.length >= MIN_PASSWORD &&
    confirm === password &&
    !accept.isPending;

  // 400 da API = convite inválido/expirado/já usado. Demais erros → mensagem genérica
  // (a 0 "sem conexão" já vem traduzida de api.ts). A central já mostrou o toast.
  const submitError = accept.isError
    ? accept.error instanceof ApiError && accept.error.status === 400
      ? "Convite inválido, expirado ou já utilizado."
      : accept.error instanceof ApiError && accept.error.message
        ? accept.error.message
        : "Não foi possível criar a conta. Verifique a conexão e tente novamente."
    : null;

  function submit() {
    if (!canSubmit) return;
    accept.mutate();
  }

  // Sem token na URL → não há nada a aceitar. Estado honesto + caminho de saída.
  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center">
            <Logo size={40} className="mb-4 rounded-lg" />
            <h1 className="text-2xl font-medium tracking-tight text-ink">Convite inválido</h1>
          </div>
          <Card>
            <p role="alert" className="text-sm text-ink/70">
              Convite inválido ou ausente. Confira se você abriu o link completo que recebeu —
              ele precisa conter o código do convite.
            </p>
          </Card>
          <p className="mt-4 text-center text-sm text-ink/65">
            Já tem conta?{" "}
            <Link href="/login" className="font-medium text-ink underline-offset-2 hover:underline">
              Entrar
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size={40} className="mb-4 rounded-xl" />
          <h1 className="text-2xl font-medium tracking-tight text-ink">Você foi convidado</h1>
          <p className="mt-1 text-sm text-ink/65">
            Defina sua senha para criar a conta e começar.
          </p>
        </div>

        <Card>
          <div className="space-y-4">
            <Field label="Nome" hint="Opcional — como você aparece para a equipe." htmlFor="invite-name">
              <Input
                id="invite-name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={accept.isPending}
              />
            </Field>

            <Field
              label="Senha"
              hint="Mínimo 8 caracteres."
              error={passwordTooShort ? "A senha deve ter no mínimo 8 caracteres." : undefined}
              htmlFor="invite-password"
            >
              <Input
                id="invite-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                error={passwordTooShort}
                disabled={accept.isPending}
              />
            </Field>

            <Field
              label="Confirmar senha"
              error={mismatch ? "As senhas não conferem." : undefined}
              htmlFor="invite-confirm"
            >
              <Input
                id="invite-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                error={mismatch}
                disabled={accept.isPending}
              />
            </Field>

            {submitError && (
              <p role="alert" className="rounded-md bg-ink/5 p-3 text-sm text-ink/80">
                {submitError}
              </p>
            )}

            <Button
              onClick={submit}
              disabled={!canSubmit}
              aria-busy={accept.isPending}
            >
              {accept.isPending ? "Criando conta…" : "Criar minha conta"}
            </Button>
          </div>
        </Card>

        <p className="mt-4 text-center text-sm text-ink/65">
          Já tem conta?{" "}
          <Link href="/login" className="font-medium text-ink underline-offset-2 hover:underline">
            Entrar
          </Link>
        </p>
      </div>
    </main>
  );
}
