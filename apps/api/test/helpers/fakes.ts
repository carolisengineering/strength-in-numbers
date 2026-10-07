import {
  isExerciseId,
  isWorkoutExerciseId,
  isSetEntryId,
  isWorkoutId,
  localDateFor,
  MAX_CUSTOM_EXERCISES_PER_USER,
  offsetMinutesForZone,
  toCanonicalKg,
  toCanonicalMeters,
  type Modality,
} from "@sin/core";
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
  ValidationError,
  WorkoutFinishedError,
  WorkoutInProgressExistsError,
} from "../../src/errors/app-error.js";
import { assertMergedFieldsValid, mergeWritableFields } from "../../src/repositories/exercise-writes.js";
import {
  assertAddPositionInRange,
  assertEndedAtInBounds,
  assertEndedAtNotBeforeStartedAt,
  assertReorderPositionInRange,
  computeAppendPosition,
} from "../../src/repositories/workout-writes.js";
import {
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
  WorkoutDetailRecord,
  WorkoutExerciseRecord,
  WorkoutRecord,
  WorkoutRepository,
  WorkoutHistoryPage,
  CreateSetFields,
  CreateSetResult,
  SetEntryRecord,
  UpdateSetFields,
} from "../../src/repositories/workout.js";
import type { AuthContext, TokenVerifier } from "../../src/auth/verify.js";
import type {
  PersonalRecordFilter,
  PersonalRecordRecord,
  PersonalRecordRepository,
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
    // from the driver.
    const row = isExerciseId(id) ? this.byId.get(id) : undefined;
    if (!row) throw new NotFoundError("exercise not found");
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
    if (before.ownerUserId !== actingUserId) throw new ExerciseImmutableUseForkError();
    if (!before.isActive) throw new ExerciseRetiredError();
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

  constructor(private readonly exerciseRepository: ExerciseRepository = new FakeExerciseRepository()) {}

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
    return { ...w, exercises };
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
      return { workout: this.workouts.get(existingId)!, created: false };
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
    };
    this.workouts.set(workout.id, workout);
    this.byClientKey.set(key, workout.id);
    return { workout, created: true };
  }

  async getActiveWorkout(actingUserId: string): Promise<WorkoutDetailRecord> {
    const w = [...this.workouts.values()].find(
      (w) => w.userId === actingUserId && w.endedAt === null,
    );
    if (!w) throw new NotFoundError("no active workout for the acting user");
    return this.detail(w);
  }

  async listFinishedWorkouts(): Promise<WorkoutHistoryPage> {
    throw new Error("FakeWorkoutRepository.listFinishedWorkouts: implemented in Spec 07.1 Task 5");
  }

  async getWorkoutById(actingUserId: string, id: string): Promise<WorkoutDetailRecord> {
    return this.detail(this.ownedWorkoutOrThrow(actingUserId, id));
  }

  async updateWorkout(
    actingUserId: string,
    id: string,
    patch: UpdateWorkoutFields,
  ): Promise<UpdateWorkoutResult> {
    const w = this.ownedWorkoutOrThrow(actingUserId, id);
    if (w.endedAt !== null) throw new WorkoutFinishedError();
    let endedAt: Date | null = w.endedAt;
    if ("endedAt" in patch && patch.endedAt !== undefined) {
      if (patch.endedAt === null) {
        endedAt = null;
      } else {
        const d = new Date(patch.endedAt);
        assertEndedAtNotBeforeStartedAt(w.startedAt, d);
        assertEndedAtInBounds(d, new Date());
        endedAt = d;
      }
    }
    // Spec 05.1 §6.5: a finish must find every working set complete.
    if (endedAt !== null && w.endedAt === null) {
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
      endedAt,
      updatedAt: new Date(w.updatedAt.getTime() + 1000),
    };
    this.workouts.set(id, updated);
    const exerciseCount = [...this.exercises.values()].filter((e) => e.workoutId === id).length;
    return { workout: updated, exerciseCount, newRecords: [] };
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
  ): Promise<WorkoutExerciseRecord> {
    const w = this.ownedWorkoutOrThrow(actingUserId, workoutId);
    if (w.endedAt !== null) throw new WorkoutFinishedError();
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
    };
    this.exercises.set(record.id, record);
    return record;
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
  ): Promise<WorkoutExerciseRecord> {
    const { we, workout } = this.ownedExerciseOrThrow(actingUserId, id);
    if (workout.endedAt !== null) throw new WorkoutFinishedError();
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
      updatedAt: new Date(we.updatedAt.getTime() + 1000),
    };
    this.exercises.set(id, updated);
    return updated;
  }

  async deleteWorkoutExercise(actingUserId: string, id: string): Promise<void> {
    const { we, workout } = this.ownedExerciseOrThrow(actingUserId, id);
    if (workout.endedAt !== null) throw new WorkoutFinishedError();
    this.exercises.delete(id);
    this.cascadeSets(new Set([id]));
    for (const e of this.exercises.values()) {
      if (e.workoutId === we.workoutId && e.position > we.position) {
        this.exercises.set(e.id, { ...e, position: e.position - 1 });
      }
    }
  }

  async createSet(actingUserId: string, workoutExerciseId: string, fields: CreateSetFields): Promise<CreateSetResult> {
    const { we, workout } = this.ownedExerciseOrThrow(actingUserId, workoutExerciseId);
    const clientGeneratedId = fields.clientGeneratedId ?? null;
    if (clientGeneratedId !== null) {
      const stored = [...this.sets.values()].find(
        (s) => s.workoutExerciseId === we.id && s.clientGeneratedId === clientGeneratedId,
      );
      if (stored) return { set: stored, modalitySnapshot: we.modalitySnapshot, created: false };
    }
    if (workout.endedAt !== null) throw new WorkoutFinishedError();
    const next = fieldsToMeasures(fields);
    assertSetMeasuresValid(we.modalitySnapshot as Modality, next);
    const siblings = [...this.sets.values()].filter((s) => s.workoutExerciseId === we.id);
    const now = new Date();
    const set: SetEntryRecord = {
      id: uuidv7(),
      workoutExerciseId: we.id,
      clientGeneratedId,
      setNumber: Math.max(0, ...siblings.map((s) => s.setNumber)) + 1,
      ...next,
      ...FakeWorkoutRepository.withCanonical(next),
      completedAt: next.isComplete ? now : null,
      createdAt: now,
      updatedAt: now,
    };
    this.sets.set(set.id, set);
    return { set, modalitySnapshot: we.modalitySnapshot, created: true };
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

  async updateSet(actingUserId: string, id: string, patch: UpdateSetFields): Promise<SetEntryRecord> {
    const { set, we, workout } = this.ownedSetOrThrow(actingUserId, id);
    if (workout.endedAt !== null) throw new WorkoutFinishedError();
    const next = mergeSetPatch(set, patch);
    assertSetMeasuresValid(we.modalitySnapshot as Modality, next);
    const updated: SetEntryRecord = {
      ...set,
      ...next,
      ...FakeWorkoutRepository.withCanonical(next),
      completedAt: next.isComplete ? (set.completedAt ?? new Date()) : null,
      updatedAt: new Date(set.updatedAt.getTime() + 1000),
    };
    this.sets.set(id, updated);
    return updated;
  }

  async deleteSet(actingUserId: string, id: string): Promise<void> {
    const { workout } = this.ownedSetOrThrow(actingUserId, id);
    if (workout.endedAt !== null) throw new WorkoutFinishedError();
    this.sets.delete(id);
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
