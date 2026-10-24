/**
 * Spec 15 AC13 / AC14 / AC21 — the `deploy-prod` gate job's decision step.
 *
 *   GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo INPUT_SHA=<sha or empty> AR_IMAGES_JSON=<file> \
 *     pnpm --filter @sin/api exec tsx scripts/release-gate.ts
 *
 * Reads the last 30 completed CI push runs on main and their jobs (GitHub REST API), the image list a prior
 * `gcloud artifacts docker images list … --include-tags --format=json` step wrote to AR_IMAGES_JSON, and
 * `git merge-base --is-ancestor <sha> origin/main` (needs `fetch-depth: 0`). Writes `sha=` and `digest=` to
 * $GITHUB_OUTPUT, or exits 1 naming the unmet condition.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { decideRelease, parseArImages, stagingStepOf, type CiRun } from "./lib/release-gate.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    process.stderr.write(`release-gate: missing env ${name}\n`);
    process.exit(1);
  }
  return value;
}

async function github<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
  });
  if (!res.ok) throw new Error(`GitHub API ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

function onMain(sha: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sha, "origin/main"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const token = requireEnv("GITHUB_TOKEN");
  const repo = requireEnv("GITHUB_REPOSITORY");
  const images = parseArImages(JSON.parse(readFileSync(requireEnv("AR_IMAGES_JSON"), "utf8")) as unknown);
  const requested = process.env.INPUT_SHA?.trim() || null;

  type Run = { id: number; head_sha: string; created_at: string };
  type Jobs = { jobs: { name: string; steps?: { name: string; conclusion: string | null }[] }[] };
  const { workflow_runs } = await github<{ workflow_runs: Run[] }>(
    `/repos/${repo}/actions/workflows/ci.yml/runs?branch=main&event=push&status=completed&per_page=30`,
    token,
  );
  const runs: CiRun[] = [];
  for (const run of workflow_runs) {
    const { jobs } = await github<Jobs>(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`, token);
    runs.push({ headSha: run.head_sha, createdAt: run.created_at, stagingStep: stagingStepOf(jobs) });
  }

  const decision = decideRelease({ requestedSha: requested, runs, images, onMain });
  if (!decision.ok) {
    process.stderr.write(`release-gate: refused (${decision.reason}) — ${decision.message}\n`);
    process.exit(1);
  }
  process.stdout.write(`release-gate: ok — ${decision.sha} (${decision.digest})\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `sha=${decision.sha}\ndigest=${decision.digest}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`release-gate: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
