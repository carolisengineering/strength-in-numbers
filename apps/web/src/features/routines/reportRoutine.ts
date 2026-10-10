// apps/web/src/features/routines/reportRoutine.ts
import { reportError } from "../../observability/reportError";
import { classifyRoutineError } from "./routineErrors";

/** Static operation names — the only context a report carries (AC38). */
export type RoutineReportOp = "load-routines" | "load-routine" | "save-routine" | "delete-routine" | "validate-draft";

/**
 * Report what we did not predict (Spec 10.0 AC11): an unrecognised problem, a non-`ApiError`, and a
 * `422` — the editor validates with the server's own schema, so a 422 means a client bug. Expected
 * conflicts, `404`, `429`, the network and `5xx` are not reported.
 */
export function reportRoutineUnexpected(op: RoutineReportOp, error: unknown): void {
  const { kind } = classifyRoutineError(error);
  if (kind !== "unknown" && kind !== "validation") return;
  reportError(error, { source: "routines", op });
}
