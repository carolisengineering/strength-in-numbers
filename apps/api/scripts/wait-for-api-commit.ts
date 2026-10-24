/**
 * Spec 15 AC12 — the CI `smoke` job's "Wait for staging to serve this commit" step.
 *
 *   WAIT_BASE_URL=https://si-api-ft2f.onrender.com WAIT_COMMIT=<sha> [WAIT_TIMEOUT_S=900] \
 *     pnpm --filter @sin/api exec tsx scripts/wait-for-api-commit.ts
 *
 * Exits 0 on a match, or when superseded (it then writes `superseded=true` to $GITHUB_OUTPUT so the
 * commit-checked smoke is skipped); exits 1 after the timeout naming the last commit seen. The ancestry
 * check needs the history (`fetch-depth: 0`); without it the wait runs to its bound.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { waitForApiCommit } from "./lib/wait-for-api-commit.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    process.stderr.write(`wait-for-api-commit: missing env ${name}\n`);
    process.exit(1);
  }
  return value;
}

/** exit 0 → true, exit 1 → false, anything else → null. */
function gitStatus(args: string[]): boolean | null {
  try {
    execFileSync("git", args, { stdio: "ignore" });
    return true;
  } catch (error) {
    return (error as { status?: number }).status === 1 ? false : null;
  }
}

function isAncestor(older: string, newer: string): boolean | null {
  // Pushed after this job's checkout: fetch it so the ancestry check can see it.
  if (gitStatus(["cat-file", "-e", `${newer}^{commit}`]) !== true && gitStatus(["fetch", "--quiet", "--no-tags", "origin", newer]) !== true) {
    return null;
  }
  return gitStatus(["merge-base", "--is-ancestor", older, newer]);
}

async function fetchCommit(url: string): Promise<string | null> {
  const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) return null;
  const body = (await res.json()) as { commit?: unknown };
  return typeof body.commit === "string" ? body.commit : null;
}

async function main(): Promise<void> {
  const baseUrl = requireEnv("WAIT_BASE_URL");
  const want = requireEnv("WAIT_COMMIT");
  const timeoutMs = Number(process.env.WAIT_TIMEOUT_S ?? "900") * 1000;
  const outcome = await waitForApiCommit({ baseUrl, want, timeoutMs, intervalMs: 10_000, fetchCommit, isAncestor, now: Date.now, sleep });
  if (outcome.result === "match") {
    process.stdout.write(`wait-for-api-commit: ok — ${baseUrl} serves ${want}\n`);
    return;
  }
  if (outcome.result === "superseded") {
    process.stdout.write(`::notice title=staging smoke superseded::${baseUrl} already serves ${outcome.last}, a later commit than ${want}; its own run tests it\n`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "superseded=true\n");
    return;
  }
  process.stderr.write(`wait-for-api-commit: ${baseUrl} did not serve ${want} within ${timeoutMs / 1000}s; last seen: ${outcome.last ?? "nothing"}\n`);
  process.exit(1);
}

void main();
