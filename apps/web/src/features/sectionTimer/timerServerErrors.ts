import { SectionTimerSchema, TIMER_CAP_SECONDS_MAX, TIMER_ROUND_SECONDS_MAX } from "@sin/core";
import { CAP_MAX_ERROR, ROUND_LENGTH_MAX_ERROR, ROUNDS_RANGE_ERROR, TIMER_CHECK_ERROR } from "./timerCopy";
import type { TimerFieldErrors, TimerFieldName } from "./timerFields";

const FIELD_MESSAGES: Readonly<Record<TimerFieldName, string>> = {
  rounds: ROUNDS_RANGE_ERROR,
  roundSeconds: ROUND_LENGTH_MAX_ERROR,
  capSeconds: CAP_MAX_ERROR,
};

/** The schema's own message for one field's failure (static, #57), read once from `@sin/core`. */
function schemaMessage(timer: unknown, field: string): string | undefined {
  return SectionTimerSchema.safeParse(timer).error?.issues.find((i) => i.path.join(".") === field)?.message;
}

/**
 * Minor 316: the only server message the "or less" copy fits, per length field. Rounds' copy states the whole range,
 * so it fits any rounds failure.
 */
const KNOWN_MAX: Readonly<Record<"roundSeconds" | "capSeconds", string | undefined>> = {
  roundSeconds: schemaMessage({ format: "set_timer", roundSeconds: TIMER_ROUND_SECONDS_MAX + 1, rounds: 1 }, "roundSeconds"),
  capSeconds: schemaMessage({ format: "amrap", capSeconds: TIMER_CAP_SECONDS_MAX + 1 }, "capSeconds"),
};

/**
 * Spec 10.7 AC10 / AC25 — where one server path under `prefix` sits: `prefix.rounds`,
 * `.roundSeconds` and `.capSeconds` under their field, `prefix` itself or any other path under it
 * under the group; `null` when the path isn't under `prefix`. The server's message is compared with the known
 * maximum, never shown: a length field keeps its "or less" copy only for that one, and says Check the timer
 * otherwise (minor 316).
 */
export function timerErrorForPath(path: string, prefix: string, message: string): { field: TimerFieldName | "group"; message: string } | null {
  if (path !== prefix && !path.startsWith(`${prefix}.`)) return null;
  const sub = path.slice(prefix.length + 1);
  const known = sub === "rounds" || sub === "roundSeconds" || sub === "capSeconds" ? sub : null;
  if (known === null) return { field: "group", message: TIMER_CHECK_ERROR };
  if (known !== "rounds" && message !== KNOWN_MAX[known]) return { field: known, message: TIMER_CHECK_ERROR };
  return { field: known, message: FIELD_MESSAGES[known] };
}

/** Spec 10.7 AC25 — a `422`'s `errors[]` as the Timer group's errors; `null` when none is a timer path. */
export function timerErrorsFromServer(fieldErrors: readonly { path: string; message: string }[], prefix: string): TimerFieldErrors | null {
  const errors: TimerFieldErrors = {};
  let any = false;
  for (const { path, message } of fieldErrors) {
    const hit = timerErrorForPath(path, prefix, message);
    if (hit === null) continue;
    any = true;
    errors[hit.field] ??= hit.message;
  }
  return any ? errors : null;
}
