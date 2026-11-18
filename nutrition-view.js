// Nutrition tab: the day's food log against the calorie and protein targets,
// the profile sheet, the add-food flow (search, quick-add, my foods) and the
// Today tab's tiles. Targets maths lives in nutrition.js, search in foods.js.
import * as db from "./db.js";
import { ACTIVITY, DEFAULT_DEFICIT, MACRO_LIMITS, DEFAULT_PROTEIN_PER_KG, MAX_DEFICIT, PROTEIN_RANGE, MEALS, profileProblems, targets, projection, dayKey, shiftDay, byMeal, sumEntries, entryNutrients, kgToLb, mealForHour, parseWeeklyCsv, dayTotalsMessage } from "./nutrition.js";
import { SOURCES, fromTableRow, fromMyFood, searchFoods, makeEntry, recentMyFoods, unitLabel } from "./foods.js";
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
    </div>` : `
    <div class="card summary">
      <div class="sum-row"><div><span class="stat-label">Eaten</span><span class="sum-big">${int(total.kcal)}</span><span class="muted"> kcal</span></div><div class="right"><span class="sum-big protein-text">${int(total.protein)}g</span><span class="muted"> protein</span></div></div>
      <p class="macros">Carbs ${int(total.carbs)}g · Fat ${int(total.fat)}g</p>
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
      <button type="button" class="add-btn" data-act="n-add" data-meal="${m.id}">+ Add to ${m.label.toLowerCase()}</button>
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

