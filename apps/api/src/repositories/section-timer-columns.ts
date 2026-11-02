/**
 * Spec 09.5 — the one mapping between a section's flat `timer_*` / `result_*` columns and the
 * `SectionTimer` / `SectionResult` DTOs, shared by routines, workouts and the export. The CHECKs in
 * migration 0018 guarantee every stored combination is one of the union's variants.
 */
import { Prisma } from "@prisma/client";
import type { SectionResult, SectionTimer, SectionTimerInput } from "@sin/core";
import { InternalError } from "../errors/app-error.js";

export interface TimerColumns {
  timer_format: string | null;
  timer_round_s: number | null;
  timer_rounds: number | null;
  timer_cap_s: number | null;
}

export interface ResultColumns {
  result_rounds: number | null;
  result_reps: number | null;
  result_finish_s: number | null;
  result_capped: boolean;
}

export function timerFromColumns(c: TimerColumns): SectionTimer | null {
  switch (c.timer_format) {
    case null:
      return null;
    case "set_timer":
      return { format: "set_timer", roundSeconds: c.timer_round_s!, rounds: c.timer_rounds! };
    case "amrap":
      return { format: "amrap", capSeconds: c.timer_cap_s! };
    case "time_cap":
      return { format: "time_cap", capSeconds: c.timer_cap_s };
    default:
      throw new InternalError("unknown stored section timer format");
  }
}

/** A request's timer as columns: `null` / absent = untimed (all NULL); a `time_cap` without a cap stores NULL. */
export function timerToColumns(t: SectionTimerInput | null | undefined): TimerColumns {
  if (t == null) return { timer_format: null, timer_round_s: null, timer_rounds: null, timer_cap_s: null };
  switch (t.format) {
    case "set_timer":
      return { timer_format: "set_timer", timer_round_s: t.roundSeconds, timer_rounds: t.rounds, timer_cap_s: null };
    case "amrap":
      return { timer_format: "amrap", timer_round_s: null, timer_rounds: null, timer_cap_s: t.capSeconds };
    case "time_cap":
      return { timer_format: "time_cap", timer_round_s: null, timer_rounds: null, timer_cap_s: t.capSeconds ?? null };
  }
}

/** `null` when all four are empty (AC10): `{ rounds: null, reps: null, finishSeconds: null, capped: false }` is never returned. */
export function resultFromColumns(c: ResultColumns): SectionResult | null {
  if (c.result_rounds === null && c.result_reps === null && c.result_finish_s === null && !c.result_capped) return null;
  return { rounds: c.result_rounds, reps: c.result_reps, finishSeconds: c.result_finish_s, capped: c.result_capped };
}

/**
 * A section's round times as one scalar subquery, ordered by round, `[]` when none. Shared by every
 * read and `RETURNING`, so a read never shows sections of one moment and rounds of another.
 * `sectionRef` is a SQL column reference (`'s.id'`, `'"workout_section".id'`), never user input.
 */
export function roundTimesJson(sectionRef: string): Prisma.Sql {
  return Prisma.raw(`COALESCE((
      SELECT json_agg(json_build_object('round', r.round_no, 'seconds', r.seconds) ORDER BY r.round_no)
      FROM "workout_section_round" r WHERE r.workout_section_id = ${sectionRef}
    ), '[]'::json)`);
}
