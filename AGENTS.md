# genki

Start at `docs/architecture.md` - it indexes every doc. Exact commands (unit tests, the fast check, the dev server) are in `.claude/test-manifest.json`; release facts are in `docs/docsic.json`. Never copy them here.

## Gotchas

- Public repo: code only. Never put real personal data (weights, meals, workouts, exports) in code, test fixtures, commits or PR text.
- A merge to `main` is a live deploy (GitHub Pages).
- IndexedDB stores and backup files live on the owner's devices: a store change needs a database version bump with an upgrade step in `db.js` and the matching `SCHEMA` bump in `backup.js`, never a rename or drop of existing data.
- `foods/*.json` are built by `scripts/build-foods.mjs` from public sources: rebuild, never hand-edit (licensing and what is kept: `docs/nutrition.md`).
