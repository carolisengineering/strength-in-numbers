/**
 * Routine repository contract (Spec 09 §6.1). Every method takes
 * `actingUserId` first (DESIGN R8) and every query is scoped
 * `user_id = $acting` (§7): a foreign id is `NotFoundError`, never a 403. A
 * malformed id is `NotFoundError` too, resolved by the branded guard before
 * any query (`isRoutineId`), as `workout.ts` does with `isWorkoutId`.
 */

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
}

export interface RoutineRecord {
  id: string;
  userId: string;
  name: string;
  notes: string | null;
  /** Ordered by `position` ascending. */
  items: RoutineItemRecord[];
  createdAt: Date;
  updatedAt: Date;
}

/** POST / PUT body, already schema-validated by `RoutineWriteSchema`: targets
 * are in wire units (RPE decimal), groups as the client sent them; position is
 * the array index. */
export interface RoutineWriteFields {
  name: string;
  notes?: string | null | undefined;
  items: {
    exerciseId: string;
    targetSets?: number | null | undefined;
    targetRepsLow?: number | null | undefined;
    targetRepsHigh?: number | null | undefined;
    targetRpe?: number | null | undefined;
    restSeconds?: number | null | undefined;
    supersetGroup?: number | null | undefined;
    notes?: string | null | undefined;
  }[];
}

export interface RoutineRepository {
  /** The caller's routines ordered by `lower(name)`, `id`, items by position (AC2). */
  list(actingUserId: string): Promise<RoutineRecord[]>;

  /** Throws `NotFoundError` on a miss, a foreign row, or a malformed id (AC3). */
  getById(actingUserId: string, id: string): Promise<RoutineRecord>;

  /**
   * §6.3 create: per-user advisory lock, cap check (`RoutineLimitError`),
   * insert (`RoutineNameTakenError` on the unique index), one batched exercise
   * check (`ValidationError` 422 for absent / invisible, `ExerciseRetiredError`
   * with `errors[]` for retired), then the items with normalised groups.
   */
  create(actingUserId: string, fields: RoutineWriteFields): Promise<RoutineRecord>;

  /** §6.3 whole replace under a `FOR UPDATE` row lock; item ids are not stable
   * (D2). Throws `NotFoundError`, `RoutineNameTakenError`, `ValidationError`,
   * `ExerciseRetiredError`. */
  replace(actingUserId: string, id: string, fields: RoutineWriteFields): Promise<RoutineRecord>;

  /** Hard delete; the FK cascades items and nulls `workout.routine_id`.
   * Throws `NotFoundError` on a miss, a foreign row, or a repeat. */
  delete(actingUserId: string, id: string): Promise<void>;
}
