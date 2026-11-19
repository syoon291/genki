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
- **check** (`scripts/check.mjs`): every script parses, the web manifest is valid and its icons exist, every file `sw.js` precaches exists, every module the app imports is precached, every food table the app fetches is precached and well formed, the Pages workflow copies every precached file into the site, `index.html`'s Content Security Policy keeps `script-src 'self'` and `connect-src 'self' https://api.github.com https://world.openfoodfacts.org`, the page has no inline or remote script and no inline event handler, only `sync.js` calls the GitHub API, only `openfoodfacts.js` calls Open Food Facts, and the color tokens in `styles.css` meet their contrast floors in all four themes (`scripts/contrast.mjs`; floors in [design-system.md](design-system.md)).

## Food tables

`foods/jp.json` and `foods/us.json` are built files, committed. To rebuild them after a source update, download the three sources named at the top of `scripts/build-foods.mjs` into one folder (the MEXT 2020 sheet as `mext2020.xlsx`, the 2015 English sheet as `mext2015en.xlsx`, the USDA SR Legacy CSV zip unzipped as `sr/`), then run the script from the repo root with that folder as its argument. It needs `unzip` on the path (`scripts/xlsx.mjs` reads the spreadsheets with it) and no packages. Review the diff: one food per line. What the script keeps and why is in [nutrition.md](nutrition.md#food-tables).

## Gotchas

- Public repo: test fixtures use made-up values only, never the owner's real data.
- A new file the app loads must go in three places: the `SHELL` list in `sw.js`, the copy step in the Pages workflow, and (if it is a module) the `MODULES` list in `scripts/check.mjs`. The check catches the first two.
- The food tables are fetched on first use of the add-food sheet; on a fresh origin that is about 1 MB (about 200 KB compressed on Pages).
