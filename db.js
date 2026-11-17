// IndexedDB store: one database ("genki"), one object store per kind of data.
// Later phases add stores by bumping DB_VERSION (and SCHEMA in backup.js) and
// adding a step to UPGRADES; existing data is never dropped by an upgrade.

export const DB_NAME = "genki";
export const DB_VERSION = 4;

// The keyPath of each store, so a backup can be checked before it replaces anything.
export const KEY_PATHS = { meta: "key", entries: "id", myFoods: "id", weighIns: "date", workouts: "id" };

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
    // Finished workout sessions: { id, date (ISO time), day, sets: [{ exId, w (kg), reps, rir }], minutes }.
    db.createObjectStore("workouts", { keyPath: KEY_PATHS.workouts });
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

export async function put(store, record) {
  const db = await openDB();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).put(record);
  return done(tx);
}

// Several puts in one transaction: all land or none do.
export async function putMany(store, records) {
  const db = await openDB();
  const tx = db.transaction(store, "readwrite");
  const os = tx.objectStore(store);
  for (const r of records) os.put(r);
  return done(tx);
}

export async function del(store, key) {
  const db = await openDB();
  const tx = db.transaction(store, "readwrite");
  tx.objectStore(store).delete(key);
  return done(tx);
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
// mention are left as they are.
export async function replaceAll(stores) {
  const db = await openDB();
  const names = Object.keys(stores);
  if (!names.length) return;
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
