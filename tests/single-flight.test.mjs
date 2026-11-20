import { test } from "node:test";
import assert from "node:assert/strict";
import { singleFlight } from "../ui.js";

test("a second call while the first is pending is dropped", async () => {
  const busy = new Set();
  let writes = 0, release;
  const write = () => new Promise((r) => { release = r; }).then(() => { writes++; });
  const first = singleFlight(busy, "add", write);
  assert.equal(singleFlight(busy, "add", write), null);
  release();
  await first;
  assert.equal(writes, 1);
});

test("the key frees once the write settles, even when it fails", async () => {
  const busy = new Set();
  await assert.rejects(singleFlight(busy, "add", async () => { throw new Error("db"); }));
  let ran = false;
  await singleFlight(busy, "add", () => { ran = true; });
  assert.ok(ran);
});

test("a synchronous throw frees the key", () => {
  const busy = new Set();
  assert.throws(() => singleFlight(busy, "k", () => { throw new Error("x"); }));
  assert.equal(busy.has("k"), false);
});

test("different keys do not block each other", async () => {
  const busy = new Set();
  const a = singleFlight(busy, "a", () => new Promise((r) => setTimeout(r, 5)));
  assert.notEqual(singleFlight(busy, "b", () => {}), null);
  await a;
});
