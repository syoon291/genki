---
owns:
  - workouts.js
  - workouts-view.js
status: current
---

# Workouts

The Workouts tab is a port of Liftlog, the workout planner on the owner's website (`syoon291.github.io/workout/`). Liftlog itself is unchanged and keeps working; genki can bring its data over (below). The tab has three parts, picked with a Train / Progress / Plan toggle (Train when a plan exists, Plan otherwise; the choice resets on reload).

| File | Role |
|------|------|
| `workouts.js` | Exercise library, plan generator, double progression, estimated 1RM, sets per muscle, weekly volume, records, the CSV, drafts, the Liftlog migration. Pure, unit-tested (`tests/workouts.test.mjs`) |
| `workouts-view.js` | The tab's three views and charts, the rest timer, the Today tab's "Next workout" card, and their handlers (acts starting `lift-`) |

## Plan

Four toggles (goal: strength / muscle / general; 2-6 days a week; equipment: full gym / dumbbells / bodyweight; experience) generate a plan straight away; "Use this plan" saves it. Days per week set the split: 2-3 full body, 4 upper/lower, 5 push/pull/legs plus upper/lower, 6 push/pull/legs twice. Each day is a template of movement patterns; each pattern takes the best exercise the equipment allows, and a repeated day rotates to a variant. The goal sets sets, rep range, reps in reserve (RIR) and rest for main lifts and accessories; beginners get one set fewer, advanced lifters one more accessory set; bodyweight exercises use a higher rep range.

The **volume check** charts planned hard sets per muscle a week (1 per primary muscle, 0.5 per assisting one) against a shaded 10-20 band, and names muscles under or over it. Switching plans keeps logged sessions and drops a session in progress (after a confirm).

**Settings and data**: the weight unit (kg or lb; weights are stored in kg, lb only changes what is shown and typed; switching it converts the weights already typed in a session in progress, to 0.1 of the new unit so toggling back and forth never drifts), **Export CSV** (one row per set: date, session, exercise, pattern, set, weight, reps, rir, e1rm, primary muscles) and **Import Liftlog file**.

## Train

The plan's days, with the next one in the rotation marked. Starting a day creates a session in progress (the draft) with a card per exercise:

- **Last** shows the last session's sets of that exercise; **Try** gives the progression suggestion. Set rows are pre-filled with the suggested weight; the reps and RIR placeholders show the targets.
- Progression is double progression: stay at a weight until every set reaches the top of the rep range, then add the exercise's smallest jump (0.5-5 kg); most sets below the range drops about 10%; bodyweight work adds a rep.
- A swap menu offers the other exercises of the same pattern that the plan's equipment allows (the suggestion follows the new exercise).
- The check button marks a set done; on an empty row it logs the placeholders. Marking a set done starts the rest timer: a bar above the tabs with +30 s and Skip, vibrating at zero where the phone allows. Screen readers hear the set logged (weight × reps and the rest), and on finish the session's sets and new PRs ([frontend.md](frontend.md#screen-reader-announcements)).
- Every keystroke is saved, so a reload or a closed app keeps the session.
- **Finish and save** keeps rows with reps above 0 (blank RIR takes the target), stores the session, moves the rotation on, and shows a summary with sets, load moved, minutes and new PRs. **Discard** drops it.

The Today tab shows the next day with a Start button, or "Workout in progress" with Continue.

## Progress

Sessions in the last 28 days and per week, load moved in the last 7 days against the 7 before, PRs in the last 28 days; then:

- **Strength trend**: the best estimated one-rep max per session for a chosen weighted exercise, with a least-squares trend line (from 3 sessions), the latest, the best and the slope a week with R².
- **Recent PRs**: a session whose best estimated 1RM beats every earlier session of that exercise.
- **Sets per muscle, last 7 days**, with the plan's weekly target as a tick.
- **Weekly volume**: weight × reps per Monday-start week, 12 weeks.
- **Consistency**: a 16-week day grid shaded by sets.
- **History**: the last 20 sessions, each deletable.

Estimated 1RM is Epley, weight × (1 + reps ÷ 30), counting RIR as reps you could have done, capped at 15.

## Storage

Finished sessions are in the `workouts` store; the plan, rotation position, draft, unit, plan form and the chart's exercise are `meta` keys starting `lift` (shapes in [data-flow.md](data-flow.md#store)). All of it is in the JSON backup.

## Liftlog migration

Liftlog kept one JSON object in `localStorage` under `liftlog.v1`, and its backup file is the same object. genki on GitHub Pages shares the website's origin, so it can read that key directly: when it holds sessions genki does not have (or a plan while genki has none), the Workouts tab offers to bring them over. Sessions are added by id (never twice, never replacing genki's); the plan, rotation and unit are taken only when genki has no plan yet. "Not now" or an import hides the offer for good (deleting an imported session does not bring it back); the imported plan is rebuilt field by field (numbers clamped, goal, equipment and level checked against the allowed values), so a hand-edited file cannot inject markup; a Liftlog backup file can still be imported from Plan's settings. Imported sessions carry `source: "liftlog"`. genki never writes to Liftlog's key.
