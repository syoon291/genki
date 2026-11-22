// Accounts: sign-in calls, the rows <-> stores mapping and the sync, against
// a mocked backend. Made-up project, keys, emails and records only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sendCode, verifyCode, refreshSession, needsRefresh, deleteAccount, storesToRows, rowsToStores, rowsToPush, stableJson, cloudSync, pullRows, pushRows, sessionFromLink, AccountError } from "../account.js";
import { tombstoneId } from "../merge.js";
import { accountConfigProblem } from "../scripts/account-rules.mjs";

const CFG = { url: "https://abcdefghijklmnopqrst.supabase.co", key: "sb_publishable_testkey1234567890" };
const KP = { meta: "key", entries: "id", weighIns: "date", deleted: "id" };
const SESSION = { accessToken: "access-1", refreshToken: "refresh-1", expiresAt: Date.now() + 3600e3, user: { id: "u-1", email: "friend@example.com" } };

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (body === undefined ? "" : JSON.stringify(body)), json: async () => body });

// A fake backend: rows in memory, push keeps the newer edit as the real one does.
function backend(initial = []) {
  const rows = new Map(initial.map((r) => [`${r.store}|${r.key}`, { ...r }]));
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    const u = new URL(url);
    if (u.pathname === "/rest/v1/records") {
      const all = [...rows.values()].sort((a, b) => (a.store + a.key < b.store + b.key ? -1 : 1));
      const limit = Number(u.searchParams.get("limit")), offset = Number(u.searchParams.get("offset"));
      // jsonb reorders object keys: hand back data with sorted keys.
      return json(200, all.slice(offset, offset + limit).map((r) => ({ ...r, data: r.data && JSON.parse(stableJson(r.data)) })));
    }
    if (u.pathname === "/rest/v1/rpc/push") {
      let n = 0;
      for (const r of JSON.parse(init.body).rows) {
        const had = rows.get(`${r.store}|${r.key}`);
        if (had && Date.parse(r.edited_at) < Date.parse(had.edited_at)) continue;
        rows.set(`${r.store}|${r.key}`, { ...r });
        n++;
      }
      return json(200, n);
    }
    return json(404, { message: "not found" });
  };
  return { rows, calls, fetchFn };
}

test("every call goes to the configured project, with the key and token in headers only", async () => {
  const be = backend();
  await pullRows(CFG, SESSION, be.fetchFn);
  const { url, init } = be.calls[0];
  assert.ok(url.startsWith(`${CFG.url}/rest/v1/records?`));
  assert.ok(!url.includes(SESSION.accessToken) && !url.includes(CFG.key));
  assert.equal(init.headers.apikey, CFG.key);
  assert.equal(init.headers.Authorization, "Bearer access-1");
  assert.equal(init.headers["Accept-Profile"], "genki");
  assert.equal(init.cache, "no-store");
  assert.equal(init.credentials, "omit");
});

test("nothing is called when accounts are not set up", async () => {
  let called = false;
  await assert.rejects(sendCode({ url: "", key: "" }, "friend@example.com", async () => { called = true; }), AccountError);
  assert.equal(called, false);
});

test("sendCode never creates an account", async () => {
  let body;
  await sendCode(CFG, "friend@example.com", async (url, init) => { body = JSON.parse(init.body); return json(200, {}); });
  assert.deepEqual(body, { email: "friend@example.com", create_user: false });
});

test("an email that was not invited gets a plain answer", async () => {
  await assert.rejects(sendCode(CFG, "stranger@example.com", async () => json(422, { error_code: "otp_disabled", msg: "Signups not allowed for otp" })), /not been invited/);
});

test("verifyCode turns the answer into a session", async () => {
  const s = await verifyCode(CFG, "friend@example.com", "123456", async (url, init) => {
    assert.ok(url.endsWith("/auth/v1/verify"));
    assert.deepEqual(JSON.parse(init.body), { type: "email", email: "friend@example.com", token: "123456" });
    return json(200, { access_token: "a", refresh_token: "r", expires_in: 3600, user: { id: "u-1", email: "friend@example.com" } });
  }, 1000);
  assert.deepEqual(s, { accessToken: "a", refreshToken: "r", expiresAt: 1000 + 3600e3, user: { id: "u-1", email: "friend@example.com" } });
});

