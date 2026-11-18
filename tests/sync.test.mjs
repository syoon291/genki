// Sync against a mocked GitHub: no network, and only made-up tokens and data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { REPO, PATH, checkAccess, remoteSha, fetchRemote, pushFile, mergeSync, syncDue, looksLikeToken, toBase64, SyncError } from "../sync.js";

const TOKEN = "github_pat_FAKE0000000000000000000000";
const FILE = `https://api.github.com/repos/${REPO}/contents/${PATH}`;
const REPO_URL = `https://api.github.com/repos/${REPO}`;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// A tiny fake of the Contents API for one file, recording every call.
function fakeGitHub({ file = null, repo = { private: true, permissions: { push: true } }, status = {} } = {}) {
  const state = { file, calls: [], shaN: 0 };
  state.fetch = async (url, init = {}) => {
    const method = init.method || "GET";
    state.calls.push({ url, method, init });
    if (status[method]) { const s = status[method].shift(); if (s) return json(s, { message: `fake ${s}` }); }
    if (url === REPO_URL) return json(200, repo);
    assert.equal(url, FILE, "only app/latest.json may be touched");
    if (method === "GET") {
      if (!state.file) return json(404, { message: "Not Found" });
      if (init.headers.Accept === "application/vnd.github.raw+json") return new Response(state.file.text, { status: 200 });
      return json(200, { sha: state.file.sha, path: PATH });
    }
    if (method === "PUT") {
      const body = JSON.parse(init.body);
      if (state.file && body.sha !== state.file.sha) return json(body.sha ? 409 : 422, { message: "sha mismatch" });
      if (!state.file && body.sha) return json(409, { message: "no such file" });
      const text = new TextDecoder().decode(Uint8Array.from(atob(body.content), (c) => c.charCodeAt(0)));
      state.file = { sha: `sha${++state.shaN}`, text };
      return json(state.shaN === 1 && !file ? 201 : 200, { content: { sha: state.file.sha, path: PATH } });
    }
    throw new Error(`unexpected ${method}`);
  };
  return state;
}

