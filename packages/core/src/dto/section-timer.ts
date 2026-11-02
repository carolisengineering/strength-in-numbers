/**
 * Spec 09.5 §5 — a section's timer plan, its recorded result and its round times. Imports only
 * `zod`, so `dto/workout.ts` and `dto/routine-section.ts` can both import it without a cycle.
 *
 * Every message here is static (#57): Zod's own, or a module constant.
 */
import { z } from "zod";
import { WorkoutSectionIdSchema } from "../ids.js";

export const TIMER_FORMAT_VALUES = ["set_timer", "amrap", "time_cap"] as const;
export type TimerFormat = (typeof TIMER_FORMAT_VALUES)[number];

/** Spec 09.5 D14 — the limits. A change is a forward migration (the CHECKs) plus these constants. */
export const TIMER_ROUND_SECONDS_MAX = 3600;
export const TIMER_ROUNDS_MAX = 100;
export const TIMER_CAP_SECONDS_MAX = 10800;
export const RESULT_ROUNDS_MAX = 999;
export const RESULT_REPS_MAX = 9999;

const UNKNOWN_TIMER_FORMAT = "unknown timer format";

const wholeNumber = (min: number, max: number) => z.number().int().min(min).max(max);

const SetTimerSchema = z.strictObject({
  format: z.literal("set_timer"),
  roundSeconds: wholeNumber(1, TIMER_ROUND_SECONDS_MAX),
  rounds: wholeNumber(1, TIMER_ROUNDS_MAX),
});
const AmrapSchema = z.strictObject({
  format: z.literal("amrap"),
  capSeconds: wholeNumber(1, TIMER_CAP_SECONDS_MAX),
});

/** The timer as returned: a `time_cap` always carries `capSeconds` (`null` = "For Time", no cap). */
export const SectionTimerSchema = z.discriminatedUnion(
  "format",
  [
    SetTimerSchema,
    AmrapSchema,
    z.strictObject({ format: z.literal("time_cap"), capSeconds: wholeNumber(1, TIMER_CAP_SECONDS_MAX).nullable() }),
  ],
  { message: UNKNOWN_TIMER_FORMAT },
);
export type SectionTimer = z.infer<typeof SectionTimerSchema>;

/** The timer as sent: a `time_cap` may omit `capSeconds`, stored and echoed as `null` (AC2). */
export const SectionTimerInputSchema = z.discriminatedUnion(
  "format",
  [
    SetTimerSchema,
    AmrapSchema,
    z.strictObject({ format: z.literal("time_cap"), capSeconds: wholeNumber(1, TIMER_CAP_SECONDS_MAX).nullable().optional() }),
  ],
  { message: UNKNOWN_TIMER_FORMAT },
);
export type SectionTimerInput = z.infer<typeof SectionTimerInputSchema>;

/** A workout section's result as returned; `null` on the section when nothing is recorded (AC10). */
export const SectionResultSchema = z.object({
  rounds: z.number().int().nullable(),
  reps: z.number().int().nullable(),
  finishSeconds: z.number().int().nullable(),
  capped: z.boolean(),
});
export type SectionResult = z.infer<typeof SectionResultSchema>;

/** `PUT /v1/workout-sections/{id}/result` (Phase B); absent = `null` / `false`. The format rules are `resultIssues`. */
export const SetSectionResultSchema = z.strictObject({
  rounds: wholeNumber(0, RESULT_ROUNDS_MAX).nullable().optional(),
  reps: wholeNumber(0, RESULT_REPS_MAX).nullable().optional(),
  finishSeconds: wholeNumber(1, TIMER_CAP_SECONDS_MAX).nullable().optional(),
  capped: z.boolean().optional(),
});
export type SetSectionResult = z.infer<typeof SetSectionResultSchema>;

/** `PUT /v1/workout-sections/{id}/round-times/{round}` (Phase B). The format rules are `roundTimeIssues`. */
export const SetRoundTimeSchema = z.strictObject({
  seconds: wholeNumber(1, TIMER_CAP_SECONDS_MAX),
});
export type SetRoundTime = z.infer<typeof SetRoundTimeSchema>;

/** One recorded round: a Set Timer's duration, or an AMRAP / Time Cap clock reading. */
export const RoundTimeSchema = z.object({
  round: z.number().int(),
  seconds: z.number().int(),
});
export type RoundTime = z.infer<typeof RoundTimeSchema>;

