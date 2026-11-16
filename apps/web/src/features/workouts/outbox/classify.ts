import { RETIME_MESSAGES } from "@sin/core";
import { ApiError } from "../../../api";
import type { OpFailure, OutboxOp } from "./ops";

/** `reconcile` (Spec 06.7 AC3): a finish met `409 workout-finished`; the outbox re-reads the workout to decide. */
export type Verdict = "done" | "retry" | "fail" | "reconcile";

const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30_000;
const JITTER = 0.2;

/**
 * Spec 06.7 §6.5: a phone clock more than five minutes ahead makes `endedAt` fail the server's rule with this static
 * field error (#57: never a value in it), which passes once real time catches up.
 */
export function isFutureEndedAt(error: unknown): boolean {
  return error instanceof ApiError && error.errors.some((e) => e.path === "endedAt" && e.message === RETIME_MESSAGES.future);
}

/**
 * Spec 06.2 AC5: what to do with an op after the server (or the network) answered with `error`. `finishWaiting`
 * (Spec 06.7 AC6): the op's workout has a finish op in the queue, so a `404` on a note or timer entry is shown, not dropped.
 */
export function classify(kind: OutboxOp["kind"], error: unknown, context: { finishWaiting?: boolean } = {}): Verdict {
  if (!(error instanceof ApiError)) return "fail";
  if (error.isNetworkError) return "retry";
  const { status } = error;
  if (kind === "finish") {
    // Spec 06.7 AC3: a replay of a finish the server already applied (or another device's finish) is reconciled by a read.
    if (status === 409 && error.type === "workout-finished") return "reconcile";
    if (status === 422 && isFutureEndedAt(error)) return "retry";
  }
  // A 404 means the target is gone: for a delete, a note, or a timer entry (Spec 10.7 AC36), nothing is left to do,
  // unless a finish waits on the workout (Spec 06.7 AC6): then the lifter must see what didn't save.
  if (status === 404 && kind === "delete") return "done";
  if (status === 404 && (kind === "note" || kind === "round" || kind === "result")) return context.finishWaiting ? "fail" : "done";
  if (status >= 500 || status === 408 || status === 429) return "retry";
  return "fail";
}

/** Delay before the attempt after attempt number `attempt` (1-based): 1, 2, 4, 8, 16, then 30 s, each ±20 %. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (1 - JITTER + 2 * JITTER * random()));
}

export function isNetworkFailure(error: unknown): boolean {
  return error instanceof ApiError && error.isNetworkError;
}

export function failureOf(error: unknown): OpFailure {
  if (error instanceof ApiError) return { status: error.status, type: error.type, requestId: error.requestId };
  return { status: 0, type: "unknown", requestId: null };
}