test("a wrong code says so", async () => {
  await assert.rejects(verifyCode(CFG, "friend@example.com", "000000", async () => json(403, { error_code: "otp_expired", msg: "Token has expired or is invalid" })), /wrong or has expired/);
});

test("refresh posts the refresh token in the body, never the URL", async () => {
  await refreshSession(CFG, SESSION, async (url, init) => {
    assert.equal(url, `${CFG.url}/auth/v1/token?grant_type=refresh_token`);
    assert.deepEqual(JSON.parse(init.body), { refresh_token: "refresh-1" });
    return json(200, { access_token: "a2", refresh_token: "r2", expires_at: 2000, user: { id: "u-1" } });
  });
  assert.equal(needsRefresh({ expiresAt: 100_000 }, 30_000), false);
  assert.equal(needsRefresh({ expiresAt: 100_000 }, 50_000), true);
});

test("the email link's tokens become a session after asking who signed in", async () => {
  const params = new URLSearchParams("access_token=a&refresh_token=r&expires_at=5000&type=magiclink");
  const s = await sessionFromLink(CFG, params, async (url, init) => {
    assert.equal(url, `${CFG.url}/auth/v1/user`);
    assert.equal(init.headers.Authorization, "Bearer a");
    return json(200, { id: "u-1", email: "friend@example.com" });
  });
  assert.equal(s.expiresAt, 5000e3);
  assert.equal(s.user.id, "u-1");
});

test("delete my account calls the backend's delete function", async () => {
  let seen;
  await deleteAccount(CFG, SESSION, async (url, init) => { seen = { url, init }; return json(204); });
  assert.equal(seen.url, `${CFG.url}/rest/v1/rpc/delete_my_account`);
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers["Content-Profile"], "public");
});

test("records and tombstones map to rows and back", () => {
  const stores = {
    entries: [{ id: "e1", kcal: 100, editedAt: "2026-01-02T00:00:00.000Z" }, { id: "e3", kcal: 5, editedAt: "2026-01-05T00:00:00.000Z" }],
    weighIns: [{ date: "2026-01-01", kg: 70, at: "2026-01-01T07:00:00.000Z" }],
    deleted: [
      { id: tombstoneId("entries", "e2"), store: "entries", key: "e2", at: "2026-01-03T00:00:00.000Z" },
      // e3 was logged again after this delete: the live record is the row.
      { id: tombstoneId("entries", "e3"), store: "entries", key: "e3", at: "2026-01-04T00:00:00.000Z" },
    ],
  };
  const rows = storesToRows(stores, KP);
  assert.equal(rows.size, 4);
  const e2 = [...rows.values()].find((r) => r.key === '"e2"');
  assert.deepEqual({ deleted: e2.deleted, edited_at: e2.edited_at }, { deleted: true, edited_at: "2026-01-03T00:00:00.000Z" });
  assert.equal([...rows.values()].find((r) => r.key === '"e3"').deleted, false);
  assert.equal([...rows.values()].find((r) => r.store === "weighIns").edited_at, "2026-01-01T07:00:00.000Z");

  const back = rowsToStores([...rows.values()], KP);
  assert.deepEqual(back.entries.map((e) => e.id).sort(), ["e1", "e3"]);
  assert.deepEqual(back.deleted.map((t) => t.key), ["e2"]);
  // A tombstone row with no data (written by another tool) still becomes a tombstone.
  const bare = rowsToStores([{ store: "entries", key: '"e9"', data: null, edited_at: "2026-01-09T00:00:00Z", deleted: true }], KP);
  assert.deepEqual(bare.deleted, [{ id: tombstoneId("entries", "e9"), store: "entries", key: "e9", at: "2026-01-09T00:00:00Z" }]);
  // A store this genki does not know is left out.
  assert.deepEqual(rowsToStores([{ store: "future", key: '"x"', data: { id: "x" }, edited_at: "2026-01-01T00:00:00Z", deleted: false }], KP).future, undefined);
});

test("a record the database reordered is not uploaded again", () => {
  const merged = storesToRows({ entries: [{ id: "e1", kcal: 1, editedAt: "2026-01-02T00:00:00.000Z" }] }, KP);
  const row = [...merged.values()][0];
  const remote = new Map([[[...merged.keys()][0], { ...row, edited_at: "2026-01-02T00:00:00+00:00", data: { kcal: 1, editedAt: "2026-01-02T00:00:00.000Z", id: "e1" } }]]);
  assert.equal(rowsToPush(merged, remote).length, 0);
});

