/**
 * AC14 assertion (Spec 04.0 §10 / §11). Parses `render.yaml`, isolates the
 * `si-web-staging` static-site `/*` response headers, and asserts the strict CSP
 * + companion security headers are all present and that no CSP relaxation
 * (`unsafe-eval`, `unsafe-inline`, `blob:`) has crept in.
 *
 *   node apps/web/scripts/assert-render-yaml.mjs
 *
 * Text-based (no YAML dependency): the file is authored here, single-line CSP
 * value, so substring checks are unambiguous.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RENDER_YAML = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "render.yaml",
);

let failed = false;
function assert(cond, msg) {
  if (cond) {
    process.stdout.write(`assert-render-yaml: ok — ${msg}\n`);
  } else {
    process.stderr.write(`assert-render-yaml: FAIL — ${msg}\n`);
    failed = true;
  }
}

const yaml = readFileSync(RENDER_YAML, "utf8");

// ── isolate the si-web-staging service block ───────────────────────────────
const startIdx = yaml.indexOf("name: si-web-staging");
assert(startIdx !== -1, "render.yaml defines a `si-web-staging` service");
// The block runs to the next top-level `envVarGroups:` or EOF.
const rest = yaml.slice(startIdx);
const endIdx = rest.indexOf("\nenvVarGroups:");
const block = endIdx === -1 ? rest : rest.slice(0, endIdx);

assert(/\bruntime:\s*static\b/.test(block), "runtime: static");
assert(
  /\bstaticPublishPath:\s*apps\/web\/dist\b/.test(block),
  "staticPublishPath: apps/web/dist",
);
assert(
  /-\s*type:\s*rewrite[\s\S]*?source:\s*\/\*[\s\S]*?destination:\s*\/index\.html/.test(
    block,
  ),
  "SPA rewrite route /* -> /index.html (AC17)",
);

// ── the CSP header value ──────────────────────────────────────────────────
const cspMatch = block.match(
  /name:\s*Content-Security-Policy\s*\n\s*value:\s*"([^"]+)"/,
);
assert(cspMatch !== null, "a Content-Security-Policy header on the static site");
const csp = cspMatch ? cspMatch[1] : "";

const requiredDirectives = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "worker-src 'self'",
  "frame-src https://dev-gncuqvfir0wv0t4l.us.auth0.com",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
];
for (const d of requiredDirectives) {
  assert(csp.includes(d), `CSP contains \`${d}\``);
}

// connect-src must allow self + the API origin + the Auth0 domain
const connectSrc = (csp.match(/connect-src ([^;]+)/) ?? ["", ""])[1];
for (const src of [
  "'self'",
  "https://si-api-ft2f.onrender.com",
  "https://dev-gncuqvfir0wv0t4l.us.auth0.com",
]) {
  assert(connectSrc.includes(src), `CSP connect-src allows ${src}`);
}

// No relaxations, anywhere in the CSP.
for (const bad of ["unsafe-eval", "unsafe-inline", "blob:"]) {
  assert(!csp.includes(bad), `CSP does NOT contain \`${bad}\``);
}

// ── companion security headers ───────────────────────────────────────────
assert(
  /name:\s*X-Content-Type-Options\s*\n\s*value:\s*nosniff\b/.test(block),
  "X-Content-Type-Options: nosniff",
);
assert(
  /name:\s*Referrer-Policy\s*\n\s*value:\s*no-referrer\b/.test(block),
  "Referrer-Policy: no-referrer",
);
assert(
  /path:\s*\/assets\/\*\s*\n\s*name:\s*Cache-Control\s*\n\s*value:[^\n]*immutable/.test(
    block,
  ),
  "immutable Cache-Control on /assets/*",
);

process.exit(failed ? 1 : 0);
