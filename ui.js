// Small shared UI helpers: escaping, number formats, and the one general
// bottom sheet (#panel-dialog) that views fill with their own content.

export const $ = (sel, root = document) => root.querySelector(sel);

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const nf0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
export const int = (n) => nf0.format(Math.round(n));
export const dec1 = (n) => nf1.format(Math.round(n * 10) / 10);

// Tell screen readers what just changed in the view, through the one polite
// live region in index.html (#announcer). It sits outside #view, so a
// re-render never replaces it. Emptying it first and filling it a moment
// later makes the same message twice in a row be read again, and lets the
// re-render and its focus restore settle before the message is spoken.
let announceTimer = null;
export function announce(text) {
  const el = document.getElementById("announcer");
  if (!el) return;
  clearTimeout(announceTimer);
  el.textContent = "";
  announceTimer = setTimeout(() => { el.textContent = text; }, 150);
}

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

// One tap = one write. run() is called only when `key` is not already in
// `busy` (a Set or WeakSet); the key stays busy until run's promise settles,
// so a second tap or submit while the first write is pending is dropped
// (returns null) instead of logging the same entry twice.
export function singleFlight(busy, key, run) {
  if (busy.has(key)) return null;
  busy.add(key);
  let p;
  try { p = Promise.resolve(run()); } catch (err) { busy.delete(key); throw err; }
  return p.finally(() => busy.delete(key));
}
const busyEls = new WeakSet();
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
    // A tapped control whose handler is still writing ignores a second tap.
    const h = handlers;
    singleFlight(busyEls, el, () => h.click?.(el.dataset.act, el, e));
  });
  p.addEventListener("submit", (e) => {
    e.preventDefault();
    // A form whose submit is still writing ignores a second tap or Enter.
    const h = handlers;
    singleFlight(busyEls, e.target, () => h.submit?.(e.target, e));
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
