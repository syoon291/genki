// Small shared UI helpers: escaping, number formats, and the one general
// bottom sheet (#panel-dialog) that views fill with their own content.

export const $ = (sel, root = document) => root.querySelector(sel);

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const nf0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
export const int = (n) => nf0.format(Math.round(n));
export const dec1 = (n) => nf1.format(Math.round(n * 10) / 10);

export function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------- panel (general bottom sheet) ----------
// openPanel(html, handlers) fills the sheet and shows it. handlers:
//   click(act, el, event)  for any [data-act] tapped inside
//   submit(form, event)    for any form submitted inside (default prevented)
//   input(event)           for any input or change inside
// Returning from a handler never closes the sheet; call closePanel().

let handlers = {};
let opener = null;
const dialog = () => $("#panel-dialog");

// ---------- focus that survives a re-render ----------
// Views re-render by replacing #view's HTML, which drops the focused button
// (and the button a sheet was opened from). focusKey() names a control by its
// data attributes so the same control can be found and focused again.

export function focusKey(el) {
  if (!el?.dataset?.act) return null;
  return Object.entries(el.dataset).map(([k, v]) => `[data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${CSS.escape(v)}"]`).join("");
}

let pendingFocus = null;
// Called by the app after each render of `root`: focus the control a closed
// sheet was opened from, if one is waiting.
export function restoreFocus(root) {
  if (!pendingFocus) return;
  const el = root.querySelector(pendingFocus);
  pendingFocus = null;
  if (el) el.focus(); else root.focus({ preventScroll: true });
}

function returnFocus(op) {
  if (!op || op.isConnected) return; // the browser already put focus back on it
  const key = focusKey(op);
  const root = $("#view");
  const el = key && root.querySelector(key);
  if (el) { el.focus(); return; }
  // Its view has not re-rendered yet: focus it when it does, else the view itself.
  pendingFocus = key;
  if (!key) root.focus({ preventScroll: true });
  else setTimeout(() => {
    if (pendingFocus !== key) return;
    pendingFocus = null;
    // Only if nothing took focus meanwhile (the user may have moved on).
    const a = document.activeElement;
    if (!a || a === document.body || a === document.documentElement || !a.isConnected) root.focus({ preventScroll: true });
  }, 1000);
}
const panel = () => $("#panel");

export function openPanel(html, h = {}) {
  handlers = h;
  panel().innerHTML = html;
  const d = dialog();
  if (!d.open) { opener = document.activeElement; d.showModal(); }
  // Focus the first field marked autofocus (showModal only does this on open).
  panel().querySelector("[autofocus]")?.focus();
}

// Replace the sheet's content while keeping it open (a step inside one flow).
export function swapPanel(html, h) {
  if (h) handlers = h;
  panel().innerHTML = html;
  panel().querySelector("[autofocus]")?.focus();
  panel().scrollTop = 0;
}

export function closePanel() {
  const d = dialog();
  if (d.open) d.close();
}

export function panelEl() { return panel(); }

export function initPanel() {
  const d = dialog();
  const p = panel();
  p.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el || !p.contains(el)) return;
    if (el.dataset.act === "close") { closePanel(); return; }
    handlers.click?.(el.dataset.act, el, e);
  });
  p.addEventListener("submit", (e) => {
    e.preventDefault();
    handlers.submit?.(e.target, e);
  });
  p.addEventListener("input", (e) => handlers.input?.(e));
  p.addEventListener("change", (e) => { if (e.target.matches("select, input[type=radio], input[type=checkbox]")) handlers.input?.(e); });
  d.addEventListener("click", (e) => { if (e.target === d) closePanel(); });
  d.addEventListener("close", () => {
    handlers.close?.(); handlers = {};
    const op = opener; opener = null;
    setTimeout(() => returnFocus(op), 0);
  });
}

export const closeBtn = `<button type="button" class="icon-btn" data-act="close" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
export const backBtn = (act = "back") => `<button type="button" class="icon-btn" data-act="${act}" aria-label="Back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>`;
