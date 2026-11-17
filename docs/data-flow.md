---
owns:
  - db.js
  - backup.js
status: current
---

# Data Flow

All user data lives in the browser, in one IndexedDB database. Nothing is sent anywhere; the only way data leaves the device is a backup file the owner exports.

## Store

`db.js` opens the database `genki` at the version number set at the top of the file. Object stores today:

| Store | Key | Holds |
|-------|-----|-------|
| `meta` | `key` | Small app facts as `{ key, value }`: `createdAt` (first open), `lastExportAt`, `lastImportAt`. Later phases keep settings here too |

Upgrades: `UPGRADES[n]` moves the database from version `n` to `n+1`, and opening runs every step from the stored version up. To add or change a store, bump that version number, append an upgrade step, and bump `SCHEMA` in `backup.js` to match. An upgrade step never drops or renames existing data: those records are on the owner's phone and in their backups.

If another tab opens a newer version, this tab closes its connection so the upgrade can run; an older tab that blocks an upgrade gets an error asking to close it.

The module exposes `get`, `getAll`, `put`, `del`, `getMeta`/`setMeta`, `storeNames`, `dumpAll` (every record of every store) and `replaceAll` (clear and refill the named stores in one transaction).

## Backup file

`backup.js` holds the format, as pure functions with unit tests (`tests/backup.test.mjs`):

```json
{
  "app": "genki",
  "schema": 1,
  "exportedAt": "2026-01-02T03:04:05.000Z",
  "stores": { "meta": [{ "key": "createdAt", "value": "..." }] }
}
```

`parseBackup` accepts a file only when it is JSON, `app` is `"genki"`, `schema` is a whole number from 1 up to the app's own `SCHEMA` (a newer file asks to update the app first), and `stores` maps store names this app knows to lists of objects. Each failure returns a message the sheet shows as is.

## Export and import

- Export: `dumpAll()` wrapped by `buildBackup()`, downloaded as a file, then `setMeta("lastExportAt")`.
- Import: `parseBackup()` against `storeNames()` and the key paths `db.js` exports (every record must carry its store's key), a confirm prompt, then `replaceAll()`. The replace is one transaction, so a failure part way (for example a record IndexedDB rejects; `replaceAll()` aborts the transaction) leaves the stored data untouched. Stores the file does not mention are left as they are. `lastImportAt` is set afterwards (best effort: a failure there does not undo the import).

An older backup (lower `schema`) is accepted as is today; once a later schema changes a record shape, `parseBackup` is where old files get migrated.
