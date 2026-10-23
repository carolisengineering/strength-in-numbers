import {
  clampInstantToSpan,
  isExerciseId,
  isRoutineId,
  isWorkoutExerciseId,
  isSetEntryId,
  isWorkoutId,
  localDateFor,
  normalizeSupersetGroups,
  ROUTINE_ONE_OFF_DAYS,
  ROUTINES_PER_USER_MAX,
  rpeToTenths,
  MAX_CUSTOM_EXERCISES_PER_USER,
  offsetMinutesForZone,
  parseWeightKgMilli,
  sumVolumeMilli,
  toCanonicalKg,
  toCanonicalMeters,
  WORKOUT_SUMMARY_NAMES_MAX,
  type Modality,
} from "@sin/core";
import { decodeWorkoutCursor, encodeWorkoutCursor } from "../../src/repositories/workout-cursor.js";
import { uuidv7 } from "uuidv7";
import type {
  ProfilePatch,
  ProvisionInput,
  ProvisionResult,
  UserRecord,
  UserRepository,
} from "../../src/repositories/user.js";
import type {
  CatalogPage,
  ExerciseRecord,
  ExerciseRepository,
  ExerciseWriteFields,
  ExerciseWritePatch,
  ReferenceRecord,
} from "../../src/repositories/exercise.js";
import {
  CustomExerciseLimitError,
  ExerciseAlreadyOwnedError,
  ExerciseImmutableError,
  ExerciseImmutableUseForkError,
  ExerciseRetiredError,
  IncompleteWorkingSetsError,
  NotFoundError,
  RoutineLimitError,
  RoutineNameTakenError,
  ValidationError,
  WorkoutFinishedError,
  WorkoutInProgressExistsError,
  WorkoutWouldBeEmptyError,
} from "../../src/errors/app-error.js";
import { assertMergedFieldsValid, mergeWritableFields } from "../../src/repositories/exercise-writes.js";
import { assertPlannedSetsFitModalities, resolveItemPlan } from "../../src/repositories/planned-sets.js";
import type {
  RoutineItemRecord,
  RoutineRecord,
  RoutineRepository,
  RoutineSectionRecord,
  RoutineCreateFields,
  RoutineWriteFields,
  SweepObserver,
} from "../../src/repositories/routine.js";
import {
  assertAddPositionInRange,
  assertReorderPositionInRange,
  computeAppendPosition,
  retimeOrThrow,
  retimeOutcome,
} from "../../src/repositories/workout-writes.js";
import {
  assertFinishedSetComplete,
  assertSetMeasuresValid,
  fieldsToMeasures,
  isWorkingSetComplete,
  mergeSetPatch,
  type MergedSet,
} from "../../src/repositories/set-writes.js";
import type {
  AddWorkoutExerciseFields,
  CreateWorkoutFields,
  CreateWorkoutResult,
  DeleteWorkoutResult,
  UpdateWorkoutExerciseFields,
  UpdateWorkoutFields,
  UpdateWorkoutResult,
  WithFinishedEdit,
  WorkoutDetailRecord,
  WorkoutExerciseRecord,
  WorkoutRecord,
  WorkoutSectionRecord,
  WorkoutRepository,
  WorkoutHistoryPage,
  ListFinishedWorkoutsOptions,
  CreateSetFields,
  CreateSetResult,
  SetEntryRecord,
  UpdateSetFields,
  OneOffOutcome,
} from "../../src/repositories/workout.js";
import type { AuthContext, TokenVerifier } from "../../src/auth/verify.js";
import type { FinishedEdit } from "../../src/repositories/write-mode.js";
import type { AccountExportRepository, AccountSnapshot } from "../../src/repositories/account-export.js";
import type {
  PersonalRecordFilter,
  PersonalRecordRecord,
  PersonalRecordRepository,
  ProgressPointRecord,
  ProgressRange,
  ProgressSeriesRecord,
} from "../../src/repositories/personal-record.js";

