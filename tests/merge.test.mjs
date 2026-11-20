// Sync merge: made-up records only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeStores, diffStores, editedMs, tombstoneId, recordCount, withTombstones, TOMBSTONES } from "../merge.js";
import { KEY_PATHS, DB_VERSION } from "../db.js";
import { SCHEMA } from "../backup.js";

const T = (h) => `2026-03-01T${String(h).padStart(2, "0")}:00:00.000Z`;
const entry = (id, h, extra = {}) => ({ id, date: "2026-03-01", meal: "lunch", name: `Food ${id}`, amount: 1, createdAt: T(1), editedAt: T(h), ...extra });
const tomb = (store, key, h) => ({ id: tombstoneId(store, key), store, key, at: T(h) });
const ids = (recs) => recs.map((r) => r.id).sort();

test("db version and backup schema move together, and the tombstone store has a key path", () => {
  assert.equal(DB_VERSION, SCHEMA);
  assert.equal(KEY_PATHS[TOMBSTONES], "id");
});

test("records on one side only are kept from both sides", () => {
  const m = mergeStores({ entries: [entry("a", 2)] }, { entries: [entry("b", 3)], weighIns: [{ date: "2026-03-01", kg: 70, at: T(4) }] }, KEY_PATHS);
  assert.deepEqual(ids(m.entries), ["a", "b"]);
  assert.equal(m.weighIns.length, 1);
});

test("the same key on both sides: the newer edit wins, whichever side it is on", () => {
  const local = { entries: [entry("a", 5, { amount: 2 }), entry("b", 2, { amount: 2 })] };
  const remote = { entries: [entry("a", 4, { amount: 9 }), entry("b", 3, { amount: 9 })] };
  const m = mergeStores(local, remote, KEY_PATHS);
  assert.equal(m.entries.find((r) => r.id === "a").amount, 2);
  assert.equal(m.entries.find((r) => r.id === "b").amount, 9);
});

test("a tie keeps this device's copy", () => {
  const m = mergeStores({ meta: [{ key: "liftUnit", value: "kg" }] }, { meta: [{ key: "liftUnit", value: "lb" }] }, KEY_PATHS);
  assert.equal(m.meta[0].value, "kg");
});

test("records written before editedAt existed fall back to their own times", () => {
  assert.equal(editedMs({ date: "2026-03-01", kg: 70, at: T(3) }), Date.parse(T(3)));
  assert.equal(editedMs({ key: "profile", value: { heightCm: 170, updatedAt: T(6) } }), Date.parse(T(6)));
  assert.equal(editedMs({ id: "f", createdAt: T(1), lastUsed: T(7) }), Date.parse(T(7)));
  assert.equal(editedMs({ key: "liftUnit", value: "kg" }), 0);
  const m = mergeStores({ weighIns: [{ date: "2026-03-01", kg: 70, at: T(3) }] }, { weighIns: [{ date: "2026-03-01", kg: 71, at: T(2), editedAt: T(2) }] }, KEY_PATHS);
  assert.equal(m.weighIns[0].kg, 70);
});

test("the first-open date keeps the earliest, not the newest", () => {
  const m = mergeStores({ meta: [{ key: "createdAt", value: T(9), editedAt: T(9) }] }, { meta: [{ key: "createdAt", value: T(1), editedAt: T(1) }] }, KEY_PATHS);
  assert.equal(m.meta[0].value, T(1));
});

test("a delete on one device is not undone by the other", () => {
  // This device deleted "a"; genki-data still has it.
  const m1 = mergeStores({ entries: [], [TOMBSTONES]: [tomb("entries", "a", 5)] }, { entries: [entry("a", 2), entry("b", 2)] }, KEY_PATHS);
  assert.deepEqual(ids(m1.entries), ["b"]);
  assert.equal(m1[TOMBSTONES].length, 1);
  // genki-data carries a delete from elsewhere; this device still has the record.
  const m2 = mergeStores({ entries: [entry("a", 2)] }, { entries: [], [TOMBSTONES]: [tomb("entries", "a", 5)] }, KEY_PATHS);
  assert.deepEqual(m2.entries, []);
  assert.equal(m2[TOMBSTONES].length, 1);
});

test("a delete also removes a record with no time of its own", () => {
  const m = mergeStores({ meta: [{ key: "liftDraft", value: null }] }, { [TOMBSTONES]: [tomb("meta", "liftDraft", 1)] }, KEY_PATHS);
  assert.deepEqual(m.meta, []);
});

