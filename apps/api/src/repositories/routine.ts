/**
 * Routine repository contract (Spec 09 §6.1). Every method takes
 * `actingUserId` first (DESIGN R8) and every query is scoped
 * `user_id = $acting` (§7): a foreign id is `NotFoundError`, never a 403. A
 * malformed id is `NotFoundError` too, resolved by the branded guard before
 * any query (`isRoutineId`), as `workout.ts` does with `isWorkoutId`.
 */

import type { PlannedSet, PlannedSetInput } from "@sin/core";

export interface RoutineItemRecord {
  id: string;
  routineId: string;
  position: number;
  exerciseId: string;
  targetSets: number | null;
  targetRepsLow: number | null;
  targetRepsHigh: number | null;
  /** Stored tenths (85 for 8.5) — the route converts with `tenthsToRpe` (D5). */
  targetRpeTenths: number | null;
  restSeconds: number | null;
  /** Dense 1, 2, 3 … by first appearance (D9), as stored. */
  supersetGroup: number | null;
  notes: string | null;
  /** Spec 09.1 — ordered by position; the source of the target columns. */
  sets: PlannedSet[];
  /** Spec 09.2 — null = loose. */
  sectionId: string | null;
}

export interface RoutineSectionRecord {
  id: string;
  position: number;
  name: string;
  notes: string | null;
}

export interface RoutineRecord {
  id: string;
  userId: string;
  name: string;
  notes: string | null;
  /** Spec 09.2 — ordered by position ascending. */
  sections: RoutineSectionRecord[];
  /** Ordered by `position` ascending. */
  items: RoutineItemRecord[];
  createdAt: Date;
  updatedAt: Date;
  /** Spec 09.3 — the one-off mark and expiry; `null` = an ordinary routine. */
  oneOffUntil: Date | null;
}

/** POST / PUT body, already schema-validated by `RoutineWriteSchema`: targets
 * are in wire units (RPE decimal), groups as the client sent them; position is
 * the array index. */
export interface RoutineWriteFields {
  name: string;
  notes?: string | null | undefined;
  /** Spec 09.2 — the routine's whole section list; `key` is request-local and never stored (D6). */
  sections?: { key: string; name: string; notes?: string | null | undefined }[] | undefined;
  items: {
    exerciseId: string;
    targetSets?: number | null | undefined;
    targetRepsLow?: number | null | undefined;
    targetRepsHigh?: number | null | undefined;
    targetRpe?: number | null | undefined;
    restSeconds?: number | null | undefined;
    supersetGroup?: number | null | undefined;
    notes?: string | null | undefined;
    /** Spec 09.1 — the row form; mutually exclusive with the quick-line fields (AC7). */
    sets?: PlannedSetInput[] | undefined;
    /** Spec 09.2 — a declared sections[*].key; null / absent = loose. */
    sectionKey?: string | null | undefined;
  }[];
}

/** POST body, validated by `RoutineCreateSchema` (Spec 09.3): the write fields plus the one-off choice. */
export interface RoutineCreateFields extends RoutineWriteFields {
  oneOff?: true | undefined;
}

/** Spec 09.3 §6.1 — told how many expired one-offs the sweep removed; called once, only when ≥ 1. */
export type SweepObserver = (removedCount: number) => void;

export interface RoutineRepository {
  /** The caller's routines: one-offs first, newest created first, then by `lower(name)`, `id` (AC2; Spec 09.3 AC3); items by position.
   * Sweeps the caller's expired one-offs first (Spec 09.3 §6.1). */
  list(actingUserId: string, onSwept?: SweepObserver): Promise<RoutineRecord[]>;

  /** Throws `NotFoundError` on a miss, a foreign row, or a malformed id (AC3). */
  getById(actingUserId: string, id: string): Promise<RoutineRecord>;

  /**
   * §6.3 create: per-user advisory lock, cap check (`RoutineLimitError`),
   * insert (`RoutineNameTakenError` on the unique index), one batched exercise
   * check (`ValidationError` 422 for absent / invisible, `ExerciseRetiredError`
   * with `errors[]` for retired), then the items with normalised groups.
   * Spec 09.3: sweeps expired one-offs after the lock, and the cap counts no expired one-off.
   */
  create(actingUserId: string, fields: RoutineCreateFields, onSwept?: SweepObserver): Promise<RoutineRecord>;

  /** §6.3 whole replace under a `FOR UPDATE` row lock; item ids are not stable
   * (D2). Throws `NotFoundError`, `RoutineNameTakenError`, `ValidationError`,
   * `ExerciseRetiredError`. */
  replace(actingUserId: string, id: string, fields: RoutineWriteFields): Promise<RoutineRecord>;

  /** Spec 09.3 §6.4 — clear the one-off mark (and bump `updated_at`). `changed: false` for an ordinary routine
   * or a repeat. Throws `NotFoundError` for a malformed, missing or foreign id (AC9). Never checks the cap. */
  keep(actingUserId: string, id: string): Promise<{ changed: boolean }>;

  /** Hard delete; the FK cascades items and nulls `workout.routine_id`.
   * Throws `NotFoundError` on a miss, a foreign row, or a repeat. */
  delete(actingUserId: string, id: string): Promise<void>;
}
