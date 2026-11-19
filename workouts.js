// Workout maths, ported from Liftlog (the website's workout planner): the
// exercise library, the plan generator, double progression, estimated 1RM,
// volume per muscle, records and the CSV export. Pure functions only (no DOM,
// no IndexedDB), so they run under `node --test` as well as in the browser.
// Weights are stored in kg; lb is only a display unit.

export const MUSCLES = ["chest", "back", "shoulders", "biceps", "triceps", "quads", "hamstrings", "glutes", "calves", "core"];

// p = movement pattern, eq = equipment it needs, pri/sec = primary and secondary muscles,
// c = compound, inc = smallest sensible load jump in kg (0 = progress with reps instead).
export const EX = [
  { id: "back-squat", name: "Back squat", p: "squat", eq: ["gym"], pri: ["quads", "glutes"], sec: ["core"], c: 1, inc: 2.5 },
  { id: "front-squat", name: "Front squat", p: "squat", eq: ["gym"], pri: ["quads"], sec: ["glutes", "core"], c: 1, inc: 2.5 },
  { id: "goblet-squat", name: "Goblet squat", p: "squat", eq: ["db"], pri: ["quads", "glutes"], sec: ["core"], c: 1, inc: 2 },
  { id: "bw-squat", name: "Tempo bodyweight squat", p: "squat", eq: ["bw"], pri: ["quads", "glutes"], sec: [], c: 1, inc: 0 },

  { id: "deadlift", name: "Deadlift", p: "hinge", eq: ["gym"], pri: ["hamstrings", "glutes"], sec: ["back", "core"], c: 1, inc: 5 },
  { id: "rdl", name: "Romanian deadlift", p: "hinge", eq: ["gym"], pri: ["hamstrings", "glutes"], sec: ["back"], c: 1, inc: 2.5 },
  { id: "db-rdl", name: "Dumbbell Romanian deadlift", p: "hinge", eq: ["db"], pri: ["hamstrings", "glutes"], sec: ["back"], c: 1, inc: 2 },
  { id: "hip-thrust", name: "Hip thrust", p: "hinge", eq: ["gym", "db"], pri: ["glutes"], sec: ["hamstrings"], c: 1, inc: 2.5 },
  { id: "sl-rdl", name: "Single-leg RDL", p: "hinge", eq: ["bw"], pri: ["hamstrings", "glutes"], sec: ["core"], c: 1, inc: 0 },
  { id: "sl-bridge", name: "Single-leg glute bridge", p: "hinge", eq: ["bw"], pri: ["glutes"], sec: ["hamstrings"], c: 0, inc: 0 },

  { id: "bss", name: "Bulgarian split squat", p: "lunge", eq: ["db", "bw"], pri: ["quads", "glutes"], sec: [], c: 1, inc: 2 },
  { id: "walking-lunge", name: "Walking lunge", p: "lunge", eq: ["db", "bw"], pri: ["quads", "glutes"], sec: ["hamstrings"], c: 1, inc: 2 },

  { id: "leg-press", name: "Leg press", p: "quad", eq: ["gym"], pri: ["quads"], sec: ["glutes"], c: 1, inc: 5 },
  { id: "leg-ext", name: "Leg extension", p: "quad", eq: ["gym"], pri: ["quads"], sec: [], c: 0, inc: 2.5 },
  { id: "step-up", name: "Step-up", p: "quad", eq: ["db", "bw"], pri: ["quads"], sec: ["glutes"], c: 1, inc: 2 },

  { id: "leg-curl", name: "Seated leg curl", p: "ham", eq: ["gym"], pri: ["hamstrings"], sec: [], c: 0, inc: 2.5 },
  { id: "nordic", name: "Assisted Nordic curl", p: "ham", eq: ["bw"], pri: ["hamstrings"], sec: [], c: 0, inc: 0 },
  { id: "slide-curl", name: "Sliding leg curl", p: "ham", eq: ["bw"], pri: ["hamstrings"], sec: ["glutes"], c: 0, inc: 0 },

  { id: "bench", name: "Bench press", p: "hpush", eq: ["gym"], pri: ["chest"], sec: ["triceps", "shoulders"], c: 1, inc: 2.5 },
  { id: "incline-db", name: "Incline dumbbell press", p: "hpush", eq: ["db"], pri: ["chest"], sec: ["shoulders", "triceps"], c: 1, inc: 2 },
  { id: "db-bench", name: "Dumbbell bench press", p: "hpush", eq: ["db"], pri: ["chest"], sec: ["triceps", "shoulders"], c: 1, inc: 2 },
  { id: "push-up", name: "Push-up", p: "hpush", eq: ["bw"], pri: ["chest"], sec: ["triceps", "shoulders"], c: 1, inc: 0 },
  { id: "deficit-push-up", name: "Deficit push-up", p: "hpush", eq: ["bw"], pri: ["chest"], sec: ["triceps", "shoulders"], c: 1, inc: 0 },

  { id: "ohp", name: "Overhead press", p: "vpush", eq: ["gym"], pri: ["shoulders"], sec: ["triceps", "core"], c: 1, inc: 2.5 },
  { id: "db-shoulder", name: "Seated dumbbell shoulder press", p: "vpush", eq: ["db"], pri: ["shoulders"], sec: ["triceps"], c: 1, inc: 2 },
  { id: "pike", name: "Pike push-up", p: "vpush", eq: ["bw"], pri: ["shoulders"], sec: ["triceps"], c: 1, inc: 0 },

  { id: "bb-row", name: "Barbell row", p: "hpull", eq: ["gym"], pri: ["back"], sec: ["biceps"], c: 1, inc: 2.5 },
  { id: "cable-row", name: "Seated cable row", p: "hpull", eq: ["gym"], pri: ["back"], sec: ["biceps"], c: 1, inc: 2.5 },
  { id: "db-row", name: "One-arm dumbbell row", p: "hpull", eq: ["db"], pri: ["back"], sec: ["biceps"], c: 1, inc: 2 },
  { id: "inverted-row", name: "Inverted row", p: "hpull", eq: ["bw"], pri: ["back"], sec: ["biceps"], c: 1, inc: 0 },

  { id: "pulldown", name: "Lat pulldown", p: "vpull", eq: ["gym"], pri: ["back"], sec: ["biceps"], c: 1, inc: 2.5 },
  { id: "pull-up", name: "Pull-up", p: "vpull", eq: ["gym", "bw"], pri: ["back"], sec: ["biceps"], c: 1, inc: 0 },
  { id: "db-pullover", name: "Dumbbell pullover", p: "vpull", eq: ["db"], pri: ["back"], sec: ["chest"], c: 0, inc: 2 },

  { id: "cable-fly", name: "Cable fly", p: "fly", eq: ["gym"], pri: ["chest"], sec: [], c: 0, inc: 2.5 },
  { id: "db-fly", name: "Dumbbell fly", p: "fly", eq: ["db"], pri: ["chest"], sec: [], c: 0, inc: 1 },
  { id: "slow-push-up", name: "Slow-eccentric push-up", p: "fly", eq: ["bw"], pri: ["chest"], sec: ["triceps"], c: 0, inc: 0 },

  { id: "lateral", name: "Dumbbell lateral raise", p: "lateral", eq: ["db"], pri: ["shoulders"], sec: [], c: 0, inc: 1 },
  { id: "cable-lateral", name: "Cable lateral raise", p: "lateral", eq: ["gym"], pri: ["shoulders"], sec: [], c: 0, inc: 1 },
  { id: "y-raise", name: "Prone Y-raise", p: "lateral", eq: ["bw"], pri: ["shoulders"], sec: ["back"], c: 0, inc: 0 },

  { id: "ez-curl", name: "EZ-bar curl", p: "biceps", eq: ["gym"], pri: ["biceps"], sec: [], c: 0, inc: 2.5 },
  { id: "db-curl", name: "Dumbbell curl", p: "biceps", eq: ["db"], pri: ["biceps"], sec: [], c: 0, inc: 1 },
  { id: "chin-up", name: "Chin-up", p: "biceps", eq: ["bw"], pri: ["biceps", "back"], sec: [], c: 1, inc: 0 },

  { id: "pushdown", name: "Cable pushdown", p: "triceps", eq: ["gym"], pri: ["triceps"], sec: [], c: 0, inc: 2.5 },
  { id: "oh-ext", name: "Overhead dumbbell extension", p: "triceps", eq: ["db"], pri: ["triceps"], sec: [], c: 0, inc: 1 },
  { id: "bench-dip", name: "Bench dip", p: "triceps", eq: ["bw"], pri: ["triceps"], sec: ["chest"], c: 0, inc: 0 },

  { id: "calf-raise", name: "Standing calf raise", p: "calves", eq: ["gym", "db"], pri: ["calves"], sec: [], c: 0, inc: 2.5 },
  { id: "sl-calf", name: "Single-leg calf raise", p: "calves", eq: ["bw"], pri: ["calves"], sec: [], c: 0, inc: 0 },

  { id: "cable-crunch", name: "Cable crunch", p: "core", eq: ["gym"], pri: ["core"], sec: [], c: 0, inc: 2.5 },
  { id: "knee-raise", name: "Hanging knee raise", p: "core", eq: ["gym", "bw"], pri: ["core"], sec: [], c: 0, inc: 0 },
  { id: "dead-bug", name: "Dead bug", p: "core", eq: ["bw"], pri: ["core"], sec: [], c: 0, inc: 0 },
];
export const BY_ID = Object.fromEntries(EX.map((e) => [e.id, e]));

