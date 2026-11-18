// Nutrition tab: the day's food log against the calorie and protein targets,
// the profile sheet, the add-food flow (recently logged, search, serving sizes,
// several days, quick add, my meals), my foods and recipes, and the Today
// tab's tiles. Targets maths lives in nutrition.js, search in foods.js.
import * as db from "./db.js";
import { ACTIVITY, DEFAULT_DEFICIT, MACRO_LIMITS, DEFAULT_PROTEIN_PER_KG, MAX_DEFICIT, PROTEIN_RANGE, MEALS, profileProblems, targets, projection, dayKey, shiftDay, byMeal, sumEntries, entryNutrients, kgToLb, mealForHour, parseWeeklyCsv, dayTotalsMessage, weekDays, pctOfTargets } from "./nutrition.js";
import { SOURCES, EXTRAS, extrasOf, fromTableRow, fromMyFood, searchFoods, makeEntry, scaleNutrients, recentLogged, pairedFoods, foodLogKey, servingSizes, itemFromEntry, itemsTotal, mealEntries, recipePerServing, parseMyFoodsFile, planMyFoodsImport } from "./foods.js";
import { exerciseLine } from "./trackers-view.js";
import { esc, int, dec1, newId, announce, openPanel, swapPanel, closePanel, panelEl, closeBtn, backBtn } from "./ui.js";

// The day shown in the Nutrition tab (YYYY-MM-DD, local); resets to today on reload.
let day = dayKey();
let rerender = () => {};

export function setRerender(fn) { rerender = fn; }

async function loadProfile() { return db.getMeta("profile", null); }

function targetsFor(profile) {
  if (!profile || profileProblems(profile).length) return null;
  return targets(profile);
}

// Announce a change to the shown day's log, with the day's totals after it.
async function announceDay(action) {
  const [profile, entries] = await Promise.all([loadProfile(), db.getByIndex("entries", "date", day)]);
  announce(dayTotalsMessage(action, sumEntries(entries), targetsFor(profile)));
}

const mealLabel = (id) => MEALS.find((m) => m.id === id)?.label ?? "Snacks";

