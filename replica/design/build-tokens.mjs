// Genera tokens.css y tailwind.preset.cjs a partir de tokens.json.
// Uso: node build-tokens.mjs   (desde replica/design)
// Nunca edites a mano los ficheros generados: cambia tokens.json y vuelve a ejecutar.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const t = JSON.parse(readFileSync(join(here, "tokens.json"), "utf8"));

const rgb = (hex) => {
  const h = hex.replace("#", "");
  const f = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)).join(" ");
};

const lines = [];
const v = (name, value) => lines.push(`  --${name}: ${value};`);

for (const [k, hex] of Object.entries(t.color)) v(`color-${k}`, rgb(hex));
v("font-sans", t.font.sans);
v("font-mono", t.font.mono);
v("font-display", t.font.display);
for (const [k, s] of Object.entries(t.type)) {
  v(`text-${k}`, `${s.size / 16}rem`);
  v(`leading-${k}`, `${s.line / 16}rem`);
  v(`weight-${k}`, s.weight);
}
for (const [k, r] of Object.entries(t.radius)) v(`radius-${k}`, `${r}px`);
for (const [k, s] of Object.entries(t.shadow)) v(`shadow-${k}`, s);
for (const [k, m] of Object.entries(t.motion)) v(`motion-${k}`, m);
for (const [k, l] of Object.entries(t.layout)) if (typeof l === "number") v(`layout-${k}`, `${l}px`);

const css = `/* GENERADO por build-tokens.mjs desde tokens.json. No editar a mano. */
:root {
  color-scheme: light;
${lines.join("\n")}
}

html, body {
  background: rgb(var(--color-bg));
  color: rgb(var(--color-text));
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  -webkit-font-smoothing: antialiased;
}

:focus-visible {
  outline: 2px solid rgb(var(--color-focus));
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; }
}
`;
writeFileSync(join(here, "tokens.css"), css);

const colors = Object.fromEntries(
  Object.keys(t.color).map((k) => [k, `rgb(var(--color-${k}) / <alpha-value>)`])
);
const fontSize = Object.fromEntries(
  Object.keys(t.type).map((k) => [
    k,
    [`var(--text-${k})`, { lineHeight: `var(--leading-${k})`, fontWeight: `var(--weight-${k})` }],
  ])
);
// Espaciado: la escala por defecto de Tailwind ya es de base 4 px (1 = 4px), igual que la
// medida. No se sobrescribe; tokens.space es el subconjunto recomendado (gap, padding).
const preset = {
  theme: {
    colors: { transparent: "transparent", current: "currentColor", ...colors },
    fontFamily: { sans: "var(--font-sans)", mono: "var(--font-mono)", display: "var(--font-display)" },
    fontSize,
    borderRadius: {
      none: "0",
      ...Object.fromEntries(Object.keys(t.radius).map((k) => [k, `var(--radius-${k})`])),
      full: "9999px",
    },
    boxShadow: {
      none: "none",
      ...Object.fromEntries(Object.keys(t.shadow).map((k) => [k, `var(--shadow-${k})`])),
    },
    screens: Object.fromEntries(Object.entries(t.layout.breakpoints).map(([k, px]) => [k, `${px}px`])),
    extend: {
      transitionDuration: { fast: "var(--motion-fast)", base: "var(--motion-base)", slow: "var(--motion-slow)" },
      transitionTimingFunction: { DEFAULT: "var(--motion-ease)" },
      width: { rail: "var(--layout-tool-rail)", panel: "var(--layout-tool-panel)", side: "var(--layout-side-panel)" },
      height: { nav: "var(--layout-nav-height)" },
      maxWidth: { content: "var(--layout-content-max)" },
    },
  },
};
writeFileSync(
  join(here, "tailwind.preset.cjs"),
  `// GENERADO por build-tokens.mjs desde tokens.json. No editar a mano.\n` +
    `// En tailwind.config.js:  presets: [require('./replica/design/tailwind.preset.cjs')]\n` +
    `module.exports = ${JSON.stringify(preset, null, 2)};\n`
);
console.log(`tokens.css (${lines.length} variables) y tailwind.preset.cjs generados`);
