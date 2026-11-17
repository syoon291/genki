---
owns:
  - scripts/**
  - .claude/test-manifest.json
status: current
---

# Local Development

## Prerequisites

- Any static file server. The manifest's dev server uses Python 3's built-in one.
- Node 22 or newer, for the unit tests and the fast check.

Nothing to install: no packages, no build, no env files.

## Setup

Clone and serve the repo root. Opening `index.html` straight from disk does not work, because module scripts need an http origin.

## Environment Variables

None.

## Running

Start the static server from `.claude/test-manifest.json` (`devServer`) and open its base URL. Data you enter is saved in that browser's IndexedDB for that origin, so a different port starts empty; use Export / Import in the Data & backup sheet to carry it over. To clear it, delete the site data in the browser's developer tools.

To try it on a phone, serve on your machine and open the machine's LAN address from the phone, or use the live site (see [deployment.md](deployment.md)). The service worker only registers over https, so offline behavior can only be tried on the live site.

## Checking changes

Two fast stacks, both in the manifest and both run by CI on every PR:

- **unit**: Node's built-in test runner over `tests/*.test.mjs`. Code that can run without a browser (formats, calculations) goes in its own module so it can be tested here.
- **check** (`scripts/check.mjs`): every script parses, the web manifest is valid and its icons exist, every file `sw.js` precaches exists, every module `app.js` imports is precached, and the Pages workflow copies every precached file into the site.

## Gotchas

- Public repo: test fixtures use made-up values only, never the owner's real data.
- A new file the app loads must go in three places: the `SHELL` list in `sw.js`, the copy step in the Pages workflow, and (if it is a module) an import the check can see. The check catches the first two.