function dayTitle(key) {
  const today = dayKey();
  if (key === today) return "Today";
  if (key === shiftDay(today, -1)) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function bar(value, target, cls = "") {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  const over = target > 0 && value > target;
  return `<div class="bar ${cls}${over ? " over" : ""}" aria-hidden="true"><span style="width:${pct.toFixed(1)}%"></span></div>`;
}

// ---------- Today tab tiles ----------

export async function todayTiles() {
  const [profile, entries] = await Promise.all([loadProfile(), db.getByIndex("entries", "date", dayKey())]);
  const t = targetsFor(profile);
  const eaten = sumEntries(entries);
  const tile = (label, eatenN, target, unit, cls, small = false) => {
    if (!t) return `<div class="card stat${small ? " mini" : ""}"><span class="stat-label">${label}</span><span class="stat-value">${int(eatenN)}${unit}</span><span class="hint">eaten today${small ? "" : `. <a href="#nutrition">Set up your profile</a> for a target`}.</span></div>`;
    const left = target - eatenN;
    const over = left < 0;
    return `<div class="card stat${small ? " mini" : ""}"><span class="stat-label">${label}</span><span class="stat-value${over ? " over-text" : ""}">${int(Math.abs(left))}${unit}</span><span class="hint">${over ? "over" : "left"} of ${int(target)}${unit}</span>${bar(eatenN, target, cls)}</div>`;
  };
  return `<div class="grid2">
    ${tile("Calories", eaten.kcal, t?.kcal, "", "")}
    ${tile("Protein", eaten.protein, t?.protein, "g", "protein")}
  </div>
  <div class="grid2 minis">
    ${tile("Carbs", eaten.carbs, t?.macros.carbs, "g", "carbs", true)}
    ${tile("Fat", eaten.fat, t?.macros.fat, "g", "fat", true)}
  </div>`;
}

// ---------- Nutrition tab ----------

export async function nutritionView() {
  const [profile, entries] = await Promise.all([loadProfile(), db.getByIndex("entries", "date", day)]);
  const t = targetsFor(profile);
  const total = sumEntries(entries);
  const meals = byMeal(entries);
  const today = dayKey();
  let repeat = "";
  if (!entries.length) {
    const prev = await db.getByIndex("entries", "date", shiftDay(day, -1));
    if (prev.length) repeat = `<button type="button" class="btn ghost" data-act="n-repeat">Repeat ${day === today ? "yesterday" : "the day before"} (${prev.length} ${prev.length === 1 ? "food" : "foods"})</button>`;
  }

  const extraLine = extrasText(itemsTotal(entries));
  const exLine = await exerciseLine(day, total.kcal);
  const summary = t ? `
    <div class="card summary">
      <div class="sum-row">
        <div><span class="stat-label">Calories</span><span class="sum-big">${int(total.kcal)}</span><span class="muted"> / ${int(t.kcal)}</span></div>
        <div class="right"><span class="sum-left${total.kcal > t.kcal ? " over-text" : ""}">${int(Math.abs(t.kcal - total.kcal))}</span><span class="hint"> ${total.kcal > t.kcal ? "over" : "left"}</span></div>
      </div>
      ${bar(total.kcal, t.kcal)}
      <div class="sum-row">
        <div><span class="stat-label">Protein</span><span class="sum-big protein-text">${int(total.protein)}g</span><span class="muted"> / ${int(t.protein)}g</span></div>
        <div class="right"><span class="sum-left${total.protein >= t.protein ? " good-text" : ""}">${total.protein >= t.protein ? "Hit" : `${int(t.protein - total.protein)}g`}</span><span class="hint">${total.protein >= t.protein ? "" : " to go"}</span></div>
      </div>
      ${bar(total.protein, t.protein, "protein")}
      <div class="macro-rows">
        ${macroRow("Carbs", total.carbs, t.macros.carbs, "carbs")}
        ${macroRow("Fat", total.fat, t.macros.fat, "fat")}
      </div>
      ${extraLine ? `<p class="macros">${extraLine}</p>` : ""}
      ${exLine}
    </div>` : `
    <div class="card summary">
      <div class="sum-row"><div><span class="stat-label">Eaten</span><span class="sum-big">${int(total.kcal)}</span><span class="muted"> kcal</span></div><div class="right"><span class="sum-big protein-text">${int(total.protein)}g</span><span class="muted"> protein</span></div></div>
      <p class="macros">Carbs ${int(total.carbs)}g · Fat ${int(total.fat)}g${extraLine ? ` · ${extraLine}` : ""}</p>
      ${exLine}
      <button type="button" class="btn" data-act="n-profile">Set up your profile for daily targets</button>
    </div>`;

  const mealHtml = MEALS.map((m) => {
    const g = meals[m.id];
    const rows = g.entries.map((e) => {
      const n = entryNutrients(e);
      return `<li><button type="button" class="entry" data-act="n-entry" data-id="${esc(e.id)}">
        <span class="entry-name">${esc(e.name)}<span class="hint">${esc(amountText(e))}</span></span>
        <span class="entry-num">${int(n.kcal)}<span class="hint">${dec1(n.protein)}g P</span></span>
      </button></li>`;
    }).join("");
    return `<section class="meal">
      <div class="meal-head"><h3>${m.label}</h3><span class="hint">${g.entries.length ? `${int(g.totals.kcal)} kcal · ${int(g.totals.protein)}g P` : ""}</span></div>
      ${rows ? `<ul class="entries">${rows}</ul>` : ""}
      <div class="meal-actions">
        <button type="button" class="add-btn" data-act="n-add" data-meal="${m.id}">+ Add to ${m.label.toLowerCase()}</button>
        ${g.entries.length ? `<button type="button" class="link-btn" data-act="n-savemeal" data-meal="${m.id}" aria-label="Save ${m.label.toLowerCase()} as a meal">Save as meal</button>` : ""}
      </div>
    </section>`;
  }).join("");

  return `
    <div class="title-row">
      <h2>Nutrition</h2>
      <div class="day-nav">
        <button type="button" class="icon-btn" data-act="n-prev" aria-label="Previous day"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
        <button type="button" class="day-label" data-act="n-today" ${day === today ? "disabled" : ""} aria-label="${esc(dayTitle(day))}${day === today ? "" : ", go to today"}">${esc(dayTitle(day))}</button>
        <button type="button" class="icon-btn" data-act="n-next" aria-label="Next day" ${day >= today ? "disabled" : ""}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
      </div>
    </div>
    ${summary}
    ${repeat ? `<div class="repeat">${repeat}</div>` : ""}
    ${mealHtml}
    <div class="foot-actions">
      <button type="button" class="btn ghost" data-act="n-profile">Profile &amp; targets</button>
      <button type="button" class="btn ghost" data-act="n-myfoods">My foods</button>
      <button type="button" class="btn ghost" data-act="n-mymeals">My meals</button>
      <button type="button" class="btn ghost" data-act="n-weeks">Weekly history</button>
    </div>
    <p class="hint credits">Food data: Standard Tables of Food Composition in Japan 2020 (MEXT) and USDA FoodData Central. Targets are general guidelines, not medical advice.</p>`;
}

// A smaller row for carbs and fat under the calorie and protein bars.
function macroRow(label, eaten, target, cls) {
  const over = eaten > target;
  return `<div class="macro-row">
    <div class="sum-row"><span class="stat-label">${label}</span><span class="small"><strong class="${cls}-text">${int(eaten)}g</strong><span class="muted"> / ${int(target)}g</span><span class="hint${over ? " over-text" : ""}"> · ${int(Math.abs(target - eaten))}g ${over ? "over" : "left"}</span></span></div>
    ${bar(eaten, target, cls)}
  </div>`;
}

// "Fiber 12 g · Sodium 900 mg" from the foods that carry them, or "".
function extrasText(n) {
  const ex = extrasOf(n);
  return EXTRAS.filter((x) => ex[x.id] !== undefined).map((x) => `${x.label} ${x.unit === "mg" ? int(ex[x.id]) : dec1(ex[x.id])} ${x.unit}`).join(" · ");
}

function amountText(e) {
  if (e.unit === "g") return `${dec1(e.amount)} g`;
  if (e.source === "quick" && e.amount === 1) return "quick add";
  if (e.amount === 1 && /^1\b/.test(e.unit)) return e.unit; // "1 bar", not "1 × 1 bar"
  return `${dec1(e.amount)} × ${e.unit}`;
}

export async function handleViewClick(act, el) {
  if (act === "n-prev") { day = shiftDay(day, -1); rerender(); }
  else if (act === "n-next") { if (day < dayKey()) { day = shiftDay(day, 1); rerender(); } }
  else if (act === "n-today") { day = dayKey(); rerender(); }
  else if (act === "n-profile") await openProfile();
  else if (act === "n-myfoods") await openMyFoods();
  else if (act === "n-mymeals") await openMyMeals();
  else if (act === "n-savemeal") await openSaveMeal(el.dataset.meal);
  else if (act === "n-weeks") await openWeeks();
  else if (act === "n-add") await openAdd(el.dataset.meal);
  else if (act === "n-entry") await openEntry(el.dataset.id);
  else if (act === "n-repeat") await repeatPrevious();
}

async function repeatPrevious() {
  const prev = await db.getByIndex("entries", "date", shiftDay(day, -1));
  const now = new Date();
  const copies = prev.map((e, i) => ({ ...e, id: newId(), date: day, createdAt: new Date(now.getTime() + i).toISOString() }));
  await db.putMany("entries", copies);
  rerender();
  await announceDay(`Added ${copies.length} ${copies.length === 1 ? "food" : "foods"}.`);
}

// ---------- profile sheet ----------

function readProfile(form) {
  const fd = new FormData(form);
  const num = (k) => { const v = String(fd.get(k) ?? "").trim(); return v === "" ? null : Number(v); };
  return {
    sex: fd.get("sex") || null,
    birthYear: num("birthYear"),
    heightCm: num("heightCm"),
    weightKg: num("weightKg"),
    activity: fd.get("activity") || null,
    goalKg: num("goalKg"),
    targetDate: String(fd.get("targetDate") ?? "") || null,
    deficit: num("deficit"),
    proteinPerKg: num("proteinPerKg"),
    ...readMacros(fd, num),
  };
}

// Carbs and fat as the sheet holds them: whichever side was edited last
// (percent or grams) is the one saved; "auto" saves neither (the defaults).
function readMacros(fd, num) {
  const mode = fd.get("macroMode");
  if (mode === "pct") return { macroMode: "pct", carbPct: num("carbPct"), fatPct: num("fatPct") };
  if (mode === "g") return { macroMode: "g", carbG: num("carbG"), fatG: num("fatG") };
  return { macroMode: null };
}

function fmtDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function profilePreview(p) {
  const problems = profileProblems(p);
  if (problems.length) return `<p class="hint">${esc(problems[0])}</p>`;
  const t = targets(p);
  const proj = projection(p, t);
  let projLine = "";
  if (proj) {
    const vs = proj.onTrack === null ? "" : proj.onTrack ? " That is on or before your target date." : ` That is after your target date (${esc(fmtDate(p.targetDate))}); a bigger deficit or a later date closes the gap.`;
    projLine = `<p class="small">At this pace you lose ${dec1(proj.kgToGo)} kg by about <strong>${esc(fmtDate(proj.date))}</strong>.${vs}</p>`;
  } else if (p.goalKg && p.goalKg >= p.weightKg) {
    projLine = `<p class="small muted">Your goal weight is not below your current weight, so there is no date to project.</p>`;
  }
  return `
    <dl class="facts">
      <div><dt>Resting energy</dt><dd>${int(t.bmr)} kcal</dd></div>
      <div><dt>Maintenance</dt><dd>${int(t.tdee)} kcal</dd></div>
      <div><dt>Daily calorie target</dt><dd>${int(t.kcal)} kcal</dd></div>
      <div><dt>Daily protein target</dt><dd>${int(t.protein)} g · ${int(t.macros.proteinPct)} %</dd></div>
      <div><dt>Daily carbs target</dt><dd>${int(t.macros.carbs)} g · ${int(t.macros.carbPct)} %</dd></div>
      <div><dt>Daily fat target</dt><dd>${int(t.macros.fat)} g · ${int(t.macros.fatPct)} %</dd></div>
    </dl>
    ${Math.abs(t.macros.totalPct - 100) > 2 ? `<p class="small warn-text">Protein, carbs and fat add up to ${int(t.macros.totalPct)} % of your calorie target, so hitting all three ${t.macros.totalPct > 100 ? "goes over" : "falls short of"} it.</p>` : ""}
    ${t.floored ? `<p class="small warn-text">The target is held at ${int(t.floor)} kcal, the lowest this app sets, so the real deficit is ${int(t.deficit)} kcal.</p>` : ""}
    ${projLine}`;
}

// The values the carbs/fat grid shows for a profile: the saved side as saved,
// the other side worked out from the calorie target (blank until the profile
// is complete enough to have one).
function macroFields(p) {
  const t = profileProblems({ ...p, macroMode: null }).length ? null : targets({ ...p, macroMode: p.macroMode ?? null });
  const out = { carbPct: p.carbPct ?? null, fatPct: p.fatPct ?? null, carbG: p.carbG ?? null, fatG: p.fatG ?? null, proteinPct: null, proteinG: null };
  if (!t) return out;
  const mt = t.macros;
  out.proteinPct = `${int(mt.proteinPct)} %`;
  out.proteinG = `${int(t.protein)} g`;
  if (p.macroMode === "pct") { out.carbG = mt.carbs; out.fatG = mt.fat; }
  else if (p.macroMode === "g") { out.carbPct = mt.carbPct; out.fatPct = mt.fatPct; }
  else Object.assign(out, { carbPct: mt.carbPct, fatPct: mt.fatPct, carbG: mt.carbs, fatG: mt.fat });
  return out;
}

// Refill the side of the carbs/fat grid that follows, after any edit.
// `edited` is the field just typed in (it is never overwritten).
function syncMacroFields(form, edited) {
  const np = readProfile(form);
  const f = macroFields(np);
  const el = form.elements;
  const mode = el.macroMode.value;
  const keep = new Set([edited]);
  if (mode === "pct") { keep.add("carbPct"); keep.add("fatPct"); }
  if (mode === "g") { keep.add("carbG"); keep.add("fatG"); }
  for (const k of ["carbPct", "fatPct", "carbG", "fatG"]) if (!keep.has(k)) el[k].value = f[k] ?? "";
  panelEl().querySelector("#protein-pct").textContent = f.proteinPct ?? "–";
  panelEl().querySelector("#protein-g").textContent = f.proteinG ?? "–";
}

const lbHint = (kg) => (kg > 0 ? `${dec1(kgToLb(kg))} lb` : "");

async function openProfile() {
  const saved = await loadProfile();
  const p = { sex: null, birthYear: null, heightCm: null, weightKg: null, activity: "moderate", goalKg: null, targetDate: null, deficit: DEFAULT_DEFICIT, proteinPerKg: DEFAULT_PROTEIN_PER_KG, ...saved };
  const v = (x) => (x === null || x === undefined ? "" : esc(x));
  const year = new Date().getFullYear();
  const m = macroFields(p);
  const weighInsNote = (await db.getAll("weighIns")).length ? `<small class="hint">Follows your weigh-ins (7-day average)</small>` : "";
  openPanel(`
    <div class="sheet-head"><h2 id="panel-title">Profile &amp; targets</h2>${closeBtn}</div>
    <p class="sub">Your daily targets come from these. They stay on this device.</p>
    <form class="form" id="profile-form" novalidate>
      <fieldset class="seg"><legend>Sex (for the energy formula)</legend>
        <label><input type="radio" name="sex" value="female" ${p.sex === "female" ? "checked" : ""}><span>Female</span></label>
        <label><input type="radio" name="sex" value="male" ${p.sex === "male" ? "checked" : ""}><span>Male</span></label>
      </fieldset>
      <div class="grid2">
        <label class="field"><span>Year of birth</span><input name="birthYear" type="number" inputmode="numeric" min="${year - 100}" max="${year - 18}" value="${v(p.birthYear)}"></label>
        <label class="field"><span>Height (cm)</span><input name="heightCm" type="number" inputmode="decimal" step="0.1" value="${v(p.heightCm)}"></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Weight (kg)</span><input name="weightKg" type="number" inputmode="decimal" step="0.1" value="${v(p.weightKg)}"><small class="hint" data-lb="weightKg">${lbHint(p.weightKg)}</small>${weighInsNote}</label>
        <label class="field"><span>Goal weight (kg)</span><input name="goalKg" type="number" inputmode="decimal" step="0.1" value="${v(p.goalKg)}"><small class="hint" data-lb="goalKg">${lbHint(p.goalKg)}</small></label>
      </div>
      <label class="field"><span>Activity</span><select name="activity">
        ${Object.entries(ACTIVITY).map(([k, a]) => `<option value="${k}" ${p.activity === k ? "selected" : ""}>${a.label}: ${a.hint}</option>`).join("")}
      </select></label>
      <label class="field"><span>Target date (optional)</span><input name="targetDate" type="date" value="${v(p.targetDate)}"></label>
      <div class="grid2">
        <label class="field"><span>Daily deficit (kcal)</span><input name="deficit" type="number" inputmode="numeric" min="0" max="${MAX_DEFICIT}" step="50" value="${v(p.deficit)}"><small class="hint">500 ≈ 0.45 kg a week</small></label>
        <label class="field"><span>Protein (g per kg)</span><input name="proteinPerKg" type="number" inputmode="decimal" min="${PROTEIN_RANGE[0]}" max="${PROTEIN_RANGE[1]}" step="0.1" value="${v(p.proteinPerKg)}"><small class="hint">${PROTEIN_RANGE[0]}-${PROTEIN_RANGE[1]} keeps muscle on a cut</small></label>
      </div>
      <fieldset class="macro-set"><legend>Carbs and fat</legend>
        <p class="hint">Set them as a share of calories or in grams; the other column follows. As a share, the grams move with your calorie target.</p>
        <div class="macro-grid">
          <span></span><span class="hint">% of calories</span><span class="hint">Grams a day</span>
          <span class="macro-name">Carbs</span>
          <input name="carbPct" type="number" inputmode="decimal" min="0" max="100" step="1" aria-label="Carbs, percent of calories" value="${v(m.carbPct)}">
          <input name="carbG" type="number" inputmode="numeric" min="0" max="${MACRO_LIMITS.carbG[1]}" step="1" aria-label="Carbs, grams a day" value="${v(m.carbG)}">
          <span class="macro-name">Fat</span>
          <input name="fatPct" type="number" inputmode="decimal" min="0" max="100" step="1" aria-label="Fat, percent of calories" value="${v(m.fatPct)}">
          <input name="fatG" type="number" inputmode="numeric" min="0" max="${MACRO_LIMITS.fatG[1]}" step="1" aria-label="Fat, grams a day" value="${v(m.fatG)}">
          <span class="macro-name">Protein</span><output id="protein-pct">${m.proteinPct ?? "–"}</output><output id="protein-g">${m.proteinG ?? "–"}</output>
        </div>
        <input type="hidden" name="macroMode" value="${esc(p.macroMode ?? "auto")}">
        <button type="button" class="link-btn" data-act="macro-reset">Use the default (fat 30 %, carbs the rest)</button>
      </fieldset>
      <div id="profile-preview" class="preview" aria-live="polite">${profilePreview(p)}</div>
      <button class="btn" type="submit">Save profile</button>
      <p class="msg bad" role="status" id="profile-msg"></p>
    </form>`, {
    click: (act) => {
      if (act !== "macro-reset") return;
      const form = panelEl().querySelector("#profile-form");
      form.elements.macroMode.value = "auto";
      syncMacroFields(form, null);
      panelEl().querySelector("#profile-preview").innerHTML = profilePreview(readProfile(form));
    },
    input: (e) => {
      const form = panelEl().querySelector("#profile-form");
      const name = e.target.name;
      if (name === "carbPct" || name === "fatPct") form.elements.macroMode.value = "pct";
      else if (name === "carbG" || name === "fatG") form.elements.macroMode.value = "g";
      // A percent edited while on the default fixes the other percent where it showed.
      syncMacroFields(form, name);
      const np = readProfile(form);
      panelEl().querySelector("#profile-preview").innerHTML = profilePreview(np);
      const lb = e.target.name && panelEl().querySelector(`[data-lb="${e.target.name}"]`);
      if (lb) lb.textContent = lbHint(np[e.target.name]);
    },
    submit: async (form) => {
      const np = readProfile(form);
      const problems = profileProblems(np);
      if (problems.length) { panelEl().querySelector("#profile-msg").textContent = problems[0]; return; }
      await db.setMeta("profile", { ...np, updatedAt: new Date().toISOString() });
      closePanel();
      rerender();
    },
  });
}

// ---------- add food ----------

let tables = null; // Promise<[jpFoods, usFoods]>

function loadTables() {
  tables ??= Promise.all(["jp", "us"].map(async (src) => {
    const res = await fetch(`foods/${src}.json`);
    if (!res.ok) throw new Error(`could not load the ${SOURCES[src]} food list (${res.status})`);
    return (await res.json()).foods.map((r) => fromTableRow(r, src));
  }));
  tables.catch(() => { tables = null; });
  return tables;
}

const mealOptions = (sel) => MEALS.map((m) => `<option value="${m.id}" ${m.id === sel ? "selected" : ""}>${m.label}</option>`).join("");
const byRecent = (a, b) => (b.lastUsed ?? "").localeCompare(a.lastUsed ?? "") || (b.uses ?? 0) - (a.uses ?? 0) || a.name.localeCompare(b.name);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// What the add sheet offers before anything is typed, and what search runs over.
async function loadAddData() {
  const [myFoodsRaw, myMeals, entries, profile] = await Promise.all([db.getAll("myFoods"), db.getAll("myMeals"), db.getAll("entries"), loadProfile()]);
  return { myFoodsRaw, myFoods: myFoodsRaw.map(fromMyFood), myMeals: myMeals.sort(byRecent), entries, recent: recentLogged(entries, myFoodsRaw), t: targetsFor(profile) };
}

// Nutrients and the share of today's targets they are, for every amount preview.
function nutrientPreview(n, t, { perDay = false } = {}) {
  const exLine = extrasText(n);
  const p = pctOfTargets(n, t);
  const pLine = p ? `<p class="small pct-line">${perDay ? "Each day: " : ""}<strong>${p.kcal} %</strong> of today's calories · <span class="protein-text">${p.protein} % protein</span> · ${p.carbs} % carbs · ${p.fat} % fat</p>` : "";
  return `<p class="preview-line"><strong>${int(n.kcal)}</strong> kcal · <strong class="protein-text">${dec1(n.protein)} g</strong> protein · ${dec1(n.carbs)} g carbs · ${dec1(n.fat)} g fat</p>${exLine ? `<p class="hint">${exLine}</p>` : ""}${pLine}`;
}

// This week's days as toggles (Monday first); days after today cannot be picked.
function daysPicker(selected) {
  const today = dayKey();
  const btns = weekDays(day).map((k) => {
    const [y, m, d] = k.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const wd = date.toLocaleDateString(undefined, { weekday: "short" });
    const long = date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    return `<button type="button" class="day-tog" data-act="day-tog" data-day="${k}" aria-pressed="${selected.has(k)}" aria-label="${esc(long)}${k === today ? ", today" : ""}" ${k > today ? "disabled" : ""}><span>${esc(wd)}</span><strong>${d}</strong></button>`;
  }).join("");
  return `<fieldset class="days"><legend>Days</legend><div class="days-row">${btns}</div></fieldset>`;
}

function toggleDay(ctx, el) {
  const k = el.dataset.day;
  if (ctx.days.has(k)) ctx.days.delete(k); else ctx.days.add(k);
  el.setAttribute("aria-pressed", String(ctx.days.has(k)));
  const btn = panelEl().querySelector("[data-add-label]");
  if (btn) btn.textContent = addLabel(ctx, btn.dataset.addLabel);
}

const addLabel = (ctx, base) => (ctx.days.size > 1 ? `${base} to ${ctx.days.size} days` : base);
const daysNote = (n) => (n > 1 ? ` on ${n} days` : "");

// The add sheet. mode "log" adds to the food log; mode "ingredient" picks an
// ingredient for a recipe and hands it to ctx.onIngredient (no meal, no days).
async function openAdd(meal = mealForHour(new Date().getHours())) {
  const ctx = { mode: "log", meal, query: "", days: new Set([day]), ...(await loadAddData()) };
  foodFlow(ctx, false);
}

function foodFlow(ctx, swap) {
  loadTables().catch(() => {});
  const log = ctx.mode === "log";
  let hits = new Map(), mealHits = new Map(), picked = null, pickedSizes = [], paired = [];

  const resultRow = (f) => `<li><button type="button" class="result" data-act="pick" data-id="${esc(f.id)}">
      <span class="entry-name">${esc(f.name)}<span class="hint">${f.brand ? `${esc(f.brand)} · ` : ""}${esc(f.recipe ? "Recipe" : SOURCES[f.source])} · per ${esc(f.per === "serving" ? f.units[0].label : f.per)}</span></span>
      <span class="entry-num">${int(f.kcal)}<span class="hint">${dec1(f.protein)}g P</span></span>
    </button></li>`;
  const recentRow = (r, i) => {
    const k = (f) => r.food[f] * (r.food.units.find((u) => u.label === r.unit)?.factor ?? 1) * r.amount;
    return `<li><button type="button" class="result" data-act="recent" data-i="${i}">
      <span class="entry-name">${esc(r.food.name)}<span class="hint">${esc(amountText({ unit: r.unit, amount: r.amount, source: r.food.source }))}</span></span>
      <span class="entry-num">${int(k("kcal"))}<span class="hint">${dec1(k("protein"))}g P</span></span>
    </button></li>`;
  };
  const mealRow = (m) => {
    const tot = itemsTotal(m.items);
    return `<li class="meal-item"><button type="button" class="result" data-act="meal" data-id="${esc(m.id)}">
      <span class="entry-name">${esc(m.name)}<span class="hint">${plural(m.items.length, "food")} · ${int(tot.kcal)} kcal · ${dec1(tot.protein)}g P</span></span>
    </button><button type="button" class="icon-btn add-one" data-act="meal-add" data-id="${esc(m.id)}" aria-label="Add ${esc(m.name)} to ${esc(mealLabel(ctx.meal).toLowerCase())}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button></li>`;
  };

  async function showResults() {
    const box = panelEl().querySelector("#results");
    if (!box) return;
    const q = ctx.query.trim();
    let html = "";
    if (!q) {
      if (log && ctx.myMeals.length) html += `<h3>My meals</h3><ul class="entries">${ctx.myMeals.map(mealRow).join("")}</ul>`;
      if (ctx.recent.length) html += `<h3>Recently logged</h3><ul class="entries">${ctx.recent.map(recentRow).join("")}</ul>`;
      if (!html) html = `<p class="hint">Type to search about 8,000 foods${log ? ", or quick-add from a label" : ""}.</p>`;
      hits = new Map();
    } else {
      let lists = [ctx.myFoods];
      try { lists = [ctx.myFoods, ...(await loadTables())]; }
      catch (e) { html += `<p class="hint bad-text">Only your foods are searched: ${esc(e.message)}.</p>`; }
      if (ctx.query.trim() !== q) return; // a newer search is on its way
      const meals = log ? searchFoods(q, [ctx.myMeals.map((m) => ({ id: m.id, name: m.name, source: "my" }))], 10).map((h) => ctx.myMeals.find((m) => m.id === h.id)) : [];
      const list = searchFoods(q, lists, 40);
      mealHits = new Map(meals.map((m) => [m.id, m]));
      hits = new Map(list.map((f) => [f.id, f]));
      if (meals.length) html += `<h3>My meals</h3><ul class="entries">${meals.map(mealRow).join("")}</ul>`;
      if (list.length) html += `${meals.length ? "<h3>Foods</h3>" : ""}<ul class="entries">${list.map(resultRow).join("")}</ul>`;
      if (!list.length && !meals.length) html += `<p class="hint">Nothing matches "${esc(q)}". Try fewer or shorter words${log ? ", or quick-add it" : ""}.</p>`;
    }
    box.innerHTML = html;
  }

  const searchScreen = () => `
    <div class="sheet-head">${log ? "" : backBtn("exit")}<h2 id="panel-title" class="grow">${log ? "Add food" : "Add ingredient"}</h2>${closeBtn}</div>
    ${log ? `<div class="add-top">
      <label class="field inline"><span>Meal</span><select name="meal" id="add-meal">${mealOptions(ctx.meal)}</select></label>
      <button type="button" class="btn ghost small-btn" data-act="quick">Quick add</button>
    </div>` : ""}
    <input type="search" id="food-q" class="search" placeholder="Search foods (e.g. chicken breast, natto)" aria-label="Search foods" autocomplete="off" value="${esc(ctx.query)}" autofocus>
    <div id="results" class="results" aria-live="polite"></div>`;

  const findMeal = (id) => ctx.myMeals.find((m) => m.id === id) ?? mealHits.get(id);

  let timer;
  const handlers = {
    input: (e) => {
      if (e.target.id === "add-meal") {
        ctx.meal = e.target.value;
        // The one-tap buttons name the meal they add to.
        for (const b of panelEl().querySelectorAll("[data-act=meal-add]")) b.setAttribute("aria-label", `Add ${findMeal(b.dataset.id)?.name ?? ""} to ${mealLabel(ctx.meal).toLowerCase()}`);
        return;
      }
      if (e.target.id === "food-q") {
        ctx.query = e.target.value;
        clearTimeout(timer);
        timer = setTimeout(showResults, 120);
      }
      if (e.target.closest("#amount-form")) updateAmountPreview();
      if (e.target.closest("#quick-form")) updateQuickPreview();
      if (e.target.closest("#meal-form")) updateMealPreview();
    },
    click: async (act, el) => {
      if (act === "pick") showAmount(hits.get(el.dataset.id));
      else if (act === "recent") { const r = ctx.recent[Number(el.dataset.i)]; if (r) showAmount(r.food, r); }
      else if (act === "meal") showMeal(findMeal(el.dataset.id));
      else if (act === "meal-add") await logMeal(findMeal(el.dataset.id), 1, ctx.meal, new Set([day]));
      else if (act === "quick") showQuick();
      else if (act === "day-tog") { toggleDay(ctx, el); updateAmountPreview(); updateQuickPreview(); updateMealPreview(); }
      else if (act === "back") { swapPanel(searchScreen(), handlers); showResults(); }
      else if (act === "exit") ctx.onExit?.();
    },
    submit: async (form) => {
      if (form.id === "amount-form") await addPicked(form);
      if (form.id === "quick-form") await addQuick(form);
      if (form.id === "meal-form") await addMealForm(form);
    },
  };

  const chosenDays = () => [...ctx.days].sort();
  const noDays = (msgId) => {
    if (ctx.days.size) return false;
    panelEl().querySelector(msgId).textContent = "Pick at least one day.";
    return true;
  };

  // ----- amount step: a serving size and a number of servings -----
  function showAmount(food, last = null) {
    if (!food) return;
    picked = food;
    pickedSizes = servingSizes(food, last?.unit === "g" ? last.amount : null);
    let sel = 0, servings = 1;
    if (last) {
      const i = last.unit === "g"
        ? pickedSizes.findIndex((s) => food.units[s.unit].label === "g" && s.per === last.amount)
        : pickedSizes.findIndex((s) => food.units[s.unit].label === last.unit);
      if (i >= 0) { sel = i; servings = last.unit === "g" ? 1 : last.amount; }
    }
    // Foods often logged in the same meal as this one, to tick and add with it.
    paired = log ? pairedFoods(ctx.entries, foodLogKey(food), ctx.myFoodsRaw) : [];
    const pairRows = paired.map((p, i) => {
      const k = (p.food.units.find((u) => u.label === p.unit)?.factor ?? 1) * p.amount;
      return `<li><label class="check entry"><input type="checkbox" name="pair" value="${i}"><span class="entry-name">${esc(p.food.name)}<span class="hint">${esc(amountText({ unit: p.unit, amount: p.amount, source: p.food.source }))} · ${int(p.food.kcal * k)} kcal · together ${p.count} times</span></span></label></li>`;
    }).join("");
    swapPanel(`
      <div class="sheet-head">${backBtn()}<h2 id="panel-title" class="grow">${esc(food.name)}</h2>${closeBtn}</div>
      <p class="sub">${esc(food.recipe ? "Recipe" : SOURCES[food.source])} · per ${esc(food.per === "serving" ? food.units[0].label : food.per)}: ${int(food.kcal)} kcal, ${dec1(food.protein)} g protein, ${dec1(food.carbs)} g carbs, ${dec1(food.fat)} g fat</p>
      <form class="form" id="amount-form" novalidate>
        <div class="grid2">
          <label class="field"><span>Serving size</span><select name="size">${pickedSizes.map((s, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select></label>
          <label class="field"><span>Number of servings</span><input name="servings" type="number" inputmode="decimal" min="0" step="any" value="${servings}" autofocus></label>
        </div>
        ${log ? `<label class="field"><span>Meal</span><select name="meal">${mealOptions(ctx.meal)}</select></label>${daysPicker(ctx.days)}` : ""}
        ${pairRows ? `<fieldset class="plain"><legend class="hint">Often eaten with (tick to add them too)</legend><ul class="entries">${pairRows}</ul></fieldset>` : ""}
        <div id="amount-preview" class="preview" aria-live="polite"></div>
        ${log && food.source !== "my" ? `<label class="check"><input type="checkbox" name="save"><span>Also save this amount to my foods</span></label>` : ""}
        <button class="btn" type="submit" data-add-label="${log ? "Add" : "Add to recipe"}">${log ? addLabel(ctx, "Add") : "Add to recipe"}</button>
        <p class="msg bad" role="status" id="amount-msg"></p>
      </form>`, handlers);
    updateAmountPreview();
  }

  function readAmount(form) {
    const fd = new FormData(form);
    const size = pickedSizes[Number(fd.get("size"))] ?? pickedSizes[0];
    const servings = Number(fd.get("servings"));
    const unit = picked.units[size.unit];
    const pairs = fd.getAll("pair").map((i) => paired[Number(i)]).filter(Boolean);
    return { unit, servings, amount: servings * size.per, meal: String(fd.get("meal") ?? ctx.meal), save: fd.get("save") === "on", pairs };
  }

  function updateAmountPreview() {
    const form = panelEl().querySelector("#amount-form");
    const out = panelEl().querySelector("#amount-preview");
    if (!form || !out || !picked) return;
    const { unit, amount, pairs } = readAmount(form);
    if (!(amount > 0)) { out.innerHTML = `<p class="hint">Enter a number of servings.</p>`; return; }
    const parts = [scaleNutrients(picked, unit.factor * amount), ...pairs.map((p) => scaleNutrients(p.food, (p.food.units.find((u) => u.label === p.unit)?.factor ?? 1) * p.amount))];
    const n = itemsTotal(parts.map((b) => ({ base: b, amount: 1 })));
    // A recipe ingredient is not eaten today: no share of today's targets.
    out.innerHTML = (pairs.length ? `<p class="hint">With ${plural(pairs.length, "food")} ticked:</p>` : "") + nutrientPreview(n, log ? ctx.t : null, { perDay: log && ctx.days.size > 1 });
  }

  async function addPicked(form) {
    const { unit, amount, meal: m, save, pairs } = readAmount(form);
    if (!(amount > 0 && amount < 100000)) { panelEl().querySelector("#amount-msg").textContent = "Enter a number of servings above zero."; return; }
    if (!log) { ctx.onIngredient(itemFromEntry(makeEntry(picked, unit, Math.round(amount * 1e6) / 1e6, { id: "", date: "", meal: "" }))); return; }
    if (noDays("#amount-msg")) return;
    const now = new Date();
    const days = chosenDays();
    const unitOf = (p) => p.food.units.find((u) => u.label === p.unit) ?? p.food.units[0];
    await db.putMany("entries", days.flatMap((d, i) => [
      makeEntry(picked, unit, amount, { id: newId(), date: d, meal: m, now: new Date(now.getTime() + i * 100) }),
      ...pairs.map((p, j) => makeEntry(p.food, unitOf(p), p.amount, { id: newId(), date: d, meal: m, now: new Date(now.getTime() + i * 100 + j + 1) })),
    ]));
    for (const p of pairs.filter((x) => x.food.source === "my" && !x.food.logKey)) {
      const mf = await db.get("myFoods", p.food.id);
      if (mf) await db.put("myFoods", { ...mf, uses: (mf.uses ?? 0) + days.length, lastUsed: now.toISOString() });
    }
    if (picked.source === "my") {
      const mf = await db.get("myFoods", picked.id);
      if (mf) await db.put("myFoods", { ...mf, uses: (mf.uses ?? 0) + days.length, lastUsed: now.toISOString() });
    } else if (save) {
      const n = scaleNutrients(picked, unit.factor * amount);
      const r1 = (v) => Math.round(v * 10) / 10;
      const ex = extrasOf(n);
      await db.put("myFoods", {
        id: newId(), name: picked.name,
        serving: unit.label === "g" ? `${dec1(amount)} g` : `${dec1(amount)} × ${unit.label}`,
        grams: unit.grams ? r1(unit.grams * amount) : null,
        kcal: Math.round(n.kcal), protein: r1(n.protein), fat: r1(n.fat), carbs: r1(n.carbs),
        ...Object.fromEntries(Object.entries(ex).map(([k, v]) => [k, k === "sodium" ? Math.round(v) : r1(v)])),
        uses: days.length, lastUsed: now.toISOString(), createdAt: now.toISOString(),
      });
    }
    closePanel();
    rerender();
    await announceDay(`Added ${picked.name}${pairs.length ? ` and ${plural(pairs.length, "more food")}` : ""} to ${mealLabel(m)}${daysNote(days.length)}.`);
  }

  // ----- my meal step: its foods, a number of servings, meal and days -----
  let shownMeal = null;
  function showMeal(m) {
    if (!m) return;
    shownMeal = m;
    const rows = m.items.map((it) => {
      const n = entryNutrients(it);
      return `<li><div class="entry"><span class="entry-name">${esc(it.name)}<span class="hint">${esc(amountText(it))}</span></span><span class="entry-num">${int(n.kcal)}<span class="hint">${dec1(n.protein)}g P</span></span></div></li>`;
    }).join("");
    swapPanel(`
      <div class="sheet-head">${backBtn()}<h2 id="panel-title" class="grow">${esc(m.name)}</h2>${closeBtn}</div>
      <p class="sub">My meal · ${plural(m.items.length, "food")}, each added to the log on its own.</p>
      <ul class="entries" aria-label="Foods in ${esc(m.name)}">${rows}</ul>
      <form class="form spaced" id="meal-form" novalidate>
        <div class="grid2">
          <label class="field"><span>Number of servings</span><input name="servings" type="number" inputmode="decimal" min="0" step="any" value="1"></label>
          <label class="field"><span>Meal</span><select name="meal">${mealOptions(savedMeal(m) ?? ctx.meal)}</select></label>
        </div>
        ${daysPicker(ctx.days)}
        <div id="meal-preview" class="preview" aria-live="polite"></div>
        <button class="btn" type="submit" data-add-label="Add meal">${addLabel(ctx, "Add meal")}</button>
        <p class="msg bad" role="status" id="meal-msg"></p>
      </form>`, handlers);
    updateMealPreview();
  }

  function updateMealPreview() {
    const form = panelEl().querySelector("#meal-form");
    const out = panelEl().querySelector("#meal-preview");
    if (!form || !out || !shownMeal) return;
    const s = Number(new FormData(form).get("servings"));
    if (!(s > 0)) { out.innerHTML = `<p class="hint">Enter a number of servings.</p>`; return; }
    const tot = itemsTotal(shownMeal.items);
    out.innerHTML = nutrientPreview(Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, v * s])), ctx.t, { perDay: ctx.days.size > 1 });
  }

  async function addMealForm(form) {
    const fd = new FormData(form);
    const s = Number(fd.get("servings"));
    if (!(s > 0 && s < 1000)) { panelEl().querySelector("#meal-msg").textContent = "Enter a number of servings above zero."; return; }
    if (noDays("#meal-msg")) return;
    await logMeal(shownMeal, s, String(fd.get("meal")), ctx.days);
  }

  async function logMeal(m, servings, mealId, days) {
    if (!m) return;
    const now = new Date();
    const list = [...days].sort();
    const entries = list.flatMap((d, i) => mealEntries(m, { date: d, meal: mealId, servings, now: new Date(now.getTime() + i * 1000), ids: newId }));
    await db.putMany("entries", entries);
    const stored = await db.get("myMeals", m.id);
    if (stored) await db.put("myMeals", { ...stored, uses: (stored.uses ?? 0) + list.length, lastUsed: now.toISOString() });
    closePanel();
    rerender();
    await announceDay(`Added ${m.name} (${plural(m.items.length, "food")}) to ${mealLabel(mealId)}${daysNote(list.length)}.`);
  }

  // ----- quick add -----
  function showQuick() {
    swapPanel(`
      <div class="sheet-head">${backBtn()}<h2 id="panel-title" class="grow">Quick add</h2>${closeBtn}</div>
      <p class="sub">Type the numbers from a label or a menu.</p>
      <form class="form" id="quick-form" novalidate>
        ${myFoodFields({ name: ctx.query.trim() }, { serving: false })}
        <label class="field"><span>Meal</span><select name="meal">${mealOptions(ctx.meal)}</select></label>
        ${daysPicker(ctx.days)}
        <div id="quick-preview" class="preview" aria-live="polite"></div>
        <label class="check"><input type="checkbox" name="save"><span>Save to my foods for next time</span></label>
        <button class="btn" type="submit" data-add-label="Add">${addLabel(ctx, "Add")}</button>
        <p class="msg bad" role="status" id="quick-msg"></p>
      </form>`, handlers);
    updateQuickPreview();
  }

  function updateQuickPreview() {
    const form = panelEl().querySelector("#quick-form");
    const out = panelEl().querySelector("#quick-preview");
    if (!form || !out) return;
    const f = readMyFood(form);
    out.innerHTML = f.kcal > 0 || f.protein > 0 ? nutrientPreview(f, ctx.t, { perDay: ctx.days.size > 1 }) : `<p class="hint">Enter the calories to see the share of today's targets.</p>`;
  }

  async function addQuick(form) {
    const f = readMyFood(form);
    const problem = myFoodProblem(f);
    if (problem) { panelEl().querySelector("#quick-msg").textContent = problem; return; }
    if (noDays("#quick-msg")) return;
    const fd = new FormData(form);
    const m = String(fd.get("meal"));
    const now = new Date();
    const days = chosenDays();
    let source = "quick", ref = null;
    const ex = extrasOf(f);
    if (fd.get("save") === "on") {
      ref = newId();
      source = "my";
      await db.put("myFoods", { id: ref, ...f, serving: "1 serving", grams: null, uses: days.length, lastUsed: now.toISOString(), createdAt: now.toISOString() });
    }
    await db.putMany("entries", days.map((d, i) => ({
      id: newId(), date: d, meal: m, name: f.name, source, ref,
      amount: 1, unit: "serving", base: { kcal: f.kcal, protein: f.protein, fat: f.fat, carbs: f.carbs, ...ex }, createdAt: new Date(now.getTime() + i).toISOString(),
    })));
    closePanel();
    rerender();
    await announceDay(`Added ${f.name} to ${mealLabel(m)}${daysNote(days.length)}.`);
  }

  if (swap) swapPanel(searchScreen(), handlers); else openPanel(searchScreen(), handlers);
  showResults();
}

