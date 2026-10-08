import { reportError } from "../../observability/reportError";
import { classifyWorkoutError } from "./errors";
import type { Operation } from "./sessionErrors";

/** The write operations of §5.8 plus the reads (including Spec 08.0's history and records, Spec 08.1's progress list and series) and the start, all static names. */
export type ReportOp = Operation | "start-workout" | "load-active" | "load-workout" | "load-history" | "load-records" | "load-progress-list" | "load-progress-series";

/**
 * Report a failure the lifter cannot act on and we did not predict (Spec 06.1 §9): an unrecognised
 * problem type, or something that is not an `ApiError` at all. Expected failures — the network, the
 * 4xx cases in §5.8, a 5xx — are not reported (06.0 AC19's precedent).
 *
 * The context is two static strings, never the error's detail, never an id (AC35): Spec 13 owns the
 * real seam and the payload sanitising.
 */
export function reportUnexpected(op: ReportOp, error: unknown): void {
  if (classifyWorkoutError(error, { op }).kind !== "unknown") return;
  reportError(error, { source: "workouts", op });
}
