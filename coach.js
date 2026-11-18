// Coach cards on the Today tab: today against the targets, protein this week,
// this week against last week, the week's biggest win, and meal ideas from my
// foods and my meals that fit what is left of today. Computed on the device
// from what is stored; no AI and no network. Pure functions (no DOM, no
// IndexedDB) so they run under `node --test` as well as in the browser.
import { dayKey, shiftDay, weekDays, sumEntries, kgToLb } from "./nutrition.js";
import { itemsTotal } from "./foods.js";
import { sortWeighIns, averageEnding } from "./weight.js";
import { records, BY_ID } from "./workouts.js";
import { fastHistory, fastStatus, waterGoalOf } from "./trackers.js";

const n0 = (v) => Math.round(v).toLocaleString("en-US");
const n1 = (v) => (Math.round(v * 10) / 10).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pct = (v, of) => Math.round((v / of) * 100);

// A day's protein counts as hit at the target, rounded to the gram.
const hitProtein = (protein, target) => Math.round(protein) >= target;

// ---------- today ----------

// Today's eaten nutrients `n` against the targets `t` (targets(); null without
// a profile): { tone: "good" | "warn" | "", text, kcalLeft, proteinLeft }, or
// null without targets.
export function todayCoach(n, t) {
  if (!t) return null;
  const kcalLeft = t.kcal - n.kcal, proteinLeft = t.protein - n.protein;
  const out = (tone, text) => ({ tone, text, kcalLeft, proteinLeft });
  if (n.kcal <= 0 && n.protein <= 0) return out("", `Nothing logged yet today. You have ${n0(t.kcal)} kcal and ${n0(t.protein)} g protein to fill.`);
  if (Math.round(kcalLeft) < 0) {
    const p = Math.round(proteinLeft) > 0 ? ` Protein still needs ${n0(proteinLeft)} g; lean foods keep the extra small.` : "";
    return out("warn", `${n0(-kcalLeft)} kcal over today's target.${p} One day over is fine: the week's average is what moves your weight.`);
  }
  if (Math.round(proteinLeft) <= 0) return out("good", `Protein target reached, with ${n0(kcalLeft)} kcal left for today.`);
  const kp = n.kcal / t.kcal, pp = n.protein / t.protein;
  if (kp >= 0.3 && kp - pp >= 0.15) {
    return out("", `Protein is behind: ${pct(n.protein, t.protein)}\u00a0% of the target with ${pct(n.kcal, t.kcal)}\u00a0% of calories eaten. Pick protein-rich foods for the ${n0(kcalLeft)} kcal left.`);
  }
  return out("good", `On track: ${n0(kcalLeft)} kcal and ${n0(proteinLeft)} g protein left today.`);
}

// ---------- the week ----------

// Daily totals of `entries` for each day in `days` that has any: Map(date -> totals).
function dayTotals(entries, days) {
  const want = new Set(days);
  const by = new Map();
  for (const e of entries) {
    if (!want.has(e.date)) continue;
    if (!by.has(e.date)) by.set(e.date, []);
    by.get(e.date).push(e);
  }
  return new Map([...by].map(([d, list]) => [d, sumEntries(list)]));
}

// The days of this week up to today, and all of last week.
export function weekWindow(today = dayKey()) {
  const thisWeek = weekDays(today).filter((d) => d <= today);
  const lastWeek = weekDays(shiftDay(weekDays(today)[0], -7));
  return { thisWeek, lastWeek };
}

const avgOf = (totals, k) => (totals.size ? [...totals.values()].reduce((s, n) => s + n[k], 0) / totals.size : null);

// Protein this week (Monday to today): { logged, hit, avg, target } over the
// logged days, or null without targets or a logged day.
export function proteinWeek(entries, t, today = dayKey()) {
  if (!t) return null;
  const totals = dayTotals(entries, weekWindow(today).thisWeek);
  if (!totals.size) return null;
  const hit = [...totals.values()].filter((n) => hitProtein(n.protein, t.protein)).length;
  return { logged: totals.size, hit, avg: avgOf(totals, "protein"), target: t.protein };
}

export function proteinWeekText(p) {
  if (!p) return "";
  return `Target hit on ${p.hit} of ${plural(p.logged, "logged day")}; ${n0(p.avg)} g a day on average against ${n0(p.target)} g.`;
}

// This week (so far) against last week: daily averages of calories and protein
// over each week's logged days, and the 7-day weight average at today against a
// week earlier. Each pair is { now, prev } with null where there is no data.
export function weekCompare(entries, weighIns, today = dayKey()) {
  const { thisWeek, lastWeek } = weekWindow(today);
  const a = dayTotals(entries, thisWeek), b = dayTotals(entries, lastWeek);
  const sorted = sortWeighIns(weighIns);
  return {
    kcal: { now: avgOf(a, "kcal"), prev: avgOf(b, "kcal") },
    protein: { now: avgOf(a, "protein"), prev: avgOf(b, "protein") },
    weight: { now: averageEnding(sorted, today), prev: averageEnding(sorted, shiftDay(today, -7)) },
  };
}

