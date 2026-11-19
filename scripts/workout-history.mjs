// Turns the owner's parsed workout log (workouts.json, made outside this repo)
// into a genki workout history file for Workouts > Plan > "Import workout
// history". It runs on the owner's computer against their own data folder and
// writes there; nothing it reads or writes belongs in this repo (public).
//
//   node scripts/workout-history.mjs propose <dir>   writes <dir>/aliases.proposed.json
//   node scripts/workout-history.mjs convert <dir>   reads <dir>/aliases.json if present,
//                                                    writes <dir>/genki-workout-history.json
//
// <dir> holds workouts.json: { sessions: [{ id, date, label, notes, exercises:
// [{ name, key, sets: [{ weight, unit, weight_label, is_drop, reps, after_dot,
// extra_reps, hard_flag, rh_flag, reps_left, reps_right, raw }] }] }] }.
// The rep text (`raw`) is read again with the app's own rep notation
// (workouts.js parseReps), so "9.7" is 9.7 reps whatever the old parse said;
// the parsed columns are the fallback. Weights written "45s" are pounds.
//
// aliases.json merges exercise names: { exercises: [{ name, exId?, keys: [key] }] }.
// exId is a genki library id (workouts.js EX) when the exercise is one of them,
// so the plan's progression sees the history; otherwise the group becomes one
// of the owner's own exercises. A key in no group keeps its own name.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseReps, BY_ID, EX, LB_PER_KG, HISTORY_KIND } from "../workouts.js";

const slug = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "exercise";

// Word-level normal form for proposing merges: spelling, plural, word order
// and abbreviation only ("DB bicep curls" ~ "dumbbell curl"), never a change of
// equipment (a machine press stays apart from a dumbbell one).
const WORDS = {
  dumbbell: "db", dumbell: "db", barbell: "bb", bar: "bar", ext: "extension", pulldwn: "pulldown", pushdwn: "pushdown",
  tri: "tricep", triceps: "tricep", bi: "bicep", biceps: "bicep", lat: "lateral", late: "lateral", latetal: "lateral", side: "lateral",
  shrugg: "shrug", pres: "press", cble: "cable", ling: "long", fremotion: "freemotion", fly: "flie", plateload: "plate", loaded: "load",
  rdl: "rdl", ab: "abs", delt: "delt", delta: "delt", del: "delt", chin: "chin", hipthrust: "hip thrust",
};
const STOP = new Set(["the", "a", "of", "and", "with", "machine2"]);
export function normKey(key) {
  let k = String(key).toLowerCase()
    .replace(/pull[\s-]*downs?/g, "pulldown").replace(/push[\s-]*downs?/g, "pushdown").replace(/push[\s-]*ups?/g, "pushup").replace(/pull[\s-]*ups?/g, "pullup")
    .replace(/pull[\s-]*overs?/g, "pullover").replace(/chestpress/g, "chest press").replace(/smith machine/g, "smith").replace(/plate load(ed)?/g, "plate")
    .replace(/body ?weight|\bbody\b/g, "").replace(/\bcables\b/g, "cable");
  let words = k.replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .map((w) => WORDS[w] ?? w);
  // "bicep curl" is "curl": curls are biceps unless named otherwise.
  if (words.includes("curl")) words = words.filter((w) => w !== "bicep");
  if (words.includes("lateral") && words.includes("raise")) words = words.filter((w) => w !== "lateral").concat("lateral");
  return [...new Set(words)].sort().join(" ");
}

// Names that read like a note or a set's load rather than an exercise
// ("slow tempo", "20s kg", "back and bis"): listed for the owner to decide.
export const looksLikeNote = (key) => !/(curl|press|squat|row|raise|bench|extension|pulldown|pushdown|fly|flie|dip|shrug|crunch|pull ?up|rdl|deadlift)/i.test(key) && /^[\d+.%\s]|\d+s\b|%|kg\b|\b(slow|faster|tempo|super ?set|superset|warm ?ups?|test|workout|day|variation|straps?|amrap|empty|both arms|degree|seems|failure|top)\b|\band\b/i.test(key)
  || /^(bar|barbell|super|core|abs|rows|incline|spider|close grip|plate|preacher|slow|walk|supine|double rope)$/i.test(key.trim());