// An exercise's name: the library's, else one of the owner's own exercises
// (the `exercises` store, brought in with an imported history: { id: name }).
export const exLabel = (id, names = {}) => BY_ID[id]?.name ?? names[id] ?? id;

// A gym has dumbbells and a floor; a dumbbell setup has a floor.
const ALLOWED = { gym: ["gym", "db", "bw"], db: ["db", "bw"], bw: ["bw"] };

export function candidates(pattern, equip) {
  const allowed = ALLOWED[equip] || ALLOWED.gym;
  // Prefer exercises that use the best equipment available, then fall back.
  return EX.filter((e) => e.p === pattern && e.eq.some((q) => allowed.includes(q)))
    .sort((a, b) => rank(a) - rank(b));
  function rank(e) { return Math.min(...e.eq.map((q) => { const i = allowed.indexOf(q); return i < 0 ? 9 : i; })); }
}

// Day templates: [pattern, variant offset, main lift?]
const T = {
  fbA: ["Full body A", [["squat", 0, 1], ["hpush", 0, 1], ["hpull", 0, 1], ["ham", 0], ["lateral", 0], ["biceps", 0], ["core", 0]]],
  fbB: ["Full body B", [["hinge", 0, 1], ["vpush", 0, 1], ["vpull", 0, 1], ["lunge", 0], ["fly", 0], ["triceps", 0], ["calves", 0]]],
  fbC: ["Full body C", [["squat", 1, 1], ["hpush", 1, 1], ["vpull", 1], ["hinge", 1], ["lateral", 0], ["biceps", 0], ["triceps", 0]]],
  upA: ["Upper A", [["hpush", 0, 1], ["hpull", 0, 1], ["vpush", 0], ["vpull", 0], ["fly", 0], ["lateral", 0], ["triceps", 0]]],
  loA: ["Lower A", [["squat", 0, 1], ["hinge", 1], ["quad", 0], ["ham", 0], ["calves", 0], ["core", 0]]],
  upB: ["Upper B", [["vpush", 0, 1], ["vpull", 0, 1], ["hpush", 1], ["hpull", 1], ["fly", 0], ["biceps", 0], ["triceps", 0]]],
  loB: ["Lower B", [["hinge", 0, 1], ["lunge", 0], ["quad", 1], ["ham", 0], ["calves", 0], ["core", 1]]],
  push: ["Push", [["hpush", 0, 1], ["vpush", 0], ["hpush", 1], ["fly", 0], ["lateral", 0], ["triceps", 0]]],
  pull: ["Pull", [["vpull", 0, 1], ["hpull", 0], ["hpull", 1], ["lateral", 1], ["biceps", 0], ["core", 0]]],
  legs: ["Legs", [["squat", 0, 1], ["hinge", 1], ["lunge", 0], ["quad", 1], ["ham", 0], ["calves", 0]]],
};
export const SPLITS = {
  2: { name: "Full body, twice a week", days: ["fbA", "fbB"] },
  3: { name: "Full body, three times a week", days: ["fbA", "fbB", "fbC"] },
  4: { name: "Upper / lower", days: ["upA", "loA", "upB", "loB"] },
  5: { name: "Push / pull / legs + upper / lower", days: ["push", "pull", "legs", "upA", "loA"] },
  6: { name: "Push / pull / legs, twice", days: ["push", "pull", "legs", "push", "pull", "legs"] },
};

