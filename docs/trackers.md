---
owns:
  - trackers.js
  - trackers-view.js
status: current
---

# Day trackers

Fasting, water and exercise on the Today tab, under the calorie tiles. The maths is in `trackers.js` (pure, unit-tested in `tests/trackers.test.mjs`); the cards and sheets are in `trackers-view.js`. A web app cannot set phone reminders or read Apple Health, so the planned fast start shows inside the app only, and exercise is typed in or imported from MyFitnessPal.

| File | Role |
|------|------|
| `trackers.js` | Fasting plans, the planned window, a fast's status, the streak, time checks; water and exercise limits; net calories; the screen-reader messages |
| `trackers-view.js` | The Fasting card and its live timer, the Water and Exercise cards, the plan, history, fast, water goal and exercise sheets, and the exercise / net line on the Nutrition tab |

## Fasting

- **Plan** (Plan button): 12:12, 14:10, 16:8 or a custom length (1-72 whole hours), and a planned start time (default 16:8 from 20:00). The sheet shows the fasting and eating windows it gives. Stored as meta `fastPlan` `{ hours, startTime }`.
- **The card** shows the plan, its next window (today's window counts until its planned end has passed, or until a fast has ended inside it or after its start) and the streak. Once the planned start has passed and no fast runs, a reminder box says it is time to start.
- **Start fast** saves a fast that starts now with the plan's length as its goal; a running fast keeps that goal even if the plan changes. While it runs the card shows a live clock (updated in place every second, `role="timer"`, never announced), a progress bar, when the goal is reached and how long is left, and **End fast** (asks first when the goal is not reached yet) and **Change start time** (for a fast started late in the app).
- **History**: finished fasts, newest first, with the streak and how many reached their goal. Tap one to change its start, end or goal, or delete it; **Add a past fast** logs one after the fact. Times cannot be in the future, the end must follow the start, and a fast is at most 7 days.
- **Streak**: days in a row, counted by the local day a fast ended, with a fast that reached its goal. A streak still counts through yesterday when today has none yet.

## Water

A glasses counter for today with − and + buttons (0 to 40) and a daily goal (default 8, meta `waterGoal`, set from the card's goal link). The bar turns the good color at the goal.

## Exercise

Calories burned and steps for a day (Log exercise / Change opens the sheet; any day up to today). The card shows net calories, food eaten minus exercise burned, beside the food total; the Nutrition tab's day summary shows the same line for the day it shows. Targets do not change: the profile's activity level already counts everyday movement, so exercise is not "eaten back". Clearing removes the day's exercise and keeps its water.

The MyFitnessPal import reads the Exercise-Summary file too: each day's exercise calories and steps are added up and fill days that have no exercise yet (marked `exerciseSource: "mfp"`; saving the day by hand drops the mark). See [nutrition.md](nutrition.md#myfitnesspal-import).

## Data

Two stores (version 8, backup schema 8; shapes in [data-flow.md](data-flow.md#store)): `days`, one record per local day for water and exercise, and `fasts`. Both go through `put`/`del`, so they are stamped for sync and in every backup and restore. No older record changed shape, so old backups import as they are.

## Screen-reader announcements

Water changes ("Water 5 of 8 glasses."), a fast started, ended, changed or deleted (with its length against the goal), the plan and water goal saved, and exercise saved or cleared (with net calories) are spoken through the polite live region (`waterMessage`, `fastMessage`, `exerciseMessage` in `trackers.js`).
