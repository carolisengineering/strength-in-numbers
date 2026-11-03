import { CAP_MAX_ERROR, ROUND_LENGTH_MAX_ERROR, ROUNDS_RANGE_ERROR, TIMER_CHECK_ERROR } from "./timerCopy";
import type { TimerFieldErrors, TimerFieldName } from "./timerFields";

const FIELD_MESSAGES: Readonly<Record<TimerFieldName, string>> = {
  rounds: ROUNDS_RANGE_ERROR,
  roundSeconds: ROUND_LENGTH_MAX_ERROR,
  capSeconds: CAP_MAX_ERROR,
};

/**
 * Spec 10.7 AC10 / AC25 — where one server path under `prefix` sits: `prefix.rounds`,
 * `.roundSeconds` and `.capSeconds` under their field, `prefix` itself or any other path under it
 * under the group; `null` when the path isn't under `prefix`. The server's message is never read.
 */
export function timerErrorForPath(path: string, prefix: string): { field: TimerFieldName | "group"; message: string } | null {
  if (path !== prefix && !path.startsWith(`${prefix}.`)) return null;
  const sub = path.slice(prefix.length + 1);
  const known = sub === "rounds" || sub === "roundSeconds" || sub === "capSeconds" ? sub : null;
  return known === null ? { field: "group", message: TIMER_CHECK_ERROR } : { field: known, message: FIELD_MESSAGES[known] };
}

/** Spec 10.7 AC25 — a `422`'s `errors[]` as the Timer group's errors; `null` when none is a timer path. */
export function timerErrorsFromServer(fieldErrors: readonly { path: string }[], prefix: string): TimerFieldErrors | null {
  const errors: TimerFieldErrors = {};
  let any = false;
  for (const { path } of fieldErrors) {
    const hit = timerErrorForPath(path, prefix);
    if (hit === null) continue;
    any = true;
    errors[hit.field] ??= hit.message;
  }
  return any ? errors : null;
}
