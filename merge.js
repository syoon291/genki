// Sync merge: combine this device's stores with the copy in genki-data record
// by record, so two devices (or a device and an older copy) never lose each
// other's records. Pure functions (no DOM, no IndexedDB) so they run under
// `node --test` as well as in the browser.
//
// - Every record is matched by its store key. A record on one side only is kept.
// - The same key on both sides: the newer edit wins (editedAt, which db.js
//   stamps on every write, or for records written before that the record's own
//   time: at, updatedAt, lastUsed, createdAt). A tie keeps this device's copy.
// - Deletions travel as tombstones in the "deleted" store ({ id, store, key, at }):
//   a record is dropped when a tombstone for its key is at least as new as the
//   record, so a delete on one device is not undone by the other. A record
//   edited after the delete (logged again) is kept.
// - Two my foods with the same barcode (two devices scanned the same package
//   before syncing) become one: see dedupeBarcodes.

export const TOMBSTONES = "deleted";

export const tombstoneId = (store, key) => `${store}:${JSON.stringify(key)}`;

const ms = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string" || !v) return 0;
  const t = Date.parse(v);
  return Number.isNaN(t) ? 0 : t;
};

// When a record was last edited, in ms (0 when it carries no time at all).
export function editedMs(r) {
  if (!r || typeof r !== "object") return 0;
  const v = r.value && typeof r.value === "object" && !Array.isArray(r.value) ? r.value : {};
  // editedAt is stamped on every save, so it alone says when the record was
  // last edited; a content time (a weigh-in's `at`) may be later and must not
  // outrank it. Older records without it fall back to their newest time field.
  if (ms(r.editedAt)) return ms(r.editedAt);
  return Math.max(ms(r.at), ms(r.updatedAt), ms(v.updatedAt), ms(r.lastUsed), ms(r.createdAt));
}

// The store set a restore or import writes: the file's stores, with the
// tombstones always replaced by the file's own (none when it has none), so this
// device's old deletions can never drop restored records on the next sync.
export function withTombstones(stores) {
  return { ...stores, [TOMBSTONES]: stores?.[TOMBSTONES] ?? [] };
}

const keyOf = (r, kp) => JSON.stringify(r[kp]);

function newer(local, remote, store) {
  // The first-open date is a fact, not an edit: keep the earliest.
  if (store === "meta" && local.key === "createdAt") return ms(remote.value) && ms(remote.value) < ms(local.value) ? remote : local;
  return editedMs(remote) > editedMs(local) ? remote : local;
}

// local, remote: { storeName: [records] }. keyPaths: { storeName: keyPath }.
// Returns the merged { storeName: [records] }, every store of either side.
export function mergeStores(local, remote, keyPaths) {
  const names = [...new Set([...Object.keys(local || {}), ...Object.keys(remote || {})])];
  const tombs = new Map();
  for (const t of [...(local?.[TOMBSTONES] ?? []), ...(remote?.[TOMBSTONES] ?? [])]) {
    const had = tombs.get(t.id);
    if (!had || ms(t.at) > ms(had.at)) tombs.set(t.id, t);
  }
  const out = {};
  for (const name of names) {
    if (name === TOMBSTONES) continue;
    const kp = keyPaths[name];
    if (!kp) throw new Error(`No key path for the "${name}" section.`);
    const recs = new Map();
    for (const r of local?.[name] ?? []) recs.set(keyOf(r, kp), r);
    for (const r of remote?.[name] ?? []) {
      const k = keyOf(r, kp);
      const mine = recs.get(k);
      recs.set(k, mine ? newer(mine, r, name) : r);
    }
    out[name] = [...recs.values()].filter((r) => {
      const t = tombs.get(tombstoneId(name, r[kp]));
      return !t || editedMs(r) > ms(t.at);
    });
  }
  if (out.myFoods) dedupeBarcodes(out, tombs);
  if (names.includes(TOMBSTONES) || tombs.size) out[TOMBSTONES] = [...tombs.values()];
  return out;
}

const iso = (t) => new Date(t).toISOString();

