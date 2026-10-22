/**
 * Workout session lifecycle repository contract (Spec 05.0 §6, "Wiring
 * points"). Every method takes `actingUserId` first (DESIGN R8) — no handler
 * ever queries `workout` or `workout_exercise` by id alone. A malformed id is
 * `NotFoundError`, resolved by the branded guard before any query
 * (`isWorkoutId` / `isWorkoutExerciseId`), exactly as `exercise.prisma.ts`
 * does with `isExerciseId`.
 */
import type { FinishedEdit } from "./write-mode.js";
import type { DistanceUnit, PlannedSet, SetType, WeightUnit } from "@sin/core";
import type { PersonalRecordRecord } from "./personal-record.js";

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
  /** Spec 09: `routine_name_snapshot` — set at start-from-routine, never updated. */
  routineName: string | null;
  /** Spec 07.4 §4: `planned_duration_s` — a live workout's planned "took"; always null once finished. */
  plannedDurationS: number | null;
}

/** One history row (Spec 07.1 §6.4): the workout plus its summary. Volume stays
 * in integer milli here; the route converts it (D5). */
export interface WorkoutSummaryRecord extends WorkoutRecord {
  exerciseCount: number;
  exerciseNames: string[];
  workingSetCount: number;
  totalVolumeMilli: number | null;
  recordCount: number;
}

export interface ListFinishedWorkoutsOptions {
  limit: number;
  /** The raw token from the client — decoded (and 422'd) by the repository (D8). */
  cursor?: string | undefined;
}

export interface WorkoutHistoryPage {
  items: WorkoutSummaryRecord[];
  /** Encoded cursor for the next page, or null when this is the last. */
  next: string | null;
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
  // Spec 09 §4: target snapshots (RPE in tenths — the route converts with
  // `tenthsToRpe`) and the live superset group.
  targetSets: number | null;
  targetRepsLow: number | null;
  targetRepsHigh: number | null;
  targetRpeTenths: number | null;
  restSeconds: number | null;
  supersetGroup: number | null;
  /** Spec 09.1 — snapshotted from the routine item at start, ordered by position; `[]` otherwise. */
  plannedSets: PlannedSet[];
  /** Spec 09.2 */
  sectionId: string | null;
}

export interface WorkoutSectionRecord {
  id: string;
  position: number;
  name: string;
  notes: string | null;
}

export interface WorkoutDetailRecord extends WorkoutRecord {
  /** Ordered by `position` ascending (§6.7). */
  exercises: WorkoutExerciseDetailRecord[];
  /** Spec 09.2 — the routine's own note as it was at start; null for a manual start. */
  routineNotes: string | null;
  /** Spec 09.2 — ordered by position ascending. */
  sections: WorkoutSectionRecord[];
  /** Spec 09.3 — the workout's routine exists and is a one-off now. */
  routineIsOneOff: boolean;
}

/** The fields a caller supplies on create (Spec 05.0 §5, §6.1, §6.3). */
export interface CreateWorkoutFields {
  clientGeneratedId: string;
  startedAt: Date;
  /** Absent -> resolved server-side from `user.timezone` (§6.3). */
  tzOffsetMinutes: number | undefined;
  title: string | null | undefined;
  notes: string | null | undefined;
  /** Spec 09 D11: copy this routine's items into the new workout (§6.5). */
  routineId?: string | undefined;
}

/** `PATCH /v1/workouts/{id}` body, already schema-validated (§5, §6.5). */
export interface UpdateWorkoutFields {
  title?: string | null;
  notes?: string | null;
  endedAt?: string | null;
  /** Spec 07.4 §5.1 (Change Time): checked by `resolveRetime` on the merged result. */
  startedAt?: string;
  tzOffsetMinutes?: number;
  durationSeconds?: number | null;
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
  /** Spec 09 D10. Key present with `null` clears the group. */
  supersetGroup?: number | null;
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
  /** Spec 07.4 §9: set iff this was a finished-mode write (the route logs `workout_edited`). */
  finishedEdit: FinishedEdit | null;
}

/**
 * A fresh create (`201`) vs. an idempotent replay (`200`) — the route uses
 * this to pick the status code and whether to set `Location` (§6.1).
 */
export interface CreateWorkoutResult {
  workout: WorkoutRecord;
  created: boolean;
  /** Spec 09 §9: `workout_exercise` rows copied from the routine — 0 for a
   * manual start and for a replay (nothing is copied twice, AC18). */
  copiedCount: number;
  /** Spec 09.1 §9: `workout_planned_set` rows copied — 0 for a manual start and for a replay. */
  plannedSetCount: number;
  /** Spec 09.2 §9: `workout_section` rows copied — 0 for a manual start and for a replay. */
  sectionCount: number;
}

/**
 * `updateWorkout`'s result (§9): `exerciseCount` is a `count` of the
 * workout's `workout_exercise` rows taken from inside the same transaction
 * as the write, so the route can log `workout_finished`'s `exercise_count`
 * without a second round trip.
 */
