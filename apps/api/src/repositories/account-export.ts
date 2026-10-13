import type { ExerciseRecord } from "./exercise.js";
import type { RoutineRecord } from "./routine.js";
import type { UserRecord } from "./user.js";
import type { WorkoutDetailRecord } from "./workout.js";

/** Spec 11 §6.2 — everything one user owns, read in one consistent snapshot. */
export interface AccountSnapshot {
  /** The database clock at the start of the snapshot. */
  exportedAt: Date;
  user: UserRecord;
  /** Custom exercises incl. soft-deleted and forks; `created_at, id`. */
  exercises: ExerciseRecord[];
  /** `lower(name), id`; items by position. */
  routines: RoutineRecord[];
  /** Finished and in-progress, `started_at, id`; exercises by position, sets by set number. */
  workouts: WorkoutDetailRecord[];
}

export interface AccountExportRepository {
  snapshot(userId: string): Promise<AccountSnapshot>;
}
