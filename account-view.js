// The Account section of the Data & backup sheet: sign in with an emailed
// code, sync to the account, sign out, delete the account; and the
// once-a-day account sync on open. The session and the account sync state
// live in the device-only database (db.js getDevice/setDevice), never in the
// stores a backup carries.
import * as db from "./db.js";
import { diffStores, recordCount } from "./merge.js";
import { esc } from "./ui.js";
import { syncDue } from "./sync.js";
import { ACCOUNT_URL, ACCOUNT_KEY } from "./account-config.js";
import { configured, sendCode, verifyCode, refreshSession, sessionFromLink, needsRefresh, signOut, deleteAccount, cloudSync, looksLikeEmail, looksLikeCode } from "./account.js";

const CFG = { url: ACCOUNT_URL, key: ACCOUNT_KEY };
export const accountsOn = () => configured(CFG);

// Device keys: accountSession ({ accessToken, refreshToken, expiresAt, user:
// { id, email } }), accountOwner (the id of the account this device's data
// was synced with: set means linked, and no other account may sync it),
// accountLastSyncedAt, accountSyncError, accountNoticeHidden.
let busy = false;
let note = { msg: "", tone: "" };
let pendingEmail = "";
let rerender = () => {};
let onRestored = () => {};

export function setAccountHooks({ rerender: r, restored }) {
  if (r) rerender = r;
  if (restored) onRestored = restored;
}

export function clearAccountNote() { note = { msg: "", tone: "" }; }
const say = (msg, tone = "") => { note = { msg, tone }; };
const fmt = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never");

// The privacy note, shown before the first sign-in (the backend repo's
// PRIVACY.md, in short).
const PRIVACY = `
  <details class="privacy">
    <summary>What genki keeps about you</summary>
    <ul>
      <li><strong>Your email address</strong>, to sign in. No passwords: you get a code by email.</li>
      <li><strong>What you log yourself</strong>: food, weight, workouts and the day trackers, and your profile if you fill it in (sex, year of birth, height, weight, goal and activity level, used for your targets). Nothing else: no name, phone number, location or contacts.</li>
      <li><strong>Sign-in records</strong> the sign-in service keeps for security: when you signed in, your IP address and kind of browser.</li>
      <li><strong>Who can see it:</strong> only you, through the app; the database refuses your entries to anyone else signed in. The owner, who invited you, runs the database, so they could technically look, and they won't.</li>
      <li><strong>Where:</strong> on your phone, in a database run by Supabase in Tokyo, Japan, and in a nightly encrypted backup only the owner can open.</li>
      <li><strong>No ads, analytics or trackers.</strong></li>
      <li><strong>Export</strong> your data any time (Export backup, above). <strong>Delete my account</strong> removes you and everything you logged, in every app at once; the encrypted backups that still hold it are replaced over 14 days.</li>
    </ul>
  </details>`;

async function state() {
  return {
    session: await db.getDevice("accountSession", null),
    owner: await db.getDevice("accountOwner", null),
    lastSyncedAt: await db.getDevice("accountLastSyncedAt", null),
    lastError: await db.getDevice("accountSyncError", null),
  };
}

