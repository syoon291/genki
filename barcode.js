// Barcode decoding for food packages, bundled so no remote script runs: EAN-13,
// UPC-A (an EAN-13 starting with 0), EAN-8 and UPC-E, read from rows of a
// camera frame or a photo. Pure functions (no DOM), so they run under
// `node --test` as well as in the browser.
//
// A row of pixels becomes runs of dark and light; a barcode is a fixed number
// of runs between guard bars, each digit four runs adding up to 7 modules.
// Every read is checked with the code's check digit.

// Run widths (in modules) of each digit, starting with a light run on the left
// half (L codes) and a dark run on the right half (R codes; the same widths).
const L = ["3211", "2221", "2122", "1411", "1132", "1231", "1114", "1312", "1213", "3112"].map((s) => [...s].map(Number));
// G codes (even parity, left half) are the L widths reversed.
const G = L.map((w) => [...w].reverse());
// The parity of EAN-13's six left digits gives its first digit (0 = L, 1 = G).
const FIRST = ["000000", "001011", "001101", "001110", "010011", "011001", "011100", "010101", "010110", "011010"];
// UPC-E: the parity of its six digits gives the check digit (number system 0; system 1 is the inverse).
const UPCE = ["111000", "110100", "110010", "110001", "101100", "100110", "100011", "101010", "101001", "100101"];

const MAX_DIGIT_ERR = 0.38; // mean width error a digit may have, in modules per run

// The best digit for four runs: { d, parity: 0|1, err } or null.
function matchDigit(runs, at, tables) {
  const sum = runs[at] + runs[at + 1] + runs[at + 2] + runs[at + 3];
  if (!(sum > 0)) return null;
  let best = null;
  for (let t = 0; t < tables.length; t++) {
    for (let d = 0; d < 10; d++) {
      const w = tables[t][d];
      let err = 0;
      for (let k = 0; k < 4; k++) err += Math.abs((runs[at + k] * 7) / sum - w[k]);
      if (!best || err < best.err) best = { d, parity: t, err };
    }
  }
  return best && best.err / 4 <= MAX_DIGIT_ERR ? best : null;
}

// Guard runs (all about one module wide) starting at `at`: true when they fit `mod`.
function guardFits(runs, at, n, mod) {
  for (let k = 0; k < n; k++) {
    const r = runs[at + k] / mod;
    if (!(r > 0.45 && r < 1.9)) return false;
  }
  return true;
}

export function ean13Valid(code) {
  if (!/^\d{13}$/.test(code)) return false;
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(code[i]) * (i % 2 ? 3 : 1);
  return (10 - (s % 10)) % 10 === Number(code[12]);
}

export function ean8Valid(code) {
  if (!/^\d{8}$/.test(code)) return false;
  let s = 0;
  for (let i = 0; i < 7; i++) s += Number(code[i]) * (i % 2 ? 1 : 3);
  return (10 - (s % 10)) % 10 === Number(code[7]);
}

// UPC-E's 6 digits (with its number system and check digit) as the UPC-A it stands for.
export function upcEToA(ns, six, check) {
  const d = six;
  const last = Number(d[5]);
  let mid;
  if (last <= 2) mid = `${d[0]}${d[1]}${last}0000${d[2]}${d[3]}${d[4]}`;
  else if (last === 3) mid = `${d[0]}${d[1]}${d[2]}00000${d[3]}${d[4]}`;
  else if (last === 4) mid = `${d[0]}${d[1]}${d[2]}${d[3]}00000${d[4]}`;
  else mid = `${d[0]}${d[1]}${d[2]}${d[3]}${d[4]}0000${last}`;
  return `${ns}${mid}${check}`;
}

// The one form a code is stored and looked up in: UPC-A and UPC-E become their
// 13-digit EAN; EAN-8 and EAN-13 stay. Anything else (or a bad check digit) is "".
export function normalizeBarcode(text) {
  const s = String(text ?? "").replace(/[\s-]/g, "");
  if (/^\d{8}$/.test(s)) return ean8Valid(s) ? s : "";
  if (/^\d{12}$/.test(s)) return ean13Valid(`0${s}`) ? `0${s}` : "";
  if (/^\d{13}$/.test(s)) return ean13Valid(s) ? s : "";
  if (/^\d{14}$/.test(s) && s[0] === "0") return ean13Valid(s.slice(1)) ? s.slice(1) : "";
  return "";
}