test("first sync of a phone uploads everything; a second sync uploads nothing", async () => {
  const be = backend();
  const local = { meta: [{ key: "createdAt", value: "2026-01-01T00:00:00.000Z" }], entries: [{ id: "e1", kcal: 100, editedAt: "2026-01-02T00:00:00.000Z" }], weighIns: [], deleted: [] };
  const first = await cloudSync(CFG, SESSION, local, KP, be.fetchFn);
  assert.equal(first.pushed, 2);
  assert.equal(be.rows.size, 2);
  const again = await cloudSync(CFG, SESSION, first.merged, KP, be.fetchFn);
  assert.equal(again.pushed, 0);
});

test("sync merges both ways: the newer edit wins and deletes carry over", async () => {
  const be = backend([
    { store: "entries", key: '"e1"', data: { id: "e1", kcal: 200, editedAt: "2026-01-05T00:00:00.000Z" }, edited_at: "2026-01-05T00:00:00.000Z", deleted: false },
    { store: "entries", key: '"e2"', data: { id: tombstoneId("entries", "e2"), store: "entries", key: "e2", at: "2026-01-05T00:00:00.000Z" }, edited_at: "2026-01-05T00:00:00.000Z", deleted: true },
    { store: "weighIns", key: '"2026-01-04"', data: { date: "2026-01-04", kg: 69, editedAt: "2026-01-04T00:00:00.000Z" }, edited_at: "2026-01-04T00:00:00.000Z", deleted: false },
  ]);
  const local = {
    entries: [
      { id: "e1", kcal: 100, editedAt: "2026-01-02T00:00:00.000Z" }, // older than the account's
      { id: "e2", kcal: 50, editedAt: "2026-01-02T00:00:00.000Z" },  // deleted elsewhere later
      { id: "e3", kcal: 30, editedAt: "2026-01-06T00:00:00.000Z" },  // only here
    ],
    weighIns: [], deleted: [], meta: [],
  };
  const { merged, pushed } = await cloudSync(CFG, SESSION, local, KP, be.fetchFn);
  assert.deepEqual(merged.entries.map((e) => [e.id, e.kcal]).sort(), [["e1", 200], ["e3", 30]]);
  assert.deepEqual(merged.weighIns.map((w) => w.date), ["2026-01-04"]);
  assert.equal(pushed, 1, "only e3 goes up");
  assert.equal(be.rows.get('entries|"e1"').data.kcal, 200);
  assert.equal(be.rows.get('entries|"e2"').deleted, true);
});

test("pull pages through more than 1000 rows; push goes in batches of 500", async () => {
  const many = Array.from({ length: 1203 }, (_, i) => ({ store: "entries", key: JSON.stringify(`e${String(i).padStart(4, "0")}`), data: { id: `e${String(i).padStart(4, "0")}`, editedAt: "2026-01-01T00:00:00.000Z" }, edited_at: "2026-01-01T00:00:00.000Z", deleted: false }));
  const be = backend(many);
  assert.equal((await pullRows(CFG, SESSION, be.fetchFn)).length, 1203);
  assert.equal(be.calls.length, 2);
  const be2 = backend();
  assert.equal(await pushRows(CFG, SESSION, many, be2.fetchFn), 1203);
  assert.equal(be2.calls.length, 3);
});

test("a failed pull uploads nothing", async () => {
  let pushed = false;
  await assert.rejects(cloudSync(CFG, SESSION, { entries: [{ id: "e1", editedAt: "2026-01-01T00:00:00Z" }] }, KP, async (url) => {
    if (url.includes("/rpc/push")) pushed = true;
    return json(500, { message: "down" });
  }), /server had a problem/);
  assert.equal(pushed, false);
});

test("the account config takes only a project address and its publishable key", () => {
  assert.equal(accountConfigProblem("", ""), "");
  assert.equal(accountConfigProblem(CFG.url, CFG.key), "");
  assert.match(accountConfigProblem(CFG.url, "sb_secret_abcdefghijklmnop"), /secret/);
  assert.match(accountConfigProblem(CFG.url, "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.x"), /secret or legacy/);
  assert.match(accountConfigProblem("https://evil.example.com", CFG.key), /supabase\.co/);
  assert.match(accountConfigProblem(CFG.url, ""), /both/);
});
