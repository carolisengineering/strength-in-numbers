import type { FastifyBaseLogger } from "fastify";
import { WorkoutWouldBeEmptyError } from "../errors/app-error.js";
import type { RetimeOutcome } from "../repositories/workout.js";
import type { FinishedEdit } from "../repositories/write-mode.js";

/** Spec 07.4 §9 — one value per kind of finished-workout edit (ids and enums only, never a value). */
export type FinishedEditKind =
  | "set_added"
  | "set_changed"
  | "set_deleted"
  | "exercise_added"
  | "exercise_removed"
  | "exercise_moved"
  | "exercise_regrouped"
  | "exercise_noted"
  | "details_changed"
  // Spec 09.4 §9 — a workout's own sections, and an exercise moved between them.
  | "section_added"
  | "section_changed"
  | "section_removed"
  | "exercise_sectioned";

/** `workout_edited`, after commit, iff the write ran in finished mode. */
export function logFinishedEdit(log: FastifyBaseLogger, userId: string, edit: FinishedEditKind, finishedEdit: FinishedEdit | null): void {
  if (finishedEdit === null) return;
  log.info(
    {
      workout_id: finishedEdit.workoutId,
      user_id: userId,
      edit,
      records_recomputed: finishedEdit.recordsRecomputed,
      root_count: finishedEdit.rootCount,
      recompute_ms: finishedEdit.recomputeMs,
    },
    "workout_edited",
  );
}

const DAY_MS = 86_400_000;

/** §9 `workout_retimed`, after commit, iff the PATCH carried `startedAt` or `durationSeconds` (ids, enums and numbers only). */
export function logRetimed(log: FastifyBaseLogger, userId: string, workoutId: string, retime: RetimeOutcome | null, now: Date): void {
  if (retime === null) return;
  log.info(
    {
      workout_id: workoutId,
      user_id: userId,
      was_finished: retime.wasFinished,
      start_shift_seconds: retime.startShiftSeconds,
      duration_seconds: retime.durationSeconds,
      days_back: retime.startShiftSeconds === null ? null : Math.max(0, Math.floor((now.getTime() - retime.startedAt.getTime()) / DAY_MS)),
    },
    "workout_retimed",
  );
}

/** §9: a `PATCH /workout-exercises/{id}` is classified by the first of: sectioned (Spec 09.4 D12), moved, regrouped, noted. */
export function exerciseEditKind(moved: boolean, body: { supersetGroup?: unknown }, sectioned: boolean): FinishedEditKind {
  if (sectioned) return "exercise_sectioned";
  if (moved) return "exercise_moved";
  return "supersetGroup" in body ? "exercise_regrouped" : "exercise_noted";
}

/** Runs a delete; a refusal to empty a finished workout logs `workout_edit_refused` and still throws (the 409). */
export async function withRefusalLogged<T>(log: FastifyBaseLogger, userId: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof WorkoutWouldBeEmptyError) {
      log.info({ workout_id: error.workoutId, user_id: userId, reason: "would_be_empty" }, "workout_edit_refused");
    }
    throw error;
  }
}