// ---------- my food fields (quick add and the my-foods editor) ----------

function myFoodFields(f, { serving = true } = {}) {
  const v = (x) => (x === null || x === undefined ? "" : esc(x));
  const hasExtra = EXTRAS.some((x) => f[x.id] != null);
  return `
    <label class="field"><span>Name</span><input name="name" type="text" required maxlength="80" value="${v(f.name)}" autocomplete="off" ${f.name ? "" : "autofocus"}></label>
    ${serving ? `<label class="field"><span>Brand or place (optional)</span><input name="brand" type="text" maxlength="60" value="${v(f.brand)}" autocomplete="off"></label>
    <div class="grid2">
      <label class="field"><span>Serving</span><input name="serving" type="text" maxlength="40" placeholder="1 pack" value="${v(f.serving)}"></label>
      <label class="field"><span>Serving weight (g, optional)</span><input name="grams" type="number" inputmode="decimal" min="0" step="any" value="${v(f.grams)}"></label>
    </div>` : ""}
    <div class="grid2">
      <label class="field"><span>Calories (kcal)</span><input name="kcal" type="number" inputmode="decimal" min="0" step="any" value="${v(f.kcal)}" ${f.name ? "autofocus" : ""}></label>
      <label class="field"><span>Protein (g)</span><input name="protein" type="number" inputmode="decimal" min="0" step="any" value="${v(f.protein)}"></label>
    </div>
    <div class="grid2">
      <label class="field"><span>Carbs (g, optional)</span><input name="carbs" type="number" inputmode="decimal" min="0" step="any" value="${v(f.carbs)}"></label>
      <label class="field"><span>Fat (g, optional)</span><input name="fat" type="number" inputmode="decimal" min="0" step="any" value="${v(f.fat)}"></label>
    </div>
    <details class="more" ${hasExtra ? "open" : ""}><summary>Fiber, sugar and sodium (optional)</summary>
      <div class="grid3">
        ${EXTRAS.map((x) => `<label class="field"><span>${x.label} (${x.unit})</span><input name="${x.id}" type="number" inputmode="decimal" min="0" step="any" value="${v(f[x.id])}"></label>`).join("")}
      </div>
    </details>`;
}

