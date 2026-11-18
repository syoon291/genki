---
owns:
  - styles.css
  - icons/**
status: current
---

# Design System

Calm off-white and deep green, built for one-handed use on a phone. All values are CSS custom properties on `:root` in `styles.css`; components use the tokens, never raw colors.

## Color tokens

| Token | Role |
|-------|------|
| `--bg` | Page background (soft green-tinted off-white; near-black green in dark mode) |
| `--surface`, `--surface-2` | Cards and the sheet; secondary fills (ghost buttons, icon buttons) |
| `--ink`, `--muted` | Primary text; secondary text, labels and hints |
| `--line` | Borders and dividers (decorative) |
| `--field-line` | Input and select borders, at least 3:1 against the page so a field's edge is visible |
| `--accent`, `--accent-ink`, `--accent-soft`, `--accent-deep` | Primary buttons, the active tab, the brand dot; text on accent; soft accent fills; accent text on a soft accent fill (`.lift-pill`) |
| `--protein`, `--carbs`, `--fat` | Protein, carb and fat figures and bars (calories use the accent) |
| `--good`, `--bad` | Success and error messages |
| `--chart-2` | Secondary chart bars (outside the volume band, past weeks), 3:1 against the card |
| `--warn`, `--warn-soft` | Warnings: the "Storage is unavailable" banner, over-target figures and bars |

Text tokens meet 4.5:1 against the surfaces they sit on, and UI tokens (field borders, chart marks) 3:1, in both schemes. Check a new pairing before using it.

Dark mode follows the system (`prefers-color-scheme: dark`) and redefines the same tokens. `index.html` sets a matching `theme-color` per scheme; `manifest.webmanifest` uses the light background.

Shape and depth: `--radius` for cards, `--shadow` for raised surfaces, `--tabs-h` for the bottom bar height (safe-area insets are added on top). Icons are inline SVG line icons (stroke `currentColor`, 1.8 wide).

## Type

The system font stack at 16px. Screen titles (`h2`) 26px bold with tight tracking; section labels (`h3`) small uppercase muted; big numbers (`.stat-value`) 30px with tabular figures.

## Components

- **Card** (`.card`); `.empty` for placeholder and empty states; `.warn-card` for warnings.
- **Stat tile** (`.stat` in a `.grid2`): label, big number, hint.
- **Button** (`.btn`, full width, 48px tall; `.ghost` for secondary) and **icon button** (`.icon-btn`, 44px). Every tap target is at least 44px tall (toggles, `.range`, `.link-btn`, `.small-btn`, selects); only `.link-btn.inline` inside running text is exempt.
- **Bottom tabs** (`.tabs`): three equal columns, icon over label, active tab in the accent.
- **Sheet** (`dialog` + `.sheet`): bottom sheet on a phone, centered card from 640px; `.facts` for label/value rows and `.msg` (`.good`/`.bad`) for the status line. The general sheet scrolls inside itself up to 92% of the screen height; `.sheet-head .grow` takes a long title between a back and a close button. The Data & backup sheet scrolls the same way; its `.sync` section sits under a divider with an `h3` heading.
- **Progress bar** (`.bar`): accent fill for calories, `.protein`, `.carbs` and `.fat` for those macros, `.goal` (good color) for progress to the goal weight, `.over` turns it to the warning color past the target.
- **Day summary** (`.summary`, `.sum-row`, `.sum-big`, `.sum-left`, `.macros`) and **day navigation** (`.title-row`, `.day-nav`, `.day-label`).
- **List rows** (`.entries` of `.entry` / `.result` buttons): name with a hint line on the left, kcal with protein on the right; `.add-btn` is the dashed add button under each meal.
- **Forms** (`.form`, `.field`, `.seg` segmented radio, `.check` checkbox row, `.preview` live result box, `.btn.danger` for destructive actions, `.search`).
- **Weight chart** (`.chart`): inline SVG with `.grid` lines and `.tick` labels, `.dot-kg` weigh-in dots (muted), `.avg-line` the 7-day average (accent), `.goal-line` dashed (good), `.plan-line` dotted (muted); `.legend` keys under it; `.range` is the 1M / 3M / All toggle (`aria-pressed`).
- **Workouts** (`.lift-*`): `.lift-ex` exercise cards with `.lift-tip` (last / try) and `.lift-set` rows (set number, weight, reps, RIR inputs, `.lift-check` done button; `.done` tints the row), `.lift-pill` small accent badge, `.lift-kpis` number grid, `.lift-list` dashed list, `.lift-plan-day`; bar charts use `.lift-in` (accent) / `.lift-out` (`--chart-2`) / `.lift-band` (the 10-20 band); the trend reuses `.avg-line` and a dashed `.goal-line`. **Rest timer** (`.rest-timer`): a dark bar fixed above the tabs with a draining progress line. **Weekly history** (`.weeks` list of `.week` rows: dates and kcal a day, a hint line of macros). **Visually hidden** (`.visually-hidden`) for labels only screen readers need. `.btn:disabled` dims a button.
- **Faster logging**: `.days` fieldset with `.days-row` of seven `.day-tog` buttons (`aria-pressed`, the accent when on; disabled after today), `.meal-item` list rows with a trailing icon button (`.add-one` the one-tap add of a my meal, or a remove button in a recipe), `.meal-actions` (the add button with "Save as meal" beside it), `.more` disclosure (`details`) for the optional nutrients in a `.grid3`, `.pct-line` for the share of today's targets, `fieldset.plain` for a list of checkboxes with a legend.
- Text colors: `.protein-text`, `.carbs-text`, `.fat-text`, `.over-text` (warn), `.good-text`, `.bad-text`, `.warn-text`.

## App icon

`icons/icon.svg` (green rounded square, white ring and dot) with PNG renders at 180, 192 and 512 px. The PNGs are full-bleed green so the 512 one also works as a maskable icon (the ring sits inside the safe zone).

## Voice

Short, plain and friendly. Say what happens ("Importing replaces what is stored here"), no exclamation marks, no fitness-bro hype. Targets are guidelines, never medical advice.