/** Spec 09.5 §6.9 — the fixed issue codes, in table order. A screen keys its wording on these, never on `message`. */
export const TIMER_ISSUE_CODES = [
  "round_beyond_rounds",
  "seconds_over_round",
  "seconds_over_cap",
  "seconds_not_after_previous",
  "seconds_not_before_next",
  "rounds_required",
  "reps_required",
  "finish_not_allowed",
  "capped_not_allowed",
  "rounds_reps_not_allowed",
  "finish_over_cap",
  "finish_required",
  "capped_needs_cap",
  "rounds_or_reps_required",
  "nothing_to_record",
  "fit_rounds_below_recorded",
  "fit_round_shorter_than_recorded",
  "fit_cap_below_reading",
  "fit_cap_below_finish",
  "fit_cap_removed_while_capped",
  "fit_result_on_set_timer",
] as const;
export type TimerIssueCode = (typeof TIMER_ISSUE_CODES)[number];

const DOES_NOT_FIT = "doesn't fit the recorded times";

/** §6.9's messages, verbatim. The `422` body carries these (never a value); the code stays in-process. */
export const TIMER_ISSUE_MESSAGES: Readonly<Record<TimerIssueCode, string>> = Object.freeze({
  round_beyond_rounds: "beyond the planned rounds",
  seconds_over_round: "longer than the round",
  seconds_over_cap: "past the time limit or cap",
  seconds_not_after_previous: "not later than the previous round",
  seconds_not_before_next: "not earlier than the next round",
  rounds_required: "required",
  reps_required: "required",
  finish_not_allowed: "not allowed here",
  capped_not_allowed: "not allowed here",
  rounds_reps_not_allowed: "not allowed with a finish time",
  finish_over_cap: "past the cap",
  finish_required: "give a finish time or mark the cap hit",
  capped_needs_cap: "needs a cap",
  rounds_or_reps_required: "give rounds or reps",
  nothing_to_record: "nothing to record",
  fit_rounds_below_recorded: DOES_NOT_FIT,
  fit_round_shorter_than_recorded: DOES_NOT_FIT,
  fit_cap_below_reading: DOES_NOT_FIT,
  fit_cap_below_finish: DOES_NOT_FIT,
  fit_cap_removed_while_capped: DOES_NOT_FIT,
  fit_result_on_set_timer: DOES_NOT_FIT,
});

export type TimerIssue = { path: string; code: TimerIssueCode; message: string };

/** Spec 09.5 §5 — the derived score as History sends it; mirrors `SectionScore` in `timer.ts` (a type test pins them). */
export const SectionScoreSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("total_time"), seconds: z.number().int(), rounds: z.number().int() }),
  z.object({ kind: z.literal("rounds_reps"), rounds: z.number().int(), reps: z.number().int() }),
  z.object({ kind: z.literal("finish_time"), seconds: z.number().int() }),
  z.object({ kind: z.literal("capped"), rounds: z.number().int().nullable(), reps: z.number().int().nullable() }),
]);

/** Spec 09.5 AC25 — one timed section of a History row: always has a timer; `score` is `sectionScore` of the section. */
export const TimedSectionSummarySchema = z.object({
  id: WorkoutSectionIdSchema,
  position: z.number().int().min(0),
  name: z.string(),
  timer: SectionTimerSchema,
  score: SectionScoreSchema.nullable(),
});
export type TimedSectionSummary = z.infer<typeof TimedSectionSummarySchema>;

export const ROUND_PARAM_MESSAGE = "a round number from 1 to 100";

/**
 * Spec 09.5 AC14 — `/v1/workout-sections/{id}/round-times/{round}`. `round` must be a canonical whole number
 * 1–100: `"03"`, `"3.0"`, `"1e1"`, `" 3"` and `"-1"` are refused, never coerced (Review Focus 1).
 */
export const SectionRoundParamsSchema = z.object({
  id: z.string(),
  round: z
    .string()
    .regex(/^[1-9]\d{0,2}$/, ROUND_PARAM_MESSAGE)
    .transform(Number)
    .pipe(z.number().max(TIMER_ROUNDS_MAX, ROUND_PARAM_MESSAGE)),
});