function readMyFood(form) {
  const fd = new FormData(form);
  const raw = (k) => String(fd.get(k) ?? "").trim();
  const num = (k) => (raw(k) === "" ? 0 : Number(raw(k)));
  const grams = raw("grams");
  const out = {
    name: raw("name"),
    brand: raw("brand"),
    serving: raw("serving") || "1 serving",
    grams: grams === "" ? null : Number(grams),
    kcal: num("kcal"), protein: num("protein"), carbs: num("carbs"), fat: num("fat"),
  };
  // Left empty means not known: stored as null, never as 0.
  for (const x of EXTRAS) out[x.id] = raw(x.id) === "" ? null : Number(raw(x.id));
  return out;
}

function myFoodProblem(f) {
  if (!f.name) return "Give it a name.";
  for (const k of ["kcal", "protein", "carbs", "fat"]) if (!(f[k] >= 0 && f[k] < 10000)) return "Numbers must be zero or more.";
  for (const x of EXTRAS) if (f[x.id] !== null && !(f[x.id] >= 0 && f[x.id] < 100000)) return `${x.label} must be zero or more, or left empty.`;
  if (f.grams !== null && !(f.grams > 0)) return "Serving weight must be above zero, or left empty.";
  if (!(f.kcal > 0 || f.protein > 0)) return "Enter the calories (and protein if you know it).";
  return "";
}

