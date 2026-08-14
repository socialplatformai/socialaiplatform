// Compilador determinístico DTCG → Tailwind tokens + CSS vars.
// Fonte: design tokens APEX (formato DTCG). As saídas já versionadas (tailwind.tokens.js,
// apex-vars.css) são o que o app consome; este script só as regenera quando os tokens mudam.
// Uso: passe o caminho do arquivo de tokens .json:
//   node compile.mjs ./tokens/apex.tokens.json
// Saídas: tailwind.tokens.js (mapa consumível) e apex-vars.css (CSS custom properties).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Default relativo ao pacote. O arquivo de tokens-fonte não é versionado (só as saídas
// compiladas são) — passe o caminho como argumento ao regenerar.
const SRC = process.argv[2] ?? resolve(__dirname, "tokens/apex.tokens.json");

const t = JSON.parse(readFileSync(SRC, "utf8"));

const colors = {
  // surface
  canvas: t.color.surface.canvas.$value,
  "canvas-2": t.color.surface["canvas-2"].$value,
  "canvas-3": t.color.surface["canvas-3"].$value,
  paper: t.color.surface.paper.$value,
  "paper-2": t.color.surface["paper-2"].$value,
  white: t.color.surface.white.$value,
  // ink
  ink: t.color.ink.ink.$value,
  "ink-2": t.color.ink["ink-2"].$value,
  "ink-3": t.color.ink["ink-3"].$value,
  slate: t.color.ink.slate.$value,
  "slate-2": t.color.ink["slate-2"].$value,
  "slate-3": t.color.ink["slate-3"].$value,
  // pastéis
  "pastel-blue": t.color.pastel.blue.$value,
  "pastel-cyan": t.color.pastel.cyan.$value,
  "pastel-mint": t.color.pastel.mint.$value,
  "pastel-lilac": t.color.pastel.lilac.$value,
  "pastel-rose": t.color.pastel.rose.$value,
  "pastel-cream": t.color.pastel.cream.$value,
  // semânticas (estados) — APCA-validadas em light+dark
  danger: t.color.semantic.danger.$value,
  "danger-on-dark": t.color.semantic["danger-on-dark"].$value,
  "danger-solid": t.color.semantic["danger-solid"].$value,
  success: t.color.semantic.success.$value,
  "success-on-dark": t.color.semantic["success-on-dark"].$value,
  "success-solid": t.color.semantic["success-solid"].$value,
  warning: t.color.semantic.warning.$value,
  "warning-on-dark": t.color.semantic["warning-on-dark"].$value,
};

const fontFamily = {
  display: t.typography.family.display.$value,
  body: t.typography.family.body.$value,
  serif: t.typography.family.serif.$value,
};

// Escala tipográfica modular (Bringhurst) + entrelinha + medida.
const fontSize = Object.fromEntries(
  Object.entries(t.typography.scale)
    .filter(([k]) => !k.startsWith("$"))
    .map(([k, v]) => [k, v.$value]),
);
const leading = Object.fromEntries(
  Object.entries(t.typography.leading)
    .filter(([k]) => !k.startsWith("$"))
    .map(([k, v]) => [k, v.$value]),
);
const measure = Object.fromEntries(
  Object.entries(t.typography.measure)
    .filter(([k]) => !k.startsWith("$"))
    .map(([k, v]) => [k, v.$value]),
);

// Tokens de motion (T4). cubicBezier vira string cubic-bezier(...) consumível.
const cb = (v) => (Array.isArray(v) ? `cubic-bezier(${v.join(", ")})` : v);
const motionDuration = Object.fromEntries(
  Object.entries(t.motion.duration)
    .filter(([k]) => !k.startsWith("$"))
    .map(([k, v]) => [k, v.$value]),
);
const motionEasing = Object.fromEntries(
  Object.entries(t.motion.easing)
    .filter(([k]) => !k.startsWith("$"))
    .map(([k, v]) => [k, cb(v.$value)]),
);

