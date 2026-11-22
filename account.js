// Accounts: sign in by email code and sync to the backend database (Supabase:
// its sign-in service and its database API, both over plain fetch). Pure
// functions with fetch passed in, so they run under `node --test` with a
// mocked fetch as well as in the browser.
//
// - Sign-in is invite-only and has no passwords: the person asks for a code,
//   gets it by email and types it in (a link in the email would open Safari,
//   not the home-screen app). The backend never creates an account here.
// - The database keeps one row per record of one store (backend repo:
//   genki.records), and shows each person only their own rows. A sync pulls
//   every row, merges them with this device's stores (merge.js, the same merge
//   as the GitHub sync) and uploads only the rows the merge changed, through
//   genki.push, which keeps the newer edit when another device saved meanwhile.
// - Tokens are passed in by the caller and only ever go into headers: never a
//   URL, a message or a log.
import { mergeStores, editedMs, tombstoneId, TOMBSTONES } from "./merge.js";

const TIMEOUT_MS = 30000;
const PAGE = 1000;      // the backend's max rows per answer
const PUSH_BATCH = 500; // genki.push takes at most 1000 rows a call
const SCHEMA = "genki";

export class AccountError extends Error {
  constructor(message, status = 0, code = "") {
    super(message);
    this.name = "AccountError";
    this.status = status;
    this.code = code;
  }
}

// cfg: { url: the project address, key: its publishable key } (account-config.js)
export const configured = (cfg) => !!(cfg && cfg.url && cfg.key);

// The only paths this module may call, on the configured project only.
const PATHS = new Set(["/auth/v1/otp", "/auth/v1/verify", "/auth/v1/token", "/auth/v1/user", "/auth/v1/logout", "/rest/v1/records", "/rest/v1/rpc/push", "/rest/v1/rpc/delete_my_account"]);

