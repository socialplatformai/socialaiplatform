"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  type ReactElement,
  type ReactNode,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type SelectHTMLAttributes,
} from "react";

// Primitivas on-brand (APEX). Sem emojis. canvas/paper/ink + Satoshi.
// Foco visível consistente (a11y) via .ringfocus; estados de erro com aria.

// Anel de foco reutilizável — contraste >=3:1 sobre canvas (WCAG 2.4.7).
const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg bg-paper p-6 shadow-sm ring-1 ring-ink/5 ${className}`}>
      {children}
    </div>
  );
}

// ── Primitivas de layout (a RÉGUA) ──────────────────────────────────────────
// Codificam o padrão único de página: container, padding responsivo, ritmo do
// header e o label de seção. Toda tela usa estas em vez de repetir classes
// ad-hoc (max-w/px/py/tracking variavam por tela → desalinhamento e ritmo quebrado).
// Escala base 4px (alinhada ao Tailwind). Não reescreva as classes nas telas.

/**
 * Container + padding canônico de toda página (R2.5 — régua de espaço por INTENÇÃO).
 * Antes: tudo era `mx-auto max-w-6xl` (ou telas declaravam `max-w-2xl/3xl` à mão) → com a
 * sidebar de 240px, formulários viravam colunas estreitas BOIANDO no canvas (deadspace
 * simétrico em telas largas). Agora a largura segue a intenção do conteúdo:
 *   - `full`  → listas/dashboards/master-detail: usa o canvas (cap 1600px p/ não esparramar).
 *   - `wide`  → DEFAULT: fronteira calma (1280px), conteúdo respira sem boiar.
 *   - `form`  → tarefa única/leitura: coluna legível, mas ANCORADA À ESQUERDA (não centralizada),
 *               então não há deadspace simétrico; sobra espaço à direita p/ contexto/preview.
 * `className` ainda sobrescreve (escape hatch), mas a prop `width` é o caminho semântico.
 */
export function PageShell({
  children,
  className = "",
  width = "wide",
}: {
  children: ReactNode;
  className?: string;
  width?: "full" | "wide" | "form";
}) {
  const widthClass =
    width === "full"
      ? "w-full max-w-[1600px]"
      : width === "form"
        ? "max-w-2xl" // form estreito: NÃO estica (legibilidade de leitura), ancora à esquerda
        : "w-full max-w-7xl";
  // App operador (denso, leitura esquerda→direita): conteúdo ancora à esquerda (mr-auto),
  // colado à sidebar — mata o "boio" central. Mas `full`/`wide` agora ESTICAM (w-full) até
  // o teto de max-w: sem isso a <main> encolhia ao conteúdo e deixava 50%+ de dead space à
  // direita em telas de fluxo único (painel). `form` permanece estreito de propósito.
  return (
    <main id="main" className={`mr-auto ${widthClass} px-4 py-8 sm:px-6 sm:py-10 lg:px-8 ${className}`}>
      {children}
    </main>
  );
}

/** Cabeçalho de página: eyebrow (opcional) + título + descrição (opcional), ritmo fixo. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-ink/65">{eyebrow}</p>
        )}
        {/* Título em Instrument Serif: assinatura editorial coesa em todo o app
            (mesma família da headline do login e da referência branding-os —
            serif p/ títulos, sans p/ corpo/dados). */}
        <h1 className="mt-1 font-serif text-4xl leading-[1.05] tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-ink/65">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * FlowFrame — o frame de 3 zonas da SoT de UX ("Gerar Conteudo v2"): rail à ESQUERDA (fluxo/contexto)
 * + conteúdo no MEIO + aside à DIREITA (preview vivo/contexto), persistente entre fases.
 *
 * É a PRIMITIVA reutilizável da qual as telas-CORE derivam — NÃO conhece domínio (recebe slots
 * `rail`/`aside`/`children`; não sabe o que é "Briefing" nem "preview"). Regras codificadas aqui
 * (não nas telas, p/ não virar 3ª cópia ad-hoc):
 *   - Grid de 3 colunas só em ≥lg; abaixo EMPILHA (rail → conteúdo → aside) — mobile-first, sem
 *     espremer o conteúdo. `aside` é OPCIONAL (sem ele vira 2 zonas: rail + conteúdo).
 *   - O `aside` é STICKY no topo em ≥lg (acompanha a rolagem do conteúdo — o preview "vive" ao lado).
 *   - Larguras por intenção (tokens de layout, não números mágicos espalhados): rail fixo estreito,
 *     conteúdo flexível (o protagonista), aside numa faixa confortável de preview.
 * Acessibilidade: o rail e o aside são <aside> landmarks rotulados; a ordem do DOM (rail→conteúdo→
 * aside) é a ordem de leitura/Tab — coerente com o empilhamento mobile.
 */
export function FlowFrame({
  rail,
  aside,
  children,
  railLabel = "Fluxo",
  asideLabel = "Prévia",
  railWidth = "flow",
  className = "",
}: {
  rail?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  railLabel?: string;
  asideLabel?: string;
  /**
   * Largura do rail por INTENÇÃO (uma primitiva, dois shapes):
   *  - "flow" (200px): rail de FLUXO/stepper (ex.: /create — passos numerados estáticos).
   *  - "list" (320px): rail de FILA de dados navegável (ex.: /approvals master-detail — thumb +
   *    título + badge por linha). Forçar uma fila rica no rail estreito de fluxo a espremeria.
   */
  railWidth?: "flow" | "list";
  className?: string;
}) {
  // Colunas por intenção × zonas PRESENTES. Strings ESTÁTICAS completas (Tailwind JIT não compila
  // classe interpolada por variável). 4 combinações: rail±aside. Sem rail + com aside = 2 zonas
  // [conteúdo · aside] (ex.: Dashboard — sem stepper, só conteúdo + sinais). Sem nenhum = 1 coluna.
  let cols = "";
  if (rail && aside) {
    cols = railWidth === "list"
      ? "lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)_minmax(300px,360px)]"
      : "lg:grid-cols-[200px_minmax(0,1fr)_minmax(300px,360px)]";
  } else if (rail && !aside) {
    cols = railWidth === "list"
      ? "lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]"
      : "lg:grid-cols-[200px_minmax(0,1fr)]";
  } else if (!rail && aside) {
    cols = "lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]";
  }
  return (
    <div className={`grid grid-cols-1 gap-x-10 gap-y-8 ${cols} ${className}`}>
      {rail && (
        <aside aria-label={railLabel} className="lg:sticky lg:top-8 lg:self-start">
          {rail}
        </aside>
      )}
      <div className="min-w-0">{children}</div>
      {aside && (
        <aside aria-label={asideLabel} className="lg:sticky lg:top-8 lg:self-start">
          {aside}
        </aside>
      )}
    </div>
  );
}

/** Label de seção/card — o uppercase tracking repetido em toda tela, agora 1 ponto. */
export function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-xs font-medium uppercase tracking-[0.18em] text-ink/65 ${className}`}>
      {children}
    </p>
  );
}