const spacing = Object.fromEntries(
  Object.entries(t.spacing)
    .filter(([k]) => !k.startsWith("$"))
    .map(([k, v]) => [k, v.$value]),
);

const radius = Object.fromEntries(
  Object.entries(t.radius)
    .filter(([k]) => !k.startsWith("$"))
    .map(([k, v]) => [k, v.$value]),
);

const boxShadow = Object.fromEntries(
  Object.entries(t.shadow).map(([k, v]) => [k, v.$value]),
);

const gradient = Object.fromEntries(
  Object.entries(t.gradient).map(([k, v]) => [v["$css-name"] ?? k, v.$value]),
);

const tokens = {
  colors,
  fontFamily,
  fontSize,
  lineHeight: leading,
  maxWidth: measure,
  spacing,
  radius,
  boxShadow,
  transitionDuration: motionDuration,
  transitionTimingFunction: motionEasing,
  gradient,
};

// ── tailwind.tokens.js ──────────────────────────────────────────────────────
const js = `// GERADO por compile.mjs a partir dos tokens APEX. NÃO editar à mão.
// Reexecutar: node packages/design-tokens/compile.mjs
export const apexTokens = ${JSON.stringify(tokens, null, 2)};
export default apexTokens;
`;
writeFileSync(resolve(__dirname, "tailwind.tokens.js"), js);

// ── apex-vars.css (CSS custom properties + @theme p/ Tailwind v4) ───────────
const themeColors = Object.entries(colors)
  .map(([k, v]) => `  --color-${k}: ${v};`)
  .join("\n");
const themeFonts = Object.entries(fontFamily)
  .map(([k, v]) => `  --font-${k}: ${v};`)
  .join("\n");
const themeRadius = Object.entries(radius)
  .map(([k, v]) => `  --radius-${k}: ${v};`)
  .join("\n");
// Tailwind v4 @theme: --text-* gera utilitários text-*; --leading-* gera leading-*;
// --ease-* gera ease-*; --duration via custom property direta.
const themeText = Object.entries(fontSize)
  .map(([k, v]) => `  --text-${k}: ${v};`)
  .join("\n");
const themeLeading = Object.entries(leading)
  .map(([k, v]) => `  --leading-${k}: ${v};`)
  .join("\n");
const themeEase = Object.entries(motionEasing)
  .map(([k, v]) => `  --ease-${k}: ${v};`)
  .join("\n");
const themeDuration = Object.entries(motionDuration)
  .map(([k, v]) => `  --duration-${k}: ${v};`)
  .join("\n");
const themeMeasure = Object.entries(measure)
  .map(([k, v]) => `  --container-${k}: ${v};`)
  .join("\n");
const gradientVars = Object.entries(gradient)
  .map(([k, v]) => `  --gradient-${k}: ${v};`)
  .join("\n");

// `@theme static` (Tailwind v4) força a emissão de TODOS os tokens, mesmo os ainda
// não consumidos por uma classe — o sistema de design é um contrato completo e
// queryável (motion/semânticas entram agora; R4/R5 consomem depois). Sem `static`,
// o Tailwind tree-shaka tokens não usados e o "sistema" some do runtime.
const css = `/* GERADO por compile.mjs a partir dos tokens APEX. NÃO editar à mão. */
@theme static {
${themeColors}
${themeFonts}
${themeText}
${themeLeading}
${themeRadius}
${themeEase}
${themeDuration}
${themeMeasure}
}

:root {
${gradientVars}
}
`;
writeFileSync(resolve(__dirname, "apex-vars.css"), css);

console.log(
  `OK: ${Object.keys(colors).length} cores, ${Object.keys(fontFamily).length} fontes, ` +
    `${Object.keys(fontSize).length} tamanhos de tipo, ${Object.keys(spacing).length} spacings, ` +
    `${Object.keys(radius).length} radii, ${Object.keys(boxShadow).length} shadows, ` +
    `${Object.keys(motionDuration).length} durações + ${Object.keys(motionEasing).length} easings, ` +
    `${Object.keys(gradient).length} gradientes.`,
);
