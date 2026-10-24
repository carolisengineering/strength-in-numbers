/**
 * Spec 15 AC14 / AC21 — the release gate's decision (pure). A commit ships to production only if its newest CI
 * push run on `main` passed the commit-checked staging smoke (a skipped step means a later push superseded it,
 * so it was never verified), its image is in Artifact Registry, and it is on `main`.
 */
/** The CI contract (rename together with ci.yml and CLAUDE.md). */
export const STAGING_SMOKE_JOB = "post-deploy smoke (staging)";
export const STAGING_SMOKE_STEP = "Staging API smoke (commit verified)";

export interface CiRun {
  headSha: string;
  createdAt: string;
  stagingStep: "success" | "skipped" | "failure" | "cancelled" | "missing";
}

export type ReleaseDecision =
  | { ok: true; sha: string; digest: string }
  | { ok: false; reason: "no-candidate" | "no-ci-run" | "staging-skipped" | "staging-failed" | "image-missing" | "not-on-main"; message: string };

const COMMIT_SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export function stagingStepOf(jobs: { name: string; steps?: { name: string; conclusion: string | null }[] }[]): CiRun["stagingStep"] {
  const step = jobs.find((j) => j.name === STAGING_SMOKE_JOB)?.steps?.find((s) => s.name === STAGING_SMOKE_STEP);
  const c = step?.conclusion;
  return c === "success" || c === "skipped" || c === "failure" || c === "cancelled" ? c : "missing";
}

/** `gcloud artifacts docker images list <repo>/api --include-tags --format=json` → full-SHA tag → digest. */
export function parseArImages(json: unknown): Map<string, string> {
  const images = new Map<string, string>();
  if (!Array.isArray(json)) return images;
  for (const entry of json as { version?: unknown; tags?: unknown }[]) {
    const digest = entry?.version;
    if (typeof digest !== "string" || !DIGEST.test(digest) || !Array.isArray(entry.tags)) continue;
    for (const tag of entry.tags) if (typeof tag === "string" && COMMIT_SHA.test(tag)) images.set(tag, digest);
  }
  return images;
}

function check(sha: string, run: CiRun | undefined, images: Map<string, string>, onMain: (sha: string) => boolean): ReleaseDecision {
  if (run === undefined) return { ok: false, reason: "no-ci-run", message: `${sha}: no completed CI push run on main for this commit` };
  if (run.stagingStep === "skipped") {
    return { ok: false, reason: "staging-skipped", message: `${sha}: its staging smoke was skipped — superseded by a later push that deployed first, so this commit was never verified on staging` };
  }
  if (run.stagingStep !== "success") {
    return { ok: false, reason: "staging-failed", message: `${sha}: the step "${STAGING_SMOKE_STEP}" did not succeed (${run.stagingStep})` };
  }
  const digest = images.get(sha);
  if (digest === undefined) {
    return { ok: false, reason: "image-missing", message: `${sha}: no image in Artifact Registry — never published, or removed by the 5-image cleanup policy` };
  }
  if (!onMain(sha)) return { ok: false, reason: "not-on-main", message: `${sha}: not reachable from main` };
  return { ok: true, sha, digest };
}

export function decideRelease(input: { requestedSha: string | null; runs: CiRun[]; images: Map<string, string>; onMain: (sha: string) => boolean }): ReleaseDecision {
  // Newest run per commit decides.
  const newest = new Map<string, CiRun>();
  for (const run of [...input.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const key = run.headSha.toLowerCase();
    if (!newest.has(key)) newest.set(key, run);
  }
  if (input.requestedSha !== null) {
    const sha = input.requestedSha.trim().toLowerCase();
    return check(sha, newest.get(sha), input.images, input.onMain);
  }
  for (const [sha, run] of newest) {
    const decision = check(sha, run, input.images, input.onMain);
    if (decision.ok) return decision;
  }
  return { ok: false, reason: "no-candidate", message: `none of the last ${newest.size} CI commits on main passed the staging smoke with a published image` };
}
