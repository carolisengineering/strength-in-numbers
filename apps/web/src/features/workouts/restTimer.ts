import type { SetType } from "@sin/core";

import { progressOf, runOf, type CurrentRow } from "./currentExercise";

/**
 * Spec 17.1 §6.10: a rest is a start time and a length, never a counter (§1.5). Every render derives what is left
 * from the clock, so a throttled tab, a locked phone or a reload cannot make it drift. Pure: no React, no DOM.
 */
export interface RestTimer {
  /** Epoch milliseconds. */
  readonly startedAt: number;
  readonly durationS: number;
}

/** AC43: whole seconds left, rounded up, clamped to `[0, durationS]` (a clock moved back never reads more than the rest). */
export function remainingSeconds(timer: RestTimer | null, now: number): number {
  if (timer === null) return 0;
  const left = Math.ceil((timer.startedAt + timer.durationS * 1000 - now) / 1000);
  return Math.min(timer.durationS, Math.max(0, left));
}

/** The line's fill: the fraction of the rest already taken, in `[0, 1]`, from the same `remainingSeconds`. */
export function restProgress(timer: RestTimer, now: number): number {
  return (timer.durationS - remainingSeconds(timer, now)) / timer.durationS;
}

export interface RestRow extends CurrentRow {
  readonly exercise: CurrentRow["exercise"] & { readonly restSeconds: number | null };
}

/**
 * AC41 / §6.10 "When it starts": the rest a log on `loggedId` starts, or `null` for none (the caller then clears any
 * running timer, AC42). `rows` already hold the new set. A superset member rests only when its log completed a round,
 * meaning the next member with a planned set left is not later in the run (the wrap, or the exercise itself).
 */
export function restAfterLog({ rows, loggedId, setType }: { rows: readonly RestRow[]; loggedId: string; setType: SetType }): { durationS: number } | null {
  const row = rows.find((r) => r.exercise.id === loggedId);
  if (row === undefined) return null;
  const rest = row.exercise.restSeconds;
  if (rest === null || rest <= 0 || setType === "warmup") return null;
  if (!rows.some((r) => progressOf(r.exercise).remaining > 0)) return null; // the last planned set: nothing follows (D8)
  const run = runOf(rows, loggedId);
  if (run !== null) {
    const k = run.findIndex((r) => r.exercise.id === loggedId);
    for (let step = 1; step < run.length; step += 1) {
      if (progressOf(run[(k + step) % run.length]!.exercise).remaining === 0) continue;
      if (k + step < run.length) return null; // mid-round: the next member to log comes later in the run
      break;
    }
  }
  return { durationS: rest };
}
