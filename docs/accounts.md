---
owns:
  - account.js
  - account-view.js
  - account-config.js
  - scripts/set-account.mjs
  - scripts/account-rules.mjs
  - tests/account.test.mjs
status: current
---

# Accounts

genki can keep each person's data in their own account on the owner's backend (Supabase, Tokyo; the private repo `syoon291/backend` holds its schema, access rules and privacy note). This is what lets the owner's invited friends use genki on their phones with a copy that survives a lost phone. The phone keeps its own copy (IndexedDB) and works with no signal; the account is a second copy, merged record by record like the GitHub sync ([sync.md](sync.md#how-the-merge-decides)).

## Turned on by config

`account-config.js` holds the project address and its **publishable** key. Both are public by design: the key can do nothing without a signed-in person, and the database shows each person only their own rows. While both are empty, genki shows no Account section and makes no account calls.

Once the owner's project exists, `scripts/set-account.mjs` (given the project address and its publishable key; usage in the script's header) writes both and adds the address to the CSP's `connect-src` in `index.html`. `scripts/check.mjs` (rules in `scripts/account-rules.mjs`) fails if only one is set, if the address is not a `*.supabase.co` project, if the key is anything but a publishable key (a secret or legacy key is refused: the service key never enters this repo), if the CSP's `connect-src` does not match the config exactly, if any module but `account-config.js` names a Supabase address, or if any module but `account.js` calls the backend.

## Signing in

Invite only, no passwords. The Account section of the Data & backup sheet shows the privacy note (what is kept, who can see it, where it is, how to export and delete) and asks for the email the owner invited, with a box to tick that the note was read. **Email me a code** asks the sign-in service for a code with `create_user: false`, so it never makes an account: an email that was not invited gets "That email has not been invited". The person types the 6-digit code from the email (`one-time-code` autofill works on iPhone).

The code is the main way in because a link in an email opens Safari, which keeps its own storage, not the home-screen app. The email also carries a link for signing in in a browser: it lands on genki with the tokens in the URL hash, which `app.js` takes out of the address bar (`history.replaceState`) before anything else runs, then `acceptSignInLink` turns them into a session, but only after asking "Sign in to genki as <email>?": anyone invited could send a link that signs in to their own account, and a phone signed in that way would offer to send its data there.

The session (`{ accessToken, refreshToken, expiresAt, user: { id, email } }`) lives only in the device-only database `genki-device` ([data-flow.md](data-flow.md#device-only-store)) as `accountSession`, so it is never in a backup or an export. Tokens only ever go into request headers. The access token is refreshed a minute before it expires, and once more on a 401; a refresh the service refuses (400/401/403) forgets the session ("You are signed out. Sign in again.").

## Sync

`cloudSync` in `account.js` (pure, fetch passed in, unit-tested in `tests/account.test.mjs` against a mocked backend):

1. Pulls every row of the person's `genki.records` (one row per record of one store; a page of 1000 at a time, ordered by store and key).
2. Turns them into stores (`rowsToStores`: a row marked `deleted` becomes a tombstone in the `deleted` store), and merges them with `dumpAll()` with `mergeStores`, the same merge as the GitHub sync.
3. Turns the merge back into rows (`storesToRows`: each record's `edited_at` is its `editedMs`, the time the merge compares; a tombstone is a row only when no live record has its key) and uploads only the rows that differ from what was pulled (`rowsToPush`, comparing with object keys sorted, since the database reorders them), 500 a call, through `genki.push`. That backend function writes a row only when its `edited_at` is at least as new as the stored one, so a device that pulled a moment before another device saved can never overwrite the newer edit.

Then the view applies the merge here exactly as the GitHub sync does (`diffStores`, `db.applyChanges`: a record edited during the sync is left alone and goes out next time). Rows of a store this genki does not know are never uploaded over. A sync never deletes a row on the server: deletes travel as tombstone rows.

- **Linking**: a device is linked to the account its data was synced with (`accountOwner`, the person's id). The first sync on a device asks before sending its data up ("Send the genki data on this phone (N records) to the account ...?"); right after signing in it runs at once. This is also how the owner's genki-data moves in: the phone already holds it, so the first sync after signing in sends it to the account.
- **Another account on the same phone**: a device linked to one account never syncs into another. Signed in as someone else, the section says so and offers **Erase this phone's data...**, after which that account's data comes down. Signing out keeps the phone's data and its link.
- **Daily sync**: on open, a signed-in, linked device syncs once a local day (`syncDue` from sync.js). A failure is kept as `accountSyncError` and shown in the section and as an "Account sync failed" notice on Today (Open Account, dismiss sets `accountNoticeHidden`; the next automatic failure clears it). The next good sync clears both. **Sync now** runs it by hand.
- The GitHub sync ([sync.md](sync.md)) stays as a fallback beside it for now; both merge, so running both is safe.

## Delete, export, sign out

- **Delete my account...** confirms, calls the backend's `delete_my_account()`, which removes the person and every row they own in every app, forgets the session, then asks whether to erase genki's data on this phone too. Kept data stays linked to the deleted account, so it can never sync to whoever signs in next, only be erased.
- **Export** is the existing Export backup (JSON) in the same sheet: everything the person logged.
- **Sign out** tells the sign-in service (best effort), forgets the session on this device, then offers to erase genki's data on this phone (for a phone someone else also uses). Kept data stays linked to this account.

## Not collected

Only the email address and what the person logs. No analytics, trackers or error reporting; the page loads no third-party code (CSP: [sync.md](sync.md#content-security-policy)).