// Library exercises by normal form of their name, for exId suggestions.
const LIB = Object.fromEntries(EX.map((e) => [normKey(e.name), e.id]));

// Every exercise key with how often it appears and its most common spelling,
// grouped by normal form. The proposal is for a person to read and fix.
export function proposeAliases(log) {
  const keys = {};
  for (const s of log.sessions || []) for (const e of s.exercises || []) {
    const k = (keys[e.key] ||= { key: e.key, sets: 0, names: {} });
    k.sets += (e.sets || []).length;
    k.names[e.name] = (k.names[e.name] || 0) + 1;
  }
  const groups = {};
  for (const k of Object.values(keys)) (groups[normKey(k.key)] ||= []).push(k);
  const out = Object.entries(groups).map(([norm, ks]) => {
    ks.sort((a, b) => b.sets - a.sets);
    const top = Object.entries(ks[0].names).sort((a, b) => b[1] - a[1])[0][0];
    const note = ks.every((k) => looksLikeNote(k.key));
    return { name: top, ...(LIB[norm] ? { exId: LIB[norm] } : {}), keys: ks.map((k) => k.key), sets: ks.reduce((a, k) => a + k.sets, 0), ...(note ? { note: true } : {}) };
  });
  return { exercises: out.sort((a, b) => b.sets - a.sets) };
}

// Pounds unless the log says kg ("45s" is 45 lb; a bare number is the same habit).
function toKg(weight, unit) {
  weight = Number(weight);
  if (!(weight > 0)) return 0;
  return +(unit === "kg" ? weight : weight / LB_PER_KG).toFixed(3);
}

function readSet(x, stats) {
  let p = parseReps(x.raw, { lenient: true });
  // Words before the reps ("fast 7", "eccentric 8"): keep them as the note.
  const lead = !p && String(x.raw ?? "").match(/^([a-z][a-z ]*?)\s*(\d.*)$/i);
  if (lead && (p = parseReps(lead[2], { lenient: true }))) p.note = [lead[1].trim(), p.note].filter(Boolean).join("; ");
  if (!p) {
    // Old parse as the fallback: reps and after_dot read together as a decimal.
    const whole = Number.isInteger(x.reps) ? x.reps : null;
    if (whole == null) { stats.skipped.noReps++; return null; }
    const ad = x.after_dot == null || x.after_dot === "" ? "" : String(x.after_dot);
    p = { reps: /^\d+$/.test(ad) ? +`${whole}.${ad}` : whole };
    if (x.extra_reps > 0) p.extra = x.extra_reps;
    if (x.hard_flag) p.hard = true;
    if (Number.isFinite(x.reps_left) && Number.isFinite(x.reps_right)) { p.repsL = x.reps_left; p.repsR = x.reps_right; }
    stats.fallback++;
  }
  if (!(p.reps > 0)) { stats.skipped.noReps++; return null; }
  const set = { reps: p.reps, rir: p.hard ? 0 : null };
  for (const k of ["extra", "hard", "side", "repsL", "repsR", "note"]) if (p[k] != null) set[k] = p[k];
  if (x.is_drop || p.drop) set.drop = true;
  if (x.rh_flag && !set.side && set.repsL == null) set.side = "R";
  const unit = x.unit || "";
  if (!["s", "", "kg"].includes(unit)) stats.units[unit] = (stats.units[unit] || 0) + 1;
  if (x.weight_label === "bodyweight") set.bw = true;
  // "2 plate": plates, not pounds; how much a plate was is not in the log.
  if (unit === "plate") { set.note = [set.note, `${x.weight} plates`].filter(Boolean).join("; "); set.w = 0; }
  else set.w = toKg(x.weight, unit);
  return set;
}

