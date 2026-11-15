import { SectionTimerSchema, TIMER_CAP_SECONDS_MAX, TIMER_ROUND_SECONDS_MAX } from "@sin/core";

const schemaMessage = (timer: unknown, field: string): string =>
  SectionTimerSchema.safeParse(timer).error!.issues.find((i) => i.path.join(".") === field)!.message;

/** The server's own `422` message for a length over its maximum, read from the `@sin/core` schema (minor 316). */
export const ROUND_SECONDS_MAX_MESSAGE = schemaMessage({ format: "set_timer", roundSeconds: TIMER_ROUND_SECONDS_MAX + 1, rounds: 1 }, "roundSeconds");
export const CAP_SECONDS_MAX_MESSAGE = schemaMessage({ format: "amrap", capSeconds: TIMER_CAP_SECONDS_MAX + 1 }, "capSeconds");

/** A timer `422` field error as the server sends it for a value over the maximum; any other path gets `other`. */
export const overMaxError = (path: string, other = "SERVER-SECRET"): { path: string; message: string } => ({
  path,
  message: path.endsWith(".roundSeconds") ? ROUND_SECONDS_MAX_MESSAGE : path.endsWith(".capSeconds") ? CAP_SECONDS_MAX_MESSAGE : other,
});
