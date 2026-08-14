"use client";

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ApiError, onUnauthorized, registerCacheClearer } from "@/lib/api";
import { Toaster, toast } from "@/components/toast";

/** Providers client-side. QueryClient por instância de app (evita vazamento entre requests no SSR). */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
        },
        // Feedback de erro centralizado: toda mutation/query que falha avisa o usuário.
        mutationCache: new MutationCache({
          onError: (err) => {
            if (err instanceof ApiError && err.status === 401) {
              onUnauthorized();
              return;
            }
            toast.error(
              err instanceof ApiError && err.message
                ? friendly(err)
                : "Não foi possível concluir a ação. Tente novamente.",
            );
          },
        }),
        queryCache: new QueryCache({
          onError: (err) => {
            if (err instanceof ApiError && err.status === 401) onUnauthorized();
          },
        }),
      }),
  );

  // Liga o clear de cache ao fim de sessão (logout/401): clearToken() chama isto.
  // Sem isso, o QueryClient da raiz sobrevive à navegação SPA e dados em cache de
  // uma sessão/marca vazariam para a próxima (achado adversarial E1-d).
  useState(() => {
    registerCacheClearer(() => client.clear());
    return null;
  });

  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}

// Traduz erros técnicos comuns em mensagens humanas.
function friendly(err: ApiError): string {
  if (err.status === 403) return "Você não tem permissão para esta ação.";
  if (err.status === 409) return "Esse registro já existe.";
  if (err.status >= 500) return "O servidor teve um problema. Tente novamente em instantes.";
  if (err.status === 0) return "Sem conexão com o servidor. Verifique sua internet.";
  // 400/422: a mensagem já foi extraída do ProblemDetails em api.ts (S-05).
  if (err.status === 400 || err.status === 422) return err.message || "Dados inválidos. Verifique os campos.";
  return err.message || "Não foi possível concluir a ação.";
}
