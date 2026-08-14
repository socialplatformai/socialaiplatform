"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { quickLogin, quickRegister, ApiError } from "@/lib/api";
import { Button, Field, Input, Logo } from "@/components/ui";

// UX-SPEC 3.1 — Login/Signup: primeiro contato que COMUNICA o valor e converte sem fricção.
// Split-screen: pitch do pipeline à esquerda (recua no login, ganha peso no registro),
// form-card à direita. Bug real corrigido na fonte (api.ts: auth fora do refresh-and-redirect)
// → 401 vira "Credenciais inválidas" inline, não reload "sessão expirou".

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [touchedEmail, setTouchedEmail] = useState(false);

  useEffect(() => {
    if (params.get("expired")) setNotice("Sua sessão expirou. Entre novamente.");
  }, [params]);

  const isRegister = mode === "register";
  const emailInvalid = touchedEmail && email.length > 0 && !EMAIL_RE.test(email);
  const passwordTooShort = isRegister && password.length > 0 && password.length < 8;

  async function submit() {
    setTouchedEmail(true);
    if (!EMAIL_RE.test(email)) { setError("Informe um e-mail válido."); return; }
    if (isRegister && password.length < 8) { setError("Senha deve ter no mínimo 8 caracteres."); return; }
    setLoading(true);
    setError(null);
    try {
      if (mode === "login") await quickLogin(email, password);
      else await quickRegister(email, password, workspace || undefined);
      router.replace("/dashboard");
    } catch (e) {
      setError(errorForStatus(e, isRegister));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[45fr_55fr]">
      {/* ── Painel de marca/pitch (esquerda no desktop · topo no mobile) ──
          Superfície ESCURA (bg-ink): cria o split-screen de verdade — contraste de
          superfície entre painel-pitch e painel-form (antes os dois eram creme e o
          split sumia). Âncora visual do olho; a ação mora na direita, clara. */}
      <aside className="relative flex flex-col justify-between overflow-hidden bg-ink px-6 py-10 text-canvas sm:px-10 lg:px-14 lg:py-14">
        {/* brilho irisado sutil no topo — vida sem ruído (gradiente iris-soft do APEX;
            é var :root, não utility Tailwind, então vai via style). */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full opacity-30 blur-3xl"
          style={{ background: "var(--gradient-iris-soft)" }}
        />

        <div className="relative flex items-center gap-3">
          <Logo size={32} />
          <span className="text-sm font-medium tracking-tight text-canvas">Social AI Platform</span>
        </div>

        <div className="relative">
          {/* Headline em serif editorial (Instrument Serif): tom de produto, não de form. */}
          <h1 className="max-w-md font-serif text-4xl leading-[1.1] tracking-tight text-canvas lg:text-5xl">
            Da ideia ao post publicado, em piloto inteligente.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-canvas/60">
            6 agentes de IA geram seus carrosséis na voz da sua marca. Você aprova, agenda e publica.
          </p>
        </div>

        {/* Selos do pipeline — sempre visíveis (também no login): ancoram o rodapé,
            matam o deadspace vertical e comunicam o valor em 3 batidas. */}
        <ul className="relative space-y-3">
          {[
            ["Gera", "Pipeline de 6 agentes monta o carrossel na sua identidade."],
            ["Aprova", "Você revisa o preview e decide — nada publica sem seu aval."],
            ["Publica", "Agenda e publica no Instagram, com aprendizado de desempenho."],
          ].map(([t, d]) => (
            <li key={t} className="flex gap-3">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-canvas/70" aria-hidden />
              <span className="text-sm text-canvas/55">
                <span className="font-medium text-canvas/90">{t}.</span> {d}
              </span>
            </li>
          ))}
        </ul>
      </aside>

      {/* ── Form-card (direita) ── */}
      <section className="flex items-center justify-center bg-canvas px-6 py-10">
        <div className="w-full max-w-[440px]">
          <div className="mb-6">
            <h2 className="text-xl font-medium tracking-tight text-ink">
              {isRegister ? "Crie sua conta" : "Entrar"}
            </h2>
            <p className="mt-1 text-sm text-ink/65">
              {isRegister ? "Comece a gerar conteúdo em minutos." : "Bom te ver de novo."}
            </p>
          </div>

          {/* <form> nativo: Enter submete sem repetir onKeyDown por campo (mais
              robusto e semântico que os 3 handlers antigos). */}
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <Field label="E-mail" error={emailInvalid ? "Informe um e-mail válido." : undefined}>
              <Input
                type="email"
                autoFocus
                value={email}
                error={emailInvalid}
                onBlur={() => setTouchedEmail(true)}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field
              label="Senha"
              hint={isRegister ? "Mínimo 8 caracteres." : undefined}
              error={passwordTooShort ? "Senha deve ter no mínimo 8 caracteres." : undefined}
            >
              <Input
                type="password"
                value={password}
                error={passwordTooShort}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {isRegister && (
              <Field
                label="Nome da sua conta"
                hint="Como sua organização aparece na plataforma (ex.: o nome da sua agência ou empresa)."
              >
                <Input value={workspace} onChange={(e) => setWorkspace(e.target.value)} />
              </Field>
            )}

            {notice && !error && (
              <p role="status" className="rounded-md bg-pastel-cream p-3 text-sm text-ink/75">{notice}</p>
            )}
            {error && (
              <p role="alert" className="rounded-md bg-danger/10 p-3 text-sm text-danger dark:text-danger-on-dark">{error}</p>
            )}

            {/* CTA primário SEMPRE vivo no repouso (Norman): não desabilita por campo
                vazio — validação acontece inline e no submit. Só trava durante o envio. */}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Aguarde…" : isRegister ? "Criar minha conta" : "Entrar"}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-ink/65">
            {isRegister ? "Já tem conta? " : "Primeira vez? "}
            <button
              type="button"
              onClick={() => { setMode(isRegister ? "login" : "register"); setError(null); }}
              className="font-medium text-ink underline underline-offset-2 decoration-ink/30 hover:decoration-ink"
            >
              {isRegister ? "Entrar" : "Criar conta"}
            </button>
          </p>
        </div>
      </section>
    </main>
  );
}

/** Mensagem de erro por status (UX-SPEC 3.1): 401/409/400/429/0, sempre PT-BR, nunca status cru. */
function errorForStatus(e: unknown, isRegister: boolean): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Credenciais inválidas.";
    if (e.status === 409) return "E-mail já cadastrado. Faça login.";
    if (e.status === 429) return "Muitas tentativas. Aguarde um minuto e tente de novo.";
    if (e.status === 400 && e.message) return e.message; // ProblemDetails PT-BR
    if (e.status === 0) return "Sem conexão com o servidor. Verifique sua internet.";
  }
  return isRegister
    ? "Não foi possível criar a conta. Verifique os dados e tente de novo."
    : "Não foi possível entrar. Verifique os dados e a conexão.";
}
