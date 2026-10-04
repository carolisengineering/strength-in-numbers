/**
 * Spec 06.3 §6.3 / AC5 — wait until the deployed static site serves the build
 * of a given commit, by polling its `<meta name="sin-commit">` stamp.
 *
 *   WAIT_BASE_URL=https://si-web-staging.onrender.com WAIT_COMMIT=<sha> \
 *     [WAIT_TIMEOUT_S=900] node apps/web/scripts/wait-for-commit.mjs
 *
 * Exits 0 when the stamp equals WAIT_COMMIT; exits 1 after the timeout with
 * the last stamp seen. A "dev" stamp or no stamp never matches, so a build
 * without RENDER_GIT_COMMIT fails loudly instead of testing a stale bundle.
 */
const base = requireEnv("WAIT_BASE_URL").replace(/\/$/, "");
const want = requireEnv("WAIT_COMMIT").toLowerCase();
const timeoutS = Number(process.env.WAIT_TIMEOUT_S ?? "900");
const deadline = Date.now() + timeoutS * 1000;

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    process.stderr.write(`wait-for-commit: missing env ${name}\n`);
    process.exit(1);
  }
  return v;
}

let seen = "nothing fetched";
while (Date.now() < deadline) {
  try {
    const res = await fetch(`${base}/`, { headers: { "cache-control": "no-cache" } });
    const html = await res.text();
    const match = html.match(/<meta name="sin-commit" content="([^"]*)"/);
    seen = match ? match[1] : `no sin-commit meta (HTTP ${res.status})`;
    if (match && match[1].toLowerCase() === want) {
      process.stdout.write(`wait-for-commit: ok — ${base} serves ${want}\n`);
      process.exit(0);
    }
  } catch (error) {
    seen = `fetch failed: ${error.message}`;
  }
  process.stdout.write(`wait-for-commit: waiting — seen ${seen}\n`);
  await new Promise((resolve) => setTimeout(resolve, Math.min(15_000, Math.max(0, deadline - Date.now()))));
}
process.stderr.write(
  `wait-for-commit: FAIL — ${base} still serves ${seen} after ${timeoutS}s, want ${want}\n`,
);
process.exit(1);
