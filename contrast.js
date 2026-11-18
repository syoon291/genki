// High contrast: a per-device display setting (Data & backup > High contrast).
// "on" and "off" are stored in localStorage; "system" (the default, nothing
// stored) follows prefers-contrast: more, which iOS sets from Settings >
// Accessibility > Display & Text Size > Increase Contrast. It is not app data,
// so it stays out of backups and sync. styles.css holds the stronger tokens
// under :root[data-contrast="more"].
import { esc } from "./ui.js";

const KEY = "genki.contrast";
const CHOICES = [["system", "Match phone"], ["on", "On"], ["off", "Off"]];
const query = typeof matchMedia === "function" ? matchMedia("(prefers-contrast: more)") : null;
let current = "system";

function readPref() {
  try {
    const v = localStorage.getItem(KEY);
    return v === "on" || v === "off" ? v : "system";
  } catch { return "system"; }
}

function apply() {
  const more = current === "on" || (current === "system" && !!query?.matches);
  if (more) document.documentElement.dataset.contrast = "more";
  else delete document.documentElement.dataset.contrast;
}

export function initContrast() {
  current = readPref();
  apply();
  query?.addEventListener?.("change", apply);
}

export function setContrast(pref) {
  current = CHOICES.some(([v]) => v === pref) ? pref : "system";
  try {
    if (current === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, current);
  } catch {}
  apply();
}

export function contrastSection() {
  return `
    <section class="display" aria-labelledby="contrast-title">
      <h3 id="contrast-title">High contrast</h3>
      <p class="hint">Darker text and stronger edges and lines, on this device only. Match phone follows Increase Contrast in the iPhone's accessibility settings.</p>
      <div class="range" role="group" aria-labelledby="contrast-title">
        ${CHOICES.map(([v, label]) => `<button type="button" data-act="contrast" data-v="${v}" aria-pressed="${current === v}">${esc(label)}</button>`).join("")}
      </div>
    </section>`;
}
