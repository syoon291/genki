// IndexedDB store: one database ("genki"), one object store per kind of data.
// Later phases add stores by bumping DB_VERSION (and SCHEMA in backup.js) and
// adding a step to UPGRADES; existing data is never dropped by an upgrade.
import { TOMBSTONES, tombstoneId, withTombstones } from "./merge.js";

export const DB_NAME = "genki";
export const DB_VERSION = 10;

// The keyPath of each store, so a backup can be checked before it replaces anything.
export const KEY_PATHS = { meta: "key", entries: "id", myFoods: "id", weighIns: "date", workouts: "id", nutritionWeeks: "weekStart", [TOMBSTONES]: "id", myMeals: "id", days: "date", fasts: "id", exercises: "id", bodyScans: "id" };

// UPGRADES[n] moves a database from version n to n+1.
const UPGRADES = [
  (db) => {
    // Key-value settings and small app facts: { key, value }.
    db.createObjectStore("meta", { keyPath: KEY_PATHS.meta });
  },
  (db) => {
    // Food log: one record per food eaten, found by its local day ("YYYY-MM-DD").
    db.createObjectStore("entries", { keyPath: KEY_PATHS.entries }).createIndex("date", "date");
    // Saved foods: name and nutrients per serving.
    db.createObjectStore("myFoods", { keyPath: KEY_PATHS.myFoods });
  },
  (db) => {
    // Weigh-ins: at most one per local day, keyed by that day ("YYYY-MM-DD").
    db.createObjectStore("weighIns", { keyPath: KEY_PATHS.weighIns });
  },
  (db) => {
    // Finished workout sessions: { id, date (ISO time), day, sets: [{ exId, w (kg), reps, rir }], minutes } (set fields added in version 9).
    db.createObjectStore("workouts", { keyPath: KEY_PATHS.workouts });
  },
  (db) => {
    // Imported weekly nutrition averages (read-only history), keyed by the week's first day:
    // { weekStart, weekEnd, kcal, protein, carbs, fat, fiber, carbPct, fatPct, proteinPct, at }.
    db.createObjectStore("nutritionWeeks", { keyPath: KEY_PATHS.nutritionWeeks });
  },
  (db) => {
    // Tombstones, so sync carries deletions: { id: "<store>:<key as JSON>", store, key, at (ISO time deleted) }.
    // Existing records need no change: until their next edit, merge.js reads their own time.
    db.createObjectStore(TOMBSTONES, { keyPath: KEY_PATHS[TOMBSTONES] });
  },
  (db) => {
    // My meals: several foods saved as one item and logged together:
    // { id, name, items: [{ name, source, ref, amount, unit, base }], uses, lastUsed, createdAt }.
    db.createObjectStore("myMeals", { keyPath: KEY_PATHS.myMeals });
  },
  (db) => {
    // Day trackers. Days: one record per local day, { date, water (glasses),
    // exerciseKcal, steps, exerciseSource? }. Fasts: { id, start, end (ISO, null
    // while running), goalHours }. New stores only: no existing record changes.
    db.createObjectStore("days", { keyPath: KEY_PATHS.days });
    db.createObjectStore("fasts", { keyPath: KEY_PATHS.fasts });
  },
  (db) => {
    // The owner's own exercises, from an imported workout history: { id: "x-<slug>", name }.
    // Sets name them by id like library exercises. Version 9 also lets a set carry
    // rep notation (fractional reps, hard, extra, one side, drop, bodyweight):
    // added optional fields, so existing sessions need no change.
    db.createObjectStore("exercises", { keyPath: KEY_PATHS.exercises });
  },
  (db) => {
    // Body scans (InBody-style printouts): { id: "scan-<date>[T<time>]", date, time,
    // unit, weightKg, smmKg, fatKg, leanKg, pbf, vfa, bmr, ecwTbw, at }. Kept apart
    // from weighIns: a scan's weight is clothed. A new store only.
    db.createObjectStore("bodyScans", { keyPath: KEY_PATHS.bodyScans });
  },
];

let dbPromise;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis)) { reject(new Error("This browser has no IndexedDB.")); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      for (let v = e.oldVersion; v < DB_VERSION; v++) UPGRADES[v](db, req.transaction);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab opened a newer version: close so its upgrade can run.
      db.onversionchange = () => { db.close(); dbPromise = undefined; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("genki is open in another tab with an older version. Close it and reload."));
  });
  dbPromise.catch(() => { dbPromise = undefined; });
  return dbPromise;
}

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  // tx.error is still null when a request error bubbles here; onabort follows with it set.
  tx.onerror = (e) => reject(tx.error ?? e.target?.error ?? new Error("Transaction failed"));
  tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
});

const result = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export async function storeNames() {
  const db = await openDB();
  return [...db.objectStoreNames];
}

export async function get(store, key) {
  const db = await openDB();
  return result(db.transaction(store).objectStore(store).get(key));
}

export async function getAll(store) {
  const db = await openDB();
  return result(db.transaction(store).objectStore(store).getAll());
}

