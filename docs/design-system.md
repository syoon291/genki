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
| `--line` | Card edges and dividers: at least 1.4:1 against the page and the card so a card's edge shows |
| `--field-line` | Borders that outline a control (inputs, selects, the dashed add button, the set check, the danger button), at least 3:1 against every surface |
| `--accent`, `--accent-ink`, `--accent-soft`, `--accent-deep` | Primary buttons, the active tab, the brand dot; text on accent; soft accent fills; accent text on a soft accent fill (`.lift-pill`) |
| `--protein`, `--carbs`, `--fat` | Protein, carb and fat figures and bars (calories use the accent) |
| `--good`, `--bad` | Success and error messages |
| `--chart-2` | Secondary chart bars (outside the volume band, past weeks), 3:1 against the card |
| `--warn`, `--warn-soft` | Warnings: the "Storage is unavailable" banner, over-target figures and bars |

Contrast floors, checked in CI by `scripts/contrast.mjs` (part of the fast check) against `--bg`, `--surface` and `--surface-2` in every theme:

| Pairing | Standard | High contrast |
|---------|----------|---------------|
| `--ink`, `--muted` text | 7:1 | 10:1 |
| Colored text (`--accent`, macros, `--good`, `--bad`, `--warn`), also as bar fills | 4.5:1 | 7:1 |
| `--field-line`, `--chart-2` | 3:1 | 4.5:1 |
| `--line` (against page and card) | 1.4:1 | 3:1 |

Plus text on fills: `--accent-ink` on `--accent`, `--accent-deep` on `--accent-soft`, `--ink` on `--accent-soft` / `--warn-soft`, `--warn` on `--warn-soft`. Tune a token by changing its lightness, never its hue, and keep macro figures labelled in words (protein, carbs, fat) so color is never the only cue. A new color pairing gets a row in `scripts/contrast.mjs`.

**High contrast** (`contrast.js`): a per-device setting in the Data & backup sheet (Match phone / On / Off; stored in localStorage, not in backups or sync). Match phone follows `prefers-contrast: more` (iOS Increase Contrast). When on, `<html data-contrast="more">` switches to the stronger token blocks under `:root[data-contrast="more"]`; the light and dark blocks set the same tokens so the dark one fully replaces the light one.

Dark mode follows the system (`prefers-color-scheme: dark`) and redefines the same tokens. `index.html` sets a matching `theme-color` per scheme; `manifest.webmanifest` uses the light background.

Shape and depth: `--radius` for cards, `--shadow` for raised surfaces, `--tabs-h` for the bottom bar height (safe-area insets are added on top). Icons are inline SVG line icons (stroke `currentColor`, 1.8 wide).

## Type

The system font stack at 16px. Screen titles (`h2`) 26px bold with tight tracking; section labels (`h3`) small uppercase muted; big numbers (`.stat-value`) 30px with tabular figures.

## Components

