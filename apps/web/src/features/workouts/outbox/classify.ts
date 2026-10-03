import { ApiError } from "../../../api";
import type { OpFailure, OutboxOp } from "./ops";

export type Verdict = "done" | "retry" | "fail";

const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30_000;
const JITTER = 0.2;

/** Spec 06.2 AC5: what to do with an op after the server (or the network) answered with `error`. */
export function classify(kind: OutboxOp["kind"], error: unknown): Verdict {
  if (!(error instanceof ApiError)) return "fail";
  if (error.isNetworkError) return "retry";
  const { status } = error;
  if (status === 404 && kind === "delete") return "done";
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