// Prescriptions by goal: main lifts and accessories.
export const SCHEME = {
  strength: { main: { sets: 4, lo: 3, hi: 5, rir: 2, rest: 180 }, acc: { sets: 3, lo: 6, hi: 10, rir: 2, rest: 90 } },
  hypertrophy: { main: { sets: 3, lo: 6, hi: 10, rir: 2, rest: 120 }, acc: { sets: 3, lo: 10, hi: 15, rir: 1, rest: 75 } },
  general: { main: { sets: 3, lo: 8, hi: 12, rir: 3, rest: 90 }, acc: { sets: 2, lo: 10, hi: 15, rir: 2, rest: 60 } },
};

export function generatePlan({ goal = "hypertrophy", days = 4, equip = "gym", level = "intermediate" } = {}) {
  days = Math.min(6, Math.max(2, Math.round(days)));
  const split = SPLITS[days];
  const scheme = SCHEME[goal] || SCHEME.hypertrophy;
  const planDays = split.days.map((key, di) => {
    const [name, slots] = T[key];
    // The second pass of a repeated day (PPL x2) rotates exercise variants.
    const repeat = split.days.slice(0, di).filter((k) => k === key).length;
    const used = new Set();
    const out = [];
    for (const [p, v, main] of slots) {
      const list = candidates(p, equip).filter((e) => !used.has(e.id));
      if (!list.length) continue;
      const ex = list[(v + repeat) % list.length];
      used.add(ex.id);
      const s = { ...(main ? scheme.main : scheme.acc) };
      if (level === "beginner") s.sets = Math.max(2, s.sets - 1);
      if (level === "advanced" && !main) s.sets += 1;
      if (ex.inc === 0) { s.lo = Math.max(s.lo, 8); s.hi = Math.max(s.hi, 20); }
      out.push({ exId: ex.id, main: !!main, ...s });
    }
    return { name: repeat ? name + " (2)" : name, slots: out };
  });
  return { goal, days, equip, level, split: split.name, created: new Date().toISOString(), schedule: planDays };
}

