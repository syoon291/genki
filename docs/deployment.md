---
owns:
  - sw.js
  - .github/**
status: current
---

# Deployment

## Targets

GitHub Pages, published by the `Pages` GitHub Actions workflow (`.github/workflows/pages.yml`; the repo's Pages source is set to "GitHub Actions"). The public URL is in `docs/docsic.json` (`release.url`). The repo is public, so its source is readable by anyone, but only the app files are on the site, and no personal data is ever in either.

## CI and build

No compile step. The workflow's build job runs on every pull request and every push to `main`: the unit tests, the fast check, then it copies an explicit list of app files (`index.html`, the JS modules (including `sync.js`, `merge.js`, `sync-view.js`, `contrast.js`, `progress.js`, `progress-view.js`, `trackers.js`, `trackers-view.js`, `coach.js` and `coach-view.js`), `styles.css`, `sw.js`, `manifest.webmanifest`, `icons/`, and `foods/` with the food tables) into `_site/` and uploads it. Docs, tests, scripts and repo tooling are not published.

A merge to `main` is the release: the deploy job publishes that artifact and the site updates within a minute or two. A manual run (`workflow_dispatch`) redeploys main. Pull requests never deploy.

## How updates reach the phone

The service worker (`sw.js`) caches the app shell on install and then serves every same-origin GET **network first** (revalidating past Pages' 10-minute HTTP cache), refreshing the cache from each response and falling back to the cache only when offline. So:

- The shell includes the food tables, so food search works offline after the first online open (install downloads about 1 MB once).
- An installed app picks up new code the next time it opens online; no cache-name bump is needed for ordinary changes.
- Only this site's files go through the service worker: sync's calls to `api.github.com` and barcode lookups on Open Food Facts always go to the network (and fail offline, which the Sync section and the scan's save step report).
- Offline, it serves the last cached copy; an uncached page navigation falls back to `index.html`, any other uncached file fails as a network error.
- Changing the cache name (`CACHE` in `sw.js`) makes the next activation delete every older cache. Do that only when old cached files must be dropped, for example after removing or renaming a shell file.

User data is in each device's IndexedDB and is untouched by deploys. A store change ships with an upgrade step (see [data-flow.md](data-flow.md#store)), which runs the first time the new code opens.
