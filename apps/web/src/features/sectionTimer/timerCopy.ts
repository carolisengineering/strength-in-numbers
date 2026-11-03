import { SUPERSET_GROUP_MEMBERS_MAX, TIMER_CAP_SECONDS_MAX, TIMER_ROUND_SECONDS_MAX, TIMER_ROUNDS_MAX } from "@sin/core";
import { digitsToText, secondsToDigits } from "./clockDigits";
import type { TimerFormatChoice } from "./timerFields";

/** Spec 10.7 AC56: every timer string, in one place. Bounds come from `@sin/core` (AC5). */
const clock = (seconds: number) => digitsToText(secondsToDigits(seconds));

export const TIMER_LABEL = "Timer";
export const TIMER_FORMAT_LABELS: Readonly<Record<TimerFormatChoice, string>> = Object.freeze({
  none: "None",
  set_timer: "Set Timer",
  amrap: "AMRAP",
  time_cap: "Time Cap",
});
export const ROUNDS_LABEL = "Rounds";
export const ROUND_LENGTH_LABEL = "Round length";
export const TIME_LIMIT_LABEL = "Time limit";
export const CAP_LABEL = "Cap";

export const CLOCK_HINT = "Type the digits: 341 is 3:41.";
export const FOR_TIME_HINT = "Leave empty for For Time, with no cap.";

export const SECONDS_MAX_ERROR = "Seconds go up to 59.";
export const ENTER_ROUND_LENGTH = "Enter the round length.";
export const ENTER_ROUNDS = "Enter the number of rounds.";
export const ENTER_TIME_LIMIT = "Enter the time limit.";
export const ROUNDS_RANGE_ERROR = `Rounds go from 1 to ${TIMER_ROUNDS_MAX}.`;
export const ROUND_LENGTH_MAX_ERROR = `Keep the round length to ${clock(TIMER_ROUND_SECONDS_MAX)} or less.`;
export const CAP_MAX_ERROR = `Keep it to ${clock(TIMER_CAP_SECONDS_MAX)} or less.`;
export const TIMER_CHECK_ERROR = "Check the timer and try again.";

export const GROUP_CAP_LINE = `Only the first ${SUPERSET_GROUP_MEMBERS_MAX} exercises are grouped.`;

// Phase B: the times line (AC20) and History's "+n more" (AC21).
export const TIMES_ROUNDS_PREFIX = "Rounds ";
export const TIMES_READINGS_PREFIX = "Round ends ";
export const TIMES_SEPARATOR = " · ";
export const TIMES_GAP = "–";
export const timedMore = (n: number): string => `+${n} more`;