async function call(cfg, fetchFn, path, { method = "GET", token, profile, body, query = "" } = {}) {
  if (!configured(cfg)) throw new AccountError("Accounts are not set up in this genki.");
  if (!PATHS.has(path)) throw new AccountError("Refusing to call that address.");
  const url = `${cfg.url}${path}${query}`;
  // Hard guard: nothing leaves for any host but the configured project.
  if (new URL(url).origin !== new URL(cfg.url).origin) throw new AccountError("Refusing to call that address.");
  const headers = { apikey: cfg.key, Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (profile && method === "GET") headers["Accept-Profile"] = profile;
  if (profile && method !== "GET") headers["Content-Profile"] = profile;
  const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
  let res;
  try { res = await fetchFn(url, { method, headers, cache: "no-store", credentials: "omit", signal, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new AccountError("Could not reach the genki server. Check the connection and try again."); }
  if (res.ok) {
    if (res.status === 204) return null;
    const text = await res.text();
    try { return text ? JSON.parse(text) : null; }
    catch { throw new AccountError("The genki server sent an answer genki cannot read."); }
  }
  let detail = {};
  try { detail = (await res.json()) || {}; } catch {}
  const code = String(detail.error_code || detail.code || detail.error || "");
  const msg = String(detail.msg || detail.message || detail.error_description || "");
  throw new AccountError(explain(res.status, code, msg), res.status, code);
}

function explain(status, code, msg) {
  if (code === "otp_disabled" || code === "signup_disabled" || /signups not allowed/i.test(msg)) return "That email has not been invited. Ask the owner for an invite.";
  if (code === "otp_expired" || /expired|invalid/i.test(msg) && status < 500 && /token|otp|code/i.test(msg)) return "That code is wrong or has expired. Ask for a new one.";
  if (status === 429 || code === "over_email_send_rate_limit" || code === "over_request_rate_limit") return "Too many tries. Wait a minute and try again.";
  if (status === 401 || code === "refresh_token_not_found" || code === "session_not_found" || code === "bad_jwt") return "You are signed out. Sign in again.";
  if (status >= 500) return `The genki server had a problem (${status}). Try again later.`;
  return `The genki server refused that (${status}${msg ? `: ${msg}` : ""}).`;
}

export const looksLikeEmail = (s) => typeof s === "string" && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
export const looksLikeCode = (s) => /^\d{6}$/.test(s);

// Email a sign-in code. create_user: false, so this never makes an account:
// only invited people get a code.
export async function sendCode(cfg, email, fetchFn = fetch) {
  await call(cfg, fetchFn, "/auth/v1/otp", { method: "POST", body: { email, create_user: false } });
}

// What genki keeps of a sign-in: the tokens, when the access token expires,
// and the person's id and email (shown in the Account section).
function toSession(out, now) {
  if (!out || typeof out.access_token !== "string" || typeof out.refresh_token !== "string" || !out.user?.id) throw new AccountError("The genki server sent an unexpected sign-in answer.");
  const expiresAt = Number.isFinite(out.expires_at) ? out.expires_at * 1000 : now + (Number(out.expires_in) || 3600) * 1000;
  return { accessToken: out.access_token, refreshToken: out.refresh_token, expiresAt, user: { id: String(out.user.id), email: String(out.user.email || "") } };
}

export async function verifyCode(cfg, email, code, fetchFn = fetch, now = Date.now()) {
  return toSession(await call(cfg, fetchFn, "/auth/v1/verify", { method: "POST", body: { type: "email", email, token: code } }), now);
}

export async function refreshSession(cfg, session, fetchFn = fetch, now = Date.now()) {
  return toSession(await call(cfg, fetchFn, "/auth/v1/token", { method: "POST", query: "?grant_type=refresh_token", body: { refresh_token: session.refreshToken } }), now);
}

// A session from the email link's landing (the tokens arrive in the URL hash).
export async function sessionFromLink(cfg, params, fetchFn = fetch, now = Date.now()) {
  const access = params.get("access_token"), refresh = params.get("refresh_token");
  if (!access || !refresh) throw new AccountError("That sign-in link is incomplete. Ask for a new code.");
  const user = await call(cfg, fetchFn, "/auth/v1/user", { token: access });
  const expiresAt = Number(params.get("expires_at"));
  return toSession({ access_token: access, refresh_token: refresh, expires_at: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : undefined, expires_in: Number(params.get("expires_in")) || 3600, user }, now);
}

// The session is due for a refresh a minute before it expires.
export const needsRefresh = (session, now = Date.now()) => !session.expiresAt || session.expiresAt - 60000 <= now;

export async function signOut(cfg, session, fetchFn = fetch) {
  await call(cfg, fetchFn, "/auth/v1/logout", { method: "POST", token: session.accessToken, query: "?scope=local" });
}

// Deletes the signed-in person and every row they own, in every app.
export async function deleteAccount(cfg, session, fetchFn = fetch) {
  await call(cfg, fetchFn, "/rest/v1/rpc/delete_my_account", { method: "POST", token: session.accessToken, profile: "public", body: {} });
}

// ---------- rows <-> stores ----------

const SEP = "\u0000";
const rowId = (store, key) => `${store}${SEP}${key}`;
const EPOCH = new Date(0).toISOString();
const ms = (v) => { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t; };

// JSON with object keys sorted, so a record that round-tripped through the
// database (which reorders keys) compares equal to the same record here.
export function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

// Stores -> rows, keyed by rowId. A record is a row; a tombstone is a row
// marked deleted, unless the record was logged again after it (then the live
// record is the row).
export function storesToRows(stores, keyPaths) {
  const rows = new Map();
  for (const [store, recs] of Object.entries(stores || {})) {
    if (store === TOMBSTONES) continue;
    const kp = keyPaths[store];
    if (!kp) continue;
    for (const r of recs) {
      const key = JSON.stringify(r[kp]);
      const t = editedMs(r);
      rows.set(rowId(store, key), { store, key, data: r, edited_at: t ? new Date(t).toISOString() : EPOCH, deleted: false });
    }
  }
  for (const t of stores?.[TOMBSTONES] ?? []) {
    if (!t || typeof t.store !== "string" || !keyPaths[t.store]) continue;
    const key = JSON.stringify(t.key);
    const id = rowId(t.store, key);
    if (rows.has(id)) continue;
    rows.set(id, { store: t.store, key, data: t, edited_at: ms(t.at) ? new Date(ms(t.at)).toISOString() : EPOCH, deleted: true });
  }
  return rows;
}

// Rows -> stores ({ storeName: [records], deleted: [tombstones] }). Rows of a
// store this genki does not know (a newer genki's) are left out here, and are
// never uploaded over, since a sync only uploads rows it merged.
export function rowsToStores(rows, keyPaths) {
  const out = {};
  for (const name of Object.keys(keyPaths)) out[name] = [];
  for (const row of rows) {
    if (!keyPaths[row.store] || row.store === TOMBSTONES) continue;
    if (!row.deleted) {
      if (row.data && typeof row.data === "object") out[row.store].push(row.data);
      continue;
    }
    let key;
    try { key = JSON.parse(row.key); } catch { continue; }
    const d = row.data && typeof row.data === "object" ? row.data : {};
    const id = tombstoneId(row.store, key);
    out[TOMBSTONES].push({ ...d, id, store: row.store, key, at: d.at || row.edited_at });
  }
  return out;
}

// The merged rows the database does not have yet (new, or different).
export function rowsToPush(merged, remote) {
  const out = [];
  for (const [id, row] of merged) {
    const r = remote.get(id);
    if (r && r.deleted === row.deleted && ms(r.edited_at) === ms(row.edited_at) && stableJson(r.data ?? null) === stableJson(row.data ?? null)) continue;
    out.push(row);
  }
  return out;
}

// ---------- sync ----------

// Every row this person has, a page at a time.
export async function pullRows(cfg, session, fetchFn = fetch) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await call(cfg, fetchFn, "/rest/v1/records", {
      token: session.accessToken, profile: SCHEMA,
      query: `?select=store,key,data,edited_at,deleted&order=store.asc,key.asc&limit=${PAGE}&offset=${offset}`,
    });
    if (!Array.isArray(page)) throw new AccountError("The genki server sent an unexpected list of records.");
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

export async function pushRows(cfg, session, rows, fetchFn = fetch) {
  let written = 0;
  for (let i = 0; i < rows.length; i += PUSH_BATCH) {
    const n = await call(cfg, fetchFn, "/rest/v1/rpc/push", { method: "POST", token: session.accessToken, profile: SCHEMA, body: { rows: rows.slice(i, i + PUSH_BATCH) } });
    written += Number(n) || 0;
  }
  return written;
}

// One sync: pull, merge with `local` (this device's dump), upload what the
// merge changed. Returns the merged stores (for the caller to apply here),
// how many rows came down and how many went up.
export async function cloudSync(cfg, session, local, keyPaths, fetchFn = fetch) {
  const remoteRows = await pullRows(cfg, session, fetchFn);
  const merged = mergeStores(local, rowsToStores(remoteRows, keyPaths), keyPaths);
  const remote = new Map(remoteRows.map((r) => [rowId(r.store, r.key), r]));
  const push = rowsToPush(storesToRows(merged, keyPaths), remote);
  const written = push.length ? await pushRows(cfg, session, push, fetchFn) : 0;
  return { merged, pulled: remoteRows.length, pushed: push.length, written };
}