// Fractional set counting: a set counts 1 for each primary muscle and 0.5 for each secondary.
function addSets(acc, exId, n) {
  const ex = BY_ID[exId];
  if (!ex) return acc;
  for (const m of ex.pri) acc[m] = (acc[m] || 0) + n;
  for (const m of ex.sec) acc[m] = (acc[m] || 0) + n * 0.5;
  return acc;
}
export function plannedSets(plan) {
  const acc = Object.fromEntries(MUSCLES.map((m) => [m, 0]));
  for (const d of plan.schedule) for (const s of d.slots) addSets(acc, s.exId, s.sets);
  return acc;
}
export function loggedSets(sessions, from, to) {
  const acc = Object.fromEntries(MUSCLES.map((m) => [m, 0]));
  for (const s of sessions) {
    const t = new Date(s.date).getTime();
    if (t < from || t >= to) continue;
    for (const set of s.sets) addSets(acc, set.exId, 1);
  }
  return acc;
}

// Estimated one-rep max, Epley formula, adjusted for reps in reserve:
// 100 kg x 8 with 2 left in the tank is treated like a 10-rep max.
export function e1rm(w, reps, rir) {
  const r = Math.min(15, (+reps || 0) + (+rir || 0));
  if (!w || !reps) return 0;
  return r <= 1 ? w : w * (1 + r / 30);
}

export const DAY = 864e5;
export function weekStart(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x.getTime();
}

export function history(sessions, exId) {
  // Per session: best e1RM, top weight, and the sets, oldest first.
  return sessions
    .filter((s) => s.sets.some((x) => x.exId === exId))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map((s) => {
      const sets = s.sets.filter((x) => x.exId === exId);
      return { date: s.date, sets, best: Math.max(...sets.map((x) => e1rm(x.w, x.reps, x.rir))), top: Math.max(...sets.map((x) => x.w || 0)) };
    });
}

// Double progression: work up to the top of the rep range on every set, then add load.
export function suggest(exId, slot, sessions) {
  const ex = BY_ID[exId] || { inc: 0 };
  const h = history(sessions, exId);
  if (!h.length) return { w: null, reps: slot.hi, why: "First time: pick a weight you could lift for a few more reps than the target." };
  const last = h[h.length - 1];
  const w = last.top;
  const work = last.sets.filter((x) => (x.w || 0) === w);
  const below = work.filter((x) => x.reps < slot.lo).length;
  if (work.length && work.every((x) => x.reps >= slot.hi)) {
    if (!ex.inc) return { w, reps: slot.hi + 1, why: "Top of the range on every set: add a rep or slow the tempo." };
    return { w: w + ex.inc, reps: slot.lo, why: `Top of the range on every set last time: add ${ex.inc} kg.` };
  }
  if (below > work.length / 2 && ex.inc) return { w: round(w * 0.9, ex.inc), reps: slot.lo, why: "Missed the range on most sets: drop about 10% and build back." };
  const bestReps = Math.max(...work.map((x) => x.reps));
  // 7.4 last time: aim for 8 (a whole rep), not 8.4.
  return { w, reps: Math.min(slot.hi, Math.floor(bestReps) + 1), why: "Same weight: beat last time by a rep on at least one set." };
}
const round = (v, step) => step ? Math.max(step, Math.round(v / step) * step) : v;

// Least-squares slope of e1RM over time, in kg per week.
export function slopePerWeek(points) {
  if (points.length < 3) return null;
  const xs = points.map((p) => new Date(p.date).getTime() / (7 * DAY));
  const ys = points.map((p) => p.best);
  const mx = mean(xs), my = mean(ys);
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  if (!den) return null;
  const slope = num / den;
  const ss = ys.reduce((a, y, i) => a + (y - (my + slope * (xs[i] - mx))) ** 2, 0);
  const st = ys.reduce((a, y) => a + (y - my) ** 2, 0);
  return { slope, r2: st ? 1 - ss / st : 0, intercept: my - slope * mx };
}
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

export function weeklyTonnage(sessions, weeks, now = Date.now()) {
  const end = weekStart(now) + 7 * DAY;
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const from = end - (i + 1) * 7 * DAY, to = from + 7 * DAY;
    let kg = 0, sets = 0, n = 0;
    for (const s of sessions) {
      const t = new Date(s.date).getTime();
      if (t < from || t >= to) continue;
      n++;
      for (const x of s.sets) { kg += setLoad(x); sets++; }
    }
    out.push({ from, kg, sets, sessions: n });
  }
  return out;
}

