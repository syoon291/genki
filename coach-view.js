// The Today tab's coach cards (maths in coach.js): today against the targets
// with meal ideas that fit what is left (one tap logs one), and the week:
// protein, this week against last week, and the biggest win.
import * as db from "./db.js";
import { MEALS, profileProblems, targets, dayKey, sumEntries, mealForHour, dayTotalsMessage } from "./nutrition.js";
import { fromMyFood, makeEntry, mealEntries } from "./foods.js";
import { todayCoach, proteinWeek, proteinWeekText, weekCompare, weekCompareLines, biggestWin, mealIdeas, weekWindow } from "./coach.js";
import { esc, int, dec1, newId, announce } from "./ui.js";

let rerender = () => {};
export function setCoachRerender(fn) { rerender = fn; }

const mealLabel = (id) => MEALS.find((m) => m.id === id)?.label ?? "Snacks";
const mealOf = (myMeals, id, fallback) => myMeals.find((m) => m.id === id)?.meal || fallback;
const targetsOf = (p) => (p && !profileProblems(p).length ? targets(p) : null);

// Entries of the two weeks the cards look at (last week and this week so far).
async function recentEntries(today) {
  const { thisWeek, lastWeek } = weekWindow(today);
  const lists = await Promise.all([...lastWeek, ...thisWeek].map((d) => db.getByIndex("entries", "date", d)));
  return lists.flat();
}

export async function coachCards() {
  const today = dayKey();
  const [profile, entries, weighIns, sessions, fasts, days, waterGoal, myFoods, myMeals] = await Promise.all([
    db.getMeta("profile", null), recentEntries(today), db.getAll("weighIns"), db.getAll("workouts"), db.getAll("fasts"), db.getAll("days"), db.getMeta("waterGoal", null), db.getAll("myFoods"), db.getAll("myMeals"),
  ]);
  const t = targetsOf(profile);
  const eaten = sumEntries(entries.filter((e) => e.date === today));
  const now = todayCoach(eaten, t);
  const meal = mealForHour(new Date().getHours());

  let todayCard;
  if (!now) {
    todayCard = `<div class="card coach"><span class="stat-label">Today</span><p class="coach-line">Set up your profile on the <a href="#nutrition">Nutrition tab</a> to get tips on today's calories and protein, and meal ideas that fit.</p></div>`;
  } else {
    const ideas = mealIdeas(myFoods, myMeals, { kcal: now.kcalLeft, protein: now.proteinLeft });
    const row = (x) => `<li class="meal-item"><div class="entry"><span class="entry-name">${esc(x.name)}<span class="hint">${x.kind === "meal" ? "My meal" : "My food, 1 serving"} · leaves ${int(x.after)} kcal</span></span><span class="entry-num">${int(x.kcal)}<span class="hint">${dec1(x.protein)}g P</span></span></div><button type="button" class="icon-btn add-one" data-act="c-add" data-kind="${x.kind}" data-id="${esc(x.id)}" aria-label="Add ${esc(x.name)} to ${esc(mealLabel(x.kind === "meal" ? mealOf(myMeals, x.id, meal) : meal).toLowerCase())}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></li>`;
    const ideasHtml = ideas.length
      ? `<h4 class="coach-sub">Meal ideas that fit</h4><ul class="entries ideas">${ideas.map(row).join("")}</ul>`
      : now.kcalLeft >= 50 && !myFoods.length && !myMeals.length
        ? `<p class="hint">Save foods to My foods or a meal to My meals on the Nutrition tab, and ideas that fit what is left show here.</p>`
        : "";
    todayCard = `<div class="card coach"><span class="stat-label">Today</span><p class="coach-line${now.tone === "warn" ? " warn-text" : ""}">${esc(now.text)}</p>${ideasHtml}</div>`;
  }

  const pw = proteinWeek(entries, t, today);
  const lines = [
    ...(pw ? [{ label: "Protein target", text: proteinWeekText(pw) }] : []),
    ...weekCompareLines(weekCompare(entries, weighIns, today)),
  ];
  const win = biggestWin({ entries, weighIns, sessions, fasts, days, t, goalKg: profile?.goalKg ?? null, weightKg: profile?.weightKg ?? null, waterGoal, today });
  const weekBody = lines.length || win
    ? `${win ? `<p class="win"><span class="stat-label">Biggest win</span>${esc(win.text)}</p>` : ""}${lines.length ? `<dl class="coach-facts">${lines.map((l) => `<div><dt>${esc(l.label)}</dt><dd>${esc(l.text)}</dd></div>`).join("")}</dl>` : ""}`
    : `<p class="coach-line">Log food for a few days and this card compares the week with the last one.</p>`;
  const weekCard = `<div class="card coach"><span class="stat-label">This week</span>${weekBody}</div>`;

  return `<h3>Coach</h3>${todayCard}${weekCard}`;
}

let busy = false;
export async function handleCoachClick(act, el) {
  if (act !== "c-add" || busy) return;
  busy = true;
  try {
    const today = dayKey(), now = new Date();
    const slot = mealForHour(now.getHours());
    let name, mealId;
    if (el.dataset.kind === "meal") {
      const m = await db.get("myMeals", el.dataset.id);
      if (!m) return;
      mealId = m.meal || slot;
      name = m.name;
      await db.putMany("entries", mealEntries(m, { date: today, meal: mealId, now, ids: newId }));
      await db.put("myMeals", { ...m, uses: (m.uses ?? 0) + 1, lastUsed: now.toISOString() });
    } else {
      const f = await db.get("myFoods", el.dataset.id);
      if (!f) return;
      const food = fromMyFood(f);
      mealId = slot;
      name = f.name;
      await db.put("entries", makeEntry(food, food.units[0], 1, { id: newId(), date: today, meal: mealId, now }));
      await db.put("myFoods", { ...f, uses: (f.uses ?? 0) + 1, lastUsed: now.toISOString() });
    }
    rerender();
    const [profile, entries] = await Promise.all([db.getMeta("profile", null), db.getByIndex("entries", "date", today)]);
    announce(dayTotalsMessage(`Added ${name} to ${mealLabel(mealId)}.`, sumEntries(entries), targetsOf(profile)));
  } finally {
    busy = false;
  }
}
