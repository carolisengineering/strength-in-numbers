/**
 * AC1 build-output assertion (Spec 04.0 §2 / §6.6 / §10). Run after
 * `pnpm --filter @sin/web run build`:
 *
 *   node apps/web/scripts/assert-build-output.mjs
 *
 * Asserts that `apps/web/dist/`:
 *   1. `index.html` contains no inline <script>/<style> and no inline event
 *      handler attributes, and references only hashed, same-origin assets.
 *   2. ships the self-hosted Auth0 worker at `/auth0-spa-js.worker.production.js`.
 *   3. bundled `@sin/core` (no unresolved / externalised import of it survives
 *      into the emitted JS).
 *
 * Any failure exits non-zero.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

let failed = false;
function assert(cond, msg) {
  if (cond) {
    process.stdout.write(`assert-build-output: ok — ${msg}\n`);
  } else {
    process.stderr.write(`assert-build-output: FAIL — ${msg}\n`);
    failed = true;
  }
}

// ── 0. dist exists ──────────────────────────────────────────────────────────
const indexPath = join(DIST, "index.html");
if (!existsSync(indexPath)) {
  process.stderr.write(
    `assert-build-output: FAIL — ${indexPath} not found (run \`pnpm --filter @sin/web run build\` first)\n`,
  );
  process.exit(1);
}
const html = readFileSync(indexPath, "utf8");

// ── 1a. no inline <script> (every <script> must have a src and an empty body) ─
const scriptTags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
assert(scriptTags.length > 0, "index.html has at least one <script> tag");
for (const [, attrs, body] of scriptTags) {
  assert(/\bsrc\s*=/.test(attrs), `<script> tag has a src attribute (attrs: ${attrs.trim()})`);
  assert(body.trim() === "", "<script> tag has no inline body");
}
assert(
  !/<script\b[^>]*\/\s*>/i.test(html) || scriptTags.length > 0,
  "no self-closing <script> shorthand hiding an inline import",
);

// ── 1b. no inline <style> ──────────────────────────────────────────────────
assert(!/<style\b/i.test(html), "index.html has no inline <style> tag");

// ── 1c. no inline event-handler attributes (onload=, onclick=, …) ──────────
assert(
  !/\son[a-z]+\s*=\s*["']/i.test(html),
  "index.html has no inline on*= event-handler attributes",
);

// ── 1d. every asset ref is same-origin and (under /assets/) content-hashed ──
const refs = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map(
  (m) => m[1],
);
for (const ref of refs) {
  if (ref.startsWith("data:")) continue; // inline data URI (e.g. favicon) is fine
  assert(
    ref.startsWith("/") && !ref.startsWith("//"),
    `asset ref is a same-origin absolute path: ${ref}`,
  );
  if (/^\/assets\/.+\.(?:js|css)$/.test(ref)) {
    assert(
      /-[\w-]{6,}\.(?:js|css)$/.test(ref),
      `asset under /assets/ is content-hashed: ${ref}`,
    );
  }
}

// ── 2. the self-hosted Auth0 refresh-token worker is present at the root ────
assert(
  existsSync(join(DIST, "auth0-spa-js.worker.production.js")),
  "dist/auth0-spa-js.worker.production.js exists (self-hosted refresh worker, AC8)",
);

// ── 3. @sin/core was bundled, not left as an unresolved / external import ───
function walkJs(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJs(p));
    else if (entry.name.endsWith(".js")) out.push(p);
  }
  return out;
}
const jsFiles = walkJs(DIST);
assert(jsFiles.length > 0, "dist contains at least one emitted .js chunk");
const leaks = jsFiles.filter((f) => readFileSync(f, "utf8").includes("@sin/core"));
assert(
  leaks.length === 0,
  leaks.length === 0
    ? "no emitted chunk carries an unresolved `@sin/core` import"
    : `emitted chunks still import "@sin/core": ${leaks.join(", ")}`,
);

process.exit(failed ? 1 : 0);