// Personal records: a session's best e1RM that beats every earlier session.
export function records(sessions) {
  const prs = [];
  const byEx = new Set(sessions.flatMap((s) => s.sets.map((x) => x.exId)));
  for (const id of byEx) {
    let best = 0;
    for (const p of history(sessions, id)) {
      if (p.best > best * 1.0001) { if (best > 0) prs.push({ exId: id, date: p.date, best: p.best, prev: best }); best = p.best; }
    }
  }
  return prs.sort((a, b) => new Date(b.date) - new Date(a.date));
}

export function toCSV(sessions, unit, names = {}) {
  const f = unit === "lb" ? 2.20462 : 1;
  const q = (v) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  // Text a spreadsheet would run as a formula (=, +, -, @ first) is kept as text.
  const txt = (v) => /^[=+\-@\t\r]/.test(String(v)) ? `'${v}` : v;
  const rows = [["date", "session", "exercise", "pattern", "set", `weight_${unit}`, "reps", "rir", `e1rm_${unit}`, "primary_muscles", "notation"]];
  for (const s of [...sessions].sort((a, b) => new Date(a.date) - new Date(b.date))) {
    const count = {};
    for (const x of s.sets) {
      const ex = BY_ID[x.exId] || { name: exLabel(x.exId, names), p: "", pri: [] };
      count[x.exId] = (count[x.exId] || 0) + 1;
      rows.push([s.date.slice(0, 10), txt(s.day), txt(ex.name), ex.p, count[x.exId], +(x.w * f).toFixed(1), x.reps, x.rir ?? "", +(e1rm(x.w, x.reps, x.rir) * f).toFixed(1), ex.pri.join("|"), formatReps(x)]);
    }
  }
  return rows.map((r) => r.map(q).join(",")).join("\n") + "\n";
}


// ---------- genki additions ----------

export const LB_PER_KG = 2.20462;
export const UNITS = ["kg", "lb"];

// kg -> the shown number in `unit`, rounded to a step a plate set can make:
// 0.5 kg, or 2.5 lb for small-jump exercises (inc under 2.5 kg) and 5 lb otherwise.
export function fmtWeight(kg, unit = "kg", ex = null) {
  if (kg == null || kg === "") return "";
  const v = unit === "lb" ? kg * LB_PER_KG : kg;
  const step = unit === "lb" ? (ex && ex.inc && ex.inc < 2.5 ? 2.5 : 5) : 0.5;
  return String(+(Math.round(v / step) * step).toFixed(1));
}
export const toKg = (v, unit = "kg") => (unit === "lb" ? v / LB_PER_KG : v);

// Rough session length: each set's rest plus ~40 s under the bar, plus a warm-up.
export const estMinutes = (day) => day.slots.reduce((a, s) => a + (s.sets * (s.rest + 40)) / 60, 0) + 5;

// Load moved in a session: weight x reps over every set (kg).
// Extra reps (the "+1" of "7+1H") count as load moved, not toward the 1RM.
export const setLoad = (x) => (x.w || 0) * ((x.reps || 0) + (x.extra || 0));
export const sessionVolume = (session) => session.sets.reduce((a, x) => a + setLoad(x), 0);

// A new in-progress session for plan day `i`: one row per planned set, the
// weight pre-filled from the progression suggestion (as text in `unit`).
export function newDraft(plan, i, sessions, unit = "kg", now = Date.now()) {
  const day = plan.schedule[i];
  return {
    dayIdx: i, day: day.name, started: now,
    entries: day.slots.map((slot) => ({ exId: slot.exId, slot, sets: Array.from({ length: slot.sets }, () => ({ w: prefill(slot.exId, slot, sessions, unit), reps: "", rir: "", done: false })) })),
  };
}
export function prefill(exId, slot, sessions, unit = "kg") {
  const sug = suggest(exId, slot, sessions), ex = BY_ID[exId];
  return sug.w != null && ex && ex.inc ? fmtWeight(sug.w, unit, ex) : "";
}

// The sets worth saving from a draft: rows whose reps parse (rep notation,
// below) to more than 0. Weights typed in `unit` become kg (3 decimals, so a
// pound weight reads back exactly); a blank RIR takes the slot's target, or 0
// on a set marked hard. A drop set needs a set before it.
export function collectSets(draft, unit = "kg") {
  const sets = [];
  for (const e of draft.entries) {
    let first = true;
    for (const x of e.sets) {
      const p = parseReps(x.reps);
      if (!p) continue;
      const w = parseFloat(x.w);
      const rir = x.rir === "" || x.rir == null ? (p.hard ? 0 : e.slot.rir) : parseInt(x.rir, 10);
      const { reps, ...flags } = p;
      if (first) delete flags.drop;
      first = false;
      sets.push({ exId: e.exId, w: Number.isFinite(w) && w > 0 ? +toKg(w, unit).toFixed(3) : 0, reps, rir: Number.isFinite(rir) ? rir : null, ...flags });
    }
  }
  return sets;
}