export async function accountSection() {
  if (!accountsOn()) return "";
  let s;
  try { s = await state(); }
  catch (e) { return `<section class="sync" aria-labelledby="account-title"><h3 id="account-title">Account</h3><p class="msg bad" role="status">${esc(`Accounts are unavailable: ${e.message}`)}</p></section>`; }
  const status = `<p class="msg ${note.tone}" role="status">${esc(busy ? "Working…" : note.msg)}</p>`;
  const off = busy ? " disabled" : "";
  if (!s.session) {
    if (pendingEmail) {
      return `
    <section class="sync" aria-labelledby="account-title">
      <h3 id="account-title">Account</h3>
      <p class="hint">Type the 6-digit code sent to ${esc(pendingEmail)}. It works once, for an hour.</p>
      <form class="stack" data-form="account-code">
        <label class="field"><span>Code</span>
          <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>
        </label>
        <button type="submit" class="btn"${off}>Sign in</button>
      </form>
      <div class="stack">
        <button type="button" class="btn ghost" data-act="account-resend"${off}>Send a new code</button>
        <button type="button" class="btn ghost" data-act="account-other"${off}>Use a different email</button>
      </div>
      ${status}
    </section>`;
    }
    return `
    <section class="sync" aria-labelledby="account-title">
      <h3 id="account-title">Account</h3>
      <p class="hint">Sign in with the email the owner invited, and genki keeps your data in your account as well as on this phone, so a new phone can get it back. Invite only: no password, no sign-up.</p>
      ${PRIVACY}
      <form class="stack" data-form="account-email">
        <label class="field"><span>Email</span>
          <input type="email" name="email" autocomplete="email" autocapitalize="off" spellcheck="false" required>
        </label>
        <label class="check"><input type="checkbox" name="ok" required> I've read what genki keeps about me</label>
        <button type="submit" class="btn"${off}>Email me a code</button>
      </form>
      ${status}
    </section>`;
  }
  const other = s.owner && s.owner !== s.session.user.id;
  return `
    <section class="sync" aria-labelledby="account-title">
      <h3 id="account-title">Account</h3>
      <dl class="facts">
        <div><dt>Signed in as</dt><dd>${esc(s.session.user.email || "your account")}</dd></div>
        <div><dt>Last synced</dt><dd>${esc(fmt(s.lastSyncedAt))}</dd></div>
      </dl>
      ${other ? `<p class="hint">The data on this phone was synced with a different account, so it is not sent to this one. Erase it here to start this account on this phone (your other account keeps its copy).</p>` : ""}
      ${s.lastError ? `<p class="hint">Last automatic sync failed: ${esc(s.lastError)}</p>` : ""}
      ${!other && s.owner ? `<p class="hint">Syncs on its own once a day when you open genki. A sync merges: records from both sides are kept, the newer edit wins, and deletes carry over.</p>` : ""}
      ${!other && !s.owner ? `<p class="hint">Sync now once to send this phone's data to your account and turn on the daily sync.</p>` : ""}
      <div class="stack">
        ${other ? `<button type="button" class="btn" data-act="account-erase"${off}>Erase this phone's data…</button>` : `<button type="button" class="btn" data-act="account-sync"${off}>Sync now</button>`}
        <button type="button" class="btn ghost" data-act="account-signout"${off}>Sign out</button>
        <button type="button" class="btn danger" data-act="account-delete"${off}>Delete my account…</button>
      </div>
      ${PRIVACY}
      ${status}
    </section>`;
}

async function run(job) {
  if (busy) return;
  busy = true;
  say("");
  rerender();
  try { await job(); }
  catch (e) { say(e.message, "bad"); }
  finally { busy = false; rerender(); }
}

// ---------- session ----------

async function refresh(session) {
  try {
    const next = await refreshSession(CFG, session);
    await db.setDevice("accountSession", next);
    return next;
  } catch (e) {
    // The sign-in is gone for good (revoked, expired, account deleted): forget it.
    if (e.status === 400 || e.status === 401 || e.status === 403) await db.delDevice("accountSession");
    throw e;
  }
}

async function withSession(fn) {
  let session = await db.getDevice("accountSession", null);
  if (!session) throw new Error("You are signed out. Sign in again.");
  if (needsRefresh(session)) session = await refresh(session);
  try { return await fn(session); }
  catch (e) {
    if (e.status !== 401) throw e;
    return fn(await refresh(session));
  }
}

async function signedIn(session) {
  await db.setDevice("accountSession", session);
  pendingEmail = "";
  const owner = await db.getDevice("accountOwner", null);
  if (owner && owner !== session.user.id) { say("Signed in. This phone's data belongs to another account, so it was not synced.", "good"); return; }
  await accountSync({ interactive: true, fresh: true });
}

// ---------- actions ----------

export function handleAccountSubmit(form) {
  const kind = form.dataset.form;
  if (kind === "account-email") {
    const email = form.elements.email.value.trim().toLowerCase();
    run(async () => {
      if (!looksLikeEmail(email)) { say("That does not look like an email address.", "bad"); return; }
      await sendCode(CFG, email);
      pendingEmail = email;
      say("Code sent. Check your email.", "good");
    });
    return true;
  }
  if (kind === "account-code") {
    const code = form.elements.code.value.replace(/\s/g, "");
    run(async () => {
      if (!looksLikeCode(code)) { say("The code is 6 digits.", "bad"); return; }
      await signedIn(await verifyCode(CFG, pendingEmail, code));
    });
    return true;
  }
  return false;
}

export function handleAccountAct(act) {
  if (act === "account-resend") { run(async () => { await sendCode(CFG, pendingEmail); say("New code sent.", "good"); }); return true; }
  if (act === "account-other") { pendingEmail = ""; say(""); rerender(); return true; }
  if (act === "account-sync") { run(() => accountSync({ interactive: true })); return true; }
  if (act === "account-erase") { run(eraseForThisAccount); return true; }
  if (act === "account-signout") {
    run(async () => {
      if (!confirm("Sign out? genki's data stays on this phone, and only this account can sync it again.")) return;
      const session = await db.getDevice("accountSession", null);
      // Best effort: the sign-in is forgotten here even if the server cannot be reached.
      if (session) await signOut(CFG, session).catch((e) => console.warn("genki: sign-out did not reach the server", e.message));
      for (const k of ["accountSession", "accountSyncError", "accountNoticeHidden"]) await db.delDevice(k);
      // A shared phone: the next person should not be able to read this one's log.
      if (confirm("Signed out. Also erase genki's data on this phone? Do this if someone else uses this phone: your account keeps its copy.")) {
        await eraseLocal();
        say("Signed out, and this phone's data erased.", "good");
      } else {
        say("Signed out.", "good");
      }
    });
    return true;
  }
  if (act === "account-delete") { run(deleteMine); return true; }
  return false;
}

async function eraseLocal() {
  const names = await db.storeNames();
  await db.replaceAll(Object.fromEntries(names.map((n) => [n, []])));
  try { await db.setMeta("createdAt", new Date().toISOString()); } catch {}
  for (const k of ["accountOwner", "accountLastSyncedAt", "accountSyncError", "accountNoticeHidden"]) await db.delDevice(k);
  onRestored();
}

async function eraseForThisAccount() {
  if (!confirm("Erase all genki data on this phone? It belongs to another account, which keeps its own copy. Then this account's data comes down here.")) return;
  await eraseLocal();
  await accountSync({ interactive: true });
}

async function deleteMine() {
  const session = await db.getDevice("accountSession", null);
  if (!session) throw new Error("You are signed out. Sign in again.");
  if (!confirm(`Delete the account ${session.user.email}? This removes you and everything you logged, in genki and the owner's other apps, from the database. It cannot be undone.`)) return;
  await withSession((s) => deleteAccount(CFG, s));
  // accountOwner stays (the deleted account's id): kept data can then never go
  // up to whoever signs in next, only be erased.
  for (const k of ["accountSession", "accountLastSyncedAt", "accountSyncError", "accountNoticeHidden"]) await db.delDevice(k);
  if (confirm("Your account is deleted. Also erase genki's data on this phone?")) {
    await eraseLocal();
    say("Account deleted, and this phone's data erased.", "good");
  } else {
    say("Account deleted. This phone keeps its copy, which no other account can sync.", "good");
  }
}