async function openAdd(meal = mealForHour(new Date().getHours())) {
  const state = { meal, query: "", results: new Map(), myFoods: (await db.getAll("myFoods")).map(fromMyFood) };
  loadTables().catch(() => {});

  const resultRow = (f) => `<li><button type="button" class="result" data-act="pick" data-id="${esc(f.id)}">
      <span class="entry-name">${esc(f.name)}<span class="hint">${esc(SOURCES[f.source])} · per ${esc(f.per === "serving" ? f.units[0].label : f.per)}</span></span>
      <span class="entry-num">${int(f.kcal)}<span class="hint">${dec1(f.protein)}g P</span></span>
    </button></li>`;

  async function showResults() {
    const box = panelEl().querySelector("#results");
    if (!box) return;
    const q = state.query.trim();
    let list, head = "";
    if (!q) {
      list = recentMyFoods(state.myFoods).map((f) => state.myFoods.find((m) => m.id === f.id));
      head = list.length ? `<h3>My foods</h3>` : `<p class="hint">Type to search about 8,000 foods, or quick-add from a label.</p>`;
    } else {
      let lists = [state.myFoods];
      try { lists = [state.myFoods, ...(await loadTables())]; }
      catch (e) { head = `<p class="hint bad-text">Only your foods are searched: ${esc(e.message)}.</p>`; }
      if (state.query.trim() !== q) return; // a newer search is on its way
      list = searchFoods(q, lists, 40);
      if (!list.length) head += `<p class="hint">Nothing matches "${esc(q)}". Try fewer or shorter words, or quick-add it.</p>`;
    }
    state.results = new Map(list.map((f) => [f.id, f]));
    box.innerHTML = head + (list.length ? `<ul class="entries">${list.map(resultRow).join("")}</ul>` : "");
  }

  const searchScreen = () => `
    <div class="sheet-head"><h2 id="panel-title">Add food</h2>${closeBtn}</div>
    <div class="add-top">
      <label class="field inline"><span>Meal</span><select name="meal" id="add-meal">${mealOptions(state.meal)}</select></label>
      <button type="button" class="btn ghost small-btn" data-act="quick">Quick add</button>
    </div>
    <input type="search" id="food-q" class="search" placeholder="Search foods (e.g. chicken breast, natto)" aria-label="Search foods" autocomplete="off" value="${esc(state.query)}" autofocus>
    <div id="results" class="results" aria-live="polite"></div>`;

  let timer;
  const handlers = {
    input: (e) => {
      if (e.target.id === "add-meal") { state.meal = e.target.value; return; }
      if (e.target.id === "food-q") {
        state.query = e.target.value;
        clearTimeout(timer);
        timer = setTimeout(showResults, 120);
      }
      if (e.target.closest("#amount-form")) updateAmountPreview();
    },
    click: async (act, el) => {
      if (act === "pick") showAmount(state.results.get(el.dataset.id));
      else if (act === "quick") showQuick();
      else if (act === "back") { swapPanel(searchScreen(), handlers); showResults(); }
    },
    submit: async (form) => {
      if (form.id === "amount-form") await addPicked(form);
      if (form.id === "quick-form") await addQuick(form);
    },
  };

  // ----- amount step -----
  let picked = null;
  function showAmount(food) {
    if (!food) return;
    picked = food;
    const defUnit = 0; // grams for the tables, one serving for my foods
    const defAmount = food.units[defUnit].label === "g" ? 100 : 1;
    swapPanel(`
      <div class="sheet-head">${backBtn()}<h2 id="panel-title" class="grow">${esc(food.name)}</h2>${closeBtn}</div>
      <p class="sub">${esc(SOURCES[food.source])} · per ${esc(food.per === "serving" ? food.units[0].label : food.per)}: ${int(food.kcal)} kcal, ${dec1(food.protein)} g protein, ${dec1(food.carbs)} g carbs, ${dec1(food.fat)} g fat</p>
      <form class="form" id="amount-form" novalidate>
        <div class="grid2">
          <label class="field"><span>Amount</span><input name="amount" type="number" inputmode="decimal" min="0" step="any" value="${defAmount}" autofocus></label>
          <label class="field"><span>Unit</span><select name="unit">${food.units.map((u, i) => `<option value="${i}" ${i === defUnit ? "selected" : ""}>${esc(unitLabel(u))}</option>`).join("")}</select></label>
        </div>
        <label class="field"><span>Meal</span><select name="meal">${mealOptions(state.meal)}</select></label>
        <div id="amount-preview" class="preview" aria-live="polite"></div>
        ${food.source === "my" ? "" : `<label class="check"><input type="checkbox" name="save"><span>Also save this amount to my foods</span></label>`}
        <button class="btn" type="submit">Add</button>
        <p class="msg bad" role="status" id="amount-msg"></p>
      </form>`, handlers);
    updateAmountPreview();
  }

  function readAmount(form) {
    const fd = new FormData(form);
    const unit = picked.units[Number(fd.get("unit"))] ?? picked.units[0];
    return { unit, amount: Number(fd.get("amount")), meal: String(fd.get("meal")), save: fd.get("save") === "on" };
  }

  function updateAmountPreview() {
    const form = panelEl().querySelector("#amount-form");
    const out = panelEl().querySelector("#amount-preview");
    if (!form || !out || !picked) return;
    const { unit, amount } = readAmount(form);
    if (!(amount > 0)) { out.innerHTML = `<p class="hint">Enter an amount.</p>`; return; }
    const k = unit.factor * amount;
    out.innerHTML = `<p class="preview-line"><strong>${int(picked.kcal * k)}</strong> kcal · <strong class="protein-text">${dec1(picked.protein * k)} g</strong> protein · ${dec1(picked.carbs * k)} g carbs · ${dec1(picked.fat * k)} g fat</p>`;
  }

  async function addPicked(form) {
    const { unit, amount, meal: m, save } = readAmount(form);
    if (!(amount > 0 && amount < 100000)) { panelEl().querySelector("#amount-msg").textContent = "Enter an amount above zero."; return; }
    const now = new Date();
    const entry = makeEntry(picked, unit, amount, { id: newId(), date: day, meal: m, now });
    await db.put("entries", entry);
    if (picked.source === "my") {
      const mf = await db.get("myFoods", picked.id);
      if (mf) await db.put("myFoods", { ...mf, uses: (mf.uses ?? 0) + 1, lastUsed: now.toISOString() });
    } else if (save) {
      const k = unit.factor * amount;
      const r1 = (n) => Math.round(n * 10) / 10;
      await db.put("myFoods", {
        id: newId(), name: picked.name,
        serving: unit.label === "g" ? `${dec1(amount)} g` : `${dec1(amount)} × ${unit.label}`,
        grams: unit.grams ? r1(unit.grams * amount) : null,
        kcal: Math.round(picked.kcal * k), protein: r1(picked.protein * k), fat: r1(picked.fat * k), carbs: r1(picked.carbs * k),
        uses: 1, lastUsed: now.toISOString(), createdAt: now.toISOString(),
      });
    }
    closePanel();
    rerender();
    await announceDay(`Added ${picked.name} to ${mealLabel(m)}.`);
  }

  // ----- quick add -----
  function showQuick() {
    swapPanel(`
      <div class="sheet-head">${backBtn()}<h2 id="panel-title" class="grow">Quick add</h2>${closeBtn}</div>
      <p class="sub">Type the numbers from a label or a menu.</p>
      <form class="form" id="quick-form" novalidate>
        ${myFoodFields({ name: state.query.trim() }, { serving: false })}
        <label class="field"><span>Meal</span><select name="meal">${mealOptions(state.meal)}</select></label>
        <label class="check"><input type="checkbox" name="save"><span>Save to my foods for next time</span></label>
        <button class="btn" type="submit">Add</button>
        <p class="msg bad" role="status" id="quick-msg"></p>
      </form>`, handlers);
  }

  async function addQuick(form) {
    const f = readMyFood(form);
    const problem = myFoodProblem(f);
    if (problem) { panelEl().querySelector("#quick-msg").textContent = problem; return; }
    const fd = new FormData(form);
    const now = new Date();
    let source = "quick", ref = null;
    if (fd.get("save") === "on") {
      ref = newId();
      source = "my";
      await db.put("myFoods", { id: ref, ...f, serving: "1 serving", grams: null, uses: 1, lastUsed: now.toISOString(), createdAt: now.toISOString() });
    }
    await db.put("entries", {
      id: newId(), date: day, meal: String(fd.get("meal")), name: f.name, source, ref,
      amount: 1, unit: "serving", base: { kcal: f.kcal, protein: f.protein, fat: f.fat, carbs: f.carbs }, createdAt: now.toISOString(),
    });
    closePanel();
    rerender();
    await announceDay(`Added ${f.name} to ${mealLabel(String(fd.get("meal")))}.`);
  }

  openPanel(searchScreen(), handlers);
  showResults();
}

