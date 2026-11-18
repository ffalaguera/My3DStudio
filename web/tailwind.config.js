/** Tailwind usa el preset generado desde replica/design/tokens.json (node build-tokens.mjs). */
module.exports = {
  presets: [require('../replica/design/tailwind.preset.cjs')],
  content: ['./src/**/*.{html,ts}'],
};
