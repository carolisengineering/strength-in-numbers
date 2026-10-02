/**
 * Workout session lifecycle repository contract (Spec 05.0 §6, "Wiring
 * points"). Every method takes `actingUserId` first (DESIGN R8) — no handler
 * ever queries `workout` or `workout_exercise` by id alone. A malformed id is
 * `NotFoundError`, resolved by the branded guard before any query
 * (`isWorkoutId` / `isWorkoutExerciseId`), exactly as `exercise.prisma.ts`
 * does with `isExerciseId`.
 */
import type { DistanceUnit, SetType, WeightUnit } from "@sin/core";

export interface WorkoutRecord {
  id: string;
  userId: string;
  title: string | null;
  notes: string | null;
  startedAt: Date;
  endedAt: Date | null;
  /** "YYYY-MM-DD" — derived once at create time, never re-derived (§6.3). */
  localDate: string;
  tzOffsetMinutes: number;
  clientGeneratedId: string;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkoutExerciseRecord {
  id: string;
  workoutId: string;
  position: number;
  exerciseId: string;
  exerciseNameSnapshot: string;
  modalitySnapshot: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkoutDetailRecord extends WorkoutRecord {
  /** Ordered by `position` ascending (§6.7). */
  exercises: WorkoutExerciseDetailRecord[];
}

/** The fields a caller supplies on create (Spec 05.0 §5, §6.1, §6.3). */
export interface CreateWorkoutFields {
  clientGeneratedId: string;
  startedAt: Date;
  /** Absent -> resolved server-side from `user.timezone` (§6.3). */
  tzOffsetMinutes: number | undefined;
  title: string | null | undefined;
  notes: string | null | undefined;
}

/** `PATCH /v1/workouts/{id}` body, already schema-validated (§5, §6.5). */
export interface UpdateWorkoutFields {
  title?: string | null;
  notes?: string | null;
  endedAt?: string | null;
}

/** `POST /v1/workouts/{id}/exercises` body (§5, §6.6). */
export interface AddWorkoutExerciseFields {
  exerciseId: string;
  position?: number;
  notes?: string | null;
}

/** `PATCH /v1/workout-exercises/{id}` body (§5, §6.7). */
export interface UpdateWorkoutExerciseFields {
  position?: number;
  notes?: string | null;
}

/** One `set_entry` row (Spec 05.1 §4). `weightKg` / `distanceM` are the
 * generated canonical-unit columns — read, never written. */
export interface SetEntryRecord {
  id: string;
  workoutExerciseId: string;
  /** The create's idempotency key; `null` when it sent none (Spec 05.1 D15). */
  clientGeneratedId: string | null;
  setNumber: number;
  setType: string;
  reps: number | null;
  weight: number | null;
  weightUnit: string | null;
  weightKg: number | null;
  distance: number | null;
  distanceUnit: string | null;
  distanceM: number | null;
  durationS: number | null;
  rpe: number | null;
  isComplete: boolean;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** `POST /v1/workout-exercises/{id}/sets` body, already schema-validated
 * (Spec 05.1 §5). Omitted = not sent; `null` = explicitly empty. */
export interface CreateSetFields {
  /** Idempotency key, unique per workout_exercise (Spec 05.1 §6.2, D15). */
  clientGeneratedId?: string;
  setType?: SetType;
  reps?: number | null;
  weight?: number | null;
  weightUnit?: WeightUnit | null;
  distance?: number | null;
  distanceUnit?: DistanceUnit | null;
  durationS?: number | null;
  rpe?: number | null;
  isComplete?: boolean;
}

/** `PATCH /v1/sets/{id}` body — create's fields minus the idempotency key
 * (Spec 05.1 §5). */
export type UpdateSetFields = Omit<CreateSetFields, "clientGeneratedId">;

export interface WorkoutExerciseDetailRecord extends WorkoutExerciseRecord {
  /** Ordered by `setNumber` ascending (Spec 05.1 AC12). */
  sets: SetEntryRecord[];
}

/** `createSet`'s result: the route logs `set_created` with the parent's
 * `modality_snapshot` (Spec 05.1 §6.6) without a second read. `created` is
 * `false` for an idempotent replay — `200`, no `Location`, no log line. */
export interface CreateSetResult {
  set: SetEntryRecord;
  modalitySnapshot: string;
  created: boolean;
}

/**
 * A fresh create (`201`) vs. an idempotent replay (`200`) — the route uses
 * this to pick the status code and whether to set `Location` (§6.1).
 */
export interface CreateWorkoutResult {
  workout: WorkoutRecord;
  created: boolean;
}

/**
 * `updateWorkout`'s result (§9): `exerciseCount` is a `count` of the
 * workout's `workout_exercise` rows taken from inside the same transaction
 * as the write, so the route can log `workout_finished`'s `exercise_count`
 * without a second round trip.
 */
export interface UpdateWorkoutResult {
  workout: WorkoutRecord;
  exerciseCount: number;
}

/**
 * `deleteWorkout`'s result (§9): both fields are read inside the delete
 * transaction *before* the `DELETE` statement runs, so the route can log
 * `workout_deleted`'s `was_finished` and `exercise_count`.
 */
export interface DeleteWorkoutResult {
  wasFinished: boolean;
  exerciseCount: number;
}

export interface WorkoutRepository {
  /**
   * Idempotent create (§6.1, §6.2, D40/D50). `created: true` -> `201` +
   * `Location`; `created: false` -> `200`, stored row, no `Location`. Throws
   * `WorkoutInProgressExistsError` (409) or `ValidationError` (422, clock-skew
   * — the route/handler layer runs the skew check before calling this, per
   * §6.1's "validation is a property of the request" ordering; see Task 18).
   */
  createWorkout(
    actingUserId: string,
    fields: CreateWorkoutFields,
    userTimezone: string,
  ): Promise<CreateWorkoutResult>;

  /** The caller's one in-progress workout, with its exercises. Throws
   * `NotFoundError` when none exists. */
  getActiveWorkout(actingUserId: string): Promise<WorkoutDetailRecord>;

  /** A workout by id, in progress or finished, with its exercises. Throws
   * `NotFoundError` on a miss, another user's row, or a malformed id. */
  getWorkoutById(actingUserId: string, id: string): Promise<WorkoutDetailRecord>;

  /**
   * `PATCH /v1/workouts/{id}` (§6.5). Applies `title`/`notes`/`endedAt`
   * (finish transition) atomically under an exclusive row lock taken ahead of
   * every check (Global Constraints, this plan). Throws `NotFoundError`,
   * `WorkoutFinishedError` (409, target already has `ended_at` set), or
   * `ValidationError` (422, `endedAt < startedAt` or the skew window —
   * evaluated inside the lock, after the finished-check), or
   * `IncompleteWorkingSetsError` (409, Spec 05.1 §6.5 — a finish with a
   * `working` set missing a required measure; checked after the endedAt rules).
   */
  updateWorkout(
    actingUserId: string,
    id: string,
    patch: UpdateWorkoutFields,
  ): Promise<UpdateWorkoutResult>;

  /** Hard delete, cascades to `workout_exercise` (§6.5's DELETE exemption).
   * Allowed on an in-progress or finished workout. Throws `NotFoundError` on
   * a miss or another user's row; idempotent-looking repeat calls throw
   * `NotFoundError` too (204 vs. 404 is the route's job). */
  deleteWorkout(actingUserId: string, id: string): Promise<DeleteWorkoutResult>;

  /**
   * Three-phase add (§6.6): resolve the workout and the exercise on the root
   * client, then open the position transaction (§6.7/§6.8). Throws
   * `NotFoundError` (workout or exerciseId not visible), `WorkoutFinishedError`,
   * `ExerciseRetiredError` (409, from 03.2), or `ValidationError` (422,
   * out-of-range `position`).
   */
  addWorkoutExercise(
    actingUserId: string,
    workoutId: string,
    fields: AddWorkoutExerciseFields,
  ): Promise<WorkoutExerciseRecord>;

  /** Reorder and/or edit notes (§6.7). Throws `NotFoundError`,
   * `WorkoutFinishedError`, or `ValidationError` (422, out-of-range `position`). */
  updateWorkoutExercise(
    actingUserId: string,
    id: string,
    patch: UpdateWorkoutExerciseFields,
  ): Promise<WorkoutExerciseRecord>;

  /** Delete + close the position gap (§6.7). Throws `NotFoundError` or
   * `WorkoutFinishedError`. */
  deleteWorkoutExercise(actingUserId: string, id: string): Promise<void>;

  /**
   * Spec 05.1 §6.2/§6.3. Resolves the workout_exercise through its workout
   * (404 not 403), validates the body against its modality (§6.1), then
   * appends at `max(set_number) + 1` under a per-workout_exercise advisory
   * lock. A `clientGeneratedId` already stored under this workout_exercise
   * returns that row with `created: false`, ahead of the finished check and
   * the validation (D15). Throws `NotFoundError`, `WorkoutFinishedError`,
   * `ValidationError`.
   */
  createSet(actingUserId: string, workoutExerciseId: string, fields: CreateSetFields): Promise<CreateSetResult>;

  /** Spec 05.1 §6.4 + D10. Merge-then-validate against the stored row, under a
   * `FOR SHARE` re-check of the parent workout. Throws `NotFoundError`,
   * `WorkoutFinishedError`, `ValidationError`. */
  updateSet(actingUserId: string, id: string, patch: UpdateSetFields): Promise<SetEntryRecord>;

  /** Spec 05.1 §6.4 + D10. Hard delete, no renumbering; no finished-workout
   * exemption. Throws `NotFoundError`, `WorkoutFinishedError`. */
  deleteSet(actingUserId: string, id: string): Promise<void>;
}
