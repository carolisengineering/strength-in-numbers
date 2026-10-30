import type { HevyImportBatch, HevyImportResponse, HevyImportResult, HevyImportWorkout, HevyWorkout } from "@sin/core";

import { ApiError } from "../../../api";
import { BATCH_GAP_MS, BATCH_RETRY_WAITS_MS, RATE_LIMIT_DEFAULT_WAIT_MS } from "./constants";
import { ImportReplyError } from "./hevyImportClient";
import { importLane } from "./importLane";
import { chunkBatches, sortNewestFirst, toImportWorkout } from "./importRequest";
import { sendable } from "./importSummary";

/**
 * Spec 20.1 AC16–AC20, §6.7: the real import, one batch at a time through the lane. React-free: it owns no state and
 * reports each batch to its caller. A batch's request gets no abort signal, so a Stop, a leave or an unmount never
 * cuts a write the server is still doing; the waits (the gap, a retry, a `429`) end at once on a Stop or an unmount.
 */

export type PauseReason = "unreachable";
/** `invalid` carries the batch's first error path only (never a title); `""` when there is none. */
export type StopReason = { kind: "user" } | { kind: "gate" } | { kind: "auth" } | { kind: "invalid"; path: string };

export interface RunDeps {
  importBatch(body: HevyImportBatch, signal?: AbortSignal): Promise<HevyImportResponse>;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  /** Aborted on unmount: the run ends silently and a reply that lands after it is dropped. */
  signal: AbortSignal;
  /** Aborted on Stop: a wait ends at once. */
  stopSignal: AbortSignal;
  shouldStop(): boolean;
}

export interface RunEvents {
  batchDone(index: number, results: HevyImportResult[], firstStartTime: string): void;
  /** `error` is the last failure, for `reportError` (the caller decides whether it is reportable). */
  paused(index: number, reason: PauseReason, error: unknown): void;
  stopped(index: number, reason: StopReason, error?: unknown): void;
  ended(): void;
}

/** One signal that aborts when either does (`AbortSignal.any` needs Safari 17.4). */
function eitherSignal(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const both = new AbortController();
  const abort = () => both.abort();
  a.addEventListener("abort", abort, { once: true });
  b.addEventListener("abort", abort, { once: true });
  return both.signal;
}

/** A network failure or a `5xx`: worth sending again. */
const unreachable = (err: unknown) => err instanceof ApiError && (err.isNetworkError || err.status >= 500);

/** What ends the run for a failure that isn't retried. */
function stopReasonFor(err: unknown): StopReason {
  if (err instanceof ApiError && err.status === 422) return { kind: "invalid", path: err.errors[0]?.path ?? "" };
  if (err instanceof ApiError && err.status === 404) return { kind: "gate" };
  if (err instanceof ApiError && err.status === 401) return { kind: "auth" };
  // An ImportReplyError, any other 4xx (a 413, a 403, a 400; O3), or anything unexpected.
  return { kind: "invalid", path: "" };
}

export async function runImport(deps: RunDeps, batches: readonly HevyImportWorkout[][], from: number, on: RunEvents): Promise<void> {
  const waitSignal = eitherSignal(deps.signal, deps.stopSignal);
  const stoppedByUser = () => deps.stopSignal.aborted || deps.shouldStop();

  /** Waits `ms`; false when the wait was cut short (the caller then ends the run). */
  const wait = async (ms: number) => {
    try {
      await deps.sleep(ms, waitSignal);
    } catch {
      /* aborted */
    }
    return !waitSignal.aborted;
  };

  for (let index = from; index < batches.length; index += 1) {
    const workouts = batches[index]!;
    if (index > from) await wait(BATCH_GAP_MS);
    if (deps.signal.aborted) return;
    if (stoppedByUser()) return on.stopped(index, { kind: "user" });

    let retries = 0;
    for (;;) {
      let reply: HevyImportResponse;
      try {
        reply = await importLane.run(() => deps.importBatch({ dryRun: false, workouts }));
      } catch (err) {
        if (deps.signal.aborted) return;
        let delay: number;
        if (err instanceof ApiError && err.status === 429) {
          delay = err.retryAfterMs ?? RATE_LIMIT_DEFAULT_WAIT_MS;
        } else if (unreachable(err)) {
          if (retries >= BATCH_RETRY_WAITS_MS.length) return on.paused(index, "unreachable", err);
          delay = BATCH_RETRY_WAITS_MS[retries]!;
          retries += 1;
        } else {
          return on.stopped(index, stopReasonFor(err), err instanceof ImportReplyError || !(err instanceof ApiError) ? err : undefined);
        }
        if (!(await wait(delay))) {
          if (deps.signal.aborted) return;
          return on.stopped(index, { kind: "user" });
        }
        if (stoppedByUser()) return on.stopped(index, { kind: "user" });
        continue;
      }
      if (deps.signal.aborted) return;
      on.batchDone(index, reply.results, workouts[0]!.startTime);
      break;
    }
  }
  on.ended();
}

/**
 * AC16: the batches the run sends — the dry run's `create` and `duplicate` workouts, newest first. The same input
 * always gives the same batches, so a Resume starts from the number of batches done. A sendable workout the request
 * can't carry is left out (defended: an unreadable one was never in the dry run).
 */
export function runBatches(results: readonly HevyImportResult[], workouts: ReadonlyMap<string, HevyWorkout>, zone: string): HevyImportWorkout[][] {
  const ids = new Set(sendable(results));
  const list = sortNewestFirst([...workouts.values()].filter((w) => ids.has(w.id))).flatMap((w) => {
    const built = toImportWorkout(w, { zone });
    return built.ok ? [built.workout] : [];
  });
  return chunkBatches(list);
}