// My foods that share a barcode become one, the same one on every device: the
// first made (earliest createdAt, then the smaller id) keeps its id and takes
// the newest edit's name and numbers, the most uses and the latest lastUsed.
// Each other copy gets a tombstone as new as the group's newest edit, with
// mergedInto naming the kept id, so a device that still has the copy drops it
// on its next sync. Entries and my meals that point at a merged copy (source
// "my", ref) are pointed at the kept one, here and on every later merge that
// sees the tombstone. Mutates out[myFoods], out.entries, out.myMeals and tombs.
function dedupeBarcodes(out, tombs) {
  const groups = new Map();
  for (const f of out.myFoods) {
    const code = typeof f.barcode === "string" ? f.barcode.trim() : "";
    if (!code) continue;
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code).push(f);
  }
  const replaced = new Map();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const first = [...group].sort((a, b) => ms(a.createdAt) - ms(b.createdAt) || String(a.id).localeCompare(String(b.id)))[0];
    const newest = group.reduce((a, b) => (editedMs(b) > editedMs(a) ? b : a));
    const editMs = Math.max(...group.map(editedMs));
    const lastUsed = group.map((f) => f.lastUsed || "").sort().at(-1);
    const kept = {
      ...newest,
      id: first.id,
      uses: Math.max(...group.map((f) => f.uses ?? 0)),
      lastUsed,
      createdAt: first.createdAt,
      ...(editMs ? { editedAt: iso(editMs) } : {}),
    };
    replaced.set(first.id, kept);
    for (const f of group) {
      if (f === first) continue;
      replaced.set(f.id, null);
      const id = tombstoneId("myFoods", f.id);
      tombs.set(id, { id, store: "myFoods", key: f.id, at: iso(Math.max(editMs, ms(tombs.get(id)?.at))), mergedInto: first.id });
    }
  }
  if (replaced.size) out.myFoods = out.myFoods.flatMap((f) => (replaced.has(f.id) ? (replaced.get(f.id) ? [replaced.get(f.id)] : []) : [f]));

  // Every merged copy's id -> the kept id (following a chain of merges).
  // A copy that is live again (edited after the merge, e.g. its barcode changed)
  // is its own food now: its entries stay.
  const liveIds = new Set(out.myFoods.map((f) => f.id));
  const into = new Map();
  for (const t of tombs.values()) if (t.store === "myFoods" && t.mergedInto != null && !liveIds.has(t.key)) into.set(t.key, t.mergedInto);
  if (!into.size) return;
  const live = (id) => {
    const seen = new Set();
    while (into.has(id) && !seen.has(id)) { seen.add(id); id = into.get(id); }
    return id;
  };
  const point = (x) => (x && x.source === "my" && into.has(x.ref) ? { ...x, ref: live(x.ref) } : x);
  if (out.entries) out.entries = out.entries.map(point);
  if (out.myMeals) out.myMeals = out.myMeals.map((m) => (Array.isArray(m.items) && m.items.some((it) => point(it) !== it) ? { ...m, items: m.items.map(point) } : m));
}

// What applying `merged` over `base` (this device's dump) changes:
// [{ store, key, before, after }], before/after null for a record added/removed.
export function diffStores(base, merged, keyPaths) {
  const changes = [];
  const names = [...new Set([...Object.keys(base || {}), ...Object.keys(merged || {})])];
  for (const store of names) {
    const kp = keyPaths[store];
    const before = new Map((base?.[store] ?? []).map((r) => [keyOf(r, kp), r]));
    const after = new Map((merged?.[store] ?? []).map((r) => [keyOf(r, kp), r]));
    for (const [k, b] of before) {
      const a = after.get(k);
      if (!a) changes.push({ store, key: b[kp], before: b, after: null });
      else if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ store, key: b[kp], before: b, after: a });
    }
    for (const [k, a] of after) if (!before.has(k)) changes.push({ store, key: a[kp], before: null, after: a });
  }
  return changes;
}

export const recordCount = (stores) => Object.entries(stores || {}).reduce((n, [k, v]) => n + (k === TOMBSTONES ? 0 : v.length), 0);