// E9.3 — associação label↔controle automática. O `Field` gera um id estável
// (useId) e o injeta no PRIMEIRO filho de formulário via cloneElement,
// junto de aria-describedby apontando para a dica/erro. Telas só passam
// `placeholder`/`hint`; quem precisa de layout custom continua podendo passar
// `htmlFor` (e um `id` próprio no filho) — o escape hatch é preservado:
// só geramos/injetamos id quando o filho ainda não tem um.
function isFormControl(el: ReactElement): boolean {
  // Aceita as primitivas Input/Textarea/Select E os elementos nativos
  // <input>/<textarea>/<select> (caso a tela use o elemento cru).
  return el.type === Input || el.type === Textarea || el.type === Select ||
    el.type === "input" || el.type === "textarea" || el.type === "select";
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
}) {
  const auto = useId();
  // Mensagem (dica/erro) recebe id próprio para o aria-describedby do controle.
  const msgId = `${auto}-msg`;
  const hasMsg = !!error || !!hint;

  // Localiza o primeiro filho de formulário e injeta id + aria-describedby.
  // Mantém os demais filhos (ex.: <p> de ajuda inline no wizard) intactos.
  let controlId: string | undefined;
  const wired = Children.map(children, (child) => {
    if (controlId !== undefined || !isValidElement(child) || !isFormControl(child)) return child;
    const props = child.props as { id?: string; "aria-describedby"?: string };
    // Respeita id próprio do filho (escape hatch); senão usa htmlFor; senão o auto.
    controlId = props.id ?? htmlFor ?? auto;
    return cloneElement(child as ReactElement<Record<string, unknown>>, {
      id: controlId,
      "aria-describedby": hasMsg ? (props["aria-describedby"] ?? msgId) : props["aria-describedby"],
    });
  });

  // htmlFor do label aponta para o id real usado no controle.
  const labelFor = controlId ?? htmlFor;

  return (
    <div className="block">
      <label
        htmlFor={labelFor}
        className="mb-1 block text-xs font-medium uppercase tracking-[0.18em] text-ink/65"
      >
        {label}
      </label>
      {wired}
      {error ? (
        <span id={msgId} role="alert" className="mt-1 block text-xs font-medium text-danger dark:text-danger-on-dark">
          {error}
        </span>
      ) : hint ? (
        <span id={msgId} className="mt-1 block text-xs text-ink/65">{hint}</span>
      ) : null}
    </div>
  );
}