/** Spec 07.4 §9: a write result carrying what a finished-mode write did (null in live mode), for the
 * route's `workout_edited` line. Mappers pick fields explicitly, so it never reaches a response. */
export type WithFinishedEdit<T> = T & { finishedEdit: FinishedEdit | null };

export interface UpdateWorkoutResult {
  workout: WorkoutRecord;
  exerciseCount: number;
  /** Spec 07.0 §6.3: the records this workout holds after a finish — `[]`
   * for any non-finish PATCH. */
  newRecords: PersonalRecordRecord[];
  /** Spec 07.4 §9: set iff a finished workout's title/notes changed (the route logs `workout_edited`). */
  finishedEdit: FinishedEdit | null;
  /** Spec 07.4 §9: true iff this request finished a workout that had a planned duration (`workout_finished`). */
  hadPlannedDuration: boolean;
  /** Spec 07.4 §9: set iff the patch carried `startedAt` or `durationSeconds` (the route logs `workout_retimed`). */
  retime: RetimeOutcome | null;
}

/** Spec 07.4 §9 — a Change Time's effect. `startShiftSeconds` is null unless the start moved;
 * `durationSeconds` is the resulting finished duration, or the stored plan on a live workout. */
export interface RetimeOutcome {
  wasFinished: boolean;
  startShiftSeconds: number | null;
  durationSeconds: number | null;
  startedAt: Date;
  recordsRecomputed: boolean;
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

  /** `GET /v1/workouts` (Spec 07.1): the caller's finished workouts, newest
   * first, keyset-paged. Throws `ValidationError` (422) on a malformed cursor,
   * before any query. */
  listFinishedWorkouts(actingUserId: string, opts: ListFinishedWorkoutsOptions): Promise<WorkoutHistoryPage>;

  /**
   * `PATCH /v1/workouts/{id}` (§6.5). Applies `title`/`notes`/`endedAt`
   * (finish transition) atomically under an exclusive row lock taken ahead of
   * every check (Global Constraints, this plan). On a finished workout (Spec 07.4) only
   * `title`/`notes` apply and `{}`/`endedAt: null` are no-ops. Throws `NotFoundError`,
   * `WorkoutFinishedError` (409, a non-null `endedAt` on an already-finished workout), or
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
   * `NotFoundError` (workout or exerciseId not visible),
   * `ExerciseRetiredError` (409, from 03.2), or `ValidationError` (422,
   * out-of-range `position`). Works on a finished workout too (Spec 07.4, finished mode).
   */
  addWorkoutExercise(
    actingUserId: string,
    workoutId: string,
    fields: AddWorkoutExerciseFields,
  ): Promise<WithFinishedEdit<WorkoutExerciseRecord>>;

  /** Reorder and/or edit notes / supersetGroup (§6.7), live or finished (Spec 07.4). Throws
   * `NotFoundError` or `ValidationError` (422, out-of-range `position`). */
  updateWorkoutExercise(
    actingUserId: string,
    id: string,
    patch: UpdateWorkoutExerciseFields,
  ): Promise<WithFinishedEdit<WorkoutExerciseRecord> & { moved: boolean }>;

  /** Delete + close the position gap (§6.7), live or finished. Throws `NotFoundError`, or
   * `WorkoutWouldBeEmptyError` (409) when it would leave a finished workout with no sets (Spec 07.4). */
  deleteWorkoutExercise(actingUserId: string, id: string): Promise<{ finishedEdit: FinishedEdit | null }>;

  /**
   * Spec 05.1 §6.2/§6.3. Resolves the workout_exercise through its workout
   * (404 not 403), validates the body against its modality (§6.1), then
   * appends at `max(set_number) + 1` under a per-workout_exercise advisory
   * lock. A `clientGeneratedId` already stored under this workout_exercise
   * returns that row with `created: false`, ahead of any lock and the validation
   * (D15). On a finished workout it runs in finished mode (Spec 07.4: a working set must be
   * complete, `completed_at` clamped into the span). Throws `NotFoundError`, `ValidationError`.
   */
  createSet(actingUserId: string, workoutExerciseId: string, fields: CreateSetFields): Promise<CreateSetResult>;

  /** Spec 05.1 §6.4 + D10. Merge-then-validate against the stored row, under a
   * `FOR SHARE` re-check of the parent workout; live or finished (Spec 07.4). Throws
   * `NotFoundError`, `ValidationError`. */
  updateSet(actingUserId: string, id: string, patch: UpdateSetFields): Promise<{ set: SetEntryRecord; finishedEdit: FinishedEdit | null }>;

  /** Spec 05.1 §6.4 + D10. Hard delete, no renumbering; live or finished (Spec 07.4). Throws
   * `NotFoundError`, or `WorkoutWouldBeEmptyError` (409) for a finished workout's last set. */
  deleteSet(actingUserId: string, id: string): Promise<{ finishedEdit: FinishedEdit | null }>;
}