// Records `session` set, given every session saved before it.
export function newRecords(before, session) {
  const seen = new Set(records(before).map((p) => p.exId + p.date));
  return records([...before, session]).filter((p) => p.date === session.date && !seen.has(p.exId + p.date));
}

// ---------- Liftlog migration ----------
// Liftlog kept one JSON object in localStorage ("liftlog.v1", the same origin as
// genki on GitHub Pages) and wrote the same object as its backup file.
export const LIFTLOG_KEY = "liftlog.v1";

const validSet = (x) => x && typeof x === "object" && typeof x.exId === "string" && Number.isFinite(+x.reps) && +x.reps > 0;
const validSession = (s) => s && typeof s === "object" && typeof s.id === "string" && s.id && !Number.isNaN(new Date(s.date).getTime()) && Array.isArray(s.sets);

// A plan from outside, rebuilt field by field: the view prints its numbers and
// names into the page, so nothing unchecked may pass through.
const num = (v, lo, hi, dflt) => (Number.isFinite(+v) && v !== null && v !== "" ? Math.min(hi, Math.max(lo, Math.round(+v))) : dflt);
const oneOf = (v, list, dflt) => (list.includes(v) ? v : dflt);
function cleanPlan(p) {
  if (!p || typeof p !== "object" || !Array.isArray(p.schedule) || !p.schedule.length) return null;
  if (!p.schedule.every((day) => day && typeof day === "object" && Array.isArray(day.slots))) return null;
  const schedule = p.schedule.map((day) => ({
    name: String(day.name ?? "Day"),
    slots: day.slots.filter((s) => s && typeof s.exId === "string").map((s) => ({ exId: s.exId, main: !!s.main, sets: num(s.sets, 1, 20, 3), lo: num(s.lo, 1, 100, 8), hi: num(s.hi, 1, 100, 12), rir: num(s.rir, 0, 10, 2), rest: num(s.rest, 0, 3600, 90) })),
  }));
  return {
    goal: oneOf(p.goal, Object.keys(SCHEME), "hypertrophy"), days: num(p.days, 2, 6, Math.min(6, Math.max(2, schedule.length))),
    equip: oneOf(p.equip, Object.keys(ALLOWED), "gym"), level: oneOf(p.level, ["beginner", "intermediate", "advanced"], "intermediate"),
    split: String(p.split ?? ""), created: typeof p.created === "string" ? p.created : new Date().toISOString(), schedule,
  };
}

// Liftlog state -> { plan|null, next, unit, form|null, sessions } or null if it is not Liftlog data.
export function fromLiftlog(raw) {
  let d = raw;
  if (typeof raw === "string") { try { d = JSON.parse(raw); } catch { return null; } }
  if (!d || typeof d !== "object" || d.v !== 1 || !Array.isArray(d.sessions)) return null;
  const sessions = d.sessions.filter(validSession).map((s) => ({
    id: s.id, date: new Date(s.date).toISOString(), day: String(s.day ?? "Session"),
    sets: s.sets.filter(validSet).map((x) => ({ exId: x.exId, w: Number.isFinite(+x.w) ? +x.w : 0, reps: Math.round(+x.reps), rir: Number.isFinite(parseInt(x.rir, 10)) ? parseInt(x.rir, 10) : null })),
    ...(Number.isFinite(+s.minutes) ? { minutes: +s.minutes } : {}),
    source: "liftlog",
  })).filter((s) => s.sets.length);
  const plan = cleanPlan(d.plan);
  const next = plan && Number.isInteger(d.next) && d.next >= 0 && d.next < plan.schedule.length ? d.next : 0;
  return { plan, next, unit: UNITS.includes(d.unit) ? d.unit : "kg", form: plan ? { goal: plan.goal, days: plan.days, equip: plan.equip, level: plan.level } : null, sessions };
}

// Sessions from `incoming` whose id is not already in `existing`.
export function newSessions(existing, incoming) {
  const ids = new Set(existing.map((s) => s.id));
  return incoming.filter((s) => !ids.has(s.id));
}

// What a screen reader hears when a set is ticked done or undone, and when a
// session is saved. w and reps are the typed text of the set row.
export function setMessage({ name, n, of, done, w, reps, unit, rest }) {
  if (!done) return `${name} set ${n} of ${of} marked not done.`;
  // Plain reps read as before ("40 kg × 8"); notation is spelled out ("7.4 reps, hard").
  const p = parseReps(reps);
  const plain = !p || Object.keys(p).length === 1;
  const load = parseFloat(w) > 0 ? `${w} ${unit} × ${plain ? reps : spokenReps(p)}` : plain ? `${reps} reps` : spokenReps(p);
  const r = rest > 0 ? ` Rest ${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, "0")}.` : "";
  return `${name} set ${n} of ${of} done: ${load}.${r}`;
}

