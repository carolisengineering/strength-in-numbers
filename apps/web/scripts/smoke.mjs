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
 *   3. GET <web>/manifest.webmanifest → 200 JSON naming the app, and the icon
 *      it lists is a PNG — the files, not the SPA rewrite's index.html (#97).
 *
 * Run by the post-deploy `smoke` job in .github/workflows/ci.yml (enabled by
 * Spec 06.3).
 *
 * Spec 15 AC23, by env (unset → today's checks and output):
 *   - WEB_SMOKE_HOST=firebase → the CSP comes from apps/web/firebase.json, and
 *     `/` must revalidate while an `/assets/…` file is immutable;
 *   - WEB_SMOKE_EXPECT_COMMIT → `<meta name="sin-commit">` must equal it.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCacheControl, checkCommitMeta, expectedCspFrom, normalizeCsp } from "./lib/web-smoke-checks.mjs";

const BASE = requireEnv("WEB_SMOKE_BASE_URL").replace(/\/$/, "");
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HOST = process.env.WEB_SMOKE_HOST === "firebase" ? "firebase" : "render";
const EXPECT_COMMIT = process.env.WEB_SMOKE_EXPECT_COMMIT || undefined;

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
  try {
    return expectedCspFrom(HOST, REPO_ROOT);
  } catch (err) {
    process.stderr.write(`web-smoke: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

async function main() {
  const root = await fetch(`${BASE}/`);
  assert(root.status === 200, `GET / → ${root.status} (expected 200)`);
  assert(
    normalizeCsp(root.headers.get("content-security-policy")) ===
      normalizeCsp(expectedCsp()),
    `GET / Content-Security-Policy header matches ${HOST === "firebase" ? "apps/web/firebase.json (Spec 15 AC23)" : "render.yaml (AC15)"}`,
  );
  assert(
    root.headers.get("x-content-type-options") === "nosniff",
    "GET / X-Content-Type-Options: nosniff (AC15)",
  );
  assert(
    root.headers.get("referrer-policy") === "no-referrer",
    "GET / Referrer-Policy: no-referrer (AC15)",
  );

  const rootHtml = await root.text();
  if (EXPECT_COMMIT) {
    const problem = checkCommitMeta(rootHtml, EXPECT_COMMIT);
    assert(problem === null, problem ?? `GET / sin-commit is ${EXPECT_COMMIT} (Spec 15 AC23)`);
  }
  if (HOST === "firebase") {
    const rootCache = checkCacheControl("/", root.headers.get("cache-control"));
    assert(rootCache === null, rootCache ?? "GET / Cache-Control revalidates (Spec 15 AC23)");
    const asset = rootHtml.match(/\/assets\/[^"'\s>]+/)?.[0];
    if (asset) {
      const res = await fetch(`${BASE}${asset}`);
      const assetCache = checkCacheControl("/assets", res.headers.get("cache-control"));
      assert(res.status === 200 && assetCache === null, assetCache ?? `GET ${asset} is immutable (Spec 15 AC23)`);
    } else {
      assert(false, "GET / names an /assets/ file to check (Spec 15 AC23)");
    }
  }

  const deep = await fetch(`${BASE}/app`);
  assert(deep.status === 200, `GET /app → ${deep.status} (expected 200, SPA rewrite)`);
  assert(
    (deep.headers.get("content-type") ?? "").includes("text/html"),
    "GET /app is text/html (AC17)",
  );
  const body = await deep.text();
  assert(body.includes('<div id="root">'), "GET /app body contains <div id=\"root\"> (AC17)");

  const manifest = await fetch(`${BASE}/manifest.webmanifest`);
  const text = await manifest.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON: the rewrite served index.html.
  }
  assert(manifest.status === 200 && parsed?.name === "Strength in Numbers", "GET /manifest.webmanifest is the app manifest (#97)");
  const icon = await fetch(new URL(parsed?.icons?.[0]?.src ?? "icon-192.png", `${BASE}/manifest.webmanifest`));
  assert(icon.status === 200 && (icon.headers.get("content-type") ?? "").includes("image/png"), "the manifest's first icon is a PNG (#97)");

  process.stdout.write(failed ? "web-smoke: FAIL\n" : "web-smoke: PASS\n");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(
    `web-smoke: FAIL — ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
