import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Social AI Platform",
  description: "Automação inteligente de Instagram com agentes autônomos de IA",
};

// Aplica o tema salvo ANTES do primeiro paint (evita flash claro→escuro).
const themeBootstrap = `(function(){try{var t=localStorage.getItem('sap_theme');if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: o themeBootstrap (abaixo) muta `document.documentElement.classList`
    // ANTES da hidratação (.dark p/ evitar flash), e extensões de navegador (ColorZilla, gerenciadores
    // de senha) injetam atributos no <html>/<body> pós-SSR (ex.: cz-shortcut-listen). Ambos são
    // mismatches ESPERADOS e benignos — suprimir evita o overlay de erro do Next em dev sem mascarar
    // mismatches reais de filhos (o suppress só vale 1 nível: o próprio elemento, não a árvore).
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {/* Satoshi self-hosted (@font-face em globals.css, .woff2 em /public/fonts).
            Preload dos pesos críticos (Regular/Bold) — evita FOUT no 1º paint sem
            esperar o CSS resolver o @font-face. crossOrigin é exigido para fontes. */}
        <link rel="preload" href="/fonts/satoshi-400.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/satoshi-700.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="min-h-screen antialiased" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
