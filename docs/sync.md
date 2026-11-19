---
owns:
  - sync.js
  - sync-view.js
  - merge.js
  - tests/sync.test.mjs
  - tests/merge.test.mjs
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

- **Sync now merges** (`mergeSync` in `sync.js`, the merge itself in `merge.js`, unit-tested in `tests/merge.test.mjs`): it fetches `app/latest.json`, checks it with `parseBackup` (a copy this app cannot read, corrupt or from a newer genki, stops the sync with nothing written), merges it with `dumpAll()` record by record, and `PUT`s the merged backup over exactly the version it fetched. If another write landed in between (GitHub answers 409, or 422 for a missing sha), it fetches and merges again, up to three times, so a write from elsewhere is never overwritten unmerged. Then it applies the merged copy on the device (below).
- A device is **linked** once it has synced or restored (it keeps the file's sha in `syncSha`). An unlinked device that finds a file already there asks before merging into it, showing that copy's date and record count, so a fresh phone never touches the real copy unasked.
- **Daily sync**: on open, a linked device with a token syncs once per local day (`syncDue`), quietly. A failure is shown in the Sync section ("Last automatic sync failed: ...") and cleared by the next good sync.
- The commit message is `genki sync <ISO time>`.

## How the merge decides

Records are matched by their store key (an entry's `id`, a weigh-in's `date`, a meta `key`, ...):

- A record on one side only is kept, so two devices logging keep each other's records.
- The same key on both sides: the **newer edit wins**. Every write through `db.js` stamps `editedAt` (ISO time) on the record, and when a record has it, `editedAt` alone decides (a content time such as a weigh-in's `at` never outranks it); a record written before that existed uses its own time instead (the latest of `at`, `updatedAt`, a meta value's `updatedAt`, `lastUsed`, `createdAt`). The times come from each device's clock, so a device whose clock runs far ahead or behind can win or lose a same-record conflict it should not; with one logging device (the phone) this rarely matters. A tie, including two records with no time at all, keeps this device's copy. The one exception is meta `createdAt` (first open), which keeps the earliest date.
- **Deletes carry over**: deleting a record (`db.del` / `db.delMany`) leaves a tombstone in the `deleted` store ([data-flow.md](data-flow.md#store)), which syncs like any record. A record is dropped when a tombstone for its key is at least as new as the record, so a delete on one device is not undone by the other; a record edited or logged again after the delete is kept. Tombstones are never pruned (deletes are rare and each is tiny).
- An import (backup file) or a restore replaces stores without leaving tombstones, and resets this device's tombstones to the file's own (none for a file without a `deleted` section, such as a schema 5 file), so the device's old deletes never drop restored records. Records that only genki-data still has come back on the next sync. Delete a record in the app to remove it everywhere.

Applying on the device: `diffStores` lists what the merged copy changes against the dump the sync started from, and `db.applyChanges` writes those changes in one transaction, without stamping them anew. A record edited on the device while the sync ran is left alone and the device is not marked synced, so the next open syncs again and carries that edit. The device's version (`syncSha`) is saved before the apply; `lastSyncedAt` only once the apply has landed, so an apply that fails is retried on the next open. When anything changed, the open tab redraws and the Sync section says how many records came from genki-data.

## Restore

**Restore from genki-data...** fetches `app/latest.json` (the raw media type, so files over 1 MB work), validates it with `parseBackup`, asks for confirmation with the copy's date and record count, then replaces the stored data exactly as a file import does (`replaceAll`); nothing is merged. With merging sync, restore is only needed to start a device over from the copy. Afterwards the device is linked to that version.

## Content Security Policy

`index.html` carries a CSP meta: scripts only from this site (`script-src 'self'`), network calls only to this site, `https://api.github.com` and `https://world.openfoodfacts.org` (the barcode lookup, [nutrition.md](nutrition.md#barcode-scan)) (`connect-src`), no plugins. The site shares the `syoon291.github.io` origin with the owner's other pages, which is why no page on that origin may load third-party code. Inline `style` attributes are allowed (bars and charts set widths that way); inline scripts and event handlers are not. `scripts/check.mjs` fails if the CSP's `script-src` or `connect-src` change, if the page gets an inline or remote script or an inline event handler, if any module but `sync.js` calls the GitHub API, or if any module but `openfoodfacts.js` calls Open Food Facts.
