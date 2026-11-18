// Contrast floors for the color tokens in styles.css, checked by
// scripts/check.mjs (CI) so later UI work cannot quietly drop below them.
// Ratios are WCAG 2 contrast ratios. Four themes are checked: light, dark,
// and the high contrast set of each (:root[data-contrast="more"]).

export function luminance(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`not a #rrggbb color: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// Collects the custom properties of the :root rules, split by whether they sit
// in @media (prefers-color-scheme: dark) and whether the selector is the high
// contrast one. Assumes the simple flat layout styles.css uses for its tokens.
export function tokenBlocks(css) {
  const blocks = { light: {}, dark: {}, lightMore: {}, darkMore: {} };
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = /(@media[^{]*\{\s*)?(:root(?:\[data-contrast="more"\])?)\s*\{([^}]*)\}/g;
  for (const [, media, sel, body] of src.matchAll(rule)) {
    const dark = !!media && /prefers-color-scheme:\s*dark/.test(media);
    if (media && !dark) continue;
    const more = sel !== ":root";
    const into = blocks[(dark ? "dark" : "light") + (more ? "More" : "")];
    for (const [, k, v] of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) into[k] = v.trim();
  }
  return {
    light: blocks.light,
    dark: { ...blocks.light, ...blocks.dark },
    "light high contrast": { ...blocks.light, ...blocks.lightMore },
    "dark high contrast": { ...blocks.light, ...blocks.dark, ...blocks.lightMore, ...blocks.darkMore },
  };
}

const SURFACES = ["bg", "surface", "surface-2"];
const COLORED = ["accent", "protein", "carbs", "fat", "good", "bad", "warn"];

// [foreground, backgrounds, floor] per theme kind.
function floors(more) {
  const rows = [
    ...["ink", "muted"].map((t) => [t, SURFACES, more ? 10 : 7]),
    ...COLORED.map((t) => [t, SURFACES, more ? 7 : 4.5]),
    ["accent-ink", ["accent"], more ? 7 : 4.5],
    ["accent-deep", ["accent-soft"], more ? 7 : 4.5],
    ["ink", ["accent-soft", "warn-soft"], 7],
    ["warn", ["warn-soft"], 4.5],
    ["accent-ink", ["good"], 3],
    ["field-line", SURFACES, more ? 4.5 : 3],
    ["chart-2", SURFACES, more ? 4.5 : 3],
    ["line", ["bg", "surface"], more ? 3 : 1.4],
    ["surface", ["bg"], 1.1],
  ];
  return rows;
}

// Returns a list of failures, empty when every theme meets its floors.
export function contrastFailures(css) {
  const out = [];
  for (const [theme, t] of Object.entries(tokenBlocks(css))) {
    for (const [fg, bgs, min] of floors(theme.includes("high contrast"))) {
      for (const bg of bgs) {
        if (!t[fg] || !t[bg]) { out.push(`${theme}: --${t[fg] ? bg : fg} is not defined`); continue; }
        let r;
        try { r = ratio(t[fg], t[bg]); } catch (e) { out.push(`${theme}: --${fg} on --${bg}: ${e.message}`); continue; }
        if (r < min) out.push(`${theme}: --${fg} ${t[fg]} on --${bg} ${t[bg]} is ${r.toFixed(2)}:1, needs ${min}:1`);
      }
    }
  }
  return out;
}
