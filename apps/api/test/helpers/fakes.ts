import { isExerciseId, MAX_CUSTOM_EXERCISES_PER_USER } from "@sin/core";
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
  ExerciseImmutableUseForkError,
  ExerciseRetiredError,
  NotFoundError,
  ValidationError,
} from "../../src/errors/app-error.js";
import { assertMergedFieldsValid, mergeWritableFields } from "../../src/repositories/exercise-writes.js";
import type { AuthContext, TokenVerifier } from "../../src/auth/verify.js";

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
 * reproduce the SQL visibility filter or `serverTime` derivation (those are
 * covered by the repository integration tests) — set `catalog` / `delta` /
 * `serverTime` and inspect `lastActingUserId` / `lastDeltaSince`.
 */
export class FakeExerciseRepository implements ExerciseRepository {
  catalog: ExerciseRecord[] = [];
  delta: ExerciseRecord[] = [];
  serverTime = new Date("2026-09-08T00:00:00.000Z");
  muscleGroups: ReferenceRecord[] = [];
  equipment: ReferenceRecord[] = [];
  byId = new Map<string, ExerciseRecord>();

  /** Overridable in tests to exercise the cap boundary without 500 inserts. */
  cap = MAX_CUSTOM_EXERCISES_PER_USER;

  lastActingUserId: string | null = null;
  lastDeltaSince: string | null = null;

  async findVisibleCatalog(actingUserId: string): Promise<CatalogPage> {
    this.lastActingUserId = actingUserId;
    return { rows: this.catalog, serverTime: this.serverTime };
  }

  async findCatalogDelta(
    actingUserId: string,
    sinceIso: string,
  ): Promise<CatalogPage> {
    this.lastActingUserId = actingUserId;
    this.lastDeltaSince = sinceIso;
    return { rows: this.delta, serverTime: this.serverTime };
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
    assertMergedFieldsValid(merged);
    const updated: ExerciseRecord = {
      ...before,
      ...merged,
      updatedAt: new Date(before.updatedAt.getTime() + 1000),
    };
    this.byId.set(updated.id, updated);
    return updated;
  }

  async listMuscleGroups(): Promise<ReferenceRecord[]> {
    return this.muscleGroups;
  }

  async listEquipment(): Promise<ReferenceRecord[]> {
    return this.equipment;
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