// ---------- my foods and recipes ----------

async function openMyFoods(message = "", tone = "good") {
  const foods = (await db.getAll("myFoods")).sort((a, b) => a.name.localeCompare(b.name));
  const list = foods.map((f) => `<li><button type="button" class="result" data-act="edit" data-id="${esc(f.id)}">
      <span class="entry-name">${esc(f.name)}<span class="hint">${f.brand ? `${esc(f.brand)} · ` : ""}${f.recipe ? `Recipe · ${plural(f.recipe.items.length, "ingredient")} · ` : ""}per ${esc(f.serving || "serving")}${f.grams && f.serving !== `${dec1(f.grams)} g` ? ` (${dec1(f.grams)} g)` : ""}</span></span>
      <span class="entry-num">${int(f.kcal)}<span class="hint">${dec1(f.protein)}g P</span></span>
    </button></li>`).join("");
  const screen = `
    <div class="sheet-head"><h2 id="panel-title">My foods</h2>${closeBtn}</div>
    <p class="sub">Foods you eat often, with their label numbers per serving, and recipes you cook. They come up first in search.</p>
    <div class="foot-actions tight">
      <button type="button" class="btn" data-act="new">New food</button>
      <button type="button" class="btn ghost" data-act="new-recipe">New recipe</button>
      <button type="button" class="btn ghost" data-act="import">Import My foods…</button>
    </div>
    <p class="msg ${tone}" role="status">${esc(message)}</p>
    ${foods.length ? `<ul class="entries spaced">${list}</ul>` : `<p class="hint">No saved foods yet. Save one here, from quick add, or when adding a food from the lists.</p>`}`;
  const handlers = {
    click: async (act, el) => {
      if (act === "new") editMyFood(null);
      else if (act === "new-recipe") await editRecipe(null);
      else if (act === "import") pickMyFoodsFile();
      else if (act === "edit") {
        const f = foods.find((x) => x.id === el.dataset.id);
        if (f?.recipe) await editRecipe(f); else editMyFood(f);
      }
      else if (act === "back") openMyFoods();
      else if (act === "delete") {
        const f = foods.find((x) => x.id === el.dataset.id);
        if (f && confirm(`Delete "${f.name}" from my foods? Days you already logged keep it.`)) { await db.del("myFoods", f.id); await openMyFoods(); }
      }
    },
    submit: async (form) => {
      const f = readMyFood(form);
      const problem = myFoodProblem(f);
      if (problem) { panelEl().querySelector("#myfood-msg").textContent = problem; return; }
      const id = form.dataset.id;
      const old = id ? await db.get("myFoods", id) : null;
      await db.put("myFoods", { ...(old ?? { uses: 0, lastUsed: "", createdAt: new Date().toISOString() }), ...f, id: id || newId() });
      await openMyFoods();
    },
  };
  function editMyFood(f) {
    swapPanel(`
      <div class="sheet-head">${backBtn()}<h2 id="panel-title" class="grow">${f ? "Edit food" : "New food"}</h2>${closeBtn}</div>
      <form class="form" id="myfood-form" data-id="${f ? esc(f.id) : ""}" novalidate>
        ${myFoodFields(f ?? { serving: "1 serving" })}
        <button class="btn" type="submit">Save</button>
        ${f ? `<button class="btn danger" type="button" data-act="delete" data-id="${esc(f.id)}">Delete</button>` : ""}
        <p class="msg bad" role="status" id="myfood-msg"></p>
      </form>`, handlers);
  }
  const dlg = document.querySelector("#panel-dialog");
  if (dlg.open) swapPanel(screen, handlers); else openPanel(screen, handlers);
}

