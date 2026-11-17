---
owns:
  - sync.js
  - sync-view.js
  - tests/sync.test.mjs
status: current
---

# Sync

genki can keep a copy of its data in the owner's **private** GitHub repo `syoon291/genki-data`, so a new phone can restore it and the owner's review tooling can read it. It writes exactly one file there, `app/latest.json`, in the [backup file format](data-flow.md#backup-file). Nothing else in that repo is read or written: its `history/` folder is the owner's own.

## The token

The owner pastes a fine-grained GitHub token (repository access: genki-data only; permission: Contents read and write) into the Sync section of the Data & backup sheet. Classic `ghp_` tokens are refused, since they cannot be limited to one repo.

- It is stored only in the device-only IndexedDB database `genki-device` (see [data-flow.md](data-flow.md#device-only-store)), never in the `genki` database, so it is never in a backup, an export or the synced file, and an import or restore never overwrites it.
- It is sent only in the `Authorization` header of requests to `api.github.com`; never in a URL, a message, a log or a commit message.
- On save, genki checks it can see the repo, that the repo is private (it refuses a public one) and, when GitHub reports permissions, that it may write.
- **Remove token** deletes it and the sync state from the device; the copy in genki-data stays.

## Sync now and the daily sync

`sync.js` holds the GitHub calls as pure functions with `fetch` passed in (unit-tested against a mocked GitHub in `tests/sync.test.mjs`, fake tokens only). Every request uses `cache: "no-store"`, since a cached sha would conflict forever, times out after 30 seconds, and a guard refuses any URL other than the repo and `app/latest.json`.

- **Sync now** builds the backup from `dumpAll()` and `PUT`s it to `app/latest.json` through the Contents API with the sha this device last saw. If the file moved on (GitHub answers 409, or 422 for a missing sha), it fetches the current sha and tries again, up to three times: the device's data wins.
- A device is **linked** once it has synced or restored (it keeps the file's sha in `syncSha`). An unlinked device that finds a file already there asks before replacing it, showing that copy's date and record count, so a fresh phone never overwrites the real copy with its empty data.
- **Daily sync**: on open, a linked device with a token syncs once per local day (`syncDue`), quietly. A failure is shown in the Sync section ("Last automatic sync failed: ...") and cleared by the next good sync.
- The commit message is `genki sync <ISO time>`.

## Restore

**Restore from genki-data...** fetches `app/latest.json` (the raw media type, so files over 1 MB work), validates it with `parseBackup`, asks for confirmation with the copy's date and record count, then replaces the stored data exactly as a file import does (`replaceAll`). Afterwards the device is linked to that version.

## Content Security Policy

`index.html` carries a CSP meta: scripts only from this site (`script-src 'self'`), network calls only to this site and `https://api.github.com` (`connect-src`), no plugins. The site shares the `syoon291.github.io` origin with the owner's other pages, which is why no page on that origin may load third-party code. Inline `style` attributes are allowed (bars and charts set widths that way); inline scripts and event handlers are not. `scripts/check.mjs` fails if the CSP's `script-src` or `connect-src` change, if the page gets an inline or remote script or an inline event handler, or if any module but `sync.js` calls the GitHub API.
