import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ratio, tokenBlocks, contrastFailures } from "../scripts/contrast.mjs";

test("ratio matches the WCAG formula", () => {
  assert.equal(ratio("#000000", "#ffffff"), 21);
  assert.equal(ratio("#777777", "#777777"), 1);
  assert.ok(Math.abs(ratio("#767676", "#ffffff") - 4.54) < 0.01);
});

test("tokenBlocks layers dark and high contrast over light", () => {
  const css = `:root { --ink: #111111; --bg: #ffffff; }
@media (prefers-color-scheme: dark) { :root { --ink: #eeeeee; --bg: #000000; } }
:root[data-contrast="more"] { --ink: #000000; }
@media (prefers-color-scheme: dark) { :root[data-contrast="more"] { --ink: #ffffff; } }
@media (min-width: 640px) { :root { --ink: #ff0000; } }`;
  const t = tokenBlocks(css);
  assert.equal(t.light.ink, "#111111");
  assert.equal(t.dark.ink, "#eeeeee");
  assert.equal(t["light high contrast"].ink, "#000000");
  assert.equal(t["dark high contrast"].ink, "#ffffff");
  assert.equal(t["dark high contrast"].bg, "#000000");
});

test("a low-contrast token is reported", () => {
  const css = readFileSync("styles.css", "utf8").replace("--muted: #444c46;", "--muted: #9aa79c;");
  assert.ok(contrastFailures(css).some((f) => f.startsWith("light: --muted")));
});

test("styles.css meets every contrast floor", () => {
  assert.deepEqual(contrastFailures(readFileSync("styles.css", "utf8")), []);
});