// Import My foods: a JSON file of foods and meals (shape in foods.js), read on
// the device. A confirm says what it adds and updates; cancelling changes nothing.
let myFoodsInput;
function pickMyFoodsFile() {
  if (!myFoodsInput) {
    myFoodsInput = Object.assign(document.createElement("input"), { type: "file", accept: ".json,application/json", hidden: true });
    document.body.append(myFoodsInput);
    myFoodsInput.addEventListener("change", async () => {
      const file = myFoodsInput.files[0];
      myFoodsInput.value = "";
      if (!file) return;
      try { await importMyFoods(await file.text()); }
      catch (err) { await openMyFoods(`Import failed: ${err.message}. Nothing changed.`, "bad"); }
    });
  }
  myFoodsInput.click();
}

async function importMyFoods(text) {
  const parsed = parseMyFoodsFile(text);
  if (!parsed.ok) { await openMyFoods(parsed.error, "bad"); return; }
  const [foods, meals] = await Promise.all([db.getAll("myFoods"), db.getAll("myMeals")]);
  const plan = planMyFoodsImport(parsed, foods, meals, { ids: newId });
  const c = plan.counts;
  const few = (list) => `${list.slice(0, 3).join("; ")}${list.length > 3 ? "; …" : ""}`;
  const lines = [
    `Import ${plural(plan.foods.length, "food")} and ${plural(plan.meals.length, "meal")}?`,
    `My foods: ${c.newFoods} new, ${c.updatedFoods} updated (same name and brand). My meals: ${c.newMeals} new, ${c.updatedMeals} updated (same name).`,
    plan.skipped.length ? `${plural(plan.skipped.length, "item")} left out (${few(plan.skipped)}).` : "",
  ].filter(Boolean);
  if (!plan.foods.length && !plan.meals.length) { await openMyFoods(`Nothing to import. ${few(plan.skipped)}.`, "bad"); return; }
  if (!confirm(lines.join("\n\n"))) { await openMyFoods("Import cancelled. Nothing changed."); return; }
  if (plan.foods.length) await db.putMany("myFoods", plan.foods);
  if (plan.meals.length) {
    try { await db.putMany("myMeals", plan.meals); }
    catch (err) { await openMyFoods(`My foods were imported, but my meals failed: ${err.message}. Import the file again to add them.`, "bad"); return; }
  }
  await openMyFoods(`Imported ${plural(plan.foods.length, "food")} and ${plural(plan.meals.length, "meal")}${plan.skipped.length ? `, left out ${plan.skipped.length}` : ""}.`);
}