test("every request carries the token only in the Authorization header, uncached", async () => {
  const gh = fakeGitHub({ file: { sha: "abc", text: "{}" } });
  await fetchRemote(TOKEN, gh.fetch);
  await pushFile(TOKEN, "{}", "abc", { fetchFn: gh.fetch });
  for (const c of gh.calls) {
    assert.equal(c.init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(c.init.cache, "no-store");
    assert.ok(!c.url.includes(TOKEN));
    assert.ok(!(c.init.body || "").includes(TOKEN));
  }
});

test("remoteSha is null when there is no file yet, the sha when there is", async () => {
  assert.equal(await remoteSha(TOKEN, fakeGitHub().fetch), null);
  assert.equal(await remoteSha(TOKEN, fakeGitHub({ file: { sha: "s1", text: "{}" } }).fetch), "s1");
});

test("fetchRemote reads the raw file with its sha", async () => {
  const gh = fakeGitHub({ file: { sha: "s1", text: '{"app":"genki"}' } });
  assert.deepEqual(await fetchRemote(TOKEN, gh.fetch), { sha: "s1", text: '{"app":"genki"}' });
  assert.equal(await fetchRemote(TOKEN, fakeGitHub().fetch), null);
});

test("pushFile creates the file, then updates it with the sha", async () => {
  const gh = fakeGitHub();
  const s1 = await pushFile(TOKEN, '{"n":1}', null, { fetchFn: gh.fetch, message: "genki sync test" });
  assert.equal(gh.file.text, '{"n":1}');
  const put = gh.calls.find((c) => c.method === "PUT");
  assert.equal(JSON.parse(put.init.body).message, "genki sync test");
  assert.equal(JSON.parse(put.init.body).sha, undefined);
  const s2 = await pushFile(TOKEN, '{"n":2}', s1, { fetchFn: gh.fetch });
  assert.notEqual(s2, s1);
  assert.equal(gh.file.text, '{"n":2}');
});

test("on a conflict pushFile refetches the sha and retries", async () => {
  const gh = fakeGitHub({ file: { sha: "newer", text: "{}" } });
  const sha = await pushFile(TOKEN, '{"mine":true}', "stale", { fetchFn: gh.fetch });
  assert.equal(gh.file.text, '{"mine":true}');
  assert.equal(gh.file.sha, sha);
  assert.deepEqual(gh.calls.map((c) => c.method), ["PUT", "GET", "PUT"]);
});

test("a missing sha on an existing file (422) is retried too", async () => {
  const gh = fakeGitHub({ file: { sha: "there", text: "{}" } });
  await pushFile(TOKEN, "{}", null, { fetchFn: gh.fetch });
  assert.deepEqual(gh.calls.map((c) => c.method), ["PUT", "GET", "PUT"]);
});

test("pushFile gives up after repeated conflicts", async () => {
  const gh = fakeGitHub({ file: { sha: "a", text: "{}" }, status: { PUT: [409, 409, 409] } });
  await assert.rejects(pushFile(TOKEN, "{}", "a", { fetchFn: gh.fetch }), SyncError);
  assert.equal(gh.calls.filter((c) => c.method === "PUT").length, 3);
});

test("errors become messages fit to show, without the token", async () => {
  for (const [s, re] of [[401, /did not accept the token/], [403, /Contents read and write/], [500, /could not/]]) {
    const gh = fakeGitHub({ status: { GET: [s] } });
    await assert.rejects(remoteSha(TOKEN, gh.fetch), (e) => re.test(e.message) && !e.message.includes(TOKEN));
  }
  const offline = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(remoteSha(TOKEN, offline), /Could not reach GitHub/);
});

test("a 404 on the file is an error when the repo itself is out of reach", async () => {
  const gh = fakeGitHub();
  const f = async (url, init) => (url === REPO_URL ? json(404, { message: "Not Found" }) : gh.fetch(url, init));
  await assert.rejects(remoteSha(TOKEN, f), /cannot see genki-data/);
});

test("checkAccess reports privacy and refuses a read-only token", async () => {
  assert.deepEqual(await checkAccess(TOKEN, fakeGitHub().fetch), { private: true });
  assert.deepEqual(await checkAccess(TOKEN, fakeGitHub({ repo: { private: false } }).fetch), { private: false });
  await assert.rejects(checkAccess(TOKEN, fakeGitHub({ repo: { private: true, permissions: { push: false } } }).fetch), /not write/);
});

test("nothing but app/latest.json and the repo is ever requested", async () => {
  const gh = fakeGitHub();
  await pushFile(TOKEN, "{}", null, { fetchFn: gh.fetch });
  await fetchRemote(TOKEN, gh.fetch);
  await checkAccess(TOKEN, gh.fetch);
  for (const c of gh.calls) assert.ok(c.url === FILE || c.url === REPO_URL, c.url);
  assert.ok(gh.calls.every((c) => !c.url.includes("history")));
});

test("toBase64 handles UTF-8 and large text", () => {
  assert.equal(toBase64("é"), "w6k=");
  const big = "あ".repeat(200_000);
  const back = new TextDecoder().decode(Uint8Array.from(atob(toBase64(big)), (c) => c.charCodeAt(0)));
  assert.equal(back, big);
});

test("syncDue: once per local day", () => {
  const now = new Date(2026, 0, 5, 9, 0);
  assert.equal(syncDue(null, now), true);
  assert.equal(syncDue("garbage", now), true);
  assert.equal(syncDue(new Date(2026, 0, 5, 7, 0).toISOString(), now), false);
  assert.equal(syncDue(new Date(2026, 0, 4, 23, 59).toISOString(), now), true);
  assert.equal(syncDue(new Date(2026, 0, 6, 1, 0).toISOString(), now), false);
});

test("looksLikeToken accepts fine-grained tokens only", () => {
  assert.equal(looksLikeToken(TOKEN), true);
  assert.equal(looksLikeToken("ghp_FAKE000000000000000000000000"), false);
  for (const s of ["", "password", "github_pat_short", "github_pat_ has spaces 00000000000"]) assert.equal(looksLikeToken(s), false);
});

// ---------- mergeSync ----------

test("mergeSync with no file yet builds from nothing and creates it", async () => {
  const gh = fakeGitHub();
  const seen = [];
  const out = await mergeSync(TOKEN, (remote) => { seen.push(remote); return "first"; }, { fetchFn: gh.fetch });
  assert.deepEqual(seen, [null]);
  assert.equal(out.sha, "sha1");
  assert.equal(gh.file.text, "first");
  assert.equal(JSON.parse(gh.calls.find((c) => c.method === "PUT").init.body).sha, undefined);
});

test("mergeSync builds from the current file and writes over exactly that version", async () => {
  const gh = fakeGitHub({ file: { sha: "v1", text: "remote-copy" } });
  const out = await mergeSync(TOKEN, (remote) => `${remote.text}+mine`, { fetchFn: gh.fetch, message: "genki sync test" });
  assert.equal(gh.file.text, "remote-copy+mine");
  assert.equal(out.remote.sha, "v1");
  const put = JSON.parse(gh.calls.find((c) => c.method === "PUT").init.body);
  assert.equal(put.sha, "v1");
  assert.equal(put.message, "genki sync test");
});

test("mergeSync never overwrites a write that landed in between: it merges again", async () => {
  const gh = fakeGitHub({ file: { sha: "v1", text: "A" } });
  let raced = false;
  const fetchFn = async (url, init = {}) => {
    // Another device writes just before this device's first PUT arrives.
    if (init.method === "PUT" && !raced) { raced = true; gh.file = { sha: "v2", text: "A+other" }; }
    return gh.fetch(url, init);
  };
  const built = [];
  const out = await mergeSync(TOKEN, (remote) => { built.push(remote.text); return `${remote.text}+mine`; }, { fetchFn });
  assert.deepEqual(built, ["A", "A+other"]);
  assert.equal(gh.file.text, "A+other+mine");
  assert.equal(out.remote.sha, "v2");
});

test("mergeSync writes nothing when building fails", async () => {
  const gh = fakeGitHub({ file: { sha: "v1", text: "unreadable" } });
  await assert.rejects(mergeSync(TOKEN, () => { throw new Error("cannot use it"); }, { fetchFn: gh.fetch }), /cannot use it/);
  assert.equal(gh.calls.filter((c) => c.method === "PUT").length, 0);
  assert.equal(gh.file.text, "unreadable");
});

test("mergeSync gives up after three conflicts with a message to show", async () => {
  const gh = fakeGitHub({ file: { sha: "v1", text: "A" }, status: { PUT: [409, 409, 409] } });
  await assert.rejects(mergeSync(TOKEN, (r) => r.text, { fetchFn: gh.fetch }), (e) => e instanceof SyncError && /conflict/.test(e.message));
  assert.equal(gh.file.text, "A");
});

test("two devices syncing in turn keep each other's records and deletes", async () => {
  const { mergeStores, tombstoneId } = await import("../merge.js");
  const { buildBackup, parseBackup } = await import("../backup.js");
  const { KEY_PATHS } = await import("../db.js");
  const names = Object.keys(KEY_PATHS);
  const gh = fakeGitHub();
  const at = (h) => `2026-03-01T0${h}:00:00.000Z`;
  const sync = async (local) => {
    let merged = local;
    await mergeSync(TOKEN, (remote) => {
      merged = remote ? mergeStores(local, parseBackup(remote.text, names, KEY_PATHS).backup.stores, KEY_PATHS) : local;
      return JSON.stringify(buildBackup(merged));
    }, { fetchFn: gh.fetch });
    return merged;
  };
  // Phone logs lunch and a weigh-in; tablet logs dinner.
  let phone = await sync({ entries: [{ id: "lunch", editedAt: at(1) }], weighIns: [{ date: "2026-03-01", kg: 70, at: at(1) }], deleted: [] });
  let tablet = await sync({ entries: [{ id: "dinner", editedAt: at(2) }], deleted: [] });
  assert.deepEqual(tablet.entries.map((e) => e.id).sort(), ["dinner", "lunch"]);
  // The phone deletes the weigh-in, then syncs: the tablet's next sync drops it too.
  phone = await sync({ ...phone, weighIns: [], deleted: [{ id: tombstoneId("weighIns", "2026-03-01"), store: "weighIns", key: "2026-03-01", at: at(3) }] });
  assert.deepEqual(phone.entries.map((e) => e.id).sort(), ["dinner", "lunch"]);
  tablet = await sync(tablet);
  assert.deepEqual(tablet.weighIns, []);
});