// Try each barcode kind with its start guard at run `i` (a dark run).
function decodeAt(runs, i) {
  const n = runs.length;
  const mod = (runs[i] + runs[i + 1] + runs[i + 2]) / 3;
  if (!guardFits(runs, i, 3, mod)) return "";
  // A quiet zone before the start guard: light, at least 3 modules (or the row's edge).
  if (i > 0 && runs[i - 1] < mod * 3) return "";
  const quietAfter = (j) => j >= n || runs[j] >= mod * 3;

  // EAN-13 / UPC-A: guard, 6 digits, middle guard (5 runs), 6 digits, guard = 59 runs.
  if (i + 59 <= n && guardFits(runs, i + 27, 5, mod) && guardFits(runs, i + 56, 3, mod) && quietAfter(i + 59)) {
    let parity = "", digits = "";
    let ok = true;
    for (let k = 0; k < 6 && ok; k++) {
      const m = matchDigit(runs, i + 3 + k * 4, [L, G]);
      if (!m) ok = false; else { digits += m.d; parity += m.parity; }
    }
    for (let k = 0; k < 6 && ok; k++) {
      const m = matchDigit(runs, i + 32 + k * 4, [L]);
      if (!m) ok = false; else digits += m.d;
    }
    const first = FIRST.indexOf(parity);
    if (ok && first >= 0 && ean13Valid(`${first}${digits}`)) return `${first}${digits}`;
  }
  // EAN-8: guard, 4 L digits, middle guard, 4 R digits, guard = 43 runs.
  if (i + 43 <= n && guardFits(runs, i + 19, 5, mod) && guardFits(runs, i + 40, 3, mod) && quietAfter(i + 43)) {
    let digits = "";
    let ok = true;
    for (let k = 0; k < 8 && ok; k++) {
      const m = matchDigit(runs, k < 4 ? i + 3 + k * 4 : i + 24 + (k - 4) * 4, [L]);
      if (!m) ok = false; else digits += m.d;
    }
    if (ok && ean8Valid(digits)) return digits;
  }
  // UPC-E: guard, 6 digits (L or G), end guard of 6 runs = 33 runs, quiet zone after.
  if (i + 33 <= n && guardFits(runs, i + 27, 6, mod) && quietAfter(i + 33)) {
    let parity = "", digits = "";
    let ok = true;
    for (let k = 0; k < 6 && ok; k++) {
      const m = matchDigit(runs, i + 3 + k * 4, [L, G]);
      if (!m) ok = false; else { digits += m.d; parity += m.parity; }
    }
    if (ok) {
      for (const ns of [0, 1]) {
        const pattern = ns === 0 ? parity : [...parity].map((p) => (p === "0" ? "1" : "0")).join("");
        const check = UPCE.indexOf(pattern);
        if (check < 0) continue;
        const a = upcEToA(ns, digits, check);
        if (ean13Valid(`0${a}`)) return `0${a}`;
      }
    }
  }
  return "";
}

// Runs of dark/light along a row of luminance values (0-255), split at
// `threshold` (one number or a per-pixel array). Each edge is placed between
// pixels where the brightness crosses the threshold, so widths are fractions
// of a pixel and thin bars far from the camera still measure right.
// Returns { runs, leadLight }: the widths, and whether the first run is light.
export function toRuns(lum, threshold) {
  const n = lum.length;
  if (!n) return { runs: [], leadLight: false };
  const thr = (i) => (typeof threshold === "number" ? threshold : threshold[i]);
  const edges = [0];
  let dark = lum[0] < thr(0);
  const leadLight = !dark;
  for (let i = 1; i < n; i++) {
    const isDark = lum[i] < thr(i);
    if (isDark === dark) continue;
    const a = lum[i - 1] - thr(i - 1), b = lum[i] - thr(i);
    const f = a === b ? 0.5 : a / (a - b);
    edges.push(i - 1 + Math.min(1, Math.max(0, f)) + 0.5);
    dark = isDark;
  }
  edges.push(n);
  const runs = [];
  for (let k = 1; k < edges.length; k++) runs.push(edges[k] - edges[k - 1]);
  return { runs, leadLight };
}

