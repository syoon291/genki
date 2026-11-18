---
owns:
  - db.js
  - backup.js
status: current
---

# Data Flow

All user data lives in the browser, in one IndexedDB database. It leaves the device only as a backup file the owner exports, or as the same file synced to the owner's private GitHub repo when they turn sync on ([sync.md](sync.md)).

## Store

`db.js` opens the database `genki` at the version number set at the top of the file. Object stores today:

| Store | Key | Holds |
|-------|-----|-------|
| `meta` | `key` | Small app facts and settings as `{ key, value }`: `createdAt` (first open), `lastExportAt`, `lastImportAt`, `profile` (below), and the workout state: `liftPlan`, `liftNext`, `liftDraft`, `liftUnit`, `liftForm`, `liftFocus`, `liftlogImport` |
| `entries` | `id` | The food log, one record per food eaten; index `date` (local day `YYYY-MM-DD`) (version 2) |
| `myFoods` | `id` | The owner's saved foods, nutrients per serving (version 2) |
| `weighIns` | `date` | Weigh-ins, at most one per local day (version 3). See [weight.md](weight.md) |
| `workouts` | `id` | Finished workout sessions (version 4). See [workouts.md](workouts.md) |
| `nutritionWeeks` | `weekStart` | Imported weekly nutrition averages, read-only history (version 5). See [nutrition.md](nutrition.md#weekly-history) |

Record shapes (what each field means is in [nutrition.md](nutrition.md)):

- `profile`: `{ sex: "female"|"male", birthYear, heightCm, weightKg, activity, goalKg|null, targetDate: "YYYY-MM-DD"|null, deficit, proteinPerKg, macroMode: "pct"|"g"|null, carbPct, fatPct (with "pct"), carbG, fatG (with "g"), updatedAt }`. `weightKg` follows the weigh-ins once there are any.
- weigh-in: `{ date: "YYYY-MM-DD", kg (0.1 kg steps), at (ISO time logged) }`.
- entry: `{ id, date, meal: "breakfast"|"lunch"|"dinner"|"snacks", name, source: "jp"|"us"|"my"|"quick"|"mfp", ref (table or my-food id, or null), amount, unit ("g", a portion label, or "serving"), base: { kcal, protein, fat, carbs } per one unit, createdAt }`. The nutrients eaten are `base x amount`; an entry copies its numbers, so editing or deleting a my food never changes logged days. A MyFitnessPal meal total (`source: "mfp"`, id `mfp-<date>-<meal>`, unit `"1 meal"`, see [nutrition.md](nutrition.md#myfitnesspal-import)) is the one entry with a fixed id, so a re-import finds it.
- weekly history: `{ weekStart, weekEnd ("YYYY-MM-DD"), kcal (a day), protein, carbs, fat, fiber (g a day), proteinPct, carbPct, fatPct (each a number or null), source: "csv", at (ISO time imported) }`.
- workout session: `{ id, date (ISO time finished), day (plan day name), sets: [{ exId (library id in workouts.js), w (kg, 0 for bodyweight), reps, rir|null }], minutes, source?: "liftlog" }`.
- `liftPlan`: `{ goal, days, equip, level, split, created, schedule: [{ name, slots: [{ exId, main, sets, lo, hi, rir, rest (s) }] }] }` (Liftlog's shape). `liftNext`: index of the next day. `liftDraft`: the session in progress, `{ dayIdx, day, started (ms), entries: [{ exId, slot, sets: [{ w, reps, rir (typed text, in the shown unit), done }] }] }` or null. `liftUnit`: `"kg"`|`"lb"`. `liftForm`: the plan toggles. `liftFocus`: the trend chart's exercise. `liftlogImport`: when Liftlog data was brought over, or `"dismissed"`.
- my food: `{ id, name, serving, grams|null, kcal, protein, fat, carbs, uses, lastUsed, createdAt }`.

Upgrades: `UPGRADES[n]` moves the database from version `n` to `n+1`, and opening runs every step from the stored version up. To add or change a store, bump that version number, append an upgrade step, and bump `SCHEMA` in `backup.js` to match. An upgrade step never drops or renames existing data: those records are on the owner's phone and in their backups.

If another tab opens a newer version, this tab closes its connection so the upgrade can run; an older tab that blocks an upgrade gets an error asking to close it.

The module exposes `get`, `getAll`, `getByIndex`, `put`, `putMany` (several records in one transaction), `del`, `getMeta`/`setMeta`, `storeNames`, `dumpAll` (every record of every store) and `replaceAll` (clear and refill the named stores in one transaction).

## Backup file

`backup.js` holds the format, as pure functions with unit tests (`tests/backup.test.mjs`):

```json
{
  "app": "genki",
  "schema": 5,
  "exportedAt": "2026-01-02T03:04:05.000Z",
  "stores": { "meta": [{ "key": "createdAt", "value": "..." }] }
}
```

`parseBackup` accepts a file only when it is JSON, `app` is `"genki"`, `schema` is a whole number from 1 up to the app's own `SCHEMA` (a newer file asks to update the app first), and `stores` maps store names this app knows to lists of objects. Each failure returns a message the sheet shows as is.

## Export and import

- Export: `dumpAll()` wrapped by `buildBackup()`, downloaded as a file, then `setMeta("lastExportAt")`.
- Import: `parseBackup()` against `storeNames()` and the key paths `db.js` exports (every record must carry its store's key), a confirm prompt, then `replaceAll()`. The replace is one transaction, so a failure part way (for example a record IndexedDB rejects; `replaceAll()` aborts the transaction) leaves the stored data untouched. Stores the file does not mention are left as they are. `lastImportAt` is set afterwards (best effort: a failure there does not undo the import).

An older backup (lower `schema`) is accepted as is today: a schema 1 file only has `meta`, so importing it replaces `meta` (including any saved profile) and leaves the food log, my foods and weigh-ins as they are (a schema 2 file has no weigh-ins and a schema 3 file no workouts and a schema 4 file no weekly history, so it leaves those as they are); once a later schema changes a record shape, `parseBackup` is where old files get migrated.

## MyFitnessPal import

A third way in, beside the backup file and sync: the Data & backup sheet reads a MyFitnessPal export's CSVs in the browser (`mfp.js`) and adds records with `putMany`, store by store: food-log entries, my foods, then weigh-ins. It only adds; it never replaces or clears a record. What it adds is in [nutrition.md](nutrition.md#myfitnesspal-import). No store or schema changed for it.

## Device-only store

A second database, `genki-device` (one store, `kv`, records `{ key, value }`), holds what belongs to this device and must never travel: `syncToken` (the GitHub token), `syncSha` (the version of `app/latest.json` this device last wrote or restored; set means linked), `lastSyncedAt`, `lastSyncError`. It is not part of `dumpAll()` or `replaceAll()`, so it is never in a backup, an export or the synced file, and an import or restore leaves it alone. `db.js` exposes `getDevice`, `setDevice` and `delDevice`. It has its own version (1) and needs no backup `SCHEMA` bump when it changes, since backups never carry it.