export function convertHistory(log, aliases = { exercises: [] }) {
  const byKey = {};
  const exercises = {};
  // An owner exercise's id from its name; two names that slug alike get a counter, never one shared id.
  const ownId = (name) => {
    name = String(name).slice(0, 80);
    const base = `x-${slug(name)}`;
    let id = base;
    for (let n = 2; exercises[id] && exercises[id].name !== name; n++) id = `${base.slice(0, 62 - String(n).length - 1)}-${n}`;
    exercises[id] ||= { id, name };
    return id;
  };
  for (const g of aliases.exercises || []) {
    const lib = g.exId && BY_ID[g.exId] ? g.exId : null;
    const id = lib || ownId(g.name);
    for (const k of g.keys || []) byKey[k] = id;
  }
  const stats = { sessionsIn: 0, sessionsOut: 0, setsIn: 0, setsOut: 0, fallback: 0, skipped: { noReps: 0, emptySession: 0 }, units: {} };
  const sessions = [], ids = new Set();
  for (const s of log.sessions || []) {
    stats.sessionsIn++;
    const sets = [];
    for (const e of s.exercises || []) {
      let id = byKey[e.key];
      if (!id) {
        const lib = slug(e.key);
        id = byKey[e.key] = BY_ID[lib] ? lib : ownId(e.name);
      }
      let first = true;
      for (const x of e.sets || []) {
        stats.setsIn++;
        const set = readSet(x, stats);
        if (!set) continue;
        if (first) delete set.drop; // a drop set needs a set before it
        first = false;
        sets.push({ exId: id, ...set });
      }
    }
    if (!sets.length) { stats.skipped.emptySession++; continue; }
    stats.sessionsOut++;
    stats.setsOut += sets.length;
    const note = (s.notes || []).join("\n");
    // Match the importer's id check (^h-[A-Za-z0-9-]{1,60}$); a clash after cleaning gets a counter so no session is dropped as a duplicate.
    const base = `h-${s.date}-${String(s.id).replace(/[^A-Za-z0-9-]+/g, "-")}`;
    let id = base.slice(0, 62);
    for (let n = 2; ids.has(id); n++) id = `${base.slice(0, 62 - String(n).length - 1)}-${n}`;
    ids.add(id);
    sessions.push({ id, date: s.date, day: s.label || "Session", ...(note ? { note } : {}), sets });
  }
  const used = new Set(sessions.flatMap((s) => s.sets.map((x) => x.exId)));
  return {
    file: { genki: HISTORY_KIND, v: 1, unit: "lb", exercises: Object.values(exercises).filter((e) => used.has(e.id)), sessions },
    stats: { ...stats, exercises: used.size },
  };
}

function main([cmd, dir]) {
  if (!["propose", "convert"].includes(cmd) || !dir) {
    console.error("Usage: node scripts/workout-history.mjs propose|convert <dir with workouts.json>");
    process.exit(2);
  }
  const log = JSON.parse(readFileSync(join(dir, "workouts.json"), "utf8"));
  if (cmd === "propose") {
    const p = proposeAliases(log);
    writeFileSync(join(dir, "aliases.proposed.json"), JSON.stringify(p, null, 1) + "\n");
    console.log(`${p.exercises.length} exercise groups proposed from ${p.exercises.reduce((a, g) => a + g.keys.length, 0)} names -> ${join(dir, "aliases.proposed.json")}`);
    return;
  }
  const aliasFile = join(dir, "aliases.json");
  const aliases = existsSync(aliasFile) ? JSON.parse(readFileSync(aliasFile, "utf8")) : { exercises: [] };
  if (!existsSync(aliasFile)) console.warn("No aliases.json: every exercise name stays as written.");
  const { file, stats } = convertHistory(log, aliases);
  const out = join(dir, "genki-workout-history.json");
  writeFileSync(out, JSON.stringify(file) + "\n");
  console.log(JSON.stringify(stats, null, 1));
  console.log(`-> ${out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main(process.argv.slice(2));