function decodeRuns(runs, startDark) {
  for (let i = startDark; i + 33 <= runs.length; i += 2) {
    const code = decodeAt(runs, i);
    if (code) return code;
  }
  return "";
}

// Thresholds to try on one row: the midpoint of its dark and light ends, and
// a local midpoint between the darkest and lightest pixels nearby (for uneven
// light across the package, and blur that dims thin gaps).
function thresholds(lum) {
  const n = lum.length;
  const sorted = Float64Array.from(lum).sort();
  const lo = sorted[Math.floor(n * 0.05)], hi = sorted[Math.floor(n * 0.95)];
  if (hi - lo < 24) return []; // no contrast: nothing to read
  const out = [(lo + hi) / 2];
  const win = Math.max(6, Math.round(n / 24));
  const local = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let mn = 255, mx = 0;
    for (let k = Math.max(0, i - win), b = Math.min(n, i + win + 1); k < b; k++) { const v = lum[k]; if (v < mn) mn = v; if (v > mx) mx = v; }
    // Where the window holds no edge (a quiet zone), fall back to the row's midpoint.
    local[i] = mx - mn < (hi - lo) / 4 ? out[0] : (mn + mx) / 2;
  }
  out.push(local);
  return out;
}

// Decode one row of luminance values, read left to right and right to left,
// as it is and slightly smoothed. Returns the normalized code or "".
export function decodeRow(lum) {
  return decodeLine(lum) || decodeLine(smooth(lum));
}

// A 1-2-1 smoothing pass: sensor noise splits runs; this joins them again.
function smooth(lum) {
  const n = lum.length, out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = (lum[Math.max(0, i - 1)] + 2 * lum[i] + lum[Math.min(n - 1, i + 1)]) / 4;
  return out;
}

function decodeLine(lum) {
  for (const thr of thresholds(lum)) {
    const { runs, leadLight } = toRuns(lum, thr);
    const fwd = decodeRuns(runs, leadLight ? 1 : 0);
    if (fwd) return normalizeBarcode(fwd);
    const rev = [...runs].reverse();
    // Reversed, the row's last run comes first: skip it when it is light.
    const lastLight = (runs.length - (leadLight ? 1 : 0)) % 2 === 0;
    const back = decodeRuns(rev, lastLight ? 1 : 0);
    if (back) return normalizeBarcode(back);
  }
  return "";
}

// Luminance of row y (or column x when `vertical`) of RGBA pixel data, between
// `from` and `to` (fractions of the line's length).
export function lineOf(img, at, { vertical = false, from = 0, to = 1 } = {}) {
  const { width: w, height: h, data } = img;
  const len = vertical ? h : w;
  const a = Math.floor(len * from), b = Math.ceil(len * to);
  const out = new Float64Array(b - a);
  for (let i = a; i < b; i++) {
    const p = (vertical ? i * w + at : at * w + i) * 4;
    out[i - a] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return out;
}

// Decode an image ({ width, height, data: RGBA }) by reading `rows` rows across
// the middle of the band from `top` to `bottom` (fractions of the height), and
// `cols` columns too when the barcode may stand upright. Returns every code
// read with how many lines read it, most first: [{ code, reads }].
export function decodeImage(img, { rows = 9, cols = 0, top = 0.2, bottom = 0.8 } = {}) {
  const counts = new Map();
  const add = (c) => { if (c) counts.set(c, (counts.get(c) ?? 0) + 1); };
  for (let r = 0; r < rows; r++) {
    const y = Math.round(img.height * (top + ((bottom - top) * (r + 0.5)) / rows));
    add(decodeRow(lineOf(img, Math.min(img.height - 1, y))));
  }
  for (let c = 0; c < cols; c++) {
    const x = Math.round((img.width * (c + 0.5)) / cols);
    add(decodeRow(lineOf(img, Math.min(img.width - 1, x), { vertical: true })));
  }
  return [...counts].map(([code, reads]) => ({ code, reads })).sort((a, b) => b.reads - a.reads);
}
