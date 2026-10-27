import type { HevyLinkOrigin, HevyPair, HevySectionRule } from "@sin/core";
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
  /** Spec 19.0 AC35: the Hevy mapping (same shapes as the read) and every link, tombstones included. */
  hevy: {
    pairs: HevyPair[];
    sectionRules: HevySectionRule[];
    links: HevyExportLinkRecord[];
  };
}

/** One `hevy_link` row as the export carries it (`workoutId: null` is a tombstone). */
export interface HevyExportLinkRecord {
  workoutId: string | null;
  hevyWorkoutId: string | null;
  origin: HevyLinkOrigin;
  syncedAt: Date | null;
}

export interface AccountExportRepository {
  snapshot(userId: string): Promise<AccountSnapshot>;
}