// ---------- sync ----------

// Merge this device's data with the account's rows record by record, upload
// what changed and apply the merge here. A device not linked to any account
// yet asks before sending its data up (fresh: right after signing in), and a
// device linked to another account never syncs.
async function accountSync({ interactive, fresh = false }) {
  await withSession(async (session) => {
    const owner = await db.getDevice("accountOwner", null);
    if (owner && owner !== session.user.id) throw new Error("This phone's data belongs to another account. Erase it in Data & backup > Account to use this one.");
    const now = new Date();
    const local = await db.dumpAll();
    if (!owner) {
      if (!interactive) return;
      const n = recordCount(local) - (local.meta?.length ?? 0);
      if (n > 0 && !confirm(`Send the genki data on this phone (${n} records) to the account ${session.user.email}? It is merged with anything already there: records from both are kept, and where both have the same one, the newer edit wins.`)) {
        say(fresh ? "Signed in. Nothing was sent: Sync now when you're ready." : "Sync cancelled. Nothing changed.");
        return;
      }
    }
    const { merged, pushed } = await cloudSync(CFG, session, local, db.KEY_PATHS);
    // Another tab may have erased this phone or linked it elsewhere meanwhile.
    if ((await db.getDevice("accountOwner", null)) !== owner) throw new Error("This phone's account changed while syncing. Nothing here was changed: sync again.");
    // The account has the merged copy now: link this device before applying it.
    await db.setDevice("accountOwner", session.user.id);
    let applied, skipped;
    try { ({ applied, skipped } = await db.applyChanges(diffStores(local, merged, db.KEY_PATHS))); }
    catch (e) { throw new Error(`Saved to your account, but this phone could not be updated: ${e.message} Sync again to finish.`); }
    if (applied) onRestored();
    // A record edited while syncing stays as it is here; the next open sends it.
    if (!skipped) await db.setDevice("accountLastSyncedAt", now.toISOString());
    await db.delDevice("accountSyncError");
    const parts = [pushed ? `${pushed} sent` : "", applied ? `${applied} updated from your account` : ""].filter(Boolean);
    say(`${fresh ? "Signed in and synced." : "Synced."}${parts.length ? ` ${parts.join(", ")}.` : ""}${skipped ? " Some records changed while syncing; they go out on the next sync." : ""}`, "good");
  });
}

