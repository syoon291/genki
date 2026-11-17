import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBackup, backupFileName, parseBackup, countRecords, APP_ID, SCHEMA } from "../backup.js";

const STORES = ["meta"];
const now = new Date("2026-01-02T03:04:05.000Z");
const sample = { meta: [{ key: "createdAt", value: "2026-01-01T00:00:00.000Z" }, { key: "units", value: "metric" }] };

test("buildBackup wraps a dump with app id, schema and time", () => {
  const b = buildBackup(sample, now);
  assert.equal(b.app, APP_ID);
  assert.equal(b.schema, SCHEMA);
  assert.equal(b.exportedAt, "2026-01-02T03:04:05.000Z");
  assert.deepEqual(b.stores, sample);
});

test("backupFileName is dated", () => {
  assert.equal(backupFileName(now), "genki-backup-2026-01-02.json");
});

test("an exported backup parses back to the same data", () => {
  const r = parseBackup(JSON.stringify(buildBackup(sample, now)), STORES);
  assert.equal(r.ok, true);
  assert.deepEqual(r.backup.stores, sample);
});

test("an empty store list is a valid backup", () => {
  const r = parseBackup(JSON.stringify(buildBackup({ meta: [] }, now)), STORES);
  assert.equal(r.ok, true);
});

const bad = (obj) => parseBackup(typeof obj === "string" ? obj : JSON.stringify(obj), STORES);

test("rejects text that is not JSON", () => {
  assert.match(bad("{nope").error, /not valid JSON/);
});

test("rejects JSON that is not a genki backup", () => {
  for (const v of [null, [], 3, "x", { app: "other", schema: 1, stores: {} }, { schema: 1, stores: {} }]) {
    assert.equal(bad(v).ok, false, JSON.stringify(v));
  }
});

test("rejects a missing or bad schema version", () => {
  assert.match(bad({ app: APP_ID, stores: {} }).error, /schema/);
  assert.match(bad({ app: APP_ID, schema: 0, stores: {} }).error, /schema/);
  assert.match(bad({ app: APP_ID, schema: "1", stores: {} }).error, /schema/);
});

test("rejects a backup from a newer app version", () => {
  assert.match(bad({ app: APP_ID, schema: SCHEMA + 1, stores: {} }).error, /newer version/);
});

test("rejects missing or malformed stores", () => {
  assert.equal(bad({ app: APP_ID, schema: 1 }).ok, false);
  assert.equal(bad({ app: APP_ID, schema: 1, stores: [] }).ok, false);
  assert.match(bad({ app: APP_ID, schema: 1, stores: { mystery: [] } }).error, /unknown section "mystery"/);
  assert.match(bad({ app: APP_ID, schema: 1, stores: { meta: {} } }).error, /not a list/);
  assert.match(bad({ app: APP_ID, schema: 1, stores: { meta: [1] } }).error, /bad record/);
  assert.match(bad({ app: APP_ID, schema: 1, stores: { meta: [null] } }).error, /bad record/);
});

test("rejects records without a valid key before anything is replaced", () => {
  const keyed = (records) => parseBackup(JSON.stringify({ app: APP_ID, schema: 1, stores: { meta: records } }), ["meta"], { meta: "key" });
  for (const r of [{}, { key: null }, { key: {} }, { key: "" }, { key: true }]) assert.match(keyed([r]).error, /without a valid "key"/);
  assert.equal(keyed([{ key: "createdAt", value: "x" }, { key: 7 }]).ok, true);
});

test("countRecords counts per store", () => {
  assert.deepEqual(countRecords({ meta: [{}, {}], foods: [] }), { meta: 2, foods: 0 });
});
