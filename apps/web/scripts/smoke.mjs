/**
 * Post-deploy smoke for the `si-web-staging` static site (Spec 04.0 §10 / §11,
 * AC15 / AC17). Mirrors `apps/api/scripts/smoke.ts`.
 *
 *   WEB_SMOKE_BASE_URL=https://si-web-staging.onrender.com \
 *     node apps/web/scripts/smoke.mjs
 *
 *   1. GET <web>/            → 200; response carries the exact CSP +
 *      X-Content-Type-Options: nosniff + Referrer-Policy: no-referrer from
 *      render.yaml (AC15).
 *   2. GET <web>/app  (cold, a protected deep link, no auth) → 200 text/html
 *      containing `<div id="root">` — the SPA rewrite serves index.html (AC17).
 *
 * NOT wired into CI yet — `si-web-staging` does not exist until the Render site
 * is created post-merge (Track B). See the TODO(Track B) marker in
 * .github/workflows/ci.yml.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = requireEnv("WEB_SMOKE_BASE_URL").replace(/\/$/, "");
const RENDER_YAML = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "render.yaml",
);

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    process.stderr.write(`web-smoke: missing env ${name}\n`);
    process.exit(1);
  }
  return v;
}

let failed = false;
function assert(cond, msg) {
  if (cond) {
    process.stdout.write(`web-smoke: ok — ${msg}\n`);
  } else {
    process.stderr.write(`web-smoke: FAIL — ${msg}\n`);
    failed = true;
  }
}

function expectedCsp() {
  const yaml = readFileSync(RENDER_YAML, "utf8");
  const block = yaml.slice(yaml.indexOf("name: si-web-staging"));
  const m = block.match(
    /name:\s*Content-Security-Policy\s*\n\s*value:\s*"([^"]+)"/,
  );
  if (!m) {
    process.stderr.write("web-smoke: could not read expected CSP from render.yaml\n");
    process.exit(1);
  }
  return m[1];
}

function normalizeCsp(v) {
  return (v ?? "")
    .split(";")
    .map((d) => d.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .sort()
    .join("; ");
}

async function main() {
  const root = await fetch(`${BASE}/`);
  assert(root.status === 200, `GET / → ${root.status} (expected 200)`);
  assert(
    normalizeCsp(root.headers.get("content-security-policy")) ===
      normalizeCsp(expectedCsp()),
    "GET / Content-Security-Policy header matches render.yaml (AC15)",
  );
  assert(
    root.headers.get("x-content-type-options") === "nosniff",
    "GET / X-Content-Type-Options: nosniff (AC15)",
  );
  assert(
    root.headers.get("referrer-policy") === "no-referrer",
    "GET / Referrer-Policy: no-referrer (AC15)",
  );

  const deep = await fetch(`${BASE}/app`);
  assert(deep.status === 200, `GET /app → ${deep.status} (expected 200, SPA rewrite)`);
  assert(
    (deep.headers.get("content-type") ?? "").includes("text/html"),
    "GET /app is text/html (AC17)",
  );
  const body = await deep.text();
  assert(body.includes('<div id="root">'), "GET /app body contains <div id=\"root\"> (AC17)");

  process.stdout.write(failed ? "web-smoke: FAIL\n" : "web-smoke: PASS\n");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(
    `web-smoke: FAIL — ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