export function sessionSavedMessage(session, prs) {
  const sets = session.sets.length;
  return `Session saved: ${session.day}, ${sets} ${sets === 1 ? "set" : "sets"}, ${prs.length} new ${prs.length === 1 ? "PR" : "PRs"}.`;
}

// ---------- rep notation ----------
// How the owner writes a set's reps, read the same way in the app and in an
// imported history:
//   7.4     7 reps and 0.4 of the 8th (12.55: 12 and 0.55 of the 13th)
//   7.7H    H: a hard set, stopped near failure
//   7+1H    +1: extra reps after the set (assisted, cheat or rest-pause)
//   7R, 7L  one side only (RH, LH: right or left hand, the same thing)
//   10R:7L  each side logged on its own
//   d6      a drop set: lighter weight straight after the set before
// H always means hard except straight after R or L ("7RH" is the right hand;
// a hard right-hand set is "7HR" or "7RHH").
// parseReps(text) -> { reps, extra?, hard?, side?, repsL?, repsR?, drop?, note? }
// or null. Strict (the default) refuses any other text; { lenient: true } keeps
// it as the note (for old logs like "8 slow warm").
const n2 = (v) => +(+v).toFixed(2);

function oneSide(s) {
  const m = s.match(/^(\d+(?:\.\d*)?|\.\d+)/);
  if (!m) return null;
  const out = { reps: n2(m[1]) };
  let rest = s.slice(m[0].length);
  for (;;) {
    let t;
    if ((t = rest.match(/^\s*\+\s*(\d+(?:\.\d+)?)/))) out.extra = n2((out.extra || 0) + +t[1]);
    else if ((t = rest.match(/^\s*(right|left)\b/i))) out.side = t[1][0].toUpperCase();
    else if ((t = rest.match(/^\s*([rl])hh(?![a-z])/i))) { out.side = t[1].toUpperCase(); out.hard = true; }
    else if ((t = rest.match(/^\s*([rl])h(?![a-z])/i)) || (t = rest.match(/^\s*([rl])(?![a-z])/i))) out.side = t[1].toUpperCase();
    else if ((t = rest.match(/^\s*h(?=[^a-z]|$|[rl](?![a-z])|[rl]h(?![a-z]))/i))) out.hard = true;
    else break;
    rest = rest.slice(t[0].length);
  }
  out.rest = rest.trim();
  return out;
}

export function parseReps(text, { lenient = false } = {}) {
  let s = String(text ?? "").replace(/,/g, ".").trim();
  if (!s) return null;
  const notes = [];
  let hard = false;
  s = s.replace(/\(([^)]*)\)/g, (_, inner) => { const t = inner.trim(); if (/^h$/i.test(t)) hard = true; else if (t) notes.push(t); return " "; }).trim();
  const dm = s.match(/^(?:drop|d)\s*(?=[\d.])/i);
  if (dm) s = s.slice(dm[0].length);
  const parts = s.split(/\s*:\s*/);
  let out;
  if (parts.length === 2) {
    const a = oneSide(parts[0]), b = oneSide(parts[1]);
    if (!a || !b) return null;
    if (a.rest) notes.push(a.rest);
    if (b.rest) notes.push(b.rest);
    // A side without a letter is the other one: "10L: 8H" is 8 on the right.
    const sa = a.side || (b.side === "L" ? "R" : "L"), sb = b.side || (sa === "L" ? "R" : "L");
    if (sa === sb) return null;
    const L = sa === "L" ? a : b, R = sa === "L" ? b : a;
    out = { reps: Math.min(L.reps, R.reps), repsL: L.reps, repsR: R.reps };
    const extra = (a.extra || 0) + (b.extra || 0);
    if (extra) out.extra = n2(extra);
    if (a.hard || b.hard) hard = true;
  } else if (parts.length === 1) {
    const a = oneSide(s);
    if (!a) return null;
    if (a.rest) notes.push(a.rest);
    out = { reps: a.reps };
    if (a.extra) out.extra = a.extra;
    if (a.side) out.side = a.side;
    if (a.hard) hard = true;
  } else return null;
  if (!(out.reps > 0) || out.reps >= 1000) return null;
  if (notes.length && !lenient) return null;
  if (hard) out.hard = true;
  if (dm) out.drop = true;
  if (notes.length) out.note = notes.join("; ").slice(0, 200);
  return out;
}

// A set's reps written back in the notation (parseReps reads it again).
export function formatReps(x) {
  const h = x.hard ? "H" : "";
  const plus = x.extra ? `+${n2(x.extra)}` : "";
  const body = x.repsL != null && x.repsR != null
    ? `${n2(x.repsR)}${h}R:${n2(x.repsL)}${h}L${plus}`
    : `${n2(x.reps)}${plus}${h}${x.side || ""}`;
  return (x.drop ? "d" : "") + body;
}