// On open: a signed-in, linked device syncs once a local day, quietly. A
// failure is kept to show in the Account section and on Today, never thrown.
export async function accountAutoSync(now = new Date()) {
  if (!accountsOn()) return;
  try {
    const session = await db.getDevice("accountSession", null);
    const owner = await db.getDevice("accountOwner", null);
    if (!session || owner !== session.user.id || !syncDue(await db.getDevice("accountLastSyncedAt", null), now)) return;
    if (busy) return;
    busy = true;
    try { await accountSync({ interactive: false }); }
    finally { busy = false; }
  } catch (e) {
    try { await db.setDevice("accountSyncError", e.message); await db.delDevice("accountNoticeHidden"); }
    catch (e2) { console.warn("genki: account sync failed and its error could not be saved", e, e2); }
  }
  note = { msg: "", tone: "" };
  try { await rerender(); } catch (e) { console.warn("genki: could not redraw after the account sync", e); }
}

// The email link's landing: the sign-in service sends the browser back with
// the tokens (or an error) in the URL hash. The caller has already taken them
// out of the address bar.
export async function acceptSignInLink(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (!accountsOn()) return;
  if (params.get("error") || params.get("error_description")) {
    say(`That sign-in link did not work${params.get("error_description") ? `: ${params.get("error_description")}` : ""}. Ask for a code instead.`, "bad");
    return true;
  }
  if (!params.get("access_token")) return false;
  if (busy) return true;
  busy = true;
  try {
    const session = await sessionFromLink(CFG, params);
    // Anyone invited can send a link that signs in to their own account, so ask.
    if (!confirm(`Sign in to genki as ${session.user.email}?`)) { say("Not signed in."); return true; }
    await signedIn(session);
  }
  catch (e) { say(e.message, "bad"); }
  finally { busy = false; }
  return true;
}

// Is this URL hash the sign-in service's answer rather than a tab?
export const isSignInHash = (hash) => /(^#|&)(access_token|error_description|error)=/.test(hash);

// The Today tab's notice for a failed automatic account sync.
export async function accountErrorNotice() {
  if (!accountsOn()) return "";
  let error = null, hidden = false;
  try {
    error = await db.getDevice("accountSyncError", null);
    hidden = !!(await db.getDevice("accountNoticeHidden", false));
  } catch (e) { console.warn("genki: could not read the account state", e); return ""; }
  if (!error || hidden) return "";
  return `
    <div class="card warn-card sync-notice" role="status">
      <div>
        <strong>Account sync failed.</strong> <span class="small">${esc(error)}</span>
        <button type="button" class="link-btn" data-act="account-notice-open">Open Account</button>
      </div>
      <button type="button" class="icon-btn" data-act="account-notice-hide" aria-label="Dismiss account sync notice"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>`;
}

export const hideAccountNotice = () => db.setDevice("accountNoticeHidden", true);
