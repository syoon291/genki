// Body scans (an InBody-style body composition printout): the fields, form
// parsing with lb/kg, the change between scans, and how far a scan's weight
// sits above that morning's weigh-in. Pure functions, unit-tested.
//
// A scan is { id, date: "YYYY-MM-DD", time: "HH:MM"|null, unit: "lb"|"kg" (as
// typed), weightKg, smmKg, fatKg, leanKg, pbf (%), vfa (cm²), bmr (kcal),
// ecwTbw (ratio), at (ISO time saved) }. Every number but the weight may be
// null (not on the printout). Masses are kept in kg with 3 decimals so a
// value typed in lb reads back exactly. A scan's weight is taken clothed and
// at any time of day, so it is never written to the weigh-ins.
import { validDate } from "./weight.js";

const KG_PER_LB = 0.45359237;

// Field order is the form's and the card's. mass: typed in the scan's unit.
// better: which way is good (+1 up, -1 down, 0 neither).
export const SCAN_FIELDS = [
  { id: "weightKg", label: "Weight", mass: true, min: 30, max: 300, better: 0, required: true },
  { id: "smmKg", label: "Skeletal muscle mass", short: "Muscle", mass: true, min: 5, max: 150, better: 1 },
  { id: "fatKg", label: "Body fat mass", short: "Fat mass", mass: true, min: 1, max: 200, better: -1 },
  { id: "pbf", label: "Percent body fat", short: "Body fat", unit: "%", min: 2, max: 75, step: 0.1, better: -1 },
  { id: "vfa", label: "Visceral fat area", short: "Visceral fat", unit: "cm²", min: 1, max: 400, step: 0.1, better: -1 },
  { id: "bmr", label: "Basal metabolic rate", short: "BMR", unit: "kcal", min: 500, max: 5000, step: 1, better: 0 },
  { id: "leanKg", label: "Lean body mass", short: "Lean mass", mass: true, min: 10, max: 250, better: 1 },
  { id: "ecwTbw", label: "ECW/TBW", unit: "", min: 0.3, max: 0.5, step: 0.001, better: 0 },
];

const round = (n, places) => { const f = 10 ** places; return Math.round(n * f) / f; };
export const toKg = (v, unit) => (unit === "lb" ? v * KG_PER_LB : v);
export const fromKg = (kg, unit) => (unit === "lb" ? kg / KG_PER_LB : kg);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const scanId = (date, time) => `scan-${date}${time ? `T${time}` : ""}`;

// Read the form's values ({ date, time, unit, weightKg: "151.1", ... } as
// typed) into a scan, or { error } naming the first problem.
export function parseScanForm(values, today) {
  const date = String(values.date ?? "");
  if (!validDate(date) || (today && date > today)) return { error: "Pick the scan's day, up to today." };
  const time = String(values.time ?? "").trim();
  if (time && !TIME_RE.test(time)) return { error: "Enter the time as HH:MM, or leave it empty." };
  const unit = values.unit === "kg" ? "kg" : "lb";
  const scan = { id: scanId(date, time || null), date, time: time || null, unit };
  for (const f of SCAN_FIELDS) {
    const raw = String(values[f.id] ?? "").trim().replace(",", ".");
    if (raw === "") {
      if (f.required) return { error: `Enter the ${f.label.toLowerCase()}.` };
      scan[f.id] = null;
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return { error: `${f.label} must be a number.` };
    const v = f.mass ? toKg(n, unit) : n;
    if (v < f.min || v > f.max) {
      const lo = f.mass ? round(fromKg(f.min, unit), 0) : f.min, hi = f.mass ? round(fromKg(f.max, unit), 0) : f.max;
      return { error: `${f.label} must be between ${lo} and ${hi}${f.mass ? ` ${unit}` : f.unit ? ` ${f.unit}` : ""}.` };
    }
    scan[f.id] = f.mass ? round(v, 3) : f.id === "ecwTbw" ? round(v, 3) : round(v, 1);
  }
  if (scan.smmKg !== null && scan.smmKg >= scan.weightKg) return { error: "Muscle mass must be less than the weight." };
  if (scan.fatKg !== null && scan.fatKg >= scan.weightKg) return { error: "Fat mass must be less than the weight." };
  return { scan };
}

// Oldest first (by day, then time; a scan with no time sorts first on its day).
export function sortScans(list) {
  return [...list].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""));
}

// The value of a field in the unit shown (masses in `unit`, the rest as stored).
export function shown(scan, f, unit) {
  const v = scan?.[f.id];
  if (v === null || v === undefined) return null;
  return f.mass ? fromKg(v, unit) : v;
}

// Change from `prev` to `cur` for each field both have, in the unit shown:
// [{ field, value, delta, good: true|false|null }]. A field `cur` lacks is left out.
export function scanChanges(cur, prev, unit) {
  const out = [];
  for (const f of SCAN_FIELDS) {
    const value = shown(cur, f, unit);
    if (value === null) continue;
    const before = shown(prev, f, unit);
    const delta = before === null ? null : value - before;
    const tiny = f.id === "ecwTbw" ? 0.0005 : 0.05;
    const good = delta === null || f.better === 0 || Math.abs(delta) < tiny ? null : Math.sign(delta) === f.better;
    out.push({ field: f, value, delta, good });
  }
  return out;
}

// How much heavier the scan read than that day's weigh-in (kg), or null when
// that day has none. Clothes and the time of day both add to it.
export function overWeighIn(scan, weighIns) {
  const w = weighIns.find((x) => x.date === scan.date);
  return w ? round(scan.weightKg - w.kg, 3) : null;
}

// What the screen reader hears after a save.
export function scanMessage(scan, prev, unit) {
  const ch = scanChanges(scan, prev, unit);
  const pick = (id) => ch.find((c) => c.field.id === id);
  const parts = [];
  for (const id of ["smmKg", "pbf"]) {
    const c = pick(id);
    if (!c) continue;
    const u = c.field.mass ? ` ${unit}` : ` ${c.field.unit}`;
    parts.push(`${c.field.short ?? c.field.label} ${round(c.value, 1)}${u}${c.delta === null ? "" : `, ${c.delta >= 0 ? "up" : "down"} ${round(Math.abs(c.delta), 1)} since the last scan`}`);
  }
  return `Body scan saved.${parts.length ? ` ${parts.join("; ")}.` : ""}`;
}