// The same, as a screen reader should say it.
export function spokenReps(x) {
  const r = (v) => `${n2(v)} ${n2(v) === 1 ? "rep" : "reps"}`;
  const parts = [x.repsL != null && x.repsR != null ? `${r(x.repsR)} right, ${r(x.repsL)} left` : r(x.reps)];
  if (x.extra) parts.push(`plus ${n2(x.extra)} extra`);
  if (x.side) parts.push(x.side === "R" ? "right side" : "left side");
  if (x.hard) parts.push("hard");
  if (x.drop) parts.push("drop set");
  return parts.join(", ");
}

// A weight as logged, to 0.1 of the unit (45 lb stays 45, not the nearest plate step).
export function fmtLoad(kg, unit = "kg") {
  const v = unit === "lb" ? (kg || 0) * LB_PER_KG : kg || 0;
  return String(+v.toFixed(1));
}

// One logged set for a list: "45×7.4H", "BW×10", "BW+10×8", "d35×6".
export function fmtSet(x, unit = "kg", ex = null) {
  const reps = formatReps({ ...x, drop: false });
  const d = x.drop ? "d" : "";
  if (x.bw) return `${d}BW${x.w ? "+" + fmtLoad(x.w, unit) : ""}×${reps}`;
  if (!x.w && ex && !ex.inc) return d + reps;
  return `${d}${fmtLoad(x.w, unit)}×${reps}`;
}

// ---------- workout history import ----------
// The owner's older training log, turned into a genki file on the owner's own
// computer by scripts/workout-history.mjs (it never enters this repo) and
// picked in the app like the Liftlog file:
// { genki: "workout-history", v: 1, unit: "lb"|"kg",
//   exercises: [{ id: "x-<slug>", name }],
//   sessions: [{ id: "h-...", date: "YYYY-MM-DD", day, note?, sets: [set] }] }
// Every field is rebuilt and checked: the view prints names into the page.
export const HISTORY_KIND = "workout-history";
const okNum = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function cleanSet(x, known) {
  if (!x || typeof x !== "object" || typeof x.exId !== "string" || !known.has(x.exId)) return null;
  if (!okNum(x.reps, 0.01, 999.99)) return null;
  const out = { exId: x.exId, w: okNum(x.w, 0, 2000) ? +x.w.toFixed(3) : 0, reps: n2(x.reps), rir: Number.isInteger(x.rir) && x.rir >= 0 && x.rir <= 10 ? x.rir : null };
  if (okNum(x.extra, 0.01, 100)) out.extra = n2(x.extra);
  if (x.hard === true) out.hard = true;
  if (x.drop === true) out.drop = true;
  if (x.side === "L" || x.side === "R") out.side = x.side;
  if (okNum(x.repsL, 0, 999) && okNum(x.repsR, 0, 999)) { out.repsL = n2(x.repsL); out.repsR = n2(x.repsR); }
  if (x.bw === true) out.bw = true;
  const note = str(x.note, 200);
  if (note) out.note = note;
  return out;
}

// File text -> { unit, exercises, sessions } or null when it is not a history file.
// A session's date becomes local noon that day, so it lands on the right day anywhere.
export function fromHistoryFile(raw) {
  let d = raw;
  if (typeof raw === "string") { try { d = JSON.parse(raw); } catch { return null; } }
  if (!d || typeof d !== "object" || d.genki !== HISTORY_KIND || d.v !== 1 || !Array.isArray(d.sessions) || !Array.isArray(d.exercises)) return null;
  const exercises = [];
  const known = new Set(Object.keys(BY_ID));
  for (const e of d.exercises) {
    if (!e || typeof e.id !== "string" || !/^x-[a-z0-9-]{1,60}$/.test(e.id) || known.has(e.id)) continue;
    const name = str(e.name, 80);
    if (!name) continue;
    exercises.push({ id: e.id, name });
    known.add(e.id);
  }
  const sessions = [], ids = new Set();
  for (const s of d.sessions) {
    if (!s || typeof s !== "object" || typeof s.id !== "string" || !/^h-[A-Za-z0-9-]{1,60}$/.test(s.id) || ids.has(s.id)) continue;
    const m = typeof s.date === "string" && s.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m || +m[1] < 1900) continue;
    const day = new Date(+m[1], +m[2] - 1, +m[3], 12);
    if (day.getMonth() !== +m[2] - 1) continue;
    const sets = (Array.isArray(s.sets) ? s.sets : []).map((x) => cleanSet(x, known)).filter(Boolean);
    // A drop set continues the set before it of the same exercise.
    sets.forEach((x, i) => { if (x.drop && sets[i - 1]?.exId !== x.exId) delete x.drop; });
    if (!sets.length) continue;
    const note = str(s.note, 2000);
    ids.add(s.id);
    sessions.push({ id: s.id, date: day.toISOString(), day: str(s.day, 80) || "Session", sets, ...(note ? { note } : {}), source: "history" });
  }
  return { unit: UNITS.includes(d.unit) ? d.unit : "kg", exercises, sessions };
}