// The comparison as short lines: [{ label, text }]; empty without this week's data.
export function weekCompareLines(c) {
  const out = [];
  const diff = (now, prev, unit) => {
    if (prev === null) return "";
    const d = now - prev;
    if (Math.abs(d) < 0.5) return ", the same as last week";
    return `, ${n0(Math.abs(d))} ${unit} ${d > 0 ? "more" : "less"} than last week`;
  };
  if (c.kcal.now !== null) out.push({ label: "Calories", text: `${n0(c.kcal.now)} kcal a day${diff(c.kcal.now, c.kcal.prev, "kcal")}.` });
  if (c.protein.now !== null) out.push({ label: "Protein", text: `${n0(c.protein.now)} g a day${diff(c.protein.now, c.protein.prev, "g")}.` });
  if (c.weight.now !== null && c.weight.prev !== null) {
    const d = c.weight.now - c.weight.prev;
    out.push({ label: "Weight", text: Math.abs(d) < 0.05 ? `7-day average ${n1(c.weight.now)} kg, the same as a week ago.` : `7-day average ${n1(c.weight.now)} kg, ${d < 0 ? "down" : "up"} ${n1(Math.abs(d))} kg (${n1(kgToLb(Math.abs(d)))} lb) since a week ago.` });
  }
  return out;
}

// The week's biggest win (Monday to today): the strongest of lift records,
// weight moving toward the goal, protein days, calorie days, workouts, fasts,
// water and logging days. { kind, text } or null when nothing stands out yet.
// goalKg/weightKg come from the profile (the direction of the goal); sessions
// are finished workouts, days the day-tracker records.
export function biggestWin({ entries = [], weighIns = [], sessions = [], fasts = [], days = [], t = null, goalKg = null, weightKg = null, waterGoal = null, today = dayKey() }) {
  const { thisWeek } = weekWindow(today);
  const inWeek = new Set(thisWeek);
  const wins = [];
  const prs = records(sessions).filter((p) => inWeek.has(dayKey(new Date(p.date))));
  if (prs.length) {
    const names = [...new Set(prs.map((p) => BY_ID[p.exId]?.name ?? p.exId))];
    wins.push({ kind: "records", score: 100 + prs.length, text: prs.length === 1 ? `A new lift record on ${names[0]}.` : `${prs.length} new lift records, including ${names[0]}.` });
  }
  const c = weekCompare(entries, weighIns, today);
  if (c.weight.now !== null && c.weight.prev !== null && goalKg > 0 && weightKg > 0 && goalKg !== weightKg) {
    const toward = (c.weight.now - c.weight.prev) * (goalKg < weightKg ? -1 : 1);
    if (toward >= 0.2) wins.push({ kind: "weight", score: 90 + toward, text: `Your 7-day weight average moved ${n1(toward)} kg (${n1(kgToLb(toward))} lb) toward your goal since a week ago.` });
  }
  const totals = dayTotals(entries, thisWeek);
  if (t) {
    const pHit = [...totals.values()].filter((n) => hitProtein(n.protein, t.protein)).length;
    if (pHit >= 3) wins.push({ kind: "protein", score: 70 + pHit, text: `Protein target hit on ${pHit} days.` });
    const kOk = [...totals.values()].filter((n) => Math.round(n.kcal) <= t.kcal && n.kcal >= t.kcal * 0.7).length;
    if (kOk >= 3) wins.push({ kind: "calories", score: 60 + kOk, text: `Calories within your target on ${kOk} days.` });
  }
  const lifts = sessions.filter((s) => inWeek.has(dayKey(new Date(s.date)))).length;
  if (lifts >= 2) wins.push({ kind: "workouts", score: 65 + lifts, text: `${lifts} workouts done.` });
  const fastsDone = fastHistory(fasts).filter((f) => fastStatus(f).reached && inWeek.has(dayKey(new Date(f.end)))).length;
  if (fastsDone >= 2) wins.push({ kind: "fasts", score: 55 + fastsDone, text: `${fastsDone} fasts finished at their goal.` });
  const goal = waterGoalOf(waterGoal);
  const water = days.filter((d) => inWeek.has(d.date) && d.water >= goal).length;
  if (water >= 3) wins.push({ kind: "water", score: 50 + water, text: `Water goal reached on ${water} days.` });
  if (totals.size >= 3) wins.push({ kind: "logging", score: 40 + totals.size, text: `Food logged on ${totals.size} days.` });
  if (!wins.length) return null;
  const best = wins.sort((a, b) => b.score - a.score)[0];
  return { kind: best.kind, text: best.text };
}

// ---------- meal ideas ----------

// My foods (one serving) and my meals (as saved) that fit what is left of
// today: calories at or under `left.kcal`, ranked by how much of the protein
// still needed they cover per calorie, then by how often they are used.
// [{ kind: "food" | "meal", id, name, kcal, protein, after (kcal left after) }].
// Empty when less than 50 kcal is left. myFoods: raw my-food records.
export function mealIdeas(myFoods, myMeals, left, limit = 3) {
  if (!left || !(left.kcal >= 50)) return [];
  const pNeed = Math.max(0, left.protein);
  const pool = [
    ...myFoods.map((f) => ({ kind: "food", id: f.id, name: f.name, kcal: f.kcal, protein: f.protein ?? 0, uses: f.uses ?? 0 })),
    ...myMeals.map((m) => { const n = itemsTotal(m.items ?? []); return { kind: "meal", id: m.id, name: m.name, kcal: n.kcal, protein: n.protein, uses: m.uses ?? 0 }; }),
  ].filter((x) => x.kcal > 0 && Math.round(x.kcal) <= left.kcal);
  const score = (x) => {
    const familiar = Math.min(x.uses, 20) / 100;
    if (pNeed < 5) return familiar + x.kcal / left.kcal / 10; // protein is done: favorites that fill more
    const fill = Math.min(x.protein, pNeed) / pNeed;
    const density = Math.min(1, (x.protein * 4) / x.kcal);
    return fill * 0.6 + density * 0.4 + familiar;
  };
  return pool
    .map((x) => ({ ...x, s: score(x) }))
    .sort((a, b) => b.s - a.s || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ kind, id, name, kcal, protein }) => ({ kind, id, name, kcal, protein, after: left.kcal - kcal }));
}
