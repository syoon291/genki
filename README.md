# genki

A personal nutrition and workout tracker for the phone, aimed at cutting weight while getting stronger. It runs in the browser as an installable web app at https://syoon291.github.io/genki/. This repo holds code only: personal data stays on the device.

## What it does

- Today at a glance: calories and protein left, and the next workout.
- Nutrition: daily calorie and protein targets from your profile, and a food log by meal with quick add, saved foods and built-in Japanese and US food tables.
- Workouts: plan-based lifting log with records and volume (in progress).
- Works offline, installs to the home screen, and backs up to a JSON file you keep.

## Surfaces and stack

- Web app (PWA): plain HTML, CSS and JavaScript, IndexedDB storage, a service worker for offline use, hosted on GitHub Pages.

## Next

- [Architecture](docs/architecture.md) - start here, it links every doc
- [Local development](docs/local-dev.md)
- [Deployment](docs/deployment.md)
