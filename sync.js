// Sync to the owner's private GitHub repo: the backup file (backup.js format)
// is written to one path, app/latest.json, through the GitHub Contents API.
// Nothing else in that repo is ever read or written (its history/ folder is
// the owner's own). Pure functions with fetch passed in, so they run under
// `node --test` with a mocked fetch as well as in the browser.
//
// The token is passed in by the caller and only ever goes into the
// Authorization header: it is never put in a message, a URL or a log.

export const REPO = "syoon291/genki-data";
export const PATH = "app/latest.json";
const API = "https://api.github.com";
const FILE_URL = `${API}/repos/${REPO}/contents/${PATH}`;
const REPO_URL = `${API}/repos/${REPO}`;
const MAX_TRIES = 3;
const TIMEOUT_MS = 30000;

export class SyncError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "SyncError";
    this.status = status;
  }
}

function headers(token, accept = "application/vnd.github+json") {
  return { Accept: accept, Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" };
}

// Every request goes through here: no browser cache (a cached sha would
// conflict forever), and failures become messages fit to show.
async function call(fetchFn, url, init) {
  // Hard guard: this module may only ever touch the repo itself and app/latest.json.
  if (url !== FILE_URL && url !== REPO_URL) throw new SyncError("Refusing to touch anything but app/latest.json.");
  let res;
  // A timeout so a hung request (captive portal, dead mobile link) never leaves the buttons stuck.
  const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
  try { res = await fetchFn(url, { cache: "no-store", signal, ...init }); }
  catch { throw new SyncError("Could not reach GitHub. Check the connection and try again."); }
  return res;
}

async function failure(res, what) {
  let detail = "";
  try { detail = (await res.json())?.message || ""; } catch {}
  if (res.status === 401) return new SyncError("GitHub did not accept the token. It may be wrong or expired.", 401);
  if (res.status === 403) return new SyncError(`GitHub refused ${what}${detail ? `: ${detail}` : ""}. The token needs Contents read and write on genki-data.`, 403);
  if (res.status === 404) return new SyncError("The token cannot see genki-data. Give it access to that repo.", 404);
  return new SyncError(`GitHub could not ${what} (${res.status}${detail ? `: ${detail}` : ""}).`, res.status);
}

// UTF-8 text to base64, in chunks so a large backup does not overflow the call stack.
export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Check the token reaches genki-data and may write to it.
export async function checkAccess(token, fetchFn = fetch) {
  const res = await call(fetchFn, REPO_URL, { headers: headers(token) });
  if (!res.ok) throw await failure(res, "access to genki-data");
  const repo = await res.json();
  if (repo?.permissions && repo.permissions.push === false) throw new SyncError("The token can read genki-data but not write to it. Give it Contents read and write.", 403);
  return { private: repo?.private === true };
}

// The current file's sha, or null when there is no app/latest.json yet.
export async function remoteSha(token, fetchFn = fetch) {
  const res = await call(fetchFn, FILE_URL, { headers: headers(token) });
  if (res.status === 404) {
    // 404 means "no file" only when the repo itself is visible.
    await checkAccess(token, fetchFn);
    return null;
  }
  if (!res.ok) throw await failure(res, "read app/latest.json");
  const meta = await res.json();
  if (typeof meta?.sha !== "string") throw new SyncError("GitHub sent an unexpected answer for app/latest.json.");
  return meta.sha;
}

// The file's text and sha, or null when there is no app/latest.json yet.
// The raw media type works for files over 1 MB, where the JSON answer has no content.
export async function fetchRemote(token, fetchFn = fetch) {
  const sha = await remoteSha(token, fetchFn);
  if (sha === null) return null;
  const res = await call(fetchFn, FILE_URL, { headers: headers(token, "application/vnd.github.raw+json") });
  if (!res.ok) throw await failure(res, "read app/latest.json");
  return { sha, text: await res.text() };
}

// Write `text` to app/latest.json. `sha` is the version this device last saw
// (null for a new file). If the file moved on since, GitHub answers 409 (or
// 422 when a sha was needed but missing): fetch the current sha and try again.
// Returns the new sha.
export async function pushFile(token, text, sha, { fetchFn = fetch, message = "genki sync" } = {}) {
  let current = sha;
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const body = { message, content: toBase64(text) };
    if (current) body.sha = current;
    const res = await call(fetchFn, FILE_URL, { method: "PUT", headers: { ...headers(token), "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) {
      const out = await res.json();
      const next = out?.content?.sha;
      if (typeof next !== "string") throw new SyncError("GitHub saved the file but sent an unexpected answer.");
      return next;
    }
    if ((res.status === 409 || res.status === 422) && attempt < MAX_TRIES) {
      current = await remoteSha(token, fetchFn);
      continue;
    }
    throw await failure(res, "save app/latest.json");
  }
  throw new SyncError("GitHub kept reporting a conflict. Try again in a minute.");
}

// Auto-sync runs once a local day: due when the last good sync was on an earlier day.
export function syncDue(lastSyncedAt, now = new Date()) {
  if (!lastSyncedAt) return true;
  const last = new Date(lastSyncedAt);
  if (Number.isNaN(last.getTime())) return true;
  const day = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  return day(last) !== day(now) && last < now;
}

// A fine-grained token looks like github_pat_... Classic tokens (ghp_...) are
// refused: they cannot be limited to genki-data. Only a sanity check on what
// was pasted: GitHub decides if it works.
export function looksLikeToken(s) {
  return /^github_pat_[A-Za-z0-9_]{20,}$/.test(s);
}
