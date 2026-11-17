---
owns:
  - index.html
  - manifest.webmanifest
  - package.json
status: current
---

# genki - Architecture

## Overview

genki is a personal nutrition and workout tracker: an installable, offline-capable web app (PWA) built for a phone. It logs food against calorie and protein targets, tracks weigh-ins, and logs workouts against a plan, with one shared on-device store. There is no server, no account and no build step: the repo is the website, served by GitHub Pages. Personal data never enters this public repo; it stays in the browser's IndexedDB and in backup files the owner keeps.

The product plan and its decisions live in the owner's knowledge hub, not here. Built so far: the app shell (three tabs), the store, and JSON backup. Nutrition and workout features arrive in later phases.

## System Overview

| Surface | Path | Role |
|---------|------|------|
| Page shell | `index.html` | Header (brand, Data & backup button), the `<main id="view">` the app renders into, the three-tab bottom bar, the backup sheet `<dialog>`, PWA meta tags |
| App logic | `app.js` | Tab routing (URL hash), view rendering, the Data & backup sheet. See [frontend.md](frontend.md) |
| Store | `db.js` | IndexedDB wrapper: versioned upgrades, get/put/delete, dump and atomic replace. See [data-flow.md](data-flow.md) |
| Backup format | `backup.js` | Builds and validates the JSON export file; pure functions, unit-tested. See [data-flow.md](data-flow.md) |
| Styles | `styles.css` | Color tokens (light + dark), layout, components. See [design-system.md](design-system.md) |
| Offline + install | `sw.js`, `manifest.webmanifest`, `icons/` | Service worker caches the app for offline use; the manifest and icons make it installable. See [deployment.md](deployment.md) |
| Tests and checks | `tests/`, `scripts/check.mjs`, `package.json` | Unit tests (Node's built-in runner) and a fast repo check; `package.json` has no dependencies and only marks the scripts as ES modules. See [local-dev.md](local-dev.md) |

How they relate: `index.html` loads `styles.css` and `app.js` (an ES module), which imports `db.js` and `backup.js`. On start, `app.js` opens the IndexedDB database (creating or upgrading it), renders the tab named in the URL hash, and registers `sw.js` when served over https.

## Repository Layout

```text
.
├── index.html             page shell + PWA meta
├── app.js                 tabs, views, backup sheet
├── db.js                  IndexedDB store
├── backup.js              export/import format (pure, tested)
├── styles.css             design tokens + components
├── sw.js                  service worker (offline cache)
├── manifest.webmanifest   install metadata
├── icons/                 app icons (svg + png sizes)
├── tests/                 unit tests (node --test)
├── scripts/check.mjs      fast repo check
├── package.json           test scripts only, no dependencies
├── .github/workflows/     CI + Pages deploy
├── docs/                  this documentation
├── AGENTS.md              agent orientation (CLAUDE.md links to it)
└── README.md              public face
```

## Tech Stack

- Plain HTML, CSS and JavaScript (ES modules), no framework, no dependencies, no bundler.
- IndexedDB for all user data; JSON export/import for backup.
- Service worker + web app manifest for offline use and "Add to Home Screen".
- Node's built-in test runner for unit tests; GitHub Actions for CI; GitHub Pages for hosting.

## Doc Index

| Doc | Scope |
|-----|-------|
| [Frontend](frontend.md) | Tabs, views, the Data & backup sheet |
| [Data Flow](data-flow.md) | The IndexedDB store, upgrades, the backup file format, export and import |
| [Design System](design-system.md) | Color tokens, type, components, voice of the copy |
| [Local Development](local-dev.md) | Running it locally, tests, gotchas (exact commands: `.claude/test-manifest.json`) |
| [Deployment](deployment.md) | CI, GitHub Pages, the service worker cache, release behavior |
| [docsic.json](docsic.json) | Machine-read release facts (not a document) |
| [gate.json](gate.json) | Docs gate config: files no doc needs to describe (not a document) |
| [worklog/](worklog/) | Ship log, one entry per PR (written by `/pr-create`) |
