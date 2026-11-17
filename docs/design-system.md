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
| `--line` | Borders and dividers |
| `--accent`, `--accent-ink`, `--accent-soft` | Primary buttons, the active tab, the brand dot; text on accent; soft accent fills |
| `--protein` | Reserved for protein figures and charts (calories use the accent) |
| `--good`, `--bad` | Success and error messages |
| `--warn`, `--warn-soft` | Warnings: the "Storage is unavailable" banner |

Dark mode follows the system (`prefers-color-scheme: dark`) and redefines the same tokens. `index.html` sets a matching `theme-color` per scheme; `manifest.webmanifest` uses the light background.

Shape and depth: `--radius` for cards, `--shadow` for raised surfaces, `--tabs-h` for the bottom bar height (safe-area insets are added on top). Icons are inline SVG line icons (stroke `currentColor`, 1.8 wide).

## Type

The system font stack at 16px. Screen titles (`h2`) 26px bold with tight tracking; section labels (`h3`) small uppercase muted; big numbers (`.stat-value`) 30px with tabular figures.

## Components

- **Card** (`.card`); `.empty` for placeholder and empty states; `.warn-card` for warnings.
- **Stat tile** (`.stat` in a `.grid2`): label, big number, hint.
- **Button** (`.btn`, full width, 48px tall; `.ghost` for secondary) and **icon button** (`.icon-btn`, 40px).
- **Bottom tabs** (`.tabs`): three equal columns, icon over label, active tab in the accent.
- **Sheet** (`dialog` + `.sheet`): bottom sheet on a phone, centered card from 640px; `.facts` for label/value rows and `.msg` (`.good`/`.bad`) for the status line. The general sheet scrolls inside itself up to 92% of the screen height; `.sheet-head .grow` takes a long title between a back and a close button.
- **Progress bar** (`.bar`): accent fill for calories, `.protein` for protein, `.over` turns it to the warning color past the target.
- **Day summary** (`.summary`, `.sum-row`, `.sum-big`, `.sum-left`, `.macros`) and **day navigation** (`.title-row`, `.day-nav`, `.day-label`).
- **List rows** (`.entries` of `.entry` / `.result` buttons): name with a hint line on the left, kcal with protein on the right; `.add-btn` is the dashed add button under each meal.
- **Forms** (`.form`, `.field`, `.seg` segmented radio, `.check` checkbox row, `.preview` live result box, `.btn.danger` for destructive actions, `.search`).
- Text colors: `.protein-text`, `.over-text` (warn), `.good-text`, `.bad-text`, `.warn-text`.

## App icon

`icons/icon.svg` (green rounded square, white ring and dot) with PNG renders at 180, 192 and 512 px. The PNGs are full-bleed green so the 512 one also works as a maskable icon (the ring sits inside the safe zone).

## Voice

Short, plain and friendly. Say what happens ("Importing replaces what is stored here"), no exclamation marks, no fitness-bro hype. Targets are guidelines, never medical advice.
