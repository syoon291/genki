---
owns:
  - db.js
  - backup.js
  - merge.js
status: current
---

# Data Flow

All user data lives in the browser, in one IndexedDB database. It leaves the device only as a backup file the owner exports, or as the same file synced to the owner's private GitHub repo when they turn sync on ([sync.md](sync.md)).

## Store

`db.js` opens the database `genki` at the version number set at the top of the file. Object stores today:

| Store | Key | Holds |
|-------|-----|-------|
| `meta` | `key` | Small app facts and settings as `{ key, value }`: `createdAt` (first open), `lastExportAt`, `lastImportAt`, `profile` (below), `fastPlan` and `waterGoal` (the day trackers, [trackers.md](trackers.md)), and the workout state: `liftPlan`, `liftNext`, `liftDraft`, `liftUnit`, `liftForm`, `liftFocus`, `liftlogImport`, and `scanUnit` (`"lb"`|`"kg"`, the unit body scans are typed in) |
| `entries` | `id` | The food log, one record per food eaten; index `date` (local day `YYYY-MM-DD`) (version 2) |
| `myFoods` | `id` | The owner's saved foods, nutrients per serving (version 2) |
| `weighIns` | `date` | Weigh-ins, at most one per local day (version 3). See [weight.md](weight.md) |
| `workouts` | `id` | Finished workout sessions (version 4). See [workouts.md](workouts.md) |
| `nutritionWeeks` | `weekStart` | Imported weekly nutrition averages, read-only history (version 5). See [nutrition.md](nutrition.md#weekly-history) |
| `deleted` | `id` | Tombstones, one per deleted record, so sync carries deletes (version 6): `{ id: "<store>:<key as JSON>", store, key, at (ISO time deleted), mergedInto? }`; `mergedInto` (the kept id) marks a my food that sync folded into another with the same barcode, an optional field, so no store or backup schema change came with it. See [sync.md](sync.md#how-the-merge-decides) |
| `myMeals` | `id` | My meals: several foods saved as one item (version 7). See [nutrition.md](nutrition.md#my-meals) |
| `days` | `date` | Day trackers, one record per local day: water and exercise (version 8). See [trackers.md](trackers.md) |
| `fasts` | `id` | Fasts, finished and running (version 8). See [trackers.md](trackers.md#fasting) |
| `exercises` | `id` | The owner's own exercises, from an imported workout history: `{ id: "x-<slug>", name }` (version 9). See [workouts.md](workouts.md#workout-history-import) |
| `bodyScans` | `id` | Body composition scans (InBody-style printouts), kept apart from the weigh-ins (version 10). See [weight.md](weight.md#body-scans) |

Every record written through `put`, `putMany` or `setMeta` also carries `editedAt` (ISO time of that write), which sync's merge uses to keep the newer edit. Records written before version 6 have none until their next edit; the merge reads their own time instead.

Record shapes (what each field means is in [nutrition.md](nutrition.md)):

- `profile`: `{ sex: "female"|"male", birthYear, heightCm, weightKg, activity, goalKg|null, targetDate: "YYYY-MM-DD"|null, deficit, proteinPerKg, macroMode: "pct"|"g"|null, carbPct, fatPct (with "pct"), carbG, fatG (with "g"), updatedAt }`. `weightKg` follows the weigh-ins once there are any.
- weigh-in: `{ date: "YYYY-MM-DD", kg (0.1 kg steps), at (ISO time logged) }`.
- body scan: `{ id: "scan-<date>[T<HH:MM>]", date: "YYYY-MM-DD", time: "HH:MM"|null, unit: "lb"|"kg" (as typed), weightKg, smmKg, fatKg, leanKg (kg, 3 decimals), pbf (%), vfa (cm²), bmr (kcal), ecwTbw (ratio), at (ISO time saved) }`; every number but `weightKg` may be null.
- entry: `{ id, date, meal: "breakfast"|"lunch"|"dinner"|"snacks", name, source: "jp"|"us"|"my"|"quick"|"mfp", ref (table or my-food id, or null), amount, unit ("g", a portion label, or "serving"), base: { kcal, protein, fat, carbs, fiber?, sugar?, sodium? } per one unit, createdAt }` (fiber and sugar in g, sodium in mg, present only when known). The nutrients eaten are `base x amount`; an entry copies its numbers, so editing or deleting a my food never changes logged days. A MyFitnessPal meal total (`source: "mfp"`, id `mfp-<date>-<meal>`, unit `"1 meal"`, see [nutrition.md](nutrition.md#myfitnesspal-import)) is the one entry with a fixed id, so a re-import finds it.
- weekly history: `{ weekStart, weekEnd ("YYYY-MM-DD"), kcal (a day), protein, carbs, fat, fiber (g a day), proteinPct, carbPct, fatPct (each a number or null), source: "csv", at (ISO time imported) }`.
- workout session: `{ id, date (ISO time finished), day (plan day name), sets: [set], minutes?, note?, source?: "liftlog"|"history" }`. A set: `{ exId (library id in workouts.js, or an `exercises` id), w (kg, 3 decimals so pounds read back exactly; 0 for bodyweight), reps (may be fractional: 7.4), rir|null, extra?, hard?, drop?, side?: "L"|"R", repsL?, repsR?, bw?, note? }` (the optional fields are the rep notation, [workouts.md](workouts.md#rep-notation); version 9). A history session has id `h-<date>-<n>`, a local-noon `date` and no `minutes`.
- `liftPlan`: `{ goal, days, equip, level, split, created, schedule: [{ name, slots: [{ exId, main, sets, lo, hi, rir, rest (s) }] }] }` (Liftlog's shape). `liftNext`: index of the next day. `liftDraft`: the session in progress, `{ dayIdx, day, started (ms), entries: [{ exId, slot, sets: [{ w, reps, rir (typed text, in the shown unit), done }] }] }` or null. `liftUnit`: `"kg"`|`"lb"`. `liftForm`: the plan toggles. `liftFocus`: the trend chart's exercise. `liftlogImport`: when Liftlog data was brought over, or `"dismissed"`.
- my food: `{ id, name, brand?, serving, grams|null, kcal, protein, fat, carbs, fiber|null, sugar|null, sodium|null, uses, lastUsed, createdAt, recipe?, importedAt?, barcode? }`. `barcode` (digits, 13 or 8, see [nutrition.md](nutrition.md#barcode-scan)) is set on foods saved from a scan; it is an optional field, so no store or backup schema change came with it. Older records lack the three optional nutrients, which reads the same as null. A recipe adds `recipe: { servings, items: [item] }`; its numbers are the items' total per serving.
- day: `{ date: "YYYY-MM-DD", water (glasses, 0-40), exerciseKcal|null, steps|null, exerciseSource?: "mfp" }` (null: not logged).
- fast: `{ id, start (ISO), end (ISO, null while running), goalHours }`. `fastPlan`: `{ hours (1-72), startTime: "HH:MM" }`. `waterGoal`: glasses a day.
- my meal: `{ id, name, items: [item], uses, lastUsed, createdAt, meal?, importedAt? }` (`meal`: the meal it was saved from, or the one Import My foods gave; older records lack it. `importedAt` from Import My foods). An item (of a my meal or a recipe) is an entry without its day, meal or id: `{ name, source, ref, amount, unit, base }`.

Upgrades: `UPGRADES[n]` moves the database from version `n` to `n+1`, and opening runs every step from the stored version up. To add or change a store, bump that version number, append an upgrade step, and bump `SCHEMA` in `backup.js` to match. An upgrade step never drops or renames existing data: those records are on the owner's phone and in their backups.

If another tab opens a newer version, this tab closes its connection so the upgrade can run; an older tab that blocks an upgrade gets an error asking to close it.

The module exposes `get`, `getAll`, `getByIndex`, `put`, `putMany` (several records in one transaction; both stamp `editedAt`), `del`/`delMany` (delete and leave a tombstone per record, in one transaction), `getMeta`/`setMeta`, `storeNames`, `dumpAll` (every record of every store, tombstones included), `replaceAll` (clear and refill the named stores in one transaction, and always reset the tombstones to the file's own, none when it has none; no stamps, no new tombstones) and `applyChanges` (write a sync merge's changes, skipping records edited since the merge began, and returning `{ applied, skipped }`; [sync.md](sync.md#how-the-merge-decides)). Code that removes records uses `del`/`delMany`, never `replaceAll` with an empty list, or sync would bring them back.

## Backup file

`backup.js` holds the format, as pure functions with unit tests (`tests/backup.test.mjs`):

```json
{
  "app": "genki",
  "schema": 10,
  "exportedAt": "2026-01-02T03:04:05.000Z",
  "stores": { "meta": [{ "key": "createdAt", "value": "..." }] }
}
```

`parseBackup` accepts a file only when it is JSON, `app` is `"genki"`, `schema` is a whole number from 1 up to the app's own `SCHEMA` (a newer file asks to update the app first), and `stores` maps store names this app knows to lists of objects. Each failure returns a message the sheet shows as is.

## Export and import

- Export: `dumpAll()` wrapped by `buildBackup()`, downloaded as a file, then `setMeta("lastExportAt")`.
- Import: `parseBackup()` against `storeNames()` and the key paths `db.js` exports (every record must carry its store's key), a confirm prompt, then `replaceAll()`. The replace is one transaction, so a failure part way (for example a record IndexedDB rejects; `replaceAll()` aborts the transaction) leaves the stored data untouched. Stores the file does not mention are left as they are, except the tombstones (`deleted`), which are always reset to the file's (none for a file without them), so this device's old deletes cannot drop imported records on the next sync. `lastImportAt` is set afterwards (best effort: a failure there does not undo the import).

An older backup (lower `schema`) is accepted as is today: a schema 1 file only has `meta`, so importing it replaces `meta` (including any saved profile) and leaves the food log, my foods and weigh-ins as they are (a schema 2 file has no weigh-ins and a schema 3 file no workouts and a schema 4 file no weekly history and a schema 6 file no my meals and a schema 7 file no day trackers, so it leaves those as they are; a schema 5 file has no tombstones, so importing it clears the device's). Schemas 6, 7, 8, 9 and 10 changed no record shape in a way old records break (`editedAt` is an added field, and a record without it still merges; 7 only adds `myMeals`, 8 only `days` and `fasts`, 9 adds `exercises` and optional set fields that an older set simply lacks), so no migration is needed (a schema 8 file has no `exercises`, so importing it leaves them as they are; 10 only adds `bodyScans`, and a schema 9 file leaves them as they are); once a later schema changes a record shape, `parseBackup` is where old files get migrated.

## MyFitnessPal import

A third way in, beside the backup file and sync: the Data & backup sheet reads a MyFitnessPal export's CSVs in the browser (`mfp.js`) and adds records with `putMany`, store by store: food-log entries, my foods, then weigh-ins. It only adds, apart from filling in fiber, sugar and sodium on entries and my foods an earlier import made (the rest of the record kept); it never clears a record. What it adds is in [nutrition.md](nutrition.md#myfitnesspal-import). Its exercise rows fill the `days` store (version 8). **Import My foods** ([nutrition.md](nutrition.md#import-my-foods)) is the same kind of add-only path into `myFoods` and `myMeals`.

## Device-only store

A second database, `genki-device` (one store, `kv`, records `{ key, value }`), holds what belongs to this device and must never travel: `syncToken` (the GitHub token), `syncSha` (the version of `app/latest.json` this device last wrote or restored; set means linked), `lastSyncedAt`, `lastSyncError`. It is not part of `dumpAll()` or `replaceAll()`, so it is never in a backup, an export or the synced file, and an import or restore leaves it alone. `db.js` exposes `getDevice`, `setDevice` and `delDevice`. It has its own version (1) and needs no backup `SCHEMA` bump when it changes, since backups never carry it.
