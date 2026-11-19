---
owns:
  - coach.js
  - coach-view.js
status: current
---

# Coach cards

Two cards on the Today tab, under the "Log food" button, with a "Coach" heading. They are worked out on the phone from what is already stored: no AI, no API key, nothing leaves the device. They only read (one tap adds food), so they add no store and nothing new to backups or sync; a food added from a card is an ordinary log entry.

| File | Role |
|------|------|
| `coach.js` | Pure maths and wording, unit-tested in `tests/coach.test.mjs`: today against the targets, protein this week, this week against last week, the biggest win, meal ideas |
| `coach-view.js` | The two cards, and the one-tap add of a meal idea (`c-add`) |

## Today

One sentence on today's calories and protein against the targets (`todayCoach`), picked in this order:

| When | Says |
|------|------|
| Nothing logged today | The calories and protein there are to fill |
| Calories over the target | How far over (in the warning color), protein still needed if any, and that the week's average is what moves the weight |
| Protein target reached | How many calories are left |
| Protein behind: at least 30 % of calories eaten and the protein share 15 points or more behind the calorie share | Both shares, and to pick protein-rich foods for the calories left |
| Otherwise | On track, with the calories and protein left |

**Meal ideas that fit** (`mealIdeas`): up to three of my foods (one serving) and my meals (as saved) whose calories fit what is left of today, ranked by how much of the protein still needed they cover per calorie, with a small lift for the ones used most. Once protein is reached they are ranked by use. Each row shows its calories, protein and what it leaves; its + button logs it to today: a my food to the meal for the time of day, a my meal to its own meal slot when it has one. It counts as a use (`uses`, `lastUsed`) like logging from the add sheet, and screen readers hear what was added and the day's totals (`dayTotalsMessage`). No ideas show under 50 kcal left. Without a profile the card points to the Nutrition tab's profile instead.

## This week

Monday to today, over logged days only (days with at least one entry), as on the Progress tab.

- **Biggest win** (`biggestWin`), in a soft accent box: the strongest of a new lift record (from `records()` in `workouts.js`; an imported exercise is named from the `exercises` store), the 7-day weight average moving 0.2 kg or more toward the profile's goal since a week ago, protein target days (3 or more), calorie days within the target (at or under it and at least 70 % of it; 3 or more), workouts done (2 or more), fasts finished at their goal (2 or more), water goal days (3 or more), and days with food logged (3 or more). Left out when none applies.
- **Protein target**: the days it was reached (rounded to the gram) of the logged days, and the daily average against the target. Needs a profile.
- **Calories** and **Protein**: the daily averages this week, and how much more or less than last week's (all of last week).
- **Weight**: the 7-day average today against a week ago, in kg with lb.

With nothing to show yet, the card says that it fills in after a few logged days.
