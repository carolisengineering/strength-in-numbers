import { TIMER_CAP_SECONDS_MAX, TIMER_ROUND_SECONDS_MAX, TIMER_ROUNDS_MAX, timersEqual, type SectionTimer, type SectionTimerInput, type TimerFormat } from "@sin/core";
import { digitsToSeconds, secondsToDigits } from "./clockDigits";
import {
  CAP_MAX_ERROR,
  ENTER_ROUND_LENGTH,
  ENTER_ROUNDS,
  ENTER_TIME_LIMIT,
  ROUND_LENGTH_MAX_ERROR,
  ROUNDS_RANGE_ERROR,
  SECONDS_MAX_ERROR,
} from "./timerCopy";

/** Spec 10.7 AC4–AC6: the Timer group's state, and its conversion to and from a `SectionTimer`. Pure. */
export type TimerFormatChoice = "none" | TimerFormat;

/** `capDigits` is the AMRAP time limit or the Time Cap cap. */
export type TimerFieldsValue = { format: TimerFormatChoice; rounds: string; roundDigits: string; capDigits: string };
export type TimerFieldName = "rounds" | "roundSeconds" | "capSeconds";
export type TimerFieldErrors = Partial<Record<TimerFieldName | "group", string>>;

const EMPTY = { rounds: "", roundDigits: "", capDigits: "" } as const;

export function fieldsFromTimer(timer: SectionTimer | null): TimerFieldsValue {
  if (timer === null) return { format: "none", ...EMPTY };
  switch (timer.format) {
    case "set_timer":
      return { format: "set_timer", ...EMPTY, rounds: String(timer.rounds), roundDigits: secondsToDigits(timer.roundSeconds) };
    case "amrap":
      return { format: "amrap", ...EMPTY, capDigits: secondsToDigits(timer.capSeconds) };
    case "time_cap":
      return { format: "time_cap", ...EMPTY, capDigits: timer.capSeconds === null ? "" : secondsToDigits(timer.capSeconds) };
  }
}

/** A different format starts its fields empty; the same format keeps them. */
export function withFormat(value: TimerFieldsValue, format: TimerFormatChoice): TimerFieldsValue {
  return value.format === format ? value : { format, ...EMPTY };
}

/** A clock field's seconds, or its error: empty → `ifEmpty`, seconds ≥ 60, or over `max`. */
function clockValue(digits: string, max: number, ifEmpty: string | null, overMax: string): { seconds: number | null } | { error: string } {
  if (digits === "") return ifEmpty === null ? { seconds: null } : { error: ifEmpty };
  const seconds = digitsToSeconds(digits);
  if (seconds === null) return { error: SECONDS_MAX_ERROR };
  if (seconds > max) return { error: overMax };
  return { seconds };
}

/** The timer the fields describe, or every field's error at once (AC5). An empty Time Cap is For Time. */
export function timerFromFields(value: TimerFieldsValue): { ok: true; timer: SectionTimer | null } | { ok: false; errors: TimerFieldErrors } {
  const errors: TimerFieldErrors = {};
  switch (value.format) {
    case "none":
      return { ok: true, timer: null };
    case "set_timer": {
      const length = clockValue(value.roundDigits, TIMER_ROUND_SECONDS_MAX, ENTER_ROUND_LENGTH, ROUND_LENGTH_MAX_ERROR);
      if ("error" in length) errors.roundSeconds = length.error;
      const rounds = value.rounds === "" ? null : Number.parseInt(value.rounds, 10);
      if (rounds === null) errors.rounds = ENTER_ROUNDS;
      else if (rounds < 1 || rounds > TIMER_ROUNDS_MAX) errors.rounds = ROUNDS_RANGE_ERROR;
      if (Object.keys(errors).length > 0 || "error" in length) return { ok: false, errors };
      return { ok: true, timer: { format: "set_timer", roundSeconds: length.seconds!, rounds: rounds! } };
    }
    case "amrap": {
      const cap = clockValue(value.capDigits, TIMER_CAP_SECONDS_MAX, ENTER_TIME_LIMIT, CAP_MAX_ERROR);
      if ("error" in cap) return { ok: false, errors: { capSeconds: cap.error } };
      return { ok: true, timer: { format: "amrap", capSeconds: cap.seconds! } };
    }
    case "time_cap": {
      const cap = clockValue(value.capDigits, TIMER_CAP_SECONDS_MAX, null, CAP_MAX_ERROR);
      if ("error" in cap) return { ok: false, errors: { capSeconds: cap.error } };
      return { ok: true, timer: { format: "time_cap", capSeconds: cap.seconds } };
    }
  }
}

/** The request form: a For Time cap omits `capSeconds` (spec AC6, 09.5 AC2). */
export function toTimerInput(timer: SectionTimer): SectionTimerInput {
  return timer.format === "time_cap" && timer.capSeconds === null ? { format: "time_cap" } : timer;
}

/** One timer equality for the server and the screens: `@sin/core` `timersEqual` (Spec 09.5 Phase B). */
export const sameTimer = timersEqual;
