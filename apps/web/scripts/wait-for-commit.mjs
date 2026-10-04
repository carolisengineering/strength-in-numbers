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
 *
 * Superseded: if the site already serves a *newer* commit (WAIT_COMMIT is a
 * git ancestor of it — a later push deployed first), this run has nothing to
 * test; that later push's own run tests it. Exits 0 with a notice and writes
 * `superseded=true` to $GITHUB_OUTPUT so the workflow skips the tests. Needs
 * the history (`fetch-depth: 0`); without it the check is skipped and the wait
 * runs to its bound as before.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

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

function git(args) {
  execFileSync("git", args, { stdio: "ignore" });
}

function isNewerThanWanted(deployed) {
  if (!/^[0-9a-f]{40}$/i.test(deployed)) return false;
  try {
    git(["cat-file", "-e", `${deployed}^{commit}`]);
  } catch {
    // Pushed after this job's checkout: fetch it so the ancestry check can see it.
    try {
      git(["fetch", "--quiet", "--no-tags", "origin", deployed]);
    } catch {
      return false; // not on origin (or no network): not provably newer
    }
  }
  try {
    git(["merge-base", "--is-ancestor", want, deployed]);
    return true;
  } catch {
    return false; // not an ancestor, or the commit isn't in the local history
  }
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
    if (match && isNewerThanWanted(match[1])) {
      process.stdout.write(
        `::notice title=e2e superseded::${base} already serves ${match[1]}, a later commit than ${want}; its own run tests it\n`,
      );
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "superseded=true\n");
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
