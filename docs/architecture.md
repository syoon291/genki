---
owns:
  - index.html
  - manifest.webmanifest
  - package.json
status: current
---

# genki - Architecture

## Overview

genki is a personal nutrition and workout tracker: an installable, offline-capable web app (PWA) built for a phone. It logs food against calorie and protein targets, tracks weigh-ins, and logs workouts against a plan, with one shared on-device store. There is no server, no account and no build step: the repo is the website, served by GitHub Pages. Personal data never enters this public repo; it stays in the browser's IndexedDB, in backup files the owner keeps, and (when the owner turns on sync) in their private repo genki-data.

The product plan and its decisions live in the owner's knowledge hub, not here. Built so far: the app shell (three tabs), the store, JSON backup, nutrition (profile, calorie, protein, carb and fat targets, the food log with search over bundled Japanese and US food tables, quick add and my foods), weigh-ins (7-day average, progress to goal, a chart, CSV import), and workouts ported from Liftlog (plan templates, set logging pre-filled from last time, a rest timer, PRs, strength trend and volume charts, Liftlog data import), and sync to the owner's private GitHub repo (sync now, daily sync, restore on a new phone).

## System Overview

| Surface | Path | Role |
|---------|------|------|
| Page shell | `index.html` | Header (brand, Data & backup button), the `<main id="view">` the app renders into, the polite live region `#announcer` that speaks view changes to screen readers (see [frontend.md](frontend.md#screen-reader-announcements)), the rest-timer bar, the three-tab bottom bar, the backup sheet `<dialog>`, PWA meta tags, the Content Security Policy meta (see [sync.md](sync.md#content-security-policy)) |
| App logic | `app.js`, `ui.js` | Tab routing (URL hash), view rendering, the Data & backup sheet; shared UI helpers and the general sheet. See [frontend.md](frontend.md) |
| Nutrition | `nutrition.js`, `foods.js`, `nutrition-view.js`, `foods/` | Targets maths and food search (pure, unit-tested), the Nutrition tab and its sheets, the bundled food tables. See [nutrition.md](nutrition.md) |
| Weight | `weight.js`, `weight-view.js` | Weigh-in maths and CSV parsing (pure, unit-tested), the Today tab's weight card, chart and sheets. See [weight.md](weight.md) |
| Workouts | `workouts.js`, `workouts-view.js` | Workout maths and the Liftlog migration (pure, unit-tested), the Workouts tab, the rest timer and the Today tab's next-workout card. See [workouts.md](workouts.md) |
| Store | `db.js` | IndexedDB wrapper: versioned upgrades, get/put/delete, dump and atomic replace; the separate device-only database for the sync token. See [data-flow.md](data-flow.md) |
| Sync | `sync.js`, `sync-view.js` | GitHub Contents API calls for `app/latest.json` in the private genki-data repo (pure, unit-tested with a mocked fetch), the Sync section of the Data & backup sheet and the daily sync. See [sync.md](sync.md) |
| Backup format | `backup.js` | Builds and validates the JSON export file; pure functions, unit-tested. See [data-flow.md](data-flow.md) |
| Styles | `styles.css` | Color tokens (light + dark), layout, components. See [design-system.md](design-system.md) |
| Offline + install | `sw.js`, `manifest.webmanifest`, `icons/` | Service worker caches the app for offline use; the manifest and icons make it installable. See [deployment.md](deployment.md) |
| Tests and checks | `tests/`, `scripts/`, `package.json` | Unit tests (Node's built-in runner), a fast repo check, and the food-table build script; `package.json` has no dependencies and only marks the scripts as ES modules. See [local-dev.md](local-dev.md) |

How they relate: `index.html` loads `styles.css` and `app.js` (an ES module), which imports `db.js`, `backup.js`, `ui.js`, `sync-view.js` (which imports `sync.js`), `weight-view.js` (which imports `weight.js`), `workouts-view.js` (which imports `workouts.js`) and `nutrition-view.js` (which imports `nutrition.js` and `foods.js`, and fetches the food tables from `foods/` on first use). On start, `app.js` opens the IndexedDB database (creating or upgrading it), renders the tab named in the URL hash, runs the daily sync when it is due, and registers `sw.js` when served over https.

## Repository Layout

```text
.
├── index.html             page shell + PWA meta
├── app.js                 tabs, views, backup sheet
├── ui.js                  shared UI helpers, general sheet
├── nutrition.js           targets maths (pure, tested)
├── foods.js               food search + units (pure, tested)
├── nutrition-view.js      Nutrition tab, Today tiles, food sheets
├── weight.js              weigh-in maths + CSV (pure, tested)
├── weight-view.js         Today weight card, chart, sheets
├── workouts.js            workout maths + Liftlog import (pure, tested)
├── workouts-view.js       Workouts tab, rest timer, Today card
├── foods/                 bundled food tables (built, committed)
├── db.js                  IndexedDB store
├── backup.js              export/import format (pure, tested)
├── sync.js                GitHub sync calls (pure, tested)
├── sync-view.js           Sync section, daily sync
├── styles.css             design tokens + components
├── sw.js                  service worker (offline cache)
├── manifest.webmanifest   install metadata
├── icons/                 app icons (svg + png sizes)
├── tests/                 unit tests (node --test)
├── scripts/               fast repo check, food-table build
├── package.json           test scripts only, no dependencies
├── .github/workflows/     CI + Pages deploy
├── docs/                  this documentation
├── AGENTS.md              agent orientation (CLAUDE.md links to it)
└── README.md              public face
```

## Tech Stack

- Plain HTML, CSS and JavaScript (ES modules), no framework, no dependencies, no bundler.
- IndexedDB for all user data; JSON export/import for backup; the GitHub Contents API for sync (the only network call besides this site).
- Service worker + web app manifest for offline use and "Add to Home Screen".
- Node's built-in test runner for unit tests; GitHub Actions for CI; GitHub Pages for hosting.

## Doc Index

| Doc | Scope |
|-----|-------|
| [Frontend](frontend.md) | Tabs, views, the general sheet, the Data & backup sheet |
| [Nutrition](nutrition.md) | Targets, the food log, adding food, the bundled food tables and their sources |
| [Weight](weight.md) | Weigh-ins, the 7-day average, progress to goal, the chart, CSV import |
| [Workouts](workouts.md) | Plans, set logging, progression, PRs and charts, the Liftlog migration |
| [Data Flow](data-flow.md) | The IndexedDB store, upgrades, the backup file format, export and import, the device-only store |
| [Sync](sync.md) | The token, sync now and the daily sync, restore, the Content Security Policy |
| [Design System](design-system.md) | Color tokens, type, components, voice of the copy |
| [Local Development](local-dev.md) | Running it locally, tests, gotchas (exact commands: `.claude/test-manifest.json`) |
| [Deployment](deployment.md) | CI, GitHub Pages, the service worker cache, release behavior |
| [docsic.json](docsic.json) | Machine-read release facts (not a document) |
| [gate.json](gate.json) | Docs gate config: files no doc needs to describe (not a document) |
| [worklog/](worklog/) | Ship log, one entry per PR (written by `/pr-create`) |