test("a record logged again after the delete survives it", () => {
  const m = mergeStores({ weighIns: [{ date: "2026-03-01", kg: 70, at: T(8), editedAt: T(8) }] }, { [TOMBSTONES]: [tomb("weighIns", "2026-03-01", 5)] }, KEY_PATHS);
  assert.equal(m.weighIns.length, 1);
});

test("tombstones merge by id, the later delete kept", () => {
  const m = mergeStores({ [TOMBSTONES]: [tomb("entries", "a", 2)] }, { [TOMBSTONES]: [tomb("entries", "a", 6), tomb("workouts", "w1", 1)] }, KEY_PATHS);
  assert.equal(m[TOMBSTONES].length, 2);
  assert.equal(m[TOMBSTONES].find((t) => t.key === "a").at, T(6));
});

test("numeric and string keys are told apart", () => {
  const m = mergeStores({ workouts: [{ id: 1, date: T(1) }] }, { workouts: [{ id: "1", date: T(1) }] }, KEY_PATHS);
  assert.equal(m.workouts.length, 2);
});

test("an older copy without the tombstone store still merges", () => {
  const m = mergeStores({ entries: [entry("a", 2)], [TOMBSTONES]: [] }, { entries: [entry("b", 2)] }, KEY_PATHS);
  assert.deepEqual(ids(m.entries), ["a", "b"]);
  assert.deepEqual(m[TOMBSTONES], []);
});

test("an unknown store is refused rather than merged blindly", () => {
  assert.throws(() => mergeStores({}, { mystery: [{ id: "x" }] }, KEY_PATHS), /mystery/);
});

test("diffStores lists only what applying the merge changes here", () => {
  const local = { entries: [entry("a", 2), entry("b", 2), entry("c", 2)], [TOMBSTONES]: [] };
  const remote = { entries: [entry("a", 2), entry("b", 4, { amount: 3 }), entry("d", 1)], [TOMBSTONES]: [tomb("entries", "c", 3)] };
  const merged = mergeStores(local, remote, KEY_PATHS);
  const ch = diffStores(local, merged, KEY_PATHS);
  const brief = ch.map((c) => `${c.store}:${c.key}:${c.before ? "had" : "new"}->${c.after ? "has" : "gone"}`).sort();
  assert.deepEqual(brief, [
    "deleted:entries:\"c\":new->has",
    "entries:b:had->has",
    "entries:c:had->gone",
    "entries:d:new->has",
  ]);
  assert.equal(ch.find((c) => c.key === "b").after.amount, 3);
  assert.deepEqual(diffStores(merged, merged, KEY_PATHS), []);
});

test("recordCount leaves tombstones out", () => {
  assert.equal(recordCount({ entries: [entry("a", 1)], meta: [{ key: "x" }], [TOMBSTONES]: [tomb("entries", "b", 1)] }), 2);
});

test("editedAt alone decides when present, even if a content time is later", () => {
  assert.equal(editedMs({ date: "2026-03-01", kg: 70, at: T(9), editedAt: T(4) }), Date.parse(T(4)));
  // The device edit at 05:00 beats genki-data's copy edited at 04:00, whose `at` reads 09:00.
  const local = { weighIns: [{ date: "2026-03-01", kg: 71, at: T(2), editedAt: T(5) }] };
  const remote = { weighIns: [{ date: "2026-03-01", kg: 70, at: T(9), editedAt: T(4) }] };
  assert.equal(mergeStores(local, remote, KEY_PATHS).weighIns[0].kg, 71);
});

test("a restore or import resets tombstones to the file's own", () => {
  const file = { entries: [entry("a", 2)] };
  assert.deepEqual(withTombstones(file), { entries: file.entries, [TOMBSTONES]: [] });
  const t = [tomb("entries", "b", 3)];
  assert.deepEqual(withTombstones({ ...file, [TOMBSTONES]: t })[TOMBSTONES], t);
});

// Two devices scanned the same (made-up) package before syncing.
const food = (id, created, edited, extra = {}) => ({ id, name: `Bar ${id}`, kcal: 200, protein: 10, serving: "1 bar", barcode: "4900000000017", uses: 1, lastUsed: T(edited), createdAt: T(created), editedAt: T(edited), ...extra });

