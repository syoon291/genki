// Daily targets and day totals. Pure functions (no DOM, no IndexedDB) so they
// run under `node --test` as well as in the browser. These are general
// guidelines for healthy adults, not medical advice.

export const ACTIVITY = {
  sedentary: { factor: 1.2, label: "Sedentary", hint: "Desk job, little exercise" },
  light: { factor: 1.375, label: "Light", hint: "Exercise 1-3 days a week" },
  moderate: { factor: 1.55, label: "Moderate", hint: "Exercise 3-5 days a week" },
  active: { factor: 1.725, label: "Active", hint: "Hard exercise 6-7 days a week" },
  very: { factor: 1.9, label: "Very active", hint: "Physical job plus training" },
};

export const DEFAULT_DEFICIT = 500; // kcal/day, about 0.45 kg a week
export const MAX_DEFICIT = 1000;
// The target never goes below these, whatever the deficit (common minimums
// for unsupervised dieting).
export const KCAL_FLOOR = { female: 1200, male: 1500 };
export const PROTEIN_RANGE = [1.6, 2.2]; // g per kg body weight
export const DEFAULT_PROTEIN_PER_KG = 1.8;
export const KCAL_PER_KG = 7700; // energy in 1 kg of body fat, roughly

export const MEALS = [
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch", label: "Lunch" },
  { id: "dinner", label: "Dinner" },
  { id: "snacks", label: "Snacks" },
];

const KG_PER_LB = 0.45359237;
export const kgToLb = (kg) => kg / KG_PER_LB;

export function ageFrom(birthYear, today = new Date()) {
  return today.getFullYear() - birthYear;
}

// Resting energy (Mifflin-St Jeor, 1990), kcal/day.
export function bmr({ sex, weightKg, heightCm, age }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === "female" ? base - 161 : base + 5;
}

// Returns a list of problems with a profile, each fit to show; empty when it is usable.
export function profileProblems(p, today = new Date()) {
  const out = [];
  const year = today.getFullYear();
  if (p.sex !== "female" && p.sex !== "male") out.push("Pick a sex for the energy formula.");
  if (!(p.birthYear >= year - 100 && p.birthYear <= year - 18)) out.push("Year of birth must make you 18 to 100 (the formula is for adults).");
  if (!(p.heightCm >= 120 && p.heightCm <= 230)) out.push("Height must be between 120 and 230 cm.");
  if (!(p.weightKg >= 30 && p.weightKg <= 300)) out.push("Weight must be between 30 and 300 kg.");
  if (!ACTIVITY[p.activity]) out.push("Pick an activity level.");
  if (p.goalKg !== undefined && p.goalKg !== null && !(p.goalKg >= 30 && p.goalKg <= 300)) out.push("Goal weight must be between 30 and 300 kg.");
  if (!(Number.isFinite(p.deficit) && p.deficit >= 0 && p.deficit <= MAX_DEFICIT)) out.push(`Daily deficit must be between 0 and ${MAX_DEFICIT} kcal.`);
  if (!(p.proteinPerKg >= PROTEIN_RANGE[0] && p.proteinPerKg <= PROTEIN_RANGE[1])) out.push(`Protein must be between ${PROTEIN_RANGE[0]} and ${PROTEIN_RANGE[1]} g per kg.`);
  if (p.targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(p.targetDate)) out.push("Target date is not a date.");
  return out;
}

// { bmr, tdee, kcal, deficit, floored, floor, protein } for a valid profile.
// deficit is what the target actually takes off maintenance (smaller than
// the profile's when the floor kicks in).
export function targets(p, today = new Date()) {
  const rest = bmr({ sex: p.sex, weightKg: p.weightKg, heightCm: p.heightCm, age: ageFrom(p.birthYear, today) });
  const tdee = rest * ACTIVITY[p.activity].factor;
  const floor = KCAL_FLOOR[p.sex];
  const wanted = tdee - p.deficit;
  // Round first, then floor, so the target shown is never under the floor.
  const kcal = Math.max(floor, Math.round(wanted / 10) * 10);
  return {
    bmr: Math.round(rest),
    tdee: Math.round(tdee),
    kcal,
    deficit: Math.max(0, Math.round(tdee) - kcal),
    floored: kcal === floor && wanted < floor,
    floor,
    protein: Math.round(p.weightKg * p.proteinPerKg),
  };
}

// When the goal weight would be reached at the target's deficit:
// { kgToGo, days, date (YYYY-MM-DD), onTrack (vs the profile's target date, or null) }.
// null when there is no goal below the current weight or no deficit.
export function projection(p, t, today = new Date()) {
  if (!(p.goalKg > 0) || p.goalKg >= p.weightKg || !(t.deficit > 0)) return null;
  const kgToGo = p.weightKg - p.goalKg;
  const days = Math.ceil((kgToGo * KCAL_PER_KG) / t.deficit);
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  const date = dayKey(d);
  return { kgToGo: Math.round(kgToGo * 10) / 10, days, date, onTrack: p.targetDate ? date <= p.targetDate : null };
}

// Local calendar day as YYYY-MM-DD (the food log's day key).
export function dayKey(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function shiftDay(key, days) {
  const [y, m, d] = key.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d + days));
}

// A log entry stores its nutrients per unit (`base`) and how many units were eaten.
export function entryNutrients(e) {
  const k = e.amount;
  return { kcal: e.base.kcal * k, protein: e.base.protein * k, fat: (e.base.fat ?? 0) * k, carbs: (e.base.carbs ?? 0) * k };
}

export function sumEntries(entries) {
  const t = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  for (const e of entries) {
    const n = entryNutrients(e);
    t.kcal += n.kcal; t.protein += n.protein; t.fat += n.fat; t.carbs += n.carbs;
  }
  return t;
}

// { breakfast: { entries, totals }, ... } in MEALS order; unknown meals land in snacks.
export function byMeal(entries) {
  const out = Object.fromEntries(MEALS.map((m) => [m.id, { entries: [], totals: null }]));
  for (const e of entries) (out[e.meal] ?? out.snacks).entries.push(e);
  for (const m of Object.values(out)) {
    m.entries.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
    m.totals = sumEntries(m.entries);
  }
  return out;
}

// The meal to suggest for a new entry, by local time of day.
export function mealForHour(h) {
  if (h < 10) return "breakfast";
  if (h < 15) return "lunch";
  if (h >= 17 && h < 22) return "dinner";
  return "snacks";
}