// A recipe: ingredients (picked like any food) and the number of servings it
// makes. It is saved as a my food whose numbers are per serving, so it is
// searched and logged like one; the ingredients stay with it for editing.
async function editRecipe(food) {
  const r = food
    ? { id: food.id, name: food.name, serving: food.serving || "1 serving", servings: food.recipe.servings, items: food.recipe.items.map((it) => ({ ...it, base: { ...it.base } })) }
    : { id: null, name: "", serving: "1 serving", servings: 4, items: [] };
  const data = await loadAddData();
  let message = "";

  const readForm = () => {
    const form = panelEl().querySelector("#recipe-form");
    if (!form) return;
    const fd = new FormData(form);
    r.name = String(fd.get("name") ?? "").trim();
    r.serving = String(fd.get("serving") ?? "").trim() || "1 serving";
    r.servings = Number(fd.get("servings"));
  };

  const perServingHtml = () => (r.items.length && r.servings > 0
    ? `<p class="hint">Per ${esc(r.serving)}:</p>${nutrientPreview(recipePerServing(r.items, r.servings), null)}`
    : `<p class="hint">${r.items.length ? "Enter how many servings it makes." : "Add the ingredients, then how many servings it makes."}</p>`);

  const handlers = {
    input: () => { readForm(); const p = panelEl().querySelector("#recipe-preview"); if (p) p.innerHTML = perServingHtml(); },
    click: async (act, el) => {
      if (act === "back") { await openMyFoods(); return; }
      if (act === "ing-del") { readForm(); const it = r.items.splice(Number(el.dataset.i), 1)[0]; message = it ? `Removed ${it.name}.` : ""; show(); return; }
      if (act === "ing-add") {
        readForm();
        foodFlow({
          mode: "ingredient", query: "", days: new Set(), ...data,
          onIngredient: (item) => { r.items.push(item); message = `Added ${item.name}.`; show(); },
          onExit: () => { message = ""; show(); },
        }, true);
        return;
      }
      if (act === "delete" && r.id && confirm(`Delete the recipe "${r.name}"? Days you already logged keep it.`)) { await db.del("myFoods", r.id); await openMyFoods(); }
    },
    submit: async () => {
      readForm();
      const msg = panelEl().querySelector("#recipe-msg");
      if (!r.name) { msg.textContent = "Give it a name."; return; }
      if (!(r.servings > 0 && r.servings <= 100)) { msg.textContent = "Servings must be above zero (up to 100)."; return; }
      if (!r.items.length) { msg.textContent = "Add at least one ingredient."; return; }
      const old = r.id ? await db.get("myFoods", r.id) : null;
      const now = new Date().toISOString();
      await db.put("myFoods", {
        ...(old ?? { uses: 0, lastUsed: "", createdAt: now }),
        id: r.id || newId(), name: r.name, serving: r.serving, grams: null,
        fiber: null, sugar: null, sodium: null, // replaced below when the ingredients carry them
        ...recipePerServing(r.items, r.servings),
        recipe: { servings: r.servings, items: r.items },
      });
      await openMyFoods();
    },
  };

  function show() {
    const rows = r.items.map((it, i) => {
      const n = entryNutrients(it);
      return `<li class="meal-item"><div class="entry"><span class="entry-name">${esc(it.name)}<span class="hint">${esc(amountText(it))}</span></span><span class="entry-num">${int(n.kcal)}<span class="hint">${dec1(n.protein)}g P</span></span></div>
        <button type="button" class="icon-btn" data-act="ing-del" data-i="${i}" aria-label="Remove ${esc(it.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></li>`;
    }).join("");
    const tot = itemsTotal(r.items);
    swapPanel(`
      <div class="sheet-head">${backBtn()}<h2 id="panel-title" class="grow">${r.id ? "Edit recipe" : "New recipe"}</h2>${closeBtn}</div>
      <form class="form" id="recipe-form" novalidate>
        <label class="field"><span>Name</span><input name="name" type="text" maxlength="80" autocomplete="off" value="${esc(r.name)}" ${r.name ? "" : "autofocus"}></label>
        <div class="grid2">
          <label class="field"><span>Servings it makes</span><input name="servings" type="number" inputmode="decimal" min="0" step="any" value="${Number.isFinite(r.servings) ? esc(r.servings) : ""}"></label>
          <label class="field"><span>One serving is</span><input name="serving" type="text" maxlength="40" placeholder="1 bowl" value="${esc(r.serving)}"></label>
        </div>
        <div class="meal-head"><h3>Ingredients</h3><span class="hint">${r.items.length ? `${int(tot.kcal)} kcal in all` : ""}</span></div>
        ${rows ? `<ul class="entries" aria-label="Ingredients">${rows}</ul>` : ""}
        <button type="button" class="add-btn" data-act="ing-add">+ Add ingredient</button>
        <p class="msg good" role="status">${esc(message)}</p>
        <div id="recipe-preview" class="preview" aria-live="polite">${perServingHtml()}</div>
        <button class="btn" type="submit">Save recipe</button>
        ${r.id ? `<button class="btn danger" type="button" data-act="delete">Delete</button>` : ""}
        <p class="msg bad" role="status" id="recipe-msg"></p>
      </form>`, handlers);
    if (!message) return;
    // After adding or removing, keep the place in the list for a keyboard or screen reader.
    panelEl().querySelector("[data-act=ing-add]")?.focus();
  }
  show();
}

// ---------- my meals ----------

// The meal (breakfast, lunch, ...) a my meal was saved with, or null for one
// saved before meals were kept, or imported without one.
const savedMeal = (m) => (MEALS.some((x) => x.id === m?.meal) ? m.meal : null);

// Save the foods logged in one meal of the shown day as a my meal.
async function openSaveMeal(mealId) {
  const entries = byMeal(await db.getByIndex("entries", "date", day))[mealId]?.entries ?? [];
  if (!entries.length) { rerender(); return; }
  const rows = entries.map((e) => {
    const n = entryNutrients(e);
    return `<li><label class="check entry"><input type="checkbox" name="pick" value="${esc(e.id)}" checked><span class="entry-name">${esc(e.name)}<span class="hint">${esc(amountText(e))} · ${int(n.kcal)} kcal</span></span></label></li>`;
  }).join("");
  openPanel(`
    <div class="sheet-head"><h2 id="panel-title" class="grow">Save as meal</h2>${closeBtn}</div>
    <p class="sub">Save these foods as one meal, then add them all with one tap from the add sheet.</p>
    <form class="form" id="savemeal-form" novalidate>
      <label class="field"><span>Meal name</span><input name="name" type="text" maxlength="80" autocomplete="off" placeholder="Burrito bowl" autofocus></label>
      <fieldset class="plain"><legend class="hint">Foods in it</legend><ul class="entries">${rows}</ul></fieldset>
      <button class="btn" type="submit">Save meal</button>
      <p class="msg bad" role="status" id="savemeal-msg"></p>
    </form>`, {
    submit: async (form) => {
      const fd = new FormData(form);
      const name = String(fd.get("name") ?? "").trim();
      const ids = new Set(fd.getAll("pick"));
      const msg = panelEl().querySelector("#savemeal-msg");
      if (!name) { msg.textContent = "Give the meal a name."; return; }
      if (!ids.size) { msg.textContent = "Keep at least one food in it."; return; }
      const items = entries.filter((e) => ids.has(e.id)).map(itemFromEntry);
      await db.put("myMeals", { id: newId(), name, meal: mealId, items, uses: 0, lastUsed: "", createdAt: new Date().toISOString() });
      closePanel();
      rerender();
      announce(`Saved ${name} as a meal with ${plural(items.length, "food")}.`);
    },
  });
}