// Every record whose `index` equals `value`, e.g. getByIndex("entries", "date", "2026-01-02").
export async function getByIndex(store, index, value) {
  const db = await openDB();
  return result(db.transaction(store).objectStore(store).index(index).getAll(value));
}

// Every write stamps editedAt (ISO time) on the record: sync's merge keeps the newer edit.
const stamped = (record, at) => ({ ...record, editedAt: at });

export async function put(store, record) {
  const db = await openDB();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).put(stamped(record, new Date().toISOString()));
  return done(tx);
}

// Several puts in one transaction: all land or none do.
export async function putMany(store, records) {
  const db = await openDB();
  const tx = db.transaction(store, "readwrite");
  const os = tx.objectStore(store);
  const at = new Date().toISOString();
  for (const r of records) os.put(stamped(r, at));
  return done(tx);
}

// Delete records and leave a tombstone for each, so a sync removes them from
// genki-data (and other devices) instead of bringing them back.
export async function delMany(store, keys) {
  const db = await openDB();
  const tx = db.transaction([store, TOMBSTONES], "readwrite");
  const os = tx.objectStore(store), ts = tx.objectStore(TOMBSTONES);
  const at = new Date().toISOString();
  for (const key of keys) {
    os.delete(key);
    ts.put({ id: tombstoneId(store, key), store, key, at });
  }
  return done(tx);
}

export const del = (store, key) => delMany(store, [key]);

// Apply sync's merge result (merge.js diffStores) in one transaction, without
// stamping or tombstoning (the merged records and tombstones carry their own).
// A record that changed on this device since the dump the merge started from
// is left alone: the next sync carries that edit. Returns how many records
// (not counting tombstones) changed.
export async function applyChanges(changes) {
  if (!changes.length) return { applied: 0, skipped: 0 };
  const db = await openDB();
  const tx = db.transaction([...new Set(changes.map((c) => c.store))], "readwrite");
  const finished = done(tx);
  let applied = 0, skipped = 0;
  for (const c of changes) {
    const os = tx.objectStore(c.store);
    const req = os.get(c.key);
    req.onsuccess = () => {
      if (JSON.stringify(req.result ?? null) !== JSON.stringify(c.before ?? null)) { skipped++; return; }
      if (c.after) os.put(c.after); else os.delete(c.key);
      if (c.store !== TOMBSTONES) applied++;
    };
  }
  await finished;
  return { applied, skipped };
}

export async function getMeta(key, fallback) {
  const row = await get("meta", key);
  return row ? row.value : fallback;
}

export function setMeta(key, value) {
  return put("meta", { key, value });
}

// Every record in every store: { storeName: [records] }.
export async function dumpAll() {
  const db = await openDB();
  const names = [...db.objectStoreNames];
  const tx = db.transaction(names);
  const out = {};
  await Promise.all(names.map(async (n) => { out[n] = await result(tx.objectStore(n).getAll()); }));
  return out;
}

// Replace the contents of every store named in `stores` in one transaction:
// either the whole import lands or none of it does. Stores the backup does not
// mention are left as they are, except the tombstones: they are always reset to
// the file's own (withTombstones).
export async function replaceAll(fileStores) {
  const db = await openDB();
  const stores = withTombstones(fileStores);
  const names = Object.keys(stores);
  const tx = db.transaction(names, "readwrite");
  const finished = done(tx);
  try {
    for (const n of names) {
      const os = tx.objectStore(n);
      os.clear();
      for (const r of stores[n]) os.put(r);
    }
  } catch (e) {
    // put() throws synchronously on a record with no usable key, which would
    // not abort the transaction: it would commit the clear() and lose data.
    tx.abort();
    finished.catch(() => {});
    throw e;
  }
  return finished;
}

// ---------- device-only store ----------
// A second, separate database for things that belong to this device and must
// never travel: the sync token and sync state. It is not part of dumpAll() or
// replaceAll(), so it never lands in a backup, an export, a synced file, and a
// restore or import never overwrites it.

export const DEVICE_DB = "genki-device";
let devicePromise;

function openDevice() {
  if (devicePromise) return devicePromise;
  devicePromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis)) { reject(new Error("This browser has no IndexedDB.")); return; }
    const req = indexedDB.open(DEVICE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv", { keyPath: "key" });
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); devicePromise = undefined; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  devicePromise.catch(() => { devicePromise = undefined; });
  return devicePromise;
}

export async function getDevice(key, fallback) {
  const db = await openDevice();
  const row = await result(db.transaction("kv").objectStore("kv").get(key));
  return row ? row.value : fallback;
}

export async function setDevice(key, value) {
  const db = await openDevice();
  const tx = db.transaction("kv", "readwrite");
  tx.objectStore("kv").put({ key, value });
  return done(tx);
}

export async function delDevice(key) {
  const db = await openDevice();
  const tx = db.transaction("kv", "readwrite");
  tx.objectStore("kv").delete(key);
  return done(tx);
}
