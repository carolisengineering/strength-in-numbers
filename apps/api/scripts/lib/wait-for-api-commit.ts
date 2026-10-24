/**
 * Spec 15 AC12 — wait until a deployed API reports a given commit on `/healthz` (pure: every input injected).
 *
 * - **match:** `/healthz` reports `want`.
 * - **superseded:** it reports a commit that `want` is an ancestor of (a later push deployed first); that later
 *   push's own run tests it. The rule copies `apps/web/scripts/wait-for-commit.mjs`.
 * - **timeout:** neither within `timeoutMs`. `"dev"` or no commit never matches, and is never checked for ancestry.
 */
export interface WaitForApiCommitOptions {
  baseUrl: string;
  want: string;
  timeoutMs: number;
  intervalMs: number;
  /** The `commit` field of the response, or null; a throw counts as null. */
  fetchCommit: (url: string) => Promise<string | null>;
  /** true / false, or null when it can't be told (no history). */
  isAncestor: (older: string, newer: string) => boolean | null;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export interface WaitForApiCommitResult {
  result: "match" | "superseded" | "timeout";
  last: string | null;
}

const COMMIT_SHA = /^[0-9a-f]{40}$/;

export async function waitForApiCommit(opts: WaitForApiCommitOptions): Promise<WaitForApiCommitResult> {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/healthz`;
  const want = opts.want.toLowerCase();
  const deadline = opts.now() + opts.timeoutMs;
  let last: string | null = null;
  for (;;) {
    try {
      last = await opts.fetchCommit(url);
    } catch {
      last = null;
    }
    if (last !== null && last === want) return { result: "match", last };
    if (last !== null && COMMIT_SHA.test(last) && opts.isAncestor(want, last) === true) return { result: "superseded", last };
    if (opts.now() + opts.intervalMs > deadline) return { result: "timeout", last };
    await opts.sleep(opts.intervalMs);
  }
}
