import type { HevyImportResult, HevyImportWorkout } from "@sin/core";

import { ApiError } from "../../../api";
import { sleep as abortableSleep } from "../sharedClient";
import { RATE_LIMIT_DEFAULT_WAIT_MS } from "./constants";
import type { HevyImportClient } from "./hevyImportClient";
import { chunkBatches } from "./importRequest";

/**
 * Spec 20.1 AC11, §6.6: the summary's server dry run. Batches go one at a time, in the order given (the caller sorts
 * newest first); a `429` waits `Retry-After` (5 s without one) and re-sends the same batch; anything else rejects.
 * No claim is carried across batches: the server's dry run is exact per batch only. React-free.
 */
export async function runDryRun(
  client: HevyImportClient,
  workouts: readonly HevyImportWorkout[],
  opts: { signal: AbortSignal; sleep?: (ms: number, signal: AbortSignal) => Promise<void>; onProgress(done: number, total: number): void },
): Promise<HevyImportResult[]> {
  const wait = opts.sleep ?? abortableSleep;
  const results: HevyImportResult[] = [];
  for (const batch of chunkBatches(workouts)) {
    for (;;) {
      try {
        const reply = await client.importBatch({ dryRun: true, workouts: batch }, opts.signal);
        results.push(...reply.results);
        break;
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 429 || opts.signal.aborted) throw err;
        await wait(err.retryAfterMs ?? RATE_LIMIT_DEFAULT_WAIT_MS, opts.signal);
      }
    }
    opts.onProgress(results.length, workouts.length);
  }
  return results;
}