test("two my foods with the same barcode merge into one, the same one on either device", () => {
  const a = food("a", 2, 3, { uses: 4 });
  const b = food("b", 1, 5, { kcal: 210, uses: 2 });
  for (const [local, remote] of [[{ myFoods: [a] }, { myFoods: [b] }], [{ myFoods: [b] }, { myFoods: [a] }]]) {
    const m = mergeStores(local, remote, KEY_PATHS);
    assert.equal(m.myFoods.length, 1);
    const kept = m.myFoods[0];
    assert.equal(kept.id, "b"); // made first
    assert.equal(kept.kcal, 210); // the newest edit's numbers
    assert.equal(kept.uses, 4);
    assert.equal(kept.lastUsed, T(5));
    assert.equal(kept.createdAt, T(1));
    const t = m[TOMBSTONES].find((x) => x.id === tombstoneId("myFoods", "a"));
    assert.equal(t.mergedInto, "b");
    assert.equal(t.at, T(5));
  }
});

test("foods without a barcode, or with different ones, stay apart", () => {
  const m = mergeStores({ myFoods: [food("a", 1, 2, { barcode: "" }), food("c", 1, 2, { barcode: "4900000000024" })] }, { myFoods: [food("b", 1, 2, { barcode: undefined }), food("d", 1, 2)] }, KEY_PATHS);
  assert.deepEqual(ids(m.myFoods), ["a", "b", "c", "d"]);
  assert.equal(m[TOMBSTONES], undefined);
});

test("entries and my meals that used the merged copy point at the kept food", () => {
  const local = {
    myFoods: [food("a", 2, 3)],
    entries: [entry("e1", 3, { source: "my", ref: "a" }), entry("e2", 3, { source: "jp", ref: "a" })],
    myMeals: [{ id: "m1", name: "Snack", items: [{ name: "Bar a", source: "my", ref: "a", amount: 1, unit: "1 bar", base: { kcal: 200 } }], createdAt: T(3), editedAt: T(3) }],
  };
  const m = mergeStores(local, { myFoods: [food("b", 1, 4)] }, KEY_PATHS);
  assert.equal(m.entries.find((e) => e.id === "e1").ref, "b");
  assert.equal(m.entries.find((e) => e.id === "e2").ref, "a"); // a table food, not a my food
  assert.equal(m.myMeals[0].items[0].ref, "b");
});

test("a device that still has the merged copy drops it and re-points its entries on its next sync", () => {
  const first = mergeStores({ myFoods: [food("a", 2, 3)] }, { myFoods: [food("b", 1, 4)] }, KEY_PATHS);
  const other = { myFoods: [food("a", 2, 3)], entries: [entry("e1", 3, { source: "my", ref: "a" })] };
  const m = mergeStores(other, first, KEY_PATHS);
  assert.deepEqual(ids(m.myFoods), ["b"]);
  assert.equal(m.myFoods[0].uses, 1); // not counted twice
  assert.equal(m.entries[0].ref, "b");
  // Merging again changes nothing.
  assert.deepEqual(diffStores(m, mergeStores(m, first, KEY_PATHS), KEY_PATHS), []);
});

test("a merged copy edited afterwards with a new barcode is its own food again and keeps its entries", () => {
  const first = mergeStores({ myFoods: [food("a", 2, 3)] }, { myFoods: [food("b", 1, 4)] }, KEY_PATHS);
  const revived = {
    myFoods: [food("a", 2, 6, { barcode: "4900000000024" })],
    entries: [entry("e1", 7, { source: "my", ref: "a" })],
  };
  for (const [local, remote] of [[revived, first], [first, revived]]) {
    const m = mergeStores(local, remote, KEY_PATHS);
    assert.deepEqual(ids(m.myFoods), ["a", "b"]);
    assert.equal(m.myFoods.find((f) => f.id === "a").barcode, "4900000000024");
    assert.equal(m.entries.find((e) => e.id === "e1").ref, "a");
    // Merging again changes nothing.
    assert.deepEqual(diffStores(m, mergeStores(m, first, KEY_PATHS), KEY_PATHS), []);
  }
});

test("a merged copy that comes back with the same barcode is merged again and its entries re-pointed", () => {
  const first = mergeStores({ myFoods: [food("a", 2, 3)] }, { myFoods: [food("b", 1, 4)] }, KEY_PATHS);
  const revived = { myFoods: [food("a", 2, 6)], entries: [entry("e1", 7, { source: "my", ref: "a" })] };
  for (const [local, remote] of [[revived, first], [first, revived]]) {
    const m = mergeStores(local, remote, KEY_PATHS);
    assert.deepEqual(ids(m.myFoods), ["b"]);
    assert.equal(m.entries.find((e) => e.id === "e1").ref, "b");
  }
});