export function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  const now = new Date("2026-08-30T12:00:00.000Z");
  return {
    id: uuidv7(),
    authSub: "auth0|user-123",
    email: "a@b.com",
    emailVerified: false,
    displayName: null,
    unitPreference: "kg",
    timezone: "UTC",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

/** In-memory UserRepository for unit tests. */
export class FakeUserRepository implements UserRepository {
  private readonly bySub = new Map<string, UserRecord>();
  provisionCalls = 0;
  syncEmailCalls = 0;

  constructor(seed: UserRecord[] = []) {
    for (const u of seed) this.bySub.set(u.authSub, u);
  }

  seed(u: UserRecord): void {
    this.bySub.set(u.authSub, u);
  }

  private byId(id: string): UserRecord {
    const u = [...this.bySub.values()].find((x) => x.id === id);
    if (!u) throw new Error(`FakeUserRepository: no user ${id}`);
    return u;
  }

  getById(id: string): UserRecord {
    return this.byId(id);
  }

  async markDeleted(id: string): Promise<Date | null> {
    const u = this.byId(id);
    if (u.deletedAt !== null) return null;
    const updated: UserRecord = { ...u, deletedAt: new Date() };
    this.bySub.set(updated.authSub, updated);
    return updated.deletedAt;
  }

  async findByAuthSub(authSub: string): Promise<UserRecord | null> {
    return this.bySub.get(authSub) ?? null;
  }

  async provision(input: ProvisionInput): Promise<ProvisionResult> {
    this.provisionCalls += 1;
    const existing = this.bySub.get(input.authSub);
    if (existing) return { user: existing, isNewUser: false };
    const user = makeUser({
      authSub: input.authSub,
      email: input.email,
      emailVerified: input.emailVerified,
    });
    this.bySub.set(user.authSub, user);
    return { user, isNewUser: true };
  }

  async syncEmail(
    id: string,
    email: string,
    emailVerified: boolean,
  ): Promise<UserRecord> {
    this.syncEmailCalls += 1;
    const u = this.byId(id);
    const updated: UserRecord = {
      ...u,
      email,
      emailVerified,
      updatedAt: new Date(u.updatedAt.getTime() + 1000),
    };
    this.bySub.set(updated.authSub, updated);
    return updated;
  }

  async updateProfile(id: string, patch: ProfilePatch): Promise<UserRecord> {
    const u = this.byId(id);
    const updated: UserRecord = {
      ...u,
      ...(patch.displayName !== undefined
        ? { displayName: patch.displayName }
        : {}),
      ...(patch.unitPreference !== undefined
        ? { unitPreference: patch.unitPreference }
        : {}),
      ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
      updatedAt: new Date(u.updatedAt.getTime() + 1000),
    };
    this.bySub.set(updated.authSub, updated);
    return updated;
  }
}

export function makeExerciseRecord(
  overrides: Partial<ExerciseRecord> = {},
): ExerciseRecord {
  const now = new Date("2026-09-01T10:00:00.000Z");
  return {
    id: uuidv7(),
    catalogKey: "test-exercise",
    ownerUserId: null,
    name: "Test Exercise",
    modality: "weight_reps",
    primaryMuscleId: "chest",
    secondaryMuscleIds: [],
    equipmentId: "barbell",
    isActive: true,
    forkedFromExerciseId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Programmable in-memory ExerciseRepository for route/unit tests. It does not
 * reproduce the SQL visibility filter or the snapshot-token derivation (those
 * are covered by the repository integration tests) — set `catalog` / `delta` /
 * `syncToken` and inspect `lastActingUserId` / `lastSince` (the bare xid the
 * route passed). `nextFindError` makes the next `findCatalog` throw once.
 */
export class FakeExerciseRepository implements ExerciseRepository {
  catalog: ExerciseRecord[] = [];
  delta: ExerciseRecord[] = [];
  syncToken = "1.100";
  muscleGroups: ReferenceRecord[] = [];
  equipment: ReferenceRecord[] = [];
  byId = new Map<string, ExerciseRecord>();

  /** Overridable in tests to exercise the cap boundary without 500 inserts. */
  cap = MAX_CUSTOM_EXERCISES_PER_USER;

  lastActingUserId: string | null = null;
  lastSince: string | null = null;
  /** One-shot: thrown by the next `findCatalog` (e.g. a SyncTokenExpiredError). */
  nextFindError: Error | null = null;

  async findCatalog(
    actingUserId: string,
    since?: string,
  ): Promise<CatalogPage> {
    this.lastActingUserId = actingUserId;
    this.lastSince = since ?? null;
    if (this.nextFindError) {
      const e = this.nextFindError;
      this.nextFindError = null;
      throw e;
    }
    return {
      rows: since === undefined ? this.catalog : this.delta,
      syncToken: this.syncToken,
    };
  }

  async findVisibleById(
    actingUserId: string,
    id: string,
  ): Promise<ExerciseRecord> {
    this.lastActingUserId = actingUserId;
    // Mirrors the Prisma implementation: a non-UUID is "not found", never a throw
    // from the driver, and another user's custom row is as invisible as an absent
    // one (`owner_user_id IS NULL OR owner_user_id = $acting`, Spec 03.2 AC8; #26).
    const row = isExerciseId(id) ? this.byId.get(id) : undefined;
    if (!row || (row.ownerUserId !== null && row.ownerUserId !== actingUserId)) throw new NotFoundError("exercise not found");
    return row;
  }

  private validateReferences(fields: ExerciseWriteFields): void {
    const muscleIds = new Set(this.muscleGroups.map((m) => m.id));
    const equipmentIds = new Set(this.equipment.map((e) => e.id));
    const fieldErrors: { path: string; message: string }[] = [];
    if (fields.primaryMuscleId !== null && !muscleIds.has(fields.primaryMuscleId)) {
      fieldErrors.push({ path: "primaryMuscleId", message: "must reference an existing muscle group" });
    }
    if (fields.secondaryMuscleIds.some((id) => !muscleIds.has(id))) {
      fieldErrors.push({ path: "secondaryMuscleIds", message: "must reference existing muscle groups" });
    }
    if (fields.equipmentId !== null && !equipmentIds.has(fields.equipmentId)) {
      fieldErrors.push({ path: "equipmentId", message: "must reference an existing equipment id" });
    }
    if (fieldErrors.length > 0) {
      throw new ValidationError(
        fieldErrors,
        "create/fork references unknown muscle group or equipment ids",
      );
    }
  }

  private activeCount(actingUserId: string): number {
    return [...this.byId.values()].filter(
      (r) => r.ownerUserId === actingUserId && r.isActive,
    ).length;
  }

  private insertOwned(
    actingUserId: string,
    fields: ExerciseWriteFields,
    forkedFromExerciseId: string | null,
  ): ExerciseRecord {
    if (this.activeCount(actingUserId) >= this.cap) {
      throw new CustomExerciseLimitError();
    }
    const now = new Date();
    const row: ExerciseRecord = {
      id: uuidv7(),
      catalogKey: null,
      ownerUserId: actingUserId,
      forkedFromExerciseId,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      ...fields,
    };
    this.byId.set(row.id, row);
    return row;
  }

  async createExercise(
    actingUserId: string,
    fields: ExerciseWriteFields,
  ): Promise<ExerciseRecord> {
    this.validateReferences(fields);
    return this.insertOwned(actingUserId, fields, null);
  }

  async updateExercise(
    actingUserId: string,
    id: string,
    patch: ExerciseWritePatch,
  ): Promise<ExerciseRecord> {
    const before = await this.findVisibleById(actingUserId, id);
    if (!before.isActive) throw new ExerciseRetiredError(); // retired before global, as the real repository (#25)
    if (before.ownerUserId !== actingUserId) throw new ExerciseImmutableUseForkError();
    const merged = mergeWritableFields(before, patch);
    assertMergedFieldsValid(merged, patch);
    this.validateReferences(merged);
    const updated: ExerciseRecord = {
      ...before,
      ...merged,
      updatedAt: new Date(before.updatedAt.getTime() + 1000),
    };
    this.byId.set(updated.id, updated);
    return updated;
  }

  async forkExercise(
    actingUserId: string,
    originId: string,
    overlay: ExerciseWritePatch,
  ): Promise<ExerciseRecord> {
    const origin = await this.findVisibleById(actingUserId, originId);
    if (origin.ownerUserId === actingUserId) throw new ExerciseAlreadyOwnedError();
    if (!origin.isActive) throw new ExerciseRetiredError();
    const merged = mergeWritableFields(origin, overlay);
    assertMergedFieldsValid(merged, overlay);
    this.validateReferences(merged);
    return this.insertOwned(actingUserId, merged, origin.id);
  }

  async deleteExercise(actingUserId: string, id: string): Promise<void> {
    const target = await this.findVisibleById(actingUserId, id);
    if (target.ownerUserId === null) throw new ExerciseImmutableError();
    if (target.isActive) {
      this.byId.set(id, { ...target, isActive: false, updatedAt: new Date() });
    }
  }

  async listMuscleGroups(): Promise<ReferenceRecord[]> {
    return this.muscleGroups;
  }

  async listEquipment(): Promise<ReferenceRecord[]> {
    return this.equipment;
  }
}

export function makeWorkoutRecord(overrides: Partial<WorkoutRecord> = {}): WorkoutRecord {
  const now = new Date("2026-09-15T10:00:00.000Z");
  return {
    id: uuidv7(),
    userId: uuidv7(),
    title: null,
    notes: null,
    startedAt: now,
    endedAt: null,
    localDate: "2026-09-15",
    tzOffsetMinutes: 0,
    clientGeneratedId: uuidv7(),
    source: "manual",
    createdAt: now,
    updatedAt: now,
    routineName: null,
    plannedDurationS: null,
    ...overrides,
  };
}

/**
 * In-memory WorkoutRepository for route/unit tests (Spec 05.0 §6, Wiring
 * points). Does not reproduce the SQL-level concurrency guarantees (the
 * advisory lock, the deferred constraint, the D40/D50 outcome switch) — those
 * are covered by `workout.prisma.ts`'s own tests against a scripted Prisma
 * client and by the Testcontainers integration suite. This fake exists so
 * route-level tests can assert status codes, headers and DTO shapes without a
 * database.
 */
export class FakeWorkoutRepository implements WorkoutRepository {
  workouts = new Map<string, WorkoutRecord>();
  exercises = new Map<string, WorkoutExerciseRecord>();
  sets = new Map<string, SetEntryRecord>();
  private byClientKey = new Map<string, string>();
  /** Spec 09.2 — per workout: the routine note snapshot and the copied sections; Spec 09.3 adds the routine it
   * came from, for `routineIsOneOff` and the sweep's "held by a live workout" rule. */
  sectionsByWorkout = new Map<
    string,
    { routineNotes: string | null; sections: WorkoutSectionRecord[]; routineId?: string | null }
  >();

  constructor(
    private readonly exerciseRepository: ExerciseRepository = new FakeExerciseRepository(),
    /** Spec 09: the routine source for `createWorkout({ routineId })`. */
    private readonly routineRepository?: FakeRoutineRepository,
  ) {
    if (routineRepository) {
      routineRepository.liveRoutineIds = () =>
        new Set(
          [...this.sectionsByWorkout.entries()]
            .filter(([workoutId, snap]) => snap.routineId && this.workouts.get(workoutId)?.endedAt === null)
            .map(([, snap]) => snap.routineId!),
        );
    }
  }

  private ownedWorkoutOrThrow(actingUserId: string, id: string): WorkoutRecord {
    const w = isWorkoutId(id) ? this.workouts.get(id) : undefined;
    if (!w || w.userId !== actingUserId) throw new NotFoundError("workout not found");
    return w;
  }

  private detail(w: WorkoutRecord): WorkoutDetailRecord {
    const exercises = [...this.exercises.values()]
      .filter((e) => e.workoutId === w.id)
      .sort((a, b) => a.position - b.position)
      .map((e) => ({
        ...e,
        sets: [...this.sets.values()]
          .filter((s) => s.workoutExerciseId === e.id)
          .sort((a, b) => a.setNumber - b.setNumber),
      }));
    const snap = this.sectionsByWorkout.get(w.id);
    const routineId = snap?.routineId ?? null;
    const routineIsOneOff = routineId !== null && this.routineRepository?.routines.get(routineId)?.oneOffUntil != null;
    return { ...w, exercises, routineNotes: snap?.routineNotes ?? null, sections: snap?.sections ?? [], routineIsOneOff };
  }

  /** Canonical columns the way Postgres generates them (numeric(…,3) rounding). */
  private static withCanonical(m: MergedSet): Pick<SetEntryRecord, "weightKg" | "distanceM"> {
    const round3 = (x: number) => Math.round(x * 1000) / 1000;
    return {
      weightKg: m.weight !== null && m.weightUnit !== null ? round3(toCanonicalKg(m.weight, m.weightUnit)) : null,
      distanceM:
        m.distance !== null && m.distanceUnit !== null ? round3(toCanonicalMeters(m.distance, m.distanceUnit)) : null,
    };
  }

  /** Drops every set under the given workout_exercise ids (the FK cascade). */
  private cascadeSets(workoutExerciseIds: Set<string>): void {
    for (const [id, s] of this.sets) {
      if (workoutExerciseIds.has(s.workoutExerciseId)) this.sets.delete(id);
    }
  }

  async createWorkout(
    actingUserId: string,
    fields: CreateWorkoutFields,
    userTimezone: string,
  ): Promise<CreateWorkoutResult> {
    const key = `${actingUserId}:${fields.clientGeneratedId}`;
    const existingId = this.byClientKey.get(key);
    if (existingId) {
      return { workout: this.workouts.get(existingId)!, created: false, copiedCount: 0, plannedSetCount: 0, sectionCount: 0 };
    }
    const hasActive = [...this.workouts.values()].some(
      (w) => w.userId === actingUserId && w.endedAt === null,
    );
    if (hasActive) throw new WorkoutInProgressExistsError();

    const startedAtIso = fields.startedAt.toISOString();
    const tzOffsetMinutes =
      fields.tzOffsetMinutes ?? offsetMinutesForZone(startedAtIso, userTimezone);
    const localDate = localDateFor(startedAtIso, tzOffsetMinutes);
    const now = new Date();
    const workout: WorkoutRecord = {
      id: uuidv7(),
      userId: actingUserId,
      title: fields.title ?? null,
      notes: fields.notes ?? null,
      startedAt: fields.startedAt,
      endedAt: null,
      localDate,
      tzOffsetMinutes,
      clientGeneratedId: fields.clientGeneratedId,
      source: "manual",
      createdAt: now,
      updatedAt: now,
      routineName: null,
      plannedDurationS: null,
    };
    const copied: WorkoutExerciseRecord[] = [];
    let sectionRecords: WorkoutSectionRecord[] = [];
    let routineNotes: string | null = null;
    if (fields.routineId !== undefined) {
      // Spec 09 §6.5 in miniature: 404 for an absent/foreign routine, 409 on a
      // retired item (nothing persisted), else copy every item in order.
      const routine = await this.routineRepository!.getById(actingUserId, fields.routineId);
      sectionRecords = routine.sections.map((s) => ({ id: uuidv7(), position: s.position, name: s.name, notes: s.notes }));
      const wsByRoutineSection = new Map(routine.sections.map((s, j) => [s.id, sectionRecords[j]!.id]));
      routineNotes = routine.notes;
      for (const item of routine.items) {
        const exercise = await this.exerciseRepository.findVisibleById(actingUserId, item.exerciseId);
        if (!exercise.isActive) {
          throw new ExerciseRetiredError(`routine item ${item.position} is retired`, {
            fieldErrors: [
              { path: "routineId", message: `item at position ${item.position} refers to a retired exercise` },
            ],
          });
        }
        copied.push({
          id: uuidv7(),
          workoutId: workout.id,
          position: item.position,
          exerciseId: exercise.id,
          exerciseNameSnapshot: exercise.name,
          modalitySnapshot: exercise.modality,
          notes: item.notes,
          createdAt: now,
          updatedAt: now,
          targetSets: item.targetSets,
          targetRepsLow: item.targetRepsLow,
          targetRepsHigh: item.targetRepsHigh,
          targetRpeTenths: item.targetRpeTenths,
          restSeconds: item.restSeconds,
          supersetGroup: item.supersetGroup,
          plannedSets: item.sets.map((s) => ({ ...s })),
          sectionId: item.sectionId === null ? null : (wsByRoutineSection.get(item.sectionId) ?? null),
        });
      }
      workout.routineName = routine.name;
    }
    this.workouts.set(workout.id, workout);
    this.byClientKey.set(key, workout.id);
    for (const e of copied) this.exercises.set(e.id, e);
    this.sectionsByWorkout.set(workout.id, { routineNotes, sections: sectionRecords, routineId: fields.routineId ?? null });
    return {
      workout,
      created: true,
      copiedCount: copied.length,
      plannedSetCount: copied.reduce((n, e) => n + e.plannedSets.length, 0),
      sectionCount: sectionRecords.length,
    };
  }

  async getActiveWorkout(actingUserId: string): Promise<WorkoutDetailRecord> {
    const w = [...this.workouts.values()].find(
      (w) => w.userId === actingUserId && w.endedAt === null,
    );
    if (!w) throw new NotFoundError("no active workout for the acting user");
    return this.detail(w);
  }

  /** Spec 07.1 — counts list calls that got past cursor decoding (AC7). */
  historyScans = 0;

  async listFinishedWorkouts(actingUserId: string, opts: ListFinishedWorkoutsOptions): Promise<WorkoutHistoryPage> {
    const cursor = opts.cursor === undefined ? null : decodeWorkoutCursor(opts.cursor);
    this.historyScans += 1;
    // The fake's Dates have millisecond precision; pad to the cursor's 6 digits.
    const text = (d: Date) => d.toISOString().replace("Z", "000Z");
    const rows = [...this.workouts.values()]
      .filter((w) => w.userId === actingUserId && w.endedAt !== null)
      .map((w) => ({ w, t: text(w.startedAt) }))
      .sort((a, b) => (a.t === b.t ? (a.w.id < b.w.id ? 1 : -1) : a.t < b.t ? 1 : -1))
      .filter(({ w, t }) => !cursor || t < cursor.startedAtText || (t === cursor.startedAtText && w.id < cursor.id));
    const page = rows.slice(0, opts.limit);
    const items = page.map(({ w }) => {
      const exercises = [...this.exercises.values()]
        .filter((e) => e.workoutId === w.id)
        .sort((a, b) => a.position - b.position);
      const working = [...this.sets.values()].filter(
        (s) => s.setType === "working" && exercises.some((e) => e.id === s.workoutExerciseId),
      );
      return {
        ...w,
        exerciseCount: exercises.length,
        exerciseNames: exercises.slice(0, WORKOUT_SUMMARY_NAMES_MAX).map((e) => e.exerciseNameSnapshot),
        workingSetCount: working.length,
        totalVolumeMilli: sumVolumeMilli(
          working.map((s) => ({
            modality: exercises.find((e) => e.id === s.workoutExerciseId)!.modalitySnapshot,
            weightKgMilli: s.weightKg === null ? null : parseWeightKgMilli(s.weightKg.toFixed(3)),
            reps: s.reps,
          })),
        ),
        recordCount: 0, // the fake keeps no personal_record rows
      };
    });
    const last = page[page.length - 1];
    return {
      items,
      next: rows.length > opts.limit && last ? encodeWorkoutCursor({ startedAtText: last.t, id: last.w.id }) : null,
    };
  }

  async getWorkoutById(actingUserId: string, id: string): Promise<WorkoutDetailRecord> {
    return this.detail(this.ownedWorkoutOrThrow(actingUserId, id));
  }

  /** Spec 07.4 AC25: the repository's `shiftSetTimes`, on the in-memory sets. */
  private shiftSetTimes(workoutId: string, deltaMs: number): void {
    for (const s of this.sets.values()) {
      const we = this.exercises.get(s.workoutExerciseId);
      if (we?.workoutId !== workoutId || s.completedAt === null) continue;
      this.sets.set(s.id, { ...s, completedAt: new Date(s.completedAt.getTime() + deltaMs) });
    }
  }

  /** Spec 07.4 AC25: the repository's `clampSetTimes`, on the in-memory sets. */
  private clampSetTimes(workoutId: string, start: Date, end: Date): void {
    for (const s of this.sets.values()) {
      const we = this.exercises.get(s.workoutExerciseId);
      if (we?.workoutId !== workoutId || s.completedAt === null) continue;
      this.sets.set(s.id, { ...s, completedAt: clampInstantToSpan(s.completedAt, start, end) });
    }
  }

  async updateWorkout(
    actingUserId: string,
    id: string,
    patch: UpdateWorkoutFields,
  ): Promise<UpdateWorkoutResult> {
    const w = this.ownedWorkoutOrThrow(actingUserId, id);
    if (w.endedAt !== null) {
      // Spec 07.4 AC3 / D17: only a re-finish is refused; {} / endedAt: null are no-ops.
      if (patch.endedAt != null) throw new WorkoutFinishedError();
      const exerciseCount = [...this.exercises.values()].filter((e) => e.workoutId === id).length;
      const next = retimeOrThrow({ startedAt: w.startedAt, endedAt: w.endedAt, plannedDurationS: null }, patch, new Date());
      const detailsSent = "title" in patch || "notes" in patch;
      let edited = w;
      if (detailsSent || next.startChanged || next.endChanged) {
        const tzOffsetMinutes = next.startChanged ? (patch.tzOffsetMinutes ?? 0) : w.tzOffsetMinutes;
        edited = {
          ...w,
          title: "title" in patch ? patch.title ?? null : w.title,
          notes: "notes" in patch ? patch.notes ?? null : w.notes,
          startedAt: next.startedAt,
          endedAt: next.endedAt,
          tzOffsetMinutes,
          localDate: next.startChanged ? localDateFor(next.startedAt.toISOString(), tzOffsetMinutes) : w.localDate,
          updatedAt: new Date(w.updatedAt.getTime() + 1000),
        };
        this.workouts.set(id, edited);
      }
      if (next.startChanged) this.shiftSetTimes(id, next.startedAt.getTime() - w.startedAt.getTime());
      if (next.startChanged || next.endChanged) this.clampSetTimes(id, next.startedAt, next.endedAt!);
      // The repository recomputes the workout's lineage roots on a start change; no exercises, no roots.
      const exerciseIds = new Set([...this.exercises.values()].filter((e) => e.workoutId === id).map((e) => e.exerciseId));
      const recomputed = next.startChanged && exerciseIds.size > 0;
      const recompute: FinishedEdit | null = recomputed ? { workoutId: id, recordsRecomputed: true, rootCount: exerciseIds.size, recomputeMs: 0 } : null;
      const retime = retimeOutcome(patch, true, w.startedAt, next, recomputed);
      return {
        workout: edited,
        exerciseCount,
        newRecords: [],
        finishedEdit: detailsSent ? (recompute ?? FakeWorkoutRepository.edit(edited)) : null,
        hadPlannedDuration: false,
        retime,
        oneOff: "none",
      };
    }
    // Spec 07.4 §6.4: the same pure rules as the repository. The fake has no profile zone, so a moved
    // start without `tzOffsetMinutes` takes offset 0; route tests that assert `localDate` send one.
    const next = retimeOrThrow({ startedAt: w.startedAt, endedAt: null, plannedDurationS: w.plannedDurationS }, patch, new Date());
    const endedAt = next.endedAt;
    const tzOffsetMinutes = next.startChanged ? (patch.tzOffsetMinutes ?? 0) : w.tzOffsetMinutes;
    const localDate = next.startChanged ? localDateFor(next.startedAt.toISOString(), tzOffsetMinutes) : w.localDate;
    // Spec 05.1 §6.5: a finish must find every working set complete.
    if (endedAt !== null) {
      for (const we of this.exercises.values()) {
        if (we.workoutId !== id) continue;
        for (const s of this.sets.values()) {
          if (s.workoutExerciseId !== we.id || s.setType !== "working") continue;
          if (!isWorkingSetComplete(we.modalitySnapshot as Modality, s)) throw new IncompleteWorkingSetsError();
        }
      }
    }
    const updated: WorkoutRecord = {
      ...w,
      title: "title" in patch ? patch.title ?? null : w.title,
      notes: "notes" in patch ? patch.notes ?? null : w.notes,
      startedAt: next.startedAt,
      endedAt,
      localDate,
      tzOffsetMinutes,
      plannedDurationS: next.plannedDurationS,
      updatedAt: new Date(w.updatedAt.getTime() + 1000),
    };
    this.workouts.set(id, updated);
    if (endedAt !== null) this.clampSetTimes(id, updated.startedAt, endedAt);
    const exerciseCount = [...this.exercises.values()].filter((e) => e.workoutId === id).length;
    const retime = retimeOutcome(patch, false, w.startedAt, next, false);
    // Spec 09.3 §6.2: a finish removes the workout's one-off, or keeps it with `keepRoutine`.
    let oneOff: OneOffOutcome = "none";
    const routineId = this.sectionsByWorkout.get(id)?.routineId ?? null;
    const routine = routineId === null ? undefined : this.routineRepository?.routines.get(routineId);
    if (endedAt !== null && routine && routine.userId === actingUserId && routine.oneOffUntil !== null) {
      if (patch.keepRoutine === true) {
        this.routineRepository!.routines.set(routine.id, { ...routine, oneOffUntil: null, updatedAt: new Date() });
        oneOff = "kept";
      } else {
        this.routineRepository!.routines.delete(routine.id);
        oneOff = "removed";
      }
    }
    return {
      workout: updated,
      exerciseCount,
      newRecords: [],
      finishedEdit: null,
      hadPlannedDuration: endedAt !== null && w.plannedDurationS !== null,
      retime,
      oneOff,
    };
  }

  async deleteWorkout(actingUserId: string, id: string): Promise<DeleteWorkoutResult> {
    const w = this.ownedWorkoutOrThrow(actingUserId, id);
    const wasFinished = w.endedAt !== null;
    const exerciseCount = [...this.exercises.values()].filter((e) => e.workoutId === id).length;
    this.workouts.delete(id);
    const removed = new Set<string>();
    for (const [exId, ex] of this.exercises) {
      if (ex.workoutId === id) {
        this.exercises.delete(exId);
        removed.add(exId);
      }
    }
    this.cascadeSets(removed);
    return { wasFinished, exerciseCount };
  }

  async addWorkoutExercise(
    actingUserId: string,
    workoutId: string,
    fields: AddWorkoutExerciseFields,
  ): Promise<WithFinishedEdit<WorkoutExerciseRecord>> {
    const w = this.ownedWorkoutOrThrow(actingUserId, workoutId);
    const exercise = await this.exerciseRepository.findVisibleById(
      actingUserId,
      fields.exerciseId,
    );
    if (!exercise.isActive) throw new ExerciseRetiredError();

    const n = [...this.exercises.values()].filter((e) => e.workoutId === workoutId).length;
    const position = fields.position ?? computeAppendPosition(n);
    if (fields.position !== undefined) {
      assertAddPositionInRange(fields.position, n);
      for (const e of this.exercises.values()) {
        if (e.workoutId === workoutId && e.position >= position) {
          this.exercises.set(e.id, { ...e, position: e.position + 1 });
        }
      }
    }
    const now = new Date();
    const record: WorkoutExerciseRecord = {
      id: uuidv7(),
      workoutId,
      position,
      exerciseId: exercise.id,
      exerciseNameSnapshot: exercise.name,
      modalitySnapshot: exercise.modality,
      notes: fields.notes ?? null,
      createdAt: now,
      updatedAt: now,
      targetSets: null,
      targetRepsLow: null,
      targetRepsHigh: null,
      targetRpeTenths: null,
      restSeconds: null,
      supersetGroup: null,
      plannedSets: [],
      sectionId: null,
    };
    this.exercises.set(record.id, record);
    return { ...record, finishedEdit: FakeWorkoutRepository.edit(w) };
  }

  private ownedExerciseOrThrow(
    actingUserId: string,
    id: string,
  ): { we: WorkoutExerciseRecord; workout: WorkoutRecord } {
    const we = isWorkoutExerciseId(id) ? this.exercises.get(id) : undefined;
    if (!we) throw new NotFoundError("workout exercise not found");
    const workout = this.workouts.get(we.workoutId);
    if (!workout || workout.userId !== actingUserId) {
      throw new NotFoundError("workout exercise not found");
    }
    return { we, workout };
  }

  async updateWorkoutExercise(
    actingUserId: string,
    id: string,
    patch: UpdateWorkoutExerciseFields,
  ): Promise<WithFinishedEdit<WorkoutExerciseRecord> & { moved: boolean }> {
    const { we, workout } = this.ownedExerciseOrThrow(actingUserId, id);
    const n = [...this.exercises.values()].filter((e) => e.workoutId === we.workoutId).length;
    let nextPosition = we.position;
    if (patch.position !== undefined && patch.position !== we.position) {
      assertReorderPositionInRange(patch.position, n);
      const old = we.position;
      nextPosition = patch.position;
      for (const e of this.exercises.values()) {
        if (e.workoutId !== we.workoutId || e.id === id) continue;
        if (nextPosition > old && e.position > old && e.position <= nextPosition) {
          this.exercises.set(e.id, { ...e, position: e.position - 1 });
        } else if (nextPosition < old && e.position >= nextPosition && e.position < old) {
          this.exercises.set(e.id, { ...e, position: e.position + 1 });
        }
      }
    }
    const updated: WorkoutExerciseRecord = {
      ...we,
      position: nextPosition,
      notes: "notes" in patch ? patch.notes ?? null : we.notes,
      supersetGroup: "supersetGroup" in patch ? (patch.supersetGroup ?? null) : we.supersetGroup,
      updatedAt: new Date(we.updatedAt.getTime() + 1000),
    };
    this.exercises.set(id, updated);
    const changed = nextPosition !== we.position || updated.notes !== we.notes || updated.supersetGroup !== we.supersetGroup;
    return { ...updated, finishedEdit: changed ? FakeWorkoutRepository.edit(workout) : null, moved: nextPosition !== we.position };
  }

  async deleteWorkoutExercise(actingUserId: string, id: string): Promise<{ finishedEdit: FinishedEdit | null }> {
    const { we, workout } = this.ownedExerciseOrThrow(actingUserId, id);
    if (workout.endedAt !== null) {
      const own = [...this.sets.values()].filter((s) => s.workoutExerciseId === id).length;
      this.assertWouldNotEmpty(workout.id, own);
    }
    this.exercises.delete(id);
    this.cascadeSets(new Set([id]));
    for (const e of this.exercises.values()) {
      if (e.workoutId === we.workoutId && e.position > we.position) {
        this.exercises.set(e.id, { ...e, position: e.position - 1 });
      }
    }
    return { finishedEdit: FakeWorkoutRepository.edit(workout) };
  }

  async createSet(actingUserId: string, workoutExerciseId: string, fields: CreateSetFields): Promise<CreateSetResult> {
    const { we, workout } = this.ownedExerciseOrThrow(actingUserId, workoutExerciseId);
    const clientGeneratedId = fields.clientGeneratedId ?? null;
    if (clientGeneratedId !== null) {
      const stored = [...this.sets.values()].find(
        (s) => s.workoutExerciseId === we.id && s.clientGeneratedId === clientGeneratedId,
      );
      if (stored) return { set: stored, modalitySnapshot: we.modalitySnapshot, created: false, finishedEdit: null };
    }
    const next = fieldsToMeasures(fields);
    assertSetMeasuresValid(we.modalitySnapshot as Modality, next);
    // Spec 07.4: a finished parent is written in finished mode (integrity, clamped completedAt).
    if (workout.endedAt !== null) assertFinishedSetComplete(we.modalitySnapshot as Modality, next.setType, next);
    const siblings = [...this.sets.values()].filter((s) => s.workoutExerciseId === we.id);
    const now = new Date();
    const set: SetEntryRecord = {
      id: uuidv7(),
      workoutExerciseId: we.id,
      clientGeneratedId,
      setNumber: Math.max(0, ...siblings.map((s) => s.setNumber)) + 1,
      ...next,
      ...FakeWorkoutRepository.withCanonical(next),
      completedAt: next.isComplete ? FakeWorkoutRepository.completedNow(workout, now) : null,
      createdAt: now,
      updatedAt: now,
    };
    this.sets.set(set.id, set);
    return { set, modalitySnapshot: we.modalitySnapshot, created: true, finishedEdit: FakeWorkoutRepository.edit(workout) };
  }

  private ownedSetOrThrow(
    actingUserId: string,
    id: string,
  ): { set: SetEntryRecord; we: WorkoutExerciseRecord; workout: WorkoutRecord } {
    const set = isSetEntryId(id) ? this.sets.get(id) : undefined;
    if (!set) throw new NotFoundError("set not found");
    const { we, workout } = this.ownedExerciseOrThrow(actingUserId, set.workoutExerciseId);
    return { set, we, workout };
  }

  async updateSet(
    actingUserId: string,
    id: string,
    patch: UpdateSetFields,
  ): Promise<{ set: SetEntryRecord; finishedEdit: FinishedEdit | null }> {
    const { set, we, workout } = this.ownedSetOrThrow(actingUserId, id);
    const next = mergeSetPatch(set, patch);
    assertSetMeasuresValid(we.modalitySnapshot as Modality, next);
    if (workout.endedAt !== null) assertFinishedSetComplete(we.modalitySnapshot as Modality, next.setType, next);
    const updated: SetEntryRecord = {
      ...set,
      ...next,
      ...FakeWorkoutRepository.withCanonical(next),
      completedAt: next.isComplete ? (set.completedAt ?? FakeWorkoutRepository.completedNow(workout, new Date())) : null,
      updatedAt: new Date(set.updatedAt.getTime() + 1000),
    };
    this.sets.set(id, updated);
    return { set: updated, finishedEdit: FakeWorkoutRepository.edit(workout) };
  }

  async deleteSet(actingUserId: string, id: string): Promise<{ finishedEdit: FinishedEdit | null }> {
    const { workout } = this.ownedSetOrThrow(actingUserId, id);
    if (workout.endedAt !== null) this.assertWouldNotEmpty(workout.id, 1);
    this.sets.delete(id);
    return { finishedEdit: FakeWorkoutRepository.edit(workout) };
  }

  /** Spec 07.4 §6.6: `now`, kept inside a finished workout's span. */
  private static completedNow(workout: WorkoutRecord, now: Date): Date {
    return workout.endedAt === null ? now : clampInstantToSpan(now, workout.startedAt, workout.endedAt);
  }

  /** The fake does no PR work; a finished-mode write still reports itself (07.4 §9). */
  private static edit(workout: WorkoutRecord): FinishedEdit | null {
    return workout.endedAt === null ? null : { workoutId: workout.id, recordsRecomputed: false, rootCount: 0, recomputeMs: 0 };
  }

  /** Spec 07.4 §6.3, over the in-memory rows. */
  private assertWouldNotEmpty(workoutId: string, removed: number): void {
    const cards = new Set([...this.exercises.values()].filter((e) => e.workoutId === workoutId).map((e) => e.id));
    const n = [...this.sets.values()].filter((s) => cards.has(s.workoutExerciseId)).length;
    if (n >= 1 && n - removed <= 0) throw new WorkoutWouldBeEmptyError(workoutId);
  }
}

export function fakeVerifier(
  handler: (token: string) => AuthContext | Promise<AuthContext>,
): TokenVerifier {
  return { verify: async (token: string) => handler(token) };
}

export function authContext(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    authSub: "auth0|user-123",
    email: "a@b.com",
    emailVerified: true,
    claims: {
      sub: "auth0|user-123",
      aud: "https://api.strengthinnumbers.app",
      exp: 9_999_999_999,
    },
    ...overrides,
  };
}

/** Spec 07.0 — in-memory read side. It filters on the stored `exerciseId`
 * directly (no lineage resolution — that is covered against Postgres). */
export class FakePersonalRecordRepository implements PersonalRecordRepository {
  rows: Array<PersonalRecordRecord & { userId: string }> = [];
  lastFilter: PersonalRecordFilter | undefined;

  /** Spec 07.2 — seeded series, keyed `${userId}:${exerciseId}` (no lineage
   * resolution — that is covered against Postgres). Absent key ⇒ NotFoundError. */
  progress = new Map<string, ProgressPointRecord[]>();
  lastProgressQuery: { exerciseId: string; range: ProgressRange } | undefined;
  /** Requested id → lineage root, so route tests can tell the two apart (the
   * real repository returns the root; unmapped ids are their own root). */
  progressRoots = new Map<string, string>();

  async getProgressSeries(actingUserId: string, exerciseId: string, range: ProgressRange): Promise<ProgressSeriesRecord> {
    this.lastProgressQuery = { exerciseId, range };
    const points = this.progress.get(`${actingUserId}:${exerciseId}`);
    if (points === undefined) throw new NotFoundError("exercise not found or not visible to the acting user");
    return {
      exerciseId: this.progressRoots.get(exerciseId) ?? exerciseId,
      points: points.filter(
        (p) => (range.from === undefined || p.localDate >= range.from) && (range.to === undefined || p.localDate <= range.to),
      ),
    };
  }

  async list(actingUserId: string, filter: PersonalRecordFilter): Promise<PersonalRecordRecord[]> {
    this.lastFilter = filter;
    return this.rows
      .filter((r) => r.userId === actingUserId)
      .filter((r) => filter.exerciseId === undefined || r.exerciseId === filter.exerciseId)
      .filter((r) => filter.workoutId === undefined || r.workoutId === filter.workoutId)
      .map((r) => {
        const record: Partial<typeof r> = { ...r };
        delete record.userId;
        return record as PersonalRecordRecord;
      });
  }
}

/**
 * In-memory RoutineRepository for route/unit tests (Spec 09). It mirrors the
 * repository's error contract (cap, name clash, item exercise check, 404 for a
 * foreign/malformed id) but not the SQL-level concurrency guarantees — those
 * are covered by the Testcontainers suites.
 */
export class FakeRoutineRepository implements RoutineRepository {
  routines = new Map<string, RoutineRecord>();
  /** Spec 09.3 — routines a live workout was started from; a `FakeWorkoutRepository` built on this fake sets it. */
  liveRoutineIds: () => Set<string> = () => new Set();

  /** Spec 09.3 §6.1 — drop the caller's expired one-offs that no live workout holds; returns how many. */
  private sweep(actingUserId: string): number {
    const now = Date.now();
    const held = this.liveRoutineIds();
    let removed = 0;
    for (const r of [...this.routines.values()]) {
      if (r.userId === actingUserId && r.oneOffUntil !== null && r.oneOffUntil.getTime() <= now && !held.has(r.id)) {
        this.routines.delete(r.id);
        removed += 1;
      }
    }
    return removed;
  }

  constructor(private readonly exerciseRepository: ExerciseRepository = new FakeExerciseRepository()) {}

  private owned(actingUserId: string, id: string): RoutineRecord {
    const r = isRoutineId(id) ? this.routines.get(id) : undefined;
    if (!r || r.userId !== actingUserId) throw new NotFoundError("routine not found");
    return r;
  }

  private async checkExercises(actingUserId: string, ids: string[]): Promise<Map<string, Modality>> {
    const modalities = new Map<string, Modality>();
    for (const [i, id] of ids.entries()) {
      let ex: ExerciseRecord;
      try {
        ex = await this.exerciseRepository.findVisibleById(actingUserId, id);
      } catch {
        throw new ValidationError([{ path: `items.${i}.exerciseId`, message: "must reference a visible exercise" }]);
      }
      if (!ex.isActive) {
        throw new ExerciseRetiredError(`item ${i} retired`, {
          fieldErrors: [{ path: `items.${i}.exerciseId`, message: "exercise is retired" }],
        });
      }
      modalities.set(id, ex.modality as Modality);
    }
    return modalities;
  }

  private sectionsOf(fields: RoutineWriteFields): { sections: RoutineSectionRecord[]; idByKey: Map<string, string> } {
    const idByKey = new Map<string, string>();
    const sections = (fields.sections ?? []).map((s, j) => {
      const id = uuidv7();
      idByKey.set(s.key, id);
      return { id, position: j, name: s.name, notes: s.notes ?? null };
    });
    return { sections, idByKey };
  }

  private buildItems(
    routineId: string,
    items: RoutineWriteFields["items"],
    idByKey: ReadonlyMap<string, string>,
  ): RoutineItemRecord[] {
    const groups = normalizeSupersetGroups(items.map((i) => i.supersetGroup ?? null));
    return items.map((it, i) => {
      const plan = resolveItemPlan(it);
      return {
        id: uuidv7(),
        routineId,
        position: i,
        exerciseId: it.exerciseId,
        targetSets: plan.targetSets,
        targetRepsLow: plan.targetRepsLow,
        targetRepsHigh: plan.targetRepsHigh,
        targetRpeTenths: it.targetRpe == null ? null : rpeToTenths(it.targetRpe),
        restSeconds: it.restSeconds ?? null,
        supersetGroup: groups[i] ?? null,
        notes: it.notes ?? null,
        sets: plan.rows,
        sectionId: it.sectionKey == null ? null : (idByKey.get(it.sectionKey) ?? null),
      };
    });
  }

  private nameClash(actingUserId: string, name: string, exceptId: string | null): boolean {
    return [...this.routines.values()].some(
      (r) => r.userId === actingUserId && r.id !== exceptId && r.name.toLowerCase() === name.toLowerCase(),
    );
  }

  /** Spec 09.3 AC3 — the same keys as `ROUTINE_ONE_OFF_ORDER`: one-offs first, newest created first, then by name. */
  async list(actingUserId: string, onSwept?: SweepObserver): Promise<RoutineRecord[]> {
    const removed = this.sweep(actingUserId);
    if (removed > 0) onSwept?.(removed);
    return [...this.routines.values()]
      .filter((r) => r.userId === actingUserId)
      .sort(
        (a, b) =>
          Number(a.oneOffUntil === null) - Number(b.oneOffUntil === null) ||
          (a.oneOffUntil !== null && b.oneOffUntil !== null ? b.createdAt.getTime() - a.createdAt.getTime() : 0) ||
          a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
          a.id.localeCompare(b.id),
      );
  }

  async getById(actingUserId: string, id: string): Promise<RoutineRecord> {
    return this.owned(actingUserId, id);
  }

  async create(actingUserId: string, fields: RoutineCreateFields, onSwept?: SweepObserver): Promise<RoutineRecord> {
    const removed = this.sweep(actingUserId);
    const now0 = Date.now();
    const counted = [...this.routines.values()].filter(
      (r) => r.userId === actingUserId && (r.oneOffUntil === null || r.oneOffUntil.getTime() > now0),
    );
    if (counted.length >= ROUTINES_PER_USER_MAX) throw new RoutineLimitError();
    if (this.nameClash(actingUserId, fields.name, null)) throw new RoutineNameTakenError();
    const modalities = await this.checkExercises(actingUserId, fields.items.map((i) => i.exerciseId));
    assertPlannedSetsFitModalities(fields.items, modalities);
    const now = new Date();
    const id = uuidv7();
    const { sections, idByKey } = this.sectionsOf(fields);
    const r: RoutineRecord = {
      id,
      userId: actingUserId,
      name: fields.name,
      notes: fields.notes ?? null,
      sections,
      items: this.buildItems(id, fields.items, idByKey),
      createdAt: now,
      updatedAt: now,
      oneOffUntil: fields.oneOff ? new Date(now.getTime() + ROUTINE_ONE_OFF_DAYS * 86_400_000) : null,
    };
    this.routines.set(id, r);
    if (removed > 0) onSwept?.(removed);
    return r;
  }

  async keep(actingUserId: string, id: string): Promise<{ changed: boolean }> {
    const r = this.owned(actingUserId, id);
    if (r.oneOffUntil === null) return { changed: false };
    this.routines.set(id, { ...r, oneOffUntil: null, updatedAt: new Date(Math.max(Date.now(), r.updatedAt.getTime() + 1)) });
    return { changed: true };
  }

  async replace(actingUserId: string, id: string, fields: RoutineWriteFields): Promise<RoutineRecord> {
    const current = this.owned(actingUserId, id);
    if (this.nameClash(actingUserId, fields.name, id)) throw new RoutineNameTakenError();
    const modalities = await this.checkExercises(actingUserId, fields.items.map((i) => i.exerciseId));
    assertPlannedSetsFitModalities(fields.items, modalities);
    const { sections, idByKey } = this.sectionsOf(fields);
    const next: RoutineRecord = {
      ...current,
      name: fields.name,
      notes: fields.notes ?? null,
      sections,
      items: this.buildItems(id, fields.items, idByKey),
      updatedAt: new Date(current.updatedAt.getTime() + 1000),
    };
    this.routines.set(id, next);
    return next;
  }

  async delete(actingUserId: string, id: string): Promise<void> {
    this.owned(actingUserId, id);
    this.routines.delete(id);
  }
}

/** Spec 11 — returns the caller's fake user plus whatever the test set in `next`. */
export class FakeAccountExportRepository implements AccountExportRepository {
  calls = 0;
  constructor(
    private readonly users: FakeUserRepository,
    public next: Partial<Omit<AccountSnapshot, "user">> = {},
  ) {}

  async snapshot(userId: string): Promise<AccountSnapshot> {
    this.calls += 1;
    return {
      exportedAt: new Date("2026-10-11T18:00:00.000Z"),
      exercises: [],
      routines: [],
      workouts: [],
      ...this.next,
      user: this.users.getById(userId),
    };
  }
}