// ---------- my food fields (quick add and the my-foods editor) ----------

function myFoodFields(f, { serving = true } = {}) {
  const v = (x) => (x === null || x === undefined ? "" : esc(x));
  return `
    <label class="field"><span>Name</span><input name="name" type="text" required maxlength="80" value="${v(f.name)}" autocomplete="off" ${f.name ? "" : "autofocus"}></label>
    ${serving ? `<div class="grid2">
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
    </div>`;
}

function readMyFood(form) {
  const fd = new FormData(form);
  const num = (k) => { const s = String(fd.get(k) ?? "").trim(); return s === "" ? 0 : Number(s); };
  const grams = String(fd.get("grams") ?? "").trim();
  return {
    name: String(fd.get("name") ?? "").trim(),
    serving: String(fd.get("serving") ?? "").trim() || "1 serving",
    grams: grams === "" ? null : Number(grams),
    kcal: num("kcal"), protein: num("protein"), carbs: num("carbs"), fat: num("fat"),
  };
}

function myFoodProblem(f) {
  if (!f.name) return "Give it a name.";
  for (const k of ["kcal", "protein", "carbs", "fat"]) if (!(f[k] >= 0 && f[k] < 10000)) return "Numbers must be zero or more.";
  if (f.grams !== null && !(f.grams > 0)) return "Serving weight must be above zero, or left empty.";
  if (!(f.kcal > 0 || f.protein > 0)) return "Enter the calories (and protein if you know it).";
  return "";
}

// ---------- my foods ----------

async function openMyFoods() {
  const foods = (await db.getAll("myFoods")).sort((a, b) => a.name.localeCompare(b.name));
  const list = foods.map((f) => `<li><button type="button" class="result" data-act="edit" data-id="${esc(f.id)}">
      <span class="entry-name">${esc(f.name)}<span class="hint">per ${esc(f.serving || "serving")}${f.grams && f.serving !== `${dec1(f.grams)} g` ? ` (${dec1(f.grams)} g)` : ""}</span></span>
      <span class="entry-num">${int(f.kcal)}<span class="hint">${dec1(f.protein)}g P</span></span>
    </button></li>`).join("");
  const screen = `
    <div class="sheet-head"><h2 id="panel-title">My foods</h2>${closeBtn}</div>
    <p class="sub">Foods you eat often, with their label numbers per serving. They come up first in search.</p>
    <button type="button" class="btn" data-act="new">New food</button>
    ${foods.length ? `<ul class="entries spaced">${list}</ul>` : `<p class="hint">No saved foods yet. Save one here, from quick add, or when adding a food from the lists.</p>`}`;
  const handlers = {
    click: async (act, el) => {
      if (act === "new") editMyFood(null);
      else if (act === "edit") editMyFood(foods.find((f) => f.id === el.dataset.id));
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
        await db.replaceAll({ nutritionWeeks: [] });
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
  const e = await db.get("entries", id);
  if (!e) { rerender(); return; }
  const preview = (amount) => {
    const n = entryNutrients({ ...e, amount });
    return amount > 0 ? `<p class="preview-line"><strong>${int(n.kcal)}</strong> kcal · <strong class="protein-text">${dec1(n.protein)} g</strong> protein · ${dec1(n.carbs)} g carbs · ${dec1(n.fat)} g fat</p>` : `<p class="hint">Enter an amount.</p>`;
  };
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
