// Backup format: build an export file from a store dump, and parse/validate
// one before it replaces anything. Pure functions (no DOM, no IndexedDB) so
// they run under `node --test` as well as in the browser.

export const APP_ID = "genki";
// Bump with DB_VERSION in db.js whenever the stores change shape.
export const SCHEMA = 10;

// dump: { storeName: [records...] }
export function buildBackup(dump, now = new Date()) {
  return {
    app: APP_ID,
    schema: SCHEMA,
    exportedAt: now.toISOString(),
    stores: dump,
  };
}

export function backupFileName(now = new Date()) {
  const d = now.toISOString().slice(0, 10);
  return `genki-backup-${d}.json`;
}

// Returns { ok: true, backup } or { ok: false, error } with a message fit to show.
// knownStores: the store names this version of the app has.
// keyPaths: { storeName: keyPath } for stores with an inline key; every record must carry it.
export function parseBackup(text, knownStores, keyPaths = {}) {
  let data;
  try { data = JSON.parse(text); }
  catch { return { ok: false, error: "That file is not valid JSON." }; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, error: "That file is not a genki backup." };
  if (data.app !== APP_ID) return { ok: false, error: "That file is not a genki backup." };
  if (!Number.isInteger(data.schema) || data.schema < 1) return { ok: false, error: "The backup has no valid schema version." };
  if (data.schema > SCHEMA) return { ok: false, error: "The backup comes from a newer version of genki. Update the app first." };
  const stores = data.stores;
  if (!stores || typeof stores !== "object" || Array.isArray(stores)) return { ok: false, error: "The backup has no data." };
  const known = new Set(knownStores);
  for (const [name, records] of Object.entries(stores)) {
    if (!known.has(name)) return { ok: false, error: `The backup has an unknown section "${name}".` };
    if (!Array.isArray(records)) return { ok: false, error: `The "${name}" section is not a list.` };
    if (records.some((r) => !r || typeof r !== "object" || Array.isArray(r))) return { ok: false, error: `The "${name}" section has a bad record.` };
    const kp = keyPaths[name];
    if (kp && records.some((r) => !validKey(r[kp]))) return { ok: false, error: `The "${name}" section has a record without a valid "${kp}".` };
  }
  return { ok: true, backup: data };
}

// A key IndexedDB accepts, limited to what JSON can carry: a non-empty string or a finite number.
function validKey(k) {
  return (typeof k === "string" && k !== "") || (typeof k === "number" && Number.isFinite(k));
}

// Record counts per store, for the confirm prompt and the data panel.
export function countRecords(stores) {
  return Object.fromEntries(Object.entries(stores).map(([k, v]) => [k, v.length]));
}
