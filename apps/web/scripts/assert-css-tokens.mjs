/**
 * AC1 styling-foundation assertion (Spec 04.1 §2 / §10). Run from anywhere:
 *
 *   node apps/web/scripts/assert-css-tokens.mjs
 *
 * Asserts that:
 *   1. `src/ui/tokens.css` exists and defines the required `:root` custom
 *      properties.
 *   2. every other `.css` file under `src/` references design values only via
 *      `var(--…)` — no hard-coded colours (`#hex`, `rgb()`, `hsl()`, named
 *      colours are not checked) and no `px` lengths other than `0` and `1px`
 *      (hairline borders / outlines).
 *   3. `package.json` `dependencies` contains no CSS framework.
 *
 * Any failure exits non-zero. The regexes are deliberately simple — this is a
 * tripwire for drift, not a CSS parser.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(WEB, "src");
const TOKENS = join(SRC, "ui", "tokens.css");

const REQUIRED_TOKENS = [
  "--color-bg",
  "--color-surface",
  "--color-text",
  "--color-muted",
  "--color-accent",
  "--color-danger",
  "--space-1",
  "--space-2",
  "--space-3",
  "--space-4",
  "--space-6",
  "--space-8",
  "--font-size-sm",
  "--font-size-md",
  "--font-size-lg",
  "--font-size-xl",
  "--radius-sm",
  "--radius-md",
  "--tap-target-min",
];

const CSS_FRAMEWORKS = [
  /^tailwindcss$/,
  /^bootstrap$/,
  /^bulma$/,
  /^@mui\//,
  /^@chakra-ui\//,
  /^@mantine\//,
  /^antd$/,
  /^styled-components$/,
  /^@emotion\//,
  /^@stitches\//,
  /^@vanilla-extract\//,
  /^@pandacss\//,
];

let failed = false;
function assert(cond, msg) {
  if (cond) {
    process.stdout.write(`assert-css-tokens: ok — ${msg}\n`);
  } else {
    process.stderr.write(`assert-css-tokens: FAIL — ${msg}\n`);
    failed = true;
  }
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".css")) out.push(p);
  }
  return out;
}

/** Strip `/* … *\/` comments so a documented hex in a comment is not a hit. */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

// ── 1. tokens.css ───────────────────────────────────────────────────────────
assert(existsSync(TOKENS), "src/ui/tokens.css exists");
const tokensCss = existsSync(TOKENS) ? stripComments(readFileSync(TOKENS, "utf8")) : "";
const rootBlock = tokensCss.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? "";
for (const token of REQUIRED_TOKENS) {
  assert(
    new RegExp(`${token}\\s*:`).test(rootBlock),
    `tokens.css :root defines ${token}`,
  );
}
assert(
  /--tap-target-min\s*:\s*44px/.test(rootBlock),
  "tokens.css sets --tap-target-min: 44px (AC2)",
);

// ── 2. every other stylesheet reads only var(--…) ───────────────────────────
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const COLOR_FN = /\b(?:rgba?|hsla?|oklch|oklab|color)\(/g;
const PX = /(?<![\w-])(\d*\.?\d+)px\b/g;

const files = walk(SRC).filter((p) => p !== TOKENS);
for (const file of files) {
  const rel = relative(WEB, file);
  const css = stripComments(readFileSync(file, "utf8"));
  const hits = [];
  for (const m of css.matchAll(HEX)) hits.push(m[0]);
  for (const m of css.matchAll(COLOR_FN)) hits.push(m[0]);
  for (const m of css.matchAll(PX)) {
    if (m[1] !== "0" && m[1] !== "1") hits.push(m[0]);
  }
  assert(
    hits.length === 0,
    `${rel} uses only var(--…) design values` +
      (hits.length ? ` (found: ${[...new Set(hits)].join(", ")})` : ""),
  );
}
assert(files.length > 0, `scanned ${files.length} stylesheet(s) besides tokens.css`);

// ── 3. no CSS framework dependency ─────────────────────────────────────────
const pkg = JSON.parse(readFileSync(join(WEB, "package.json"), "utf8"));
const deps = Object.keys(pkg.dependencies ?? {});
const offenders = deps.filter((d) => CSS_FRAMEWORKS.some((re) => re.test(d)));
assert(
  offenders.length === 0,
  "package.json dependencies contain no CSS framework" +
    (offenders.length ? ` (found: ${offenders.join(", ")})` : ""),
);

process.exit(failed ? 1 : 0);