async function openMyMeals(message = "") {
  const meals = (await db.getAll("myMeals")).sort((a, b) => a.name.localeCompare(b.name));
  const list = meals.map((m) => {
    const tot = itemsTotal(m.items);
    return `<li><button type="button" class="result" data-act="edit" data-id="${esc(m.id)}">
      <span class="entry-name">${esc(m.name)}<span class="hint">${plural(m.items.length, "food")}</span></span>
      <span class="entry-num">${int(tot.kcal)}<span class="hint">${dec1(tot.protein)}g P</span></span>
    </button></li>`;
  }).join("");
  const screen = `
    <div class="sheet-head"><h2 id="panel-title">My meals</h2>${closeBtn}</div>
    <p class="sub">Foods you eat together, added to the log in one tap from the add sheet.</p>
    <p class="msg good" role="status">${esc(message)}</p>
    ${meals.length ? `<ul class="entries spaced">${list}</ul>` : `<p class="hint">No meals yet. On the Nutrition tab, log the foods of a meal, then tap "Save as meal" under it.</p>`}`;
  const handlers = {
    click: async (act, el) => {
      if (act === "edit") editMeal(meals.find((m) => m.id === el.dataset.id));
      else if (act === "back") await openMyMeals();
      else if (act === "delete") {
        const m = meals.find((x) => x.id === el.dataset.id);
        if (m && confirm(`Delete the meal "${m.name}"? Days you already logged keep its foods.`)) { await db.del("myMeals", m.id); await openMyMeals(`Deleted ${m.name}.`); }
      }
    },
    submit: async (form) => {
      const m = meals.find((x) => x.id === form.dataset.id);
      if (!m) return;
      const fd = new FormData(form);
      const name = String(fd.get("name") ?? "").trim();
      const keep = new Set(fd.getAll("keep").map(Number));
      const msg = panelEl().querySelector("#meal-edit-msg");
      if (!name) { msg.textContent = "Give the meal a name."; return; }
      if (!keep.size) { msg.textContent = "Keep at least one food, or delete the meal."; return; }
      await db.put("myMeals", { ...m, name, items: m.items.filter((_, i) => keep.has(i)) });
      await openMyMeals(`Saved ${name}.`);
    },
  };
  function editMeal(m) {
    if (!m) return;
    const rows = m.items.map((it, i) => `<li><label class="check entry"><input type="checkbox" name="keep" value="${i}" checked><span class="entry-name">${esc(it.name)}<span class="hint">${esc(amountText(it))} · ${int(entryNutrients(it).kcal)} kcal</span></span></label></li>`).join("");
    swapPanel(`
      <div class="sheet-head">${backBtn()}<h2 id="panel-title" class="grow">Edit meal</h2>${closeBtn}</div>
      <form class="form" id="meal-edit-form" data-id="${esc(m.id)}" novalidate>
        <label class="field"><span>Meal name</span><input name="name" type="text" maxlength="80" autocomplete="off" value="${esc(m.name)}"></label>
        <fieldset class="plain"><legend class="hint">Foods in it (untick to take one out)</legend><ul class="entries">${rows}</ul></fieldset>
        <button class="btn" type="submit">Save</button>
        <button class="btn danger" type="button" data-act="delete" data-id="${esc(m.id)}">Delete meal</button>
        <p class="msg bad" role="status" id="meal-edit-msg"></p>
      </form>`, handlers);
  }
  const dlg = document.querySelector("#panel-dialog");
  if (dlg.open) swapPanel(screen, handlers); else openPanel(screen, handlers);
}

// ---------- weekly history (imported, read-only) ----------

const g = (v) => (v == null ? "–" : `${int(v)}g`);
const pct = (v) => (v == null ? "–" : `${int(v)} %`);

async function openWeeks(message = "", tone = "") {
  const weeks = (await db.getAll("nutritionWeeks")).sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  const rows = weeks.map((w) => {
    const split = [w.proteinPct, w.carbPct, w.fatPct].some((v) => v != null) ? ` · P ${pct(w.proteinPct)} / C ${pct(w.carbPct)} / F ${pct(w.fatPct)}` : "";
    return `<li class="week">
      <div class="sum-row"><span class="entry-name">${esc(fmtDate(w.weekStart))} – ${esc(fmtDate(w.weekEnd))}</span><span class="entry-num">${int(w.kcal)}<span class="hint"> kcal/day</span></span></div>
      <p class="hint">Protein ${g(w.protein)} · Carbs ${g(w.carbs)} · Fat ${g(w.fat)} · Fiber ${g(w.fiber)}${split}</p>
    </li>`;
  }).join("");
  const html = `
    <div class="sheet-head"><h2 id="panel-title">Weekly history</h2>${closeBtn}</div>
    <p class="sub">Daily averages per week, imported from another app. Shown as history only: they do not count toward today's targets.</p>
    <div class="foot-actions tight">
      <button type="button" class="btn ghost" data-act="import">Import CSV</button>
      ${weeks.length ? `<button type="button" class="btn danger" data-act="clear">Remove all</button>` : ""}
    </div>
    <p class="hint">CSV columns: <code>week_start,week_end,net_kcal_per_day,protein_g,carbs_g,fat_g,fiber_g,carb_pct,fat_pct,protein_pct</code>, dates as YYYY-MM-DD. A week already here is replaced.</p>
    <p class="msg ${tone}" role="status">${esc(message)}</p>
    ${rows ? `<ul class="entries weeks" aria-label="Weeks, newest first">${rows}</ul>` : `<p class="hint">No weeks imported yet.</p>`}`;
  const handlers = {
    click: async (act) => {
      if (act === "import") pickWeeksCsv();
      if (act === "clear" && confirm(`Remove all ${weeks.length} imported weeks? Your food log is not touched. This cannot be undone.`)) {
        await db.delMany("nutritionWeeks", weeks.map((w) => w.weekStart));
        await openWeeks("Weekly history removed.", "good");
      }
    },
  };
  if (document.querySelector("#panel-dialog").open) swapPanel(html, handlers); else openPanel(html, handlers);
}

let weeksInput;
function pickWeeksCsv() {
  if (!weeksInput) {
    weeksInput = Object.assign(document.createElement("input"), { type: "file", accept: ".csv,text/csv,text/plain", hidden: true });
    document.body.append(weeksInput);
    weeksInput.addEventListener("change", async () => {
      const file = weeksInput.files[0];
      weeksInput.value = "";
      if (!file) return;
      try { await importWeeks(await file.text()); }
      catch (err) { await openWeeks(`Import failed: ${err.message}. Nothing changed.`, "bad"); }
    });
  }
  weeksInput.click();
}

async function importWeeks(text) {
  const { rows, skipped } = parseWeeklyCsv(text);
  const skipNote = skipped.map((s) => `line ${s.line}: ${s.reason}`);
  const few = (list) => `${list.slice(0, 3).join("; ")}${list.length > 3 ? "; …" : ""}`;
  if (!rows.length) { await openWeeks(`No weeks found in that file.${skipNote.length ? ` Skipped ${few(skipNote)}.` : ""}`, "bad"); return; }
  const have = new Set((await db.getAll("nutritionWeeks")).map((w) => w.weekStart));
  const replacing = rows.filter((r) => have.has(r.weekStart)).length;
  const lines = [
    `Add ${rows.length} ${rows.length === 1 ? "week" : "weeks"} of nutrition history, ${rows[0].weekStart} to ${rows[rows.length - 1].weekEnd}?`,
    replacing ? `${replacing} of those weeks are already here and the file replaces them.` : "",
    skipNote.length ? `${skipNote.length} ${skipNote.length === 1 ? "line is" : "lines are"} skipped (${few(skipNote)}).` : "",
  ].filter(Boolean);
  if (!confirm(lines.join("\n\n"))) { await openWeeks("Import cancelled. Nothing changed."); return; }
  const at = new Date().toISOString();
  await db.putMany("nutritionWeeks", rows.map((r) => ({ ...r, source: "csv", at })));
  await openWeeks(`Imported ${rows.length} ${rows.length === 1 ? "week" : "weeks"}${skipNote.length ? `, skipped ${skipNote.length} ${skipNote.length === 1 ? "line" : "lines"}` : ""}.`, "good");
}

// ---------- edit an entry ----------

async function openEntry(id) {
  const [e, profile] = await Promise.all([db.get("entries", id), loadProfile()]);
  if (!e) { rerender(); return; }
  const t = targetsFor(profile);
  const preview = (amount) => (amount > 0 ? nutrientPreview(itemsTotal([{ ...e, amount }]), t) : `<p class="hint">Enter an amount.</p>`);
  const unitText = e.unit === "g" ? "g" : `× ${e.unit}`;
  openPanel(`
    <div class="sheet-head"><h2 id="panel-title" class="grow">${esc(e.name)}</h2>${closeBtn}</div>
    <p class="sub">${esc(SOURCES[e.source] ?? "Quick add")} · ${esc(mealLabel(e.meal))}</p>
    <form class="form" id="entry-form" novalidate>
      <div class="grid2">
        <label class="field"><span>Amount (${esc(unitText)})</span><input name="amount" type="number" inputmode="decimal" min="0" step="any" value="${esc(e.amount)}"></label>
        <label class="field"><span>Meal</span><select name="meal">${mealOptions(e.meal)}</select></label>
      </div>
      <div id="entry-preview" class="preview" aria-live="polite">${preview(e.amount)}</div>
      <button class="btn" type="submit">Save</button>
      <button class="btn danger" type="button" data-act="delete">Remove from log</button>
      <p class="msg bad" role="status" id="entry-msg"></p>
    </form>`, {
    input: () => {
      const amount = Number(new FormData(panelEl().querySelector("#entry-form")).get("amount"));
      panelEl().querySelector("#entry-preview").innerHTML = preview(amount);
    },
    click: async (act) => {
      if (act === "delete") { await db.del("entries", e.id); closePanel(); rerender(); await announceDay(`Removed ${e.name}.`); }
    },
    submit: async (form) => {
      const fd = new FormData(form);
      const amount = Number(fd.get("amount"));
      if (!(amount > 0 && amount < 100000)) { panelEl().querySelector("#entry-msg").textContent = "Enter an amount above zero."; return; }
      await db.put("entries", { ...e, amount, meal: String(fd.get("meal")) });
      closePanel();
      rerender();
      await announceDay(`Saved ${e.name}.`);
    },
  });
}