export function Input({ error, ...props }: InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) {
  return (
    <input
      {...props}
      aria-invalid={error || undefined}
      className={`w-full rounded-sm border bg-canvas px-3 py-2 text-sm text-ink outline-none transition ${FOCUS} ${
        error ? "border-danger/70 dark:border-danger-on-dark/70 focus-visible:ring-danger dark:focus-visible:ring-danger-on-dark" : "border-ink/15 focus:border-ink/40"
      } ${props.className ?? ""}`}
    />
  );
}

export function Textarea({
  error,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: boolean }) {
  return (
    <textarea
      {...props}
      aria-invalid={error || undefined}
      className={`min-h-24 w-full rounded-sm border bg-canvas px-3 py-2 text-sm text-ink outline-none transition ${FOCUS} ${
        error ? "border-danger/70 dark:border-danger-on-dark/70 focus-visible:ring-danger dark:focus-visible:ring-danger-on-dark" : "border-ink/15 focus:border-ink/40"
      } ${props.className ?? ""}`}
    />
  );
}

export function Button({
  children,
  variant = "solid",
  className = "",
  ...props
}: {
  children: ReactNode;
  variant?: "solid" | "ghost" | "danger";
} & InputHTMLAttributes<HTMLButtonElement>) {
  // Disabled POR VARIANTE: um CTA desabilitado deve ler como "esperando algo de você",
  // não como "quebrado". O solid mantém a FORMA preenchida (superfície ink suave) em vez
  // do opacity-50 genérico que apagava tudo e deixava o botão cinza-morto. cursor-not-allowed
  // sinaliza inatividade sem matar a presença visual.
  const styles = {
    solid: "bg-ink text-canvas hover:bg-ink-2 disabled:bg-ink/35 disabled:text-canvas/80",
    ghost: "bg-transparent text-ink ring-1 ring-ink/15 hover:bg-ink/5 disabled:text-ink/30 disabled:ring-ink/8",
    danger: "bg-danger-solid text-white hover:brightness-110 disabled:bg-danger-solid/30",
  }[variant];
  return (
    <button
      {...(props as object)}
      className={`inline-flex min-h-[44px] items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed ${FOCUS} ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function Select({
  children,
  error,
  ...props
}: { children: ReactNode; error?: boolean } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      aria-invalid={error || undefined}
      className={`w-full rounded-sm border bg-canvas px-3 py-2 text-sm text-ink outline-none transition ${FOCUS} ${
        error ? "border-danger/70 dark:border-danger-on-dark/70" : "border-ink/15 focus:border-ink/40"
      } ${props.className ?? ""}`}
    >
      {children}
    </select>
  );
}

/**
 * R1 (Atomic Design / Brad Frost) — molécula ÚNICA de "card selecionável" (radio).
 * Antes duplicada em 3 lugares (create: formato, template-gallery: galeria + "IA escolhe"):
 * mesmo `<button role=radio>` + `<Card>` com anel selecionado/hover + badge de check.
 * Agora um ponto só: o estado de seleção, foco e o badge vivem AQUI; cada tela passa só o
 * conteúdo (`children`). Mantém a a11y (role=radio + aria-checked + foco visível).
 */
export function SelectableCard({
  selected,
  onSelect,
  children,
  className = "",
  ariaLabel,
  fill = false,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  /** Apex/Müller-Brockmann: em grid com `auto-rows-fr`, faz o card preencher a altura da linha
   *  (h-full + coluna flex) p/ as BASES alinharem mesmo com conteúdos de alturas diferentes. */
  fill?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={ariaLabel}
      onClick={onSelect}
      className={`rounded-lg text-left ${FOCUS} ${fill ? "h-full" : ""} ${className}`}
    >
      <Card className={`${fill ? "flex h-full flex-col" : ""} ${selected ? "bg-ink/5 ring-2 ring-ink" : "ring-1 ring-ink/10 hover:ring-ink/30"}`}>
        {children}
      </Card>
    </button>
  );
}

/** Badge de check (círculo) do SelectableCard — preenchido quando selecionado. */
export function CheckCircle({ selected, icon }: { selected: boolean; icon: ReactNode }) {
  return (
    <span
      aria-hidden
      className={`grid h-5 w-5 shrink-0 place-items-center rounded-full transition ${
        selected ? "bg-ink text-canvas" : "ring-1 ring-ink/20 text-transparent"
      }`}
    >
      {icon}
    </span>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "high" | "medium" | "low" | "neutral" }) {
  const styles = {
    high: "bg-ink text-canvas",
    medium: "bg-ink/15 text-ink",
    low: "bg-ink/5 text-ink/65",
    neutral: "bg-ink/5 text-ink/65",
  }[tone];
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${styles}`}>{children}</span>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 rounded-full bg-ink/5 p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={`min-h-[40px] rounded-full px-4 py-1.5 text-sm font-medium transition ${FOCUS} ${
            active === t.id ? "bg-paper text-ink shadow-sm" : "text-ink/65 hover:text-ink"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Logo da marca — consome o token de gradiente (sem hex inline duplicado). */
export function Logo({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={`block rounded-lg ${className}`}
      style={{ height: size, width: size, background: "var(--gradient-iris-grad)" }}
    />
  );
}

/** Skeleton on-brand para estados de carregamento. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-sm bg-ink/5 ${className}`} aria-hidden />;
}

/** Estado vazio padronizado com título, descrição e CTA opcional. */
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  /** Ícone opcional no medalhão; sem ele, mantém o gradiente irisado padrão. */
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-ink/15 bg-paper/50 px-6 py-12 text-center">
      <div
        aria-hidden
        className="mb-4 grid h-12 w-12 place-items-center rounded-full text-ink/70"
        style={icon ? { background: "var(--color-canvas-2)" } : { background: "var(--gradient-iris-soft)" }}
      >
        {icon}
      </div>
      <p className="text-base font-medium text-ink">{title}</p>
      {description && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink/65">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/**
 * E9.2 — exemplo-semente removível. Renderiza os atalhos "usar exemplo" / "limpar".
 * O exemplo NUNCA é gravado sozinho: só vira dado real quando o operador clica
 * "usar exemplo" (`onUse(example)`); intocado, o campo segue vazio e o submit não
 * envia o texto do exemplo. "limpar" (`onClear`) só aparece quando há valor.
 */
export function FieldSeed({
  value,
  example,
  onUse,
  onClear,
}: {
  value: string;
  example: string;
  onUse: (example: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="mt-1.5 flex items-center gap-3 text-xs">
      <button
        type="button"
        onClick={() => onUse(example)}
        className={`font-medium text-ink/65 underline-offset-2 hover:text-ink hover:underline ${FOCUS}`}
      >
        Usar exemplo
      </button>
      {value ? (
        <button
          type="button"
          onClick={onClear}
          className={`text-ink/65 underline-offset-2 hover:text-ink hover:underline ${FOCUS}`}
        >
          Limpar
        </button>
      ) : null}
    </div>
  );
}

/** Hook utilitário p/ associar label↔controle quando o id não é fornecido. */
export function useFieldId(provided?: string) {
  const auto = useId();
  return provided ?? auto;
}

/**
 * Modal acessível (ADR-0009): overlay + diálogo on-brand. role=dialog + aria-modal;
 * fecha no Esc e no clique do backdrop; trava o scroll do body enquanto aberto.
 * Move o foco para o diálogo ao abrir e o RESTAURA no gatilho ao fechar (WCAG 2.4.3/4.1.2).
 * KISS: sem foco-trap por Tab completo (escopo atual = poucos controles; os primitivos têm
 * FOCUS visível e o Esc fecha) — foco-trap fica como incremento se o conteúdo crescer.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Guarda o elemento que tinha foco (o gatilho) para restaurar ao fechar.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      previouslyFocused?.focus(); // devolve o foco ao gatilho (a11y de teclado)
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-lg bg-paper p-6 shadow-xl outline-none ring-1 ring-ink/10"
      >
        <h2 className="text-lg font-medium tracking-tight text-ink">{title}</h2>
        <div className="mt-4">{children}</div>
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