- **Card** (`.card`); `.empty` for placeholder and empty states; `.warn-card` for warnings.
- **Stat tile** (`.stat` in a `.grid2`): label, big number, hint.
- **Button** (`.btn`, full width, 48px tall; `.ghost` for secondary) and **icon button** (`.icon-btn`, 44px). Every tap target is at least 44px tall (toggles, `.range`, `.link-btn`, `.small-btn`, selects); only `.link-btn.inline` inside running text is exempt.
- **Bottom tabs** (`.tabs`): four equal columns, icon over label, active tab in the accent.
- **Sheet** (`dialog` + `.sheet`): bottom sheet on a phone, centered card from 640px; `.facts` for label/value rows and `.msg` (`.good`/`.bad`) for the status line. The general sheet scrolls inside itself up to 92% of the screen height; `.sheet-head .grow` takes a long title between a back and a close button. The Data & backup sheet scrolls the same way; its `.display` (High contrast), Account and Sync sections (`.sync`) sit under a divider with an `h3` heading. The Account section's privacy note is a `details.privacy` (an accent summary row at least 44px tall, the list in `--ink`).
- **Progress bar** (`.bar`): accent fill for calories, `.protein`, `.carbs` and `.fat` for those macros, `.goal` (good color) for progress to the goal weight, `.over` turns it to the warning color past the target.
- **Day summary** (`.summary`, `.sum-row`, `.sum-big`, `.sum-left`, `.macros`) and **day navigation** (`.title-row`, `.day-nav`, `.day-label`).
- **List rows** (`.entries` of `.entry` / `.result` buttons): name with a hint line on the left, kcal with protein on the right (in the Nutrition day list the kcal is `.entry-kcal`: 19px, weight 750, ink, with a smaller muted `.unit`); `.add-btn` is the dashed add button under each meal.
- **Forms** (`.form`, `.field`, `.seg` segmented radio, `.check` checkbox row, `.preview` live result box, `.btn.danger` for destructive actions, `.search`). Date inputs drop the native appearance (`appearance: none`, full column width, left-aligned) so iOS Safari does not overflow the grid; the weigh-in sheet's two-column row (`.grid2.weigh-fields`) uses a 20px column gap.
- **Sync notice** (`.warn-card.sync-notice`): the Today tab's dismissible "Sync failed" card; text and an Open Sync link button on the left, a transparent `.icon-btn` X on the right.
- **Weight chart** (`.chart`): inline SVG with `.grid` lines and `.tick` labels, `.dot-kg` weigh-in dots (solid `--muted`, r 3), `.avg-line` the 7-day average (accent), `.goal-line` dashed (good), `.plan-line` dotted (muted); `.legend` keys under it; `.range` is the 1M / 3M / All toggle (`aria-pressed`).
- **Workouts** (`.lift-*`): `.lift-ex` exercise cards with `.lift-tip` (last / try) and `.lift-set` rows (set number, weight, reps, RIR inputs, `.lift-check` done button; `.done` tints the row; a reps box whose text is not rep notation gets `aria-invalid` and a 2px `--bad` border), `.lift-notation` the notation hint under the rows, `.lift-pill` small accent badge, `.lift-kpis` number grid, `.lift-list` dashed list, `.lift-plan-day`; bar charts use `.lift-in` (accent) / `.lift-out` (`--chart-2`) / `.lift-band` (the 10-20 band); the trend reuses `.avg-line` and a dashed `.goal-line`. **Rest timer** (`.rest-timer`): a dark bar fixed above the tabs with a draining progress line. **Weekly history** (`.weeks` list of `.week` rows: dates and kcal a day, a hint line of macros). **Visually hidden** (`.visually-hidden`) for labels only screen readers need. `.btn:disabled` dims a button.
- **Faster logging**: `.days` fieldset with `.days-row` of seven `.day-tog` buttons (`aria-pressed`, the accent when on; disabled after today), `.meal-item` list rows with a trailing icon button (`.add-one` the one-tap add of a my meal, or a remove button in a recipe), `.meal-actions` (the add button with "Save as meal" beside it), `.more` disclosure (`details`) for the optional nutrients in a `.grid3`, `.pct-line` for the share of today's targets, `fieldset.plain` for a list of checkboxes with a legend.
- **Progress**: `.modes` the five-button view switcher (a `.range` with smaller labels), `.prog` card grid, `.week-label` the week in the title row, `.trio` three numbers side by side (start, current, change), `.day-row` list rows of a day and its number, `.split-table` the macro split table, `.export` the CSV button block. Charts: `.kcal-bar` (accent, `.over` warn), `.target-line` dashed ink, `.seg-carbs` / `.seg-fat` / `.seg-protein` stacked bars, `.tick.now` today's day label; legend keys `.key.kcal`, `.target`, `.over`, `.carbs`, `.fat`, `.protein`.
- **Day trackers**: `.fast` the fasting card (`.fast-clock` tabular live clock), `.reminder` the soft accent box for a fast that is due, `.trackers` the water and exercise pair of `.tracker` stat cards, `.stepper` two full-width icon buttons (− and +; `.icon-btn.primary` the accent one, `.icon-btn:disabled` dimmed), `.of` the small "/ goal" after a big number, `.net` the net calories figure.
- **Coach cards**: `.coach` cards, `.coach-line` the sentence (`.warn-text` when over the target), `.coach-sub` the small "Meal ideas that fit" heading over an `.entries.ideas` list of `.meal-item` rows with `.add-one` buttons, `.win` the biggest win in a soft accent box (`--ink` on `--accent-soft`, its label in `--accent-deep`), `.coach-facts` stacked label and sentence rows.
- **Barcode and voice**: `.search-row` the search box with two icon buttons beside it, `.mic` (voice search, the accent while `aria-pressed="true"`, listening) and the barcode button, `.scan-view` the camera picture (black, 4:3, at most 46 % of the screen height) with `.scan-guide` the white guide box (a red center line, the rest dimmed); these are the only fixed colors outside the tokens, since they sit on a camera picture, not on a theme surface.
- Text colors: `.protein-text`, `.carbs-text`, `.fat-text`, `.over-text` (warn), `.good-text`, `.bad-text`, `.warn-text`.

## App icon

`icons/icon.svg` (green rounded square, white ring and dot) with PNG renders at 180, 192 and 512 px. The PNGs are full-bleed green so the 512 one also works as a maskable icon (the ring sits inside the safe zone).

## Voice

Short, plain and friendly. Say what happens ("Importing replaces what is stored here"), no exclamation marks, no fitness-bro hype. Targets are guidelines, never medical advice.
