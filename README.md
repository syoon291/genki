# genki

A personal nutrition and workout tracker for the phone, aimed at cutting weight while getting stronger. It runs in the browser as an installable web app at https://syoon291.github.io/genki/. This repo holds code only: personal data stays on the device.

## What it does

- Today at a glance: calories and protein left, the next workout, fasting, water and exercise trackers, and coach cards (today against targets, a protein week, this week against last, a biggest win, meal ideas that fit), all computed on the device.
- Nutrition: daily calorie, protein, carb and fat targets from your profile, and a food log by meal with servings, recents, my meals and recipes, quick add and built-in Japanese and US food tables. It imports MyFitnessPal exports.
- Weight and progress: weigh-ins with a 7-day average, a week overview, calorie, macro, nutrient and weight charts, and a week CSV export.
- Workouts: plan templates, set logging pre-filled from last time, a rest timer, personal records and volume charts (ported from Liftlog, whose data it can bring over).
- Works offline, installs to the home screen, backs up to a JSON file you keep, and can sync devices through a private data repo with a device-only GitHub token.
- Accessible by design: screen reader announcements and a High contrast setting.

## Surfaces and stack

- Web app (PWA): plain HTML, CSS and JavaScript, IndexedDB storage, a service worker for offline use, hosted on GitHub Pages.

## Next

- [Architecture](docs/architecture.md) - start here, it links every doc
- [Local development](docs/local-dev.md)
- [Deployment](docs/deployment.md)
