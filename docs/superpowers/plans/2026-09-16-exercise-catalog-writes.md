# Exercise Catalog Writes (Spec 03.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `POST /v1/exercises`, `PATCH /v1/exercises/{id}`, `POST /v1/exercises/{id}/fork`, and `DELETE /v1/exercises/{id}` — custom exercise create, edit, copy-on-write fork of a global row, and soft-delete — plus the `forked_from_exercise_id` provenance column and the per-user 500-row active-custom-exercise cap.

**Architecture:** Extend the existing `ExerciseRepository` port (`apps/api/src/repositories/exercise.ts`) with four write methods; implement them in `exercise.prisma.ts` with raw parameterized SQL (an advisory-lock-guarded atomic cap insert shared by create+fork, and a race-safe conditional `UPDATE`); mirror the same branching in `FakeExerciseRepository` for route unit tests. New Zod DTOs and a pure cross-field validator land in `@sin/core` so create-time (full body) and merge-time (partial body) validation share one rule. Four new Fastify routes reuse the existing `findVisibleById`-based 404 convention and the Spec 01 RFC 9457 error contract.

**Tech Stack:** Fastify v5, `fastify-type-provider-zod`, Prisma (raw `$queryRaw`/`$executeRaw` tagged templates only), Zod 4, Vitest + `fastify.inject`, Testcontainers Postgres (`RUN_INTEGRATION=1`).

**Spec:** `docs/specs/03.2-exercise-catalog-writes.md` (status: ready for implementation, no open review gates). Also touches `docs/DESIGN.md` §4.2 per that spec's §11.

## Global Constraints

- Raw SQL only via Prisma tagged-template `$queryRaw`/`$executeRaw` — never `$queryRawUnsafe` or string-concatenated SQL for any value that flows from a request body (spec §6; matches `exercise.prisma.ts`'s existing documented convention).
- `MAX_CUSTOM_EXERCISES_PER_USER = 500` is a `@sin/core` code constant, not an env var (spec §8, D15).
- `secondaryMuscleIds` is capped at 4 entries via a plain Zod `.max(4)` (spec D18).
- Migration `0003_exercise_fork_provenance` is additive only (`ALTER TABLE ADD COLUMN` + FK); no backfill; never combine a drop/rename with the code that stops using a column in the same release (CLAUDE.md).
- 404, not 403, for "not visible" (absent id or another user's custom row) everywhere — reuse the existing `findVisibleById`/visibility-filter convention (spec §7, D19's 403 is reserved for a *visible* global row that can never be operated on).
- 403 vs 409 split (D19): 403 = permanent, no-recourse ("nobody can ever do this to this kind of row" — only `DELETE` on a global row). 409 = conflict with current state that has an actionable next step (`PATCH`/`fork` on the wrong kind or state of row).
- Never the word "dummy" anywhere (code/comments/config/docs) — use placeholder/test/fake/stub (CLAUDE.md).
- `pnpm run lint` — never bare `pnpm lint` (CLAUDE.md).
- `describe.skipIf(cond)` still runs `beforeAll` when `cond` is wrong — every integration `beforeAll` must re-check the guard internally (CLAUDE.md; already the pattern in this repo's integration tests).
- Every non-hidden Fastify route must declare a `response` schema (`assertRouteHasResponseSchema` in `apps/api/src/app.ts`, enforced at boot).
- After any route-schema change, regenerate the committed OpenAPI document: `pnpm --filter @sin/api run openapi:emit`, then commit `openapi.json`. CI drift-checks it (`git diff --exit-code openapi.json`).
- Structured logs for create/fork/update/delete carry `exercise_id`/`owner_user_id`/`forked_from_exercise_id` only — never the raw `name` value (spec §7/§9).

---

## Task 1: Migration `0003_exercise_fork_provenance`

**Files:**
- Create: `apps/api/prisma/migrations/0003_exercise_fork_provenance/migration.sql`
- Modify: `apps/api/prisma/schema.prisma`
- Test: `apps/api/test/integration/exercise-catalog.integration.test.ts`

**Interfaces:**
- Produces: the `exercise.forked_from_exercise_id UUID NULL` column + `exercise_forked_from_exercise_id_fkey` FK (`ON DELETE RESTRICT ON UPDATE CASCADE`) that every later task's SQL reads/writes.

- [ ] **Step 1: Write the failing integration test (AC1)**

Add to the end of `apps/api/test/integration/exercise-catalog.integration.test.ts`, inside the existing `describe.skipIf(...)` block, right before the final `"AC1 — down migration"` block (down-migration must stay last since it drops the tables):

```ts
    describe("Spec 03.2 AC1 — 0003 migration adds forked_from_exercise_id", () => {
      it("adds a nullable uuid column", async () => {
        const cols = await db.prisma.$queryRawUnsafe<
          { column_name: string; data_type: string; is_nullable: string }[]
        >(
          `SELECT column_name, data_type, is_nullable FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'exercise'
             AND column_name = 'forked_from_exercise_id'`,
        );
        expect(cols).toHaveLength(1);
        expect(cols[0]?.data_type).toBe("uuid");
        expect(cols[0]?.is_nullable).toBe("YES");
      });

      it("adds a self-referential RESTRICT FK on forked_from_exercise_id", async () => {
        const fks = await db.prisma.$queryRawUnsafe<
          { constraint_name: string; delete_rule: string }[]
        >(
          `SELECT rc.constraint_name, rc.delete_rule
           FROM information_schema.referential_constraints rc
           JOIN information_schema.table_constraints tc
             ON tc.constraint_name = rc.constraint_name
            AND tc.constraint_schema = rc.constraint_schema
           WHERE tc.table_name = 'exercise'
             AND rc.constraint_name = 'exercise_forked_from_exercise_id_fkey'`,
        );
        expect(fks).toHaveLength(1);
        expect(fks[0]?.delete_rule).toBe("RESTRICT");
      });

      it("defaults to NULL on an existing row and accepts a self-reference", async () => {
        const originId = uuidv7();
        await insertExercise({ id: originId, name: "Origin", catalogKey: "origin-key" });
        const forkRow = await db.prisma.$queryRawUnsafe<{ forked_from_exercise_id: string | null }[]>(
          `SELECT forked_from_exercise_id FROM "exercise" WHERE id = $1::uuid`,
          originId,
        );
        expect(forkRow[0]?.forked_from_exercise_id).toBeNull();

        const forkId = uuidv7();
        await db.prisma.$executeRawUnsafe(
          `INSERT INTO "exercise" ("id", "catalog_key", "owner_user_id", "name", "modality", "forked_from_exercise_id")
           VALUES ($1::uuid, NULL, NULL, $2, $3, $4::uuid)`,
          forkId,
          "Forked",
          "weight_reps",
          originId,
        );
        const forked = await db.prisma.$queryRawUnsafe<{ forked_from_exercise_id: string | null }[]>(
          `SELECT forked_from_exercise_id FROM "exercise" WHERE id = $1::uuid`,
          forkId,
        );
        expect(forked[0]?.forked_from_exercise_id).toBe(originId);
      });
    });
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `RUN_INTEGRATION=1 pnpm --filter @sin/api run test:integration -- exercise-catalog`
Expected: FAIL — `column "forked_from_exercise_id" does not exist` (no such migration yet).

- [ ] **Step 3: Write the migration**

Create `apps/api/prisma/migrations/0003_exercise_fork_provenance/migration.sql`:

```sql
-- Spec 03.2 §4 — 0003_exercise_fork_provenance. Additive, expand-only.
-- Down = ALTER TABLE "exercise" DROP CONSTRAINT "exercise_forked_from_exercise_id_fkey",
--        DROP COLUMN "forked_from_exercise_id"; (test teardown / local `migrate reset`
-- only — production undo is `git revert` + a forward migration, per Spec 01 §11.)
--
-- RESTRICT matches the existing primary_muscle_id / equipment_id convention. The
-- self-reference always points at a global row in practice (enforced at the
-- application layer — forking never chains, Spec 03.2 §6), not by a CHECK (which
-- cannot reference another row of the same table). No new index: nothing queries
-- *by* this column yet (Spec 03.2 §4).

ALTER TABLE "exercise" ADD COLUMN "forked_from_exercise_id" UUID NULL;
ALTER TABLE "exercise" ADD CONSTRAINT "exercise_forked_from_exercise_id_fkey"
  FOREIGN KEY ("forked_from_exercise_id") REFERENCES "exercise"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 4: Update the Prisma schema**

In `apps/api/prisma/schema.prisma`, in the `Exercise` model (after the `isActive` line), add the new column plus both sides of the self-relation (Prisma requires a back-relation field for a self-referencing FK):

```prisma
model Exercise {
  id                 String       @id @db.Uuid // app-generated UUIDv7
  catalogKey         String?      @map("catalog_key") // kebab-case; null for custom rows
  ownerUserId        String?      @map("owner_user_id") @db.Uuid // null = global/curated
  owner              User?        @relation(fields: [ownerUserId], references: [id], onDelete: Cascade)
  name               String
  modality           String // CHECK ('weight_reps', ...) — literal list in the migration
  primaryMuscleId    String?      @map("primary_muscle_id")
  primaryMuscle      MuscleGroup? @relation(fields: [primaryMuscleId], references: [id], onDelete: Restrict)
  secondaryMuscleIds String[]     @default([]) @map("secondary_muscle_ids") // muscle_group ids, authoring order
  equipmentId        String?      @map("equipment_id")
  equipment          Equipment?   @relation(fields: [equipmentId], references: [id], onDelete: Restrict)
  isActive           Boolean      @default(true) @map("is_active")
  // Spec 03.2 §4 — copy-on-write fork provenance. Always points at a global row
  // (owner_user_id IS NULL) in practice; enforced at the application layer, not
  // the DB, since forking never chains (§6).
  forkedFromExerciseId String?    @map("forked_from_exercise_id") @db.Uuid
  forkedFrom         Exercise?    @relation("ExerciseFork", fields: [forkedFromExerciseId], references: [id], onDelete: Restrict)
  forks              Exercise[]   @relation("ExerciseFork")
  createdAt          DateTime     @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt          DateTime     @default(now()) @map("updated_at") @db.Timestamptz(6)

  @@index([ownerUserId], map: "exercise_owner_idx")
  @@index([updatedAt], map: "exercise_updated_at_idx")
  @@map("exercise")
}
```

- [ ] **Step 5: Regenerate the Prisma client and run the test**

Run: `pnpm --filter @sin/api run prisma:generate && RUN_INTEGRATION=1 pnpm --filter @sin/api run test:integration -- exercise-catalog`
Expected: PASS (all three new tests, plus every pre-existing test in the file still green).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm run typecheck`
Expected: no errors.

```bash
git add apps/api/prisma/migrations/0003_exercise_fork_provenance apps/api/prisma/schema.prisma apps/api/test/integration/exercise-catalog.integration.test.ts
git commit -m "feat(api): add forked_from_exercise_id column + FK (migration 0003)"
```

---

## Task 2: Wire `forkedFromExerciseId` through the read path

**Files:**
- Modify: `apps/api/src/repositories/exercise.ts`
- Modify: `apps/api/src/repositories/exercise.prisma.ts`
- Modify: `apps/api/test/helpers/fakes.ts`
- Modify: `packages/core/src/dto/exercise.ts`
- Modify: `apps/api/src/routes/exercises.ts`
- Test: `apps/api/test/unit/routes-exercises.test.ts`, `apps/api/test/unit/openapi-catalog.test.ts`, `packages/core/test/dto/exercise.test.ts`, `apps/api/test/integration/exercise-repository.integration.test.ts`

**Interfaces:**
- Consumes: the `forked_from_exercise_id` column from Task 1.
- Produces: `ExerciseRecord.forkedFromExerciseId: string | null` (repository layer, every task after this reads/writes it) and `Exercise.forkedFromExerciseId` on the wire DTO (AC10's DTO-field/ETag/OpenAPI requirements, for the read side — the write endpoints that populate it non-null land in later tasks).

This is a pure plumbing task — every current row has `forkedFromExerciseId: null`; no new endpoint yet.

- [ ] **Step 1: Write the failing tests**

In `packages/core/test/dto/exercise.test.ts`, add `forkedFromExerciseId: null` to `curatedRow` (top of file):

```ts
const curatedRow = {
  id: "018f9c8e-7b1a-7c2d-9e3f-4a5b6c7d8e9f",
  catalogKey: "barbell-back-squat",
  ownerUserId: null,
  name: "Barbell Back Squat",
  modality: "weight_reps",
  primaryMuscleId: "quads",
  secondaryMuscleIds: ["glutes", "hamstrings"],
  equipmentId: "barbell",
  isActive: true,
  forkedFromExerciseId: null,
  createdAt: "2026-09-08T12:00:00Z",
  updatedAt: "2026-09-08T12:00:00Z",
};
```

And add a dedicated test in the same `describe("catalog DTOs (Spec 03.1 §5)", ...)` block:

```ts
  it("ExerciseSchema requires forkedFromExerciseId and accepts a fork's origin id", () => {
    expect(() =>
      ExerciseSchema.parse({ ...curatedRow, forkedFromExerciseId: undefined }),
    ).toThrow();
    expect(
      ExerciseSchema.parse({
        ...curatedRow,
        forkedFromExerciseId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      }).forkedFromExerciseId,
    ).toBe("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d");
  });
```

In `apps/api/test/unit/routes-exercises.test.ts`, add `"forkedFromExerciseId"` to the `DTO_KEYS` array:

```ts
const DTO_KEYS = [
  "id",
  "catalogKey",
  "ownerUserId",
  "name",
  "modality",
  "primaryMuscleId",
  "secondaryMuscleIds",
  "equipmentId",
  "isActive",
  "forkedFromExerciseId",
  "createdAt",
  "updatedAt",
].sort();
```

In `apps/api/test/unit/openapi-catalog.test.ts`, add `"forkedFromExerciseId"` to the `arrayContaining` list inside `"every catalog response schema uses camelCase field names (DESIGN §6)"`.

In `apps/api/test/integration/exercise-repository.integration.test.ts`, add to the `findVisibleCatalog` describe block:

```ts
      it("maps forked_from_exercise_id (null for every existing row)", async () => {
        await insertExercise({ name: "Plain Row" });
        const { rows: [row] } = await repo.findVisibleCatalog(uuidv7());
        expect(row?.forkedFromExerciseId).toBeNull();
      });
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @sin/core run test:unit && pnpm --filter @sin/api run test:unit -- routes-exercises openapi-catalog`
Expected: FAIL — `ExerciseSchema.parse` throws on the new required field being absent from `curatedRow`'s override test but the base `curatedRow` object (used by every other pre-existing test) doesn't yet carry the field at all, and the DTO-key/field-list assertions don't yet include it.

- [ ] **Step 3: Add the core schema field**

In `packages/core/src/dto/exercise.ts`, in `ExerciseSchema` (after `isActive`):

```ts
export const ExerciseSchema = z.object({
  id: ExerciseIdSchema,
  catalogKey: z.string().min(1).nullable(), // set for curated rows, null for custom
  ownerUserId: UserIdSchema.nullable(), // null = global/curated
  name: CatalogName,
  modality: z.enum(MODALITY_VALUES),
  primaryMuscleId: z.string().nullable(),
  secondaryMuscleIds: z.array(z.string()), // muscle_group ids, authoring order (§6.1)
  equipmentId: z.string().nullable(),
  isActive: z.boolean(),
  // Spec 03.2 §5/§6 D9 — null unless this row is a copy-on-write fork of a global
  // row. Never server-side-filtered from GET /v1/exercises; suppressing a forked
  // origin from a picker is a client-side rule (Spec 06).
  forkedFromExerciseId: ExerciseIdSchema.nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Exercise = z.infer<typeof ExerciseSchema>;
```

- [ ] **Step 4: Wire the repository record + Prisma mapping**

In `apps/api/src/repositories/exercise.ts`, add the field to `ExerciseRecord` (right after `isActive`):

```ts
export interface ExerciseRecord {
  id: string;
  catalogKey: string | null;
  ownerUserId: string | null;
  name: string;
  modality: string;
  primaryMuscleId: string | null;
  secondaryMuscleIds: string[];
  equipmentId: string | null;
  isActive: boolean;
  /** Spec 03.2 — null unless this row is a copy-on-write fork of a global row. */
  forkedFromExerciseId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

In `apps/api/src/repositories/exercise.prisma.ts`:
1. Add `forked_from_exercise_id: string | null;` to `ExerciseDbRow`.
2. Add `forkedFromExerciseId: r.forked_from_exercise_id,` to `toRecord`.
3. Add `, forked_from_exercise_id` to the `SELECT` column list in `findVisibleCatalog`, `findCatalogDelta`, and `findVisibleById` (three call sites).

Also, in `findVisibleById`, extract the row-lookup into a standalone local function so later tasks (update/fork/delete) can reuse the same visibility-filtered lookup without going through `this` (avoids method-binding footguns on the returned object literal). Replace the current `findVisibleById` implementation:

```ts
  /** Visibility-filtered row lookup, shared by every write method that needs the
   * existing-row/404 check before branching on ownership/state (spec §6, §7). */
  async function loadVisibleRow(
    actingUserId: string,
    id: string,
  ): Promise<ExerciseDbRow> {
    if (!isExerciseId(id)) {
      throw new NotFoundError(
        "exercise not found or not visible to the acting user",
      );
    }
    const rows = await prisma.$queryRaw<ExerciseDbRow[]>`
      SELECT id, catalog_key, owner_user_id, name, modality,
             primary_muscle_id, secondary_muscle_ids, equipment_id,
             is_active, forked_from_exercise_id, created_at, updated_at
      FROM "exercise"
      WHERE id = ${id}::uuid
        AND (owner_user_id IS NULL OR owner_user_id = ${actingUserId}::uuid)
    `;
    const row = rows[0];
    if (!row) {
      throw new NotFoundError(
        "exercise not found or not visible to the acting user",
      );
    }
    return row;
  }
```

placed above the `return { ... }` object literal (as a sibling to `serverNow`), and change the `findVisibleById` method on the returned object to:

```ts
    async findVisibleById(
      actingUserId: string,
      id: string,
    ): Promise<ExerciseRecord> {
      return toRecord(await loadVisibleRow(actingUserId, id));
    },
```

- [ ] **Step 5: Wire the route + Fake**

In `apps/api/src/routes/exercises.ts`, add to `toDto`:

```ts
function toDto(r: ExerciseRecord): Exercise {
  return {
    id: r.id as Exercise["id"],
    catalogKey: r.catalogKey,
    ownerUserId: r.ownerUserId as Exercise["ownerUserId"],
    name: r.name,
    modality: r.modality as Exercise["modality"],
    primaryMuscleId: r.primaryMuscleId,
    secondaryMuscleIds: r.secondaryMuscleIds,
    equipmentId: r.equipmentId,
    isActive: r.isActive,
    forkedFromExerciseId: r.forkedFromExerciseId as Exercise["forkedFromExerciseId"],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
```

In `apps/api/test/helpers/fakes.ts`, add `forkedFromExerciseId: null,` to `makeExerciseRecord`'s returned defaults (before `...overrides`):

```ts
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
```

- [ ] **Step 6: Regenerate OpenAPI + run everything**

```bash
pnpm --filter @sin/api run openapi:emit
pnpm --filter @sin/core run test:unit
pnpm --filter @sin/api run test:unit
RUN_INTEGRATION=1 pnpm --filter @sin/api run test:integration
pnpm run typecheck
```

Expected: all green, `git diff openapi.json` shows only the new `forkedFromExerciseId` property.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/dto/exercise.ts packages/core/test/dto/exercise.test.ts \
  apps/api/src/repositories/exercise.ts apps/api/src/repositories/exercise.prisma.ts \
  apps/api/src/routes/exercises.ts apps/api/test/helpers/fakes.ts \
  apps/api/test/unit/routes-exercises.test.ts apps/api/test/unit/openapi-catalog.test.ts \
  apps/api/test/integration/exercise-repository.integration.test.ts openapi.json
git commit -m "feat(api): thread forkedFromExerciseId through the read path"
```

---

## Task 3: New `AppError` subclasses

**Files:**
- Modify: `apps/api/src/errors/app-error.ts`
- Test: `apps/api/test/unit/errors.test.ts`

**Interfaces:**
- Produces: `CustomExerciseLimitError` (409), `ExerciseRetiredError` (409), `ExerciseImmutableError` (403), `ExerciseImmutableUseForkError` (409), `ExerciseAlreadyOwnedError` (409) — every write-path task below throws these.

- [ ] **Step 1: Write the failing test**

In `apps/api/test/unit/errors.test.ts`, update the imports and the `cases` array inside `describe("AppError hierarchy", ...)`:

```ts
import {
  AppError,
  UnauthenticatedError,
  InvalidTokenError,
  AuthUnavailableError,
  AccountDeletedError,
  ValidationError,
  PayloadTooLargeError,
  NotFoundError,
  InternalError,
  CustomExerciseLimitError,
  ExerciseRetiredError,
  ExerciseImmutableError,
  ExerciseImmutableUseForkError,
  ExerciseAlreadyOwnedError,
} from "../../src/errors/app-error.js";
```

```ts
    const cases: Array<[AppError, number, string]> = [
      [new UnauthenticatedError(), 401, "unauthenticated"],
      [new InvalidTokenError("expired"), 401, "invalid-token"],
      [new AuthUnavailableError("jwks fetch failed"), 503, "auth-unavailable"],
      [new AccountDeletedError(), 403, "account-deleted"],
      [
        new ValidationError([{ path: "unitPreference", message: "invalid" }]),
        422,
        "validation-error",
      ],
      [new PayloadTooLargeError(), 413, "payload-too-large"],
      [new NotFoundError(), 404, "not-found"],
      [new InternalError("boom"), 500, "internal"],
      [new CustomExerciseLimitError(), 409, "exercise-limit-reached"],
      [new ExerciseRetiredError(), 409, "exercise-retired"],
      [new ExerciseImmutableError(), 403, "exercise-immutable"],
      [new ExerciseImmutableUseForkError(), 409, "exercise-immutable-use-fork"],
      [new ExerciseAlreadyOwnedError(), 409, "exercise-already-owned"],
    ];
```

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm --filter @sin/api run test:unit -- errors`
Expected: FAIL — the five new classes don't exist yet (import error).

- [ ] **Step 3: Add the error classes**

Append to `apps/api/src/errors/app-error.ts`, after `InternalError`:

```ts
export class CustomExerciseLimitError extends AppError {
  readonly status = 409;
  readonly slug = "exercise-limit-reached";
  readonly title = "Custom exercise limit reached";
  readonly publicDetail =
    "You have reached the maximum number of custom exercises.";

  constructor(internal = "per-user active custom exercise cap exceeded") {
    super(internal);
  }
}

export class ExerciseRetiredError extends AppError {
  readonly status = 409;
  readonly slug = "exercise-retired";
  readonly title = "Exercise retired";
  readonly publicDetail =
    "This exercise has been retired and can no longer be modified.";

  constructor(internal = "target exercise is_active=false") {
    super(internal);
  }
}

export class ExerciseImmutableError extends AppError {
  readonly status = 403;
  readonly slug = "exercise-immutable";
  readonly title = "Exercise immutable";
  readonly publicDetail = "This is a global exercise and cannot be deleted.";

  constructor(internal = "target exercise is a global row") {
    super(internal);
  }
}

export class ExerciseImmutableUseForkError extends AppError {
  readonly status = 409;
  readonly slug = "exercise-immutable-use-fork";
  readonly title = "Exercise immutable — use fork";
  readonly publicDetail =
    "This is a global exercise and cannot be edited directly. Fork it first.";

  constructor(internal = "target exercise is a global row; PATCH refused") {
    super(internal);
  }
}

export class ExerciseAlreadyOwnedError extends AppError {
  readonly status = 409;
  readonly slug = "exercise-already-owned";
  readonly title = "Exercise already owned";
  readonly publicDetail =
    "You already own this exercise. Edit it directly instead of forking.";

  constructor(internal = "fork target is already owned by the caller") {
    super(internal);
  }
}
```

- [ ] **Step 4: Run to confirm it passes**

Run: `pnpm --filter @sin/api run test:unit -- errors`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/errors/app-error.ts apps/api/test/unit/errors.test.ts
git commit -m "feat(api): add exercise-write AppError subclasses (Spec 03.2 §5)"
```

---

## Task 4: `@sin/core` write DTOs + shared cross-field validator

**Files:**
- Modify: `packages/core/src/dto/exercise.ts`
- Test: `packages/core/test/dto/exercise.test.ts`

**Interfaces:**
- Produces:
  - `CreateExerciseSchema` / `type CreateExercise` (full body, `.strict()`, self-validating)
  - `UpdateExerciseSchema` / `type UpdateExercise` (partial body, `.strict()`, no self cross-field check)
  - `MAX_CUSTOM_EXERCISES_PER_USER = 500`
  - `muscleIdCrossFieldIssues(val: { primaryMuscleId: string | null; secondaryMuscleIds: string[] }): { path: ["secondaryMuscleIds"]; message: string }[]` — the pure duplicate/restate check, reused by `CreateExerciseSchema`'s `.superRefine` here and by `apps/api/src/repositories/exercise-writes.ts`'s merge-then-validate step (Task 6).

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/dto/exercise.test.ts`, inside `describe("catalog DTOs (Spec 03.1 §5)", ...)` (or as a sibling top-level `describe` in the same file — either is fine; place it as a new top-level block after the existing one closes):

```ts
import {
  CatalogName,
  CreateExerciseSchema,
  EquipmentSchema,
  ExerciseSchema,
  ExercisesResponse,
  MAX_CUSTOM_EXERCISES_PER_USER,
  MuscleGroupSchema,
  muscleIdCrossFieldIssues,
  noControlChars,
  UpdatedSinceQuery,
  UpdateExerciseSchema,
} from "../../src/dto/exercise.js";
```

```ts
describe("write DTOs (Spec 03.2 §5)", () => {
  const validCreate = {
    name: "Incline Dumbbell Press",
    modality: "weight_reps",
    primaryMuscleId: "chest",
    secondaryMuscleIds: ["triceps", "shoulders"],
    equipmentId: "dumbbell",
  };

  it("CreateExerciseSchema accepts a full valid body and applies field defaults", () => {
    expect(
      CreateExerciseSchema.parse({ name: "Push-up", modality: "bodyweight_reps" }),
    ).toEqual({
      name: "Push-up",
      modality: "bodyweight_reps",
      primaryMuscleId: null,
      secondaryMuscleIds: [],
      equipmentId: null,
    });
  });

  it("CreateExerciseSchema rejects an unknown key (.strict())", () => {
    expect(() =>
      CreateExerciseSchema.parse({ ...validCreate, extra: "nope" }),
    ).toThrow();
  });

  it("CreateExerciseSchema rejects a duplicate secondaryMuscleIds entry", () => {
    const r = CreateExerciseSchema.safeParse({
      ...validCreate,
      secondaryMuscleIds: ["triceps", "triceps"],
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]).toMatchObject({
      path: ["secondaryMuscleIds"],
      message: "duplicate muscle id",
    });
  });

  it("CreateExerciseSchema rejects secondaryMuscleIds restating primaryMuscleId", () => {
    const r = CreateExerciseSchema.safeParse({
      ...validCreate,
      primaryMuscleId: "chest",
      secondaryMuscleIds: ["chest"],
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues.some((i) => i.message === "must not restate primaryMuscleId")).toBe(
      true,
    );
  });

  it("CreateExerciseSchema caps secondaryMuscleIds at 4 entries", () => {
    expect(
      CreateExerciseSchema.safeParse({ ...validCreate, secondaryMuscleIds: ["a", "b", "c", "d"] })
        .success,
    ).toBe(true);
    expect(
      CreateExerciseSchema.safeParse({
        ...validCreate,
        secondaryMuscleIds: ["a", "b", "c", "d", "e"],
      }).success,
    ).toBe(false);
  });

  it("CreateExerciseSchema rejects a bad name and a bad modality", () => {
    expect(CreateExerciseSchema.safeParse({ ...validCreate, name: "" }).success).toBe(false);
    expect(
      CreateExerciseSchema.safeParse({ ...validCreate, modality: "isometric_hold" }).success,
    ).toBe(false);
  });

  it("UpdateExerciseSchema accepts an empty object and any single field", () => {
    expect(UpdateExerciseSchema.parse({})).toEqual({});
    expect(UpdateExerciseSchema.parse({ name: "New Name" })).toEqual({ name: "New Name" });
    expect(UpdateExerciseSchema.parse({ primaryMuscleId: null })).toEqual({
      primaryMuscleId: null,
    });
  });

  it("UpdateExerciseSchema rejects an unknown key and does not itself cross-check fields", () => {
    expect(() => UpdateExerciseSchema.parse({ nope: 1 })).toThrow();
    // A partial body restating nothing yet is not, by itself, a conflict — the
    // merge-then-validate rule (Spec 03.2 §6) lives server-side, not here.
    expect(
      UpdateExerciseSchema.safeParse({ secondaryMuscleIds: ["chest", "chest"] }).success,
    ).toBe(false); // still rejected: same-array duplicate is a standalone-valid-body failure
  });

  it("muscleIdCrossFieldIssues is the pure rule both schemas/merge-validation share", () => {
    expect(
      muscleIdCrossFieldIssues({ primaryMuscleId: null, secondaryMuscleIds: ["a", "b"] }),
    ).toEqual([]);
    expect(
      muscleIdCrossFieldIssues({ primaryMuscleId: null, secondaryMuscleIds: ["a", "a"] }),
    ).toEqual([{ path: ["secondaryMuscleIds"], message: "duplicate muscle id" }]);
    expect(
      muscleIdCrossFieldIssues({ primaryMuscleId: "chest", secondaryMuscleIds: ["chest"] }),
    ).toEqual([{ path: ["secondaryMuscleIds"], message: "must not restate primaryMuscleId" }]);
  });

  it("MAX_CUSTOM_EXERCISES_PER_USER is 500", () => {
    expect(MAX_CUSTOM_EXERCISES_PER_USER).toBe(500);
  });
});
```

Note on the "rejects a duplicate ... same-array" test above: `UpdateExerciseSchema` has no `.superRefine`, but `secondaryMuscleIds` restating itself *within the same array* has nothing to do with cross-field merge — wait, re-check: a bare `["chest","chest"]` duplicate-within-array check is exactly what `muscleIdCrossFieldIssues` catches, and since `UpdateExerciseSchema` doesn't call it, this assertion is actually wrong. **Fix before running:** change that last expectation to `.toBe(true)` (accepted, standalone) — `UpdateExerciseSchema` really does defer *all* cross-field checking, including intra-array duplicates, to the server-side merge-then-validate step, since a partial body has no `primaryMuscleId` context to check against either. Use:

```ts
    expect(
      UpdateExerciseSchema.safeParse({ secondaryMuscleIds: ["chest", "chest"] }).success,
    ).toBe(true); // UpdateExerciseSchema defers all cross-field checking (incl. intra-array
    // duplicates) to the server-side merge-then-validate step (Spec 03.2 §6) — a
    // partial body alone can't know if this is a real conflict or a no-op restate.
```

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm --filter @sin/core run test:unit`
Expected: FAIL — `CreateExerciseSchema`, `UpdateExerciseSchema`, `MAX_CUSTOM_EXERCISES_PER_USER`, `muscleIdCrossFieldIssues` don't exist yet.

- [ ] **Step 3: Implement**

In `packages/core/src/dto/exercise.ts`, add after `ExerciseSchema`'s `export type Exercise = ...` line:

```ts
/**
 * The muscle-id cross-field rule shared by `CreateExerciseSchema.superRefine`
 * (full body) and the server-side merge-then-validate step for `PATCH` and the
 * `/fork` overlay (Spec 03.2 §6) — a partial `UpdateExerciseSchema` body can't
 * see the base row's current values, so this same pure check re-runs against the
 * *merged* result there instead of at parse time.
 */
export interface MuscleFieldIssue {
  path: ["secondaryMuscleIds"];
  message: string;
}

export function muscleIdCrossFieldIssues(val: {
  primaryMuscleId: string | null;
  secondaryMuscleIds: string[];
}): MuscleFieldIssue[] {
  const issues: MuscleFieldIssue[] = [];
  const seen = new Set<string>();
  for (const id of val.secondaryMuscleIds) {
    if (seen.has(id)) {
      issues.push({ path: ["secondaryMuscleIds"], message: "duplicate muscle id" });
    }
    seen.add(id);
  }
  if (val.primaryMuscleId !== null && val.secondaryMuscleIds.includes(val.primaryMuscleId)) {
    issues.push({ path: ["secondaryMuscleIds"], message: "must not restate primaryMuscleId" });
  }
  return issues;
}

/** `POST /v1/exercises` body — a full custom-exercise definition (Spec 03.2 §5). */
export const CreateExerciseSchema = z
  .object({
    name: CatalogName,
    modality: z.enum(MODALITY_VALUES),
    primaryMuscleId: z.string().nullable().default(null),
    secondaryMuscleIds: z.array(z.string()).max(4).default([]),
    equipmentId: z.string().nullable().default(null),
  })
  .strict()
  .superRefine((val, ctx) => {
    for (const issue of muscleIdCrossFieldIssues(val)) {
      ctx.addIssue({ code: "custom", path: issue.path, message: issue.message });
    }
  });
export type CreateExercise = z.infer<typeof CreateExerciseSchema>;

/**
 * `PATCH /v1/exercises/{id}` body and the `/fork` overlay body — same fields as
 * `CreateExerciseSchema`, all optional, **no** `.superRefine`: a partial body
 * can't see the base row's current values, so the cross-field check re-runs
 * server-side against the merged result instead (Spec 03.2 §6).
 */
export const UpdateExerciseSchema = z
  .object({
    name: CatalogName,
    modality: z.enum(MODALITY_VALUES),
    primaryMuscleId: z.string().nullable(),
    secondaryMuscleIds: z.array(z.string()).max(4),
    equipmentId: z.string().nullable(),
  })
  .partial()
  .strict();
export type UpdateExercise = z.infer<typeof UpdateExerciseSchema>;

/**
 * Hard per-user active-custom-exercise cap (Spec 03.2 D15) — a single budget
 * shared by `POST /v1/exercises` and `POST /v1/exercises/{id}/fork`. A code
 * constant, not env-configurable: raising it is a reviewed decision tied to the
 * unpaginated `GET /v1/exercises` read (Spec 03.1 §6.1), not an ops knob.
 */
export const MAX_CUSTOM_EXERCISES_PER_USER = 500;
```

- [ ] **Step 4: Run to confirm it passes**

Run: `pnpm --filter @sin/core run test:unit`
Expected: PASS.

- [ ] **Step 5: Typecheck + purity + commit**

```bash
pnpm --filter @sin/core run typecheck
pnpm run core:purity
git add packages/core/src/dto/exercise.ts packages/core/test/dto/exercise.test.ts
git commit -m "feat(core): add CreateExerciseSchema/UpdateExerciseSchema + cap constant (Spec 03.2 §5)"
```

---

## Task 5: `POST /v1/exercises` (custom create)

**Files:**
- Modify: `apps/api/src/repositories/exercise.ts`
- Modify: `apps/api/src/repositories/exercise.prisma.ts`
- Modify: `apps/api/test/helpers/fakes.ts`
- Modify: `apps/api/src/routes/exercises.ts`
- Create: `apps/api/test/unit/routes-exercises-writes.test.ts`
- Modify: `apps/api/test/unit/openapi-catalog.test.ts`
- Modify: `apps/api/test/integration/exercise-repository.integration.test.ts`

**Interfaces:**
- Consumes: `CreateExerciseSchema`/`CreateExercise` (Task 4), `CustomExerciseLimitError` (Task 3), `loadVisibleRow` pattern precedent (Task 2).
- Produces:
  - `ExerciseWriteFields` type (`{ name, modality, primaryMuscleId, secondaryMuscleIds, equipmentId }`) and `ExerciseWritePatch = Partial<ExerciseWriteFields>`, exported from `apps/api/src/repositories/exercise.ts` — every later write task uses these.
  - `ExerciseRepository.createExercise(actingUserId: string, fields: ExerciseWriteFields): Promise<ExerciseRecord>`.
  - The private `insertWithCap` and `validateReferences` helpers inside `exercise.prisma.ts`, reused verbatim by `forkExercise` in Task 7 (fork **shares this exact statement**, spec §6).

- [ ] **Step 1: Write the failing repository interface + Fake usage**

In `apps/api/src/repositories/exercise.ts`, add after the `ExerciseRecord` interface:

```ts
/** The fields a caller can set on a custom exercise (Spec 03.2 §5). */
export interface ExerciseWriteFields {
  name: string;
  modality: string;
  primaryMuscleId: string | null;
  secondaryMuscleIds: string[];
  equipmentId: string | null;
}

/** A partial edit — `PATCH` body or `/fork` overlay body (Spec 03.2 §5, §6). */
export type ExerciseWritePatch = Partial<ExerciseWriteFields>;
```

and add to the `ExerciseRepository` interface (after `findVisibleById`):

```ts
  /**
   * Creates an owned custom exercise: validates every reference id
   * (`primaryMuscleId`/`secondaryMuscleIds`/`equipmentId`) exists, then inserts
   * atomically under the shared 500-active-row cap (Spec 03.2 §6). Throws
   * `ValidationError` (bad reference ids) or `CustomExerciseLimitError` (cap hit).
   */
  createExercise(
    actingUserId: string,
    fields: ExerciseWriteFields,
  ): Promise<ExerciseRecord>;
```

- [ ] **Step 2: Write the failing integration test**

Append to `apps/api/test/integration/exercise-repository.integration.test.ts` (new top-level `describe` inside the existing `describe.skipIf(...)` block, and new imports at the top of the file):

```ts
import { CustomExerciseLimitError, ValidationError } from "../../src/errors/app-error.js";
```

```ts
    describe("Spec 03.2 AC2/AC3 — createExercise", () => {
      const fields = {
        name: "Cable Fly",
        modality: "weight_reps",
        primaryMuscleId: null as string | null,
        secondaryMuscleIds: [] as string[],
        equipmentId: null as string | null,
      };

      it("inserts an owned row with catalogKey null and forkedFromExerciseId null", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        const created = await repo.createExercise(userId, fields);
        expect(created).toMatchObject({
          catalogKey: null,
          ownerUserId: userId,
          forkedFromExerciseId: null,
          isActive: true,
          name: "Cable Fly",
        });
      });

      it("rejects unknown primaryMuscleId, secondaryMuscleIds, and equipmentId together in one error", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        try {
          await repo.createExercise(userId, {
            ...fields,
            primaryMuscleId: "no-such-muscle",
            secondaryMuscleIds: ["also-missing"],
            equipmentId: "no-such-equipment",
          });
          expect.unreachable("expected ValidationError");
        } catch (err) {
          expect(err).toBeInstanceOf(ValidationError);
          const paths = (err as ValidationError).fieldErrors!.map((f) => f.path);
          expect(paths).toEqual(
            expect.arrayContaining(["primaryMuscleId", "secondaryMuscleIds", "equipmentId"]),
          );
        }
      });

      it("accepts real muscle/equipment reference ids", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        await insertMuscleGroup("chest", "Chest", 1);
        await insertEquipment("barbell", "Barbell", 1);
        const created = await repo.createExercise(userId, {
          ...fields,
          primaryMuscleId: "chest",
          equipmentId: "barbell",
        });
        expect(created.primaryMuscleId).toBe("chest");
      });

      it("admits the 500th active row, rejects the 501st with CustomExerciseLimitError", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        await Promise.all(
          Array.from({ length: 499 }, () =>
            insertExercise({ name: `Seed ${uuidv7()}`, ownerUserId: userId, isActive: true }),
          ),
        );

        const ok = await repo.createExercise(userId, { ...fields, name: "Row 500" });
        expect(ok.ownerUserId).toBe(userId);

        await expect(
          repo.createExercise(userId, { ...fields, name: "Row 501" }),
        ).rejects.toBeInstanceOf(CustomExerciseLimitError);
      });

      it("does not count another user's or the caller's own retired rows toward the cap", async () => {
        const userA = uuidv7();
        const userB = uuidv7();
        await insertUser(userA);
        await insertUser(userB);
        await insertExercise({ name: "B's row", ownerUserId: userB, isActive: true });
        await insertExercise({ name: "A's retired row", ownerUserId: userA, isActive: false });

        const created = await repo.createExercise(userA, fields);
        expect(created.ownerUserId).toBe(userA);
      });
    });
```

- [ ] **Step 3: Run to confirm it fails**

Run: `RUN_INTEGRATION=1 pnpm --filter @sin/api run test:integration -- exercise-repository`
Expected: FAIL — `repo.createExercise is not a function`.

- [ ] **Step 4: Implement in `exercise.prisma.ts`**

Add near the top of `apps/api/src/repositories/exercise.prisma.ts` (after the existing imports):

```ts
import { uuidv7 } from "uuidv7";
import { MAX_CUSTOM_EXERCISES_PER_USER } from "@sin/core";
import {
  CustomExerciseLimitError,
  NotFoundError,
  ValidationError,
  type FieldError,
} from "../errors/app-error.js";
import type {
  CatalogPage,
  ExerciseRecord,
  ExerciseRepository,
  ExerciseWriteFields,
  ReferenceRecord,
} from "./exercise.js";
```

(replace the existing narrower `import type { ... } from "./exercise.js"` line with the one above.)

Then, inside `createExerciseRepository`, add these two local functions above the `return { ... }` object literal (alongside `serverNow` and `loadVisibleRow` from Task 2):

```ts
  /**
   * Batch-checks every reference id in one query per table, collecting *all* bad
   * ones into a single ValidationError rather than stopping at the first (Spec
   * 03.2 §6, AC2). Real FKs on primary_muscle_id/equipment_id stay as
   * defense-in-depth; secondary_muscle_ids has no DB FK at all, so this is its
   * only integrity guard.
   */
  async function validateReferences(fields: ExerciseWriteFields): Promise<void> {
    const muscleIds = [
      ...(fields.primaryMuscleId !== null ? [fields.primaryMuscleId] : []),
      ...fields.secondaryMuscleIds,
    ];
    const uniqueMuscleIds = [...new Set(muscleIds)];
    const equipmentIds = fields.equipmentId !== null ? [fields.equipmentId] : [];

    const [foundMuscle, foundEquipment] = await Promise.all([
      uniqueMuscleIds.length > 0
        ? prisma.$queryRaw<{ id: string }[]>`
            SELECT id FROM "muscle_group" WHERE id = ANY(${uniqueMuscleIds}::text[])`
        : Promise.resolve([]),
      equipmentIds.length > 0
        ? prisma.$queryRaw<{ id: string }[]>`
            SELECT id FROM "equipment" WHERE id = ANY(${equipmentIds}::text[])`
        : Promise.resolve([]),
    ]);
    const foundMuscleSet = new Set(foundMuscle.map((r) => r.id));
    const foundEquipmentSet = new Set(foundEquipment.map((r) => r.id));

    const fieldErrors: FieldError[] = [];
    if (fields.primaryMuscleId !== null && !foundMuscleSet.has(fields.primaryMuscleId)) {
      fieldErrors.push({
        path: "primaryMuscleId",
        message: "must reference an existing muscle group",
      });
    }
    if (fields.secondaryMuscleIds.some((id) => !foundMuscleSet.has(id))) {
      fieldErrors.push({
        path: "secondaryMuscleIds",
        message: "must reference existing muscle groups",
      });
    }
    if (fields.equipmentId !== null && !foundEquipmentSet.has(fields.equipmentId)) {
      fieldErrors.push({
        path: "equipmentId",
        message: "must reference an existing equipment id",
      });
    }
    if (fieldErrors.length > 0) {
      throw new ValidationError(
        fieldErrors,
        "create/fork references unknown muscle group or equipment ids",
      );
    }
  }

  /**
   * The atomic, advisory-lock-guarded cap insert (Spec 03.2 §6, D15). Shared
   * verbatim by `createExercise` (forkedFromExerciseId = null) and
   * `forkExercise` (Task 7) — a single budget across both endpoints. Every
   * interpolation is a driver-bound tagged-template parameter, never
   * `$queryRawUnsafe` — `name` is up to 120 chars of verbatim user text on this
   * table's first-ever user-write path (Spec 03.2 §6).
   */
  async function insertWithCap(
    actingUserId: string,
    fields: ExerciseWriteFields,
    forkedFromExerciseId: string | null,
  ): Promise<ExerciseDbRow | undefined> {
    const id = uuidv7();
    const rows = await prisma.$queryRaw<ExerciseDbRow[]>`
      WITH _lock AS (
        SELECT pg_advisory_xact_lock(hashtext(${actingUserId}))
      ),
      _cap AS (
        SELECT count(*) AS active_count
        FROM "exercise", _lock
        WHERE owner_user_id = ${actingUserId}::uuid AND is_active = true
      )
      INSERT INTO "exercise" (id, owner_user_id, catalog_key, name, modality,
                              primary_muscle_id, secondary_muscle_ids, equipment_id,
                              is_active, forked_from_exercise_id, created_at, updated_at)
      SELECT ${id}::uuid, ${actingUserId}::uuid, NULL, ${fields.name}, ${fields.modality},
             ${fields.primaryMuscleId}, ${fields.secondaryMuscleIds}::text[], ${fields.equipmentId},
             true, ${forkedFromExerciseId}::uuid, now(), now()
      FROM _cap
      WHERE _cap.active_count < ${MAX_CUSTOM_EXERCISES_PER_USER}
      RETURNING id, catalog_key, owner_user_id, name, modality, primary_muscle_id,
                secondary_muscle_ids, equipment_id, is_active, forked_from_exercise_id,
                created_at, updated_at
    `;
    return rows[0];
  }
```

Then add the `createExercise` method to the returned object (after `findVisibleById`):

```ts
    async createExercise(
      actingUserId: string,
      fields: ExerciseWriteFields,
    ): Promise<ExerciseRecord> {
      await validateReferences(fields);
      const row = await insertWithCap(actingUserId, fields, null);
      if (!row) throw new CustomExerciseLimitError();
      return toRecord(row);
    },
```

- [ ] **Step 5: Add the Fake implementation**

In `apps/api/test/helpers/fakes.ts`, update imports:

```ts
import { isExerciseId, MAX_CUSTOM_EXERCISES_PER_USER } from "@sin/core";
import { CustomExerciseLimitError, NotFoundError, ValidationError } from "../../src/errors/app-error.js";
import type {
  CatalogPage,
  ExerciseRecord,
  ExerciseRepository,
  ExerciseWriteFields,
  ReferenceRecord,
} from "../../src/repositories/exercise.js";
```

Add to `FakeExerciseRepository` (after the `byId` field declaration):

```ts
  /** Overridable in tests to exercise the cap boundary without 500 inserts. */
  cap = MAX_CUSTOM_EXERCISES_PER_USER;

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
```

- [ ] **Step 6: Wire the route + write the route unit tests**

In `apps/api/src/routes/exercises.ts`, update imports:

```ts
import { CreateExerciseSchema, ExercisesResponse, ExerciseSchema, UpdatedSinceQuery, type Exercise } from "@sin/core";
```

Add inside `registerExerciseRoutes`, after the existing `r.get("/exercises", ...)` block:

```ts
  r.post(
    "/exercises",
    { schema: { body: CreateExerciseSchema, response: { 201: ExerciseSchema } } },
    async (request, reply) => {
      const actingUserId = request.user!.id;
      const created = await deps.exerciseRepository.createExercise(
        actingUserId,
        request.body,
      );
      request.log.info(
        { exercise_id: created.id, owner_user_id: actingUserId },
        "custom_exercise_created",
      );
      reply.code(201).header("location", `/v1/exercises/${created.id}`);
      return toDto(created);
    },
  );
```

Create `apps/api/test/unit/routes-exercises-writes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";
import { FakeExerciseRepository, fakeVerifier } from "../helpers/fakes.js";
import { InvalidTokenError } from "../../src/errors/app-error.js";

const BEARER = { authorization: "Bearer test-token" };
const JSON_HEADERS = { ...BEARER, "content-type": "application/json" };

const validCreateBody = {
  name: "Cable Fly",
  modality: "weight_reps",
};

describe("POST /v1/exercises (Spec 03.2 AC2, AC3)", () => {
  it("201s with catalogKey null, ownerUserId = caller, forkedFromExerciseId null, isActive true", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    const { app, repo } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const res = await app.inject({
      method: "POST",
      url: "/v1/exercises",
      headers: JSON_HEADERS,
      payload: validCreateBody,
    });

    expect(res.statusCode).toBe(201);
    const user = await repo.findByAuthSub("auth0|user-123");
    const body = res.json();
    expect(body).toMatchObject({
      catalogKey: null,
      ownerUserId: user!.id,
      forkedFromExerciseId: null,
      isActive: true,
      name: "Cable Fly",
      secondaryMuscleIds: [],
    });
    expect(res.headers.location).toBe(`/v1/exercises/${body.id}`);
  });

  it("preserves secondaryMuscleIds in submitted order", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const res = await app.inject({
      method: "POST",
      url: "/v1/exercises",
      headers: JSON_HEADERS,
      payload: { ...validCreateBody, secondaryMuscleIds: ["c", "a", "b"] },
    });

    expect(res.json().secondaryMuscleIds).toEqual(["c", "a", "b"]);
  });

  it("422 on bad name/modality", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/exercises",
      headers: JSON_HEADERS,
      payload: { name: "", modality: "isometric_hold" },
    });
    expect(res.statusCode).toBe(422);
    const paths = res.json().errors.map((e: { path: string }) => e.path);
    expect(paths).toEqual(expect.arrayContaining(["name", "modality"]));
  });

  it("422 naming every unknown reference id together, not just the first", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });
    const res = await app.inject({
      method: "POST",
      url: "/v1/exercises",
      headers: JSON_HEADERS,
      payload: {
        ...validCreateBody,
        primaryMuscleId: "no-such-muscle",
        secondaryMuscleIds: ["also-missing"],
        equipmentId: "no-such-equipment",
      },
    });
    expect(res.statusCode).toBe(422);
    const paths = res.json().errors.map((e: { path: string }) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining(["primaryMuscleId", "secondaryMuscleIds", "equipmentId"]),
    );
  });

  it("409 exercise-limit-reached once the (test-lowered) cap is hit", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.cap = 1;
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const first = await app.inject({
      method: "POST",
      url: "/v1/exercises",
      headers: JSON_HEADERS,
      payload: validCreateBody,
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/v1/exercises",
      headers: JSON_HEADERS,
      payload: { ...validCreateBody, name: "Second" },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().type).toContain("exercise-limit-reached");
  });

  it("401 without a token", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/exercises",
      headers: { "content-type": "application/json" },
      payload: validCreateBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it("401 with an invalid token", async () => {
    const { app } = await buildTestApp({
      tokenVerifier: fakeVerifier(() => {
        throw new InvalidTokenError("signature check failed");
      }),
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/exercises",
      headers: JSON_HEADERS,
      payload: validCreateBody,
    });
    expect(res.statusCode).toBe(401);
  });
});
```

In `apps/api/test/unit/openapi-catalog.test.ts`, fix the exact-methods assertion so it no longer breaks now that `/v1/exercises` has both `GET` and `POST`. Replace:

```ts
    for (const path of CATALOG_PATHS) {
      expect(doc.paths, path).toHaveProperty(path);
      expect(Object.keys(doc.paths[path]!)).toEqual(["get"]);
    }
```

with:

```ts
    const expectedMethods: Record<string, string[]> = {
      "/v1/exercises": ["get", "post"],
      "/v1/muscle-groups": ["get"],
      "/v1/equipment": ["get"],
    };
    for (const path of CATALOG_PATHS) {
      expect(doc.paths, path).toHaveProperty(path);
      expect(Object.keys(doc.paths[path]!).sort()).toEqual(expectedMethods[path]!.sort());
    }
```

- [ ] **Step 7: Run everything, regenerate OpenAPI, verify**

```bash
pnpm --filter @sin/api run test:unit
RUN_INTEGRATION=1 pnpm --filter @sin/api run test:integration
pnpm --filter @sin/api run openapi:emit
pnpm run typecheck
pnpm run lint
```

Expected: all green; `openapi.json` now lists `post` under `/v1/exercises`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/repositories/exercise.ts apps/api/src/repositories/exercise.prisma.ts \
  apps/api/src/routes/exercises.ts apps/api/test/helpers/fakes.ts \
  apps/api/test/unit/routes-exercises-writes.test.ts apps/api/test/unit/openapi-catalog.test.ts \
  apps/api/test/integration/exercise-repository.integration.test.ts openapi.json
git commit -m "feat(api): add POST /v1/exercises (custom create + atomic cap)"
```

---

## Task 6: `PATCH /v1/exercises/{id}`

**Files:**
- Create: `apps/api/src/repositories/exercise-writes.ts`
- Create: `apps/api/test/unit/exercise-writes.test.ts`
- Modify: `apps/api/src/repositories/exercise.ts`
- Modify: `apps/api/src/repositories/exercise.prisma.ts`
- Modify: `apps/api/test/helpers/fakes.ts`
- Modify: `apps/api/src/routes/exercises.ts`
- Modify: `apps/api/test/unit/routes-exercises-writes.test.ts`
- Modify: `apps/api/test/unit/contract-pipeline.test.ts`
- Modify: `apps/api/test/integration/exercise-repository.integration.test.ts`

**Interfaces:**
- Consumes: `muscleIdCrossFieldIssues` (Task 4), `ExerciseWriteFields`/`ExerciseWritePatch` (Task 5), `loadVisibleRow` (Task 2), `ExerciseImmutableUseForkError`/`ExerciseRetiredError` (Task 3).
- Produces:
  - `mergeWritableFields(base: ExerciseWriteFields, patch: ExerciseWritePatch): ExerciseWriteFields` and `assertMergedFieldsValid(merged: ExerciseWriteFields): void` (throws `ValidationError`) from `apps/api/src/repositories/exercise-writes.ts` — Task 7's fork overlay reuses both.
  - `ExerciseRepository.updateExercise(actingUserId: string, id: string, patch: ExerciseWritePatch): Promise<ExerciseRecord>`.

- [ ] **Step 1: Write the failing unit test for the pure merge/validate helpers**

Create `apps/api/test/unit/exercise-writes.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mergeWritableFields, assertMergedFieldsValid } from "../../src/repositories/exercise-writes.js";
import { ValidationError } from "../../src/errors/app-error.js";
import type { ExerciseWriteFields } from "../../src/repositories/exercise.js";

const base: ExerciseWriteFields = {
  name: "Back Squat",
  modality: "weight_reps",
  primaryMuscleId: "quads",
  secondaryMuscleIds: ["glutes"],
  equipmentId: "barbell",
};

describe("mergeWritableFields", () => {
  it("overlays only the keys present in the patch", () => {
    expect(mergeWritableFields(base, { name: "Front Squat" })).toEqual({
      ...base,
      name: "Front Squat",
    });
  });

  it("applies an explicit null on a nullable field rather than falling back to base", () => {
    expect(mergeWritableFields(base, { primaryMuscleId: null }).primaryMuscleId).toBeNull();
  });

  it("returns the base fields unchanged for an empty patch", () => {
    expect(mergeWritableFields(base, {})).toEqual(base);
  });
});

describe("assertMergedFieldsValid", () => {
  it("does not throw for a conflict-free merge", () => {
    expect(() => assertMergedFieldsValid(base)).not.toThrow();
  });

  it("throws ValidationError naming secondaryMuscleIds when the merge restates primaryMuscleId", () => {
    const merged = { ...base, secondaryMuscleIds: ["quads"] };
    try {
      assertMergedFieldsValid(merged);
      expect.unreachable("expected ValidationError");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fieldErrors).toEqual([
        { path: "secondaryMuscleIds", message: "must not restate primaryMuscleId" },
      ]);
    }
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm --filter @sin/api run test:unit -- exercise-writes`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the pure helper module**

Create `apps/api/src/repositories/exercise-writes.ts`:

```ts
import { muscleIdCrossFieldIssues } from "@sin/core";
import { ValidationError, type FieldError } from "../errors/app-error.js";
import type { ExerciseWriteFields, ExerciseWritePatch } from "./exercise.js";

/**
 * Overlays only the keys actually present in `patch` onto `base` (Spec 03.2
 * §5/§6). `"key" in patch` — not `??` — distinguishes an explicit `null` on a
 * nullable field (clear it) from the field being absent (keep the base value);
 * `UpdateExerciseSchema.partial()` omits absent keys entirely rather than
 * setting them to `undefined`, so this check is exact.
 */
export function mergeWritableFields(
  base: ExerciseWriteFields,
  patch: ExerciseWritePatch,
): ExerciseWriteFields {
  return {
    name: "name" in patch ? patch.name! : base.name,
    modality: "modality" in patch ? patch.modality! : base.modality,
    primaryMuscleId:
      "primaryMuscleId" in patch ? patch.primaryMuscleId! : base.primaryMuscleId,
    secondaryMuscleIds:
      "secondaryMuscleIds" in patch
        ? patch.secondaryMuscleIds!
        : base.secondaryMuscleIds,
    equipmentId: "equipmentId" in patch ? patch.equipmentId! : base.equipmentId,
  };
}

/**
 * Re-runs the muscle-id cross-field rule against the *merged* result (Spec
 * 03.2 §6) — a partial body that is valid standalone can still produce an
 * invalid merge (e.g. restating the base row's untouched `primaryMuscleId`).
 * Shared by `PATCH` and the `/fork` overlay.
 */
export function assertMergedFieldsValid(merged: ExerciseWriteFields): void {
  const issues = muscleIdCrossFieldIssues(merged);
  if (issues.length === 0) return;
  const fieldErrors: FieldError[] = issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
  throw new ValidationError(
    fieldErrors,
    "merged exercise fields fail the muscle-id cross-field check",
  );
}
```

- [ ] **Step 4: Run to confirm the pure-helper test passes**

Run: `pnpm --filter @sin/api run test:unit -- exercise-writes`
Expected: PASS.

- [ ] **Step 5: Write the failing repository integration test**

Add imports to `apps/api/test/integration/exercise-repository.integration.test.ts`:

```ts
import { ExerciseImmutableUseForkError, ExerciseRetiredError } from "../../src/errors/app-error.js";
```

Append a new `describe`:

```ts
    describe("Spec 03.2 AC4/AC5 — updateExercise", () => {
      it("updates an owned row in place: same id, updatedAt bumped", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        const id = uuidv7();
        await insertExercise({ id, name: "Old Name", ownerUserId: userId });
        const before = await repo.findVisibleById(userId, id);

        const updated = await repo.updateExercise(userId, id, { name: "New Name" });
        expect(updated.id).toBe(id);
        expect(updated.name).toBe("New Name");
        expect(updated.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
      });

      it("422s naming the field when a partial body, merged with the base row, restates primaryMuscleId", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        const id = uuidv7();
        await insertMuscleGroup("quads", "Quads", 1);
        await db.prisma.$executeRawUnsafe(
          `UPDATE "exercise" SET primary_muscle_id = NULL WHERE id = $1::uuid`,
          id,
        );
        await insertExercise({ id, name: "Squat", ownerUserId: userId });
        await db.prisma.$executeRawUnsafe(
          `UPDATE "exercise" SET primary_muscle_id = 'quads' WHERE id = $1::uuid`,
          id,
        );

        await expect(
          repo.updateExercise(userId, id, { secondaryMuscleIds: ["quads"] }),
        ).rejects.toMatchObject({ fieldErrors: [{ path: "secondaryMuscleIds" }] });
      });

      it("409 exercise-immutable-use-fork on a global row", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        const id = uuidv7();
        await insertExercise({ id, name: "Global Row" });

        await expect(
          repo.updateExercise(userId, id, { name: "Hijacked" }),
        ).rejects.toBeInstanceOf(ExerciseImmutableUseForkError);
      });

      it("409 exercise-retired on the caller's own already-soft-deleted row", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        const id = uuidv7();
        await insertExercise({ id, name: "Gone", ownerUserId: userId, isActive: false });

        await expect(
          repo.updateExercise(userId, id, { name: "Revived?" }),
        ).rejects.toBeInstanceOf(ExerciseRetiredError);
      });

      it("404 for an absent id and for another user's custom row, indistinguishable", async () => {
        const userA = uuidv7();
        const userB = uuidv7();
        await insertUser(userA);
        await insertUser(userB);
        const bRow = uuidv7();
        await insertExercise({ id: bRow, name: "B only", ownerUserId: userB });

        await expect(
          repo.updateExercise(userA, bRow, { name: "x" }),
        ).rejects.toBeInstanceOf(NotFoundError);
        await expect(
          repo.updateExercise(userA, uuidv7(), { name: "x" }),
        ).rejects.toBeInstanceOf(NotFoundError);
      });

      it("a PATCH racing a concurrent DELETE on the same owned row never silently applies to a retired row", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        const id = uuidv7();
        await insertExercise({ id, name: "Racer", ownerUserId: userId, isActive: true });

        const [patchResult, deleteResult] = await Promise.allSettled([
          repo.updateExercise(userId, id, { name: "Renamed" }),
          repo.deleteExercise(userId, id),
        ]);

        expect(deleteResult.status).toBe("fulfilled"); // soft-delete is idempotent — always succeeds

        const final = await db.prisma.$queryRawUnsafe<{ name: string; is_active: boolean }[]>(
          `SELECT name, is_active FROM "exercise" WHERE id = $1::uuid`,
          id,
        );
        expect(final[0]?.is_active).toBe(false);
        if (patchResult.status === "fulfilled") {
          expect(final[0]?.name).toBe("Renamed");
        } else {
          expect((patchResult as PromiseRejectedResult).reason).toBeInstanceOf(ExerciseRetiredError);
          expect(final[0]?.name).toBe("Racer");
        }
      });
    });
```

- [ ] **Step 6: Run to confirm it fails**

Run: `RUN_INTEGRATION=1 pnpm --filter @sin/api run test:integration -- exercise-repository`
Expected: FAIL — `repo.updateExercise is not a function`.

- [ ] **Step 7: Add `updateExercise` to the repository interface**

In `apps/api/src/repositories/exercise.ts`, add to `ExerciseRepository` (after `createExercise`):

```ts
  /**
   * Updates the caller's own custom row in place (Spec 03.2 §6). The
   * ownership/global/retired checks run ahead of the write; the actual `UPDATE`
   * additionally gates its own `WHERE` clause on `owner_user_id` + `is_active`
   * so a same-user race against a concurrent `DELETE` can never silently apply
   * an edit to a row that just became retired. Throws `NotFoundError` (not
   * visible), `ExerciseImmutableUseForkError` (target is global),
   * `ExerciseRetiredError` (target already soft-deleted), or `ValidationError`
   * (merged result fails the cross-field check).
   */
  updateExercise(
    actingUserId: string,
    id: string,
    patch: ExerciseWritePatch,
  ): Promise<ExerciseRecord>;
```

- [ ] **Step 8: Implement in `exercise.prisma.ts`**

Update the import line to also bring in the new error classes and the merge helpers:

```ts
import {
  CustomExerciseLimitError,
  ExerciseImmutableUseForkError,
  ExerciseRetiredError,
  NotFoundError,
  ValidationError,
  type FieldError,
} from "../errors/app-error.js";
import { assertMergedFieldsValid, mergeWritableFields } from "./exercise-writes.js";
import type {
  CatalogPage,
  ExerciseRecord,
  ExerciseRepository,
  ExerciseWriteFields,
  ExerciseWritePatch,
  ReferenceRecord,
} from "./exercise.js";
```

Add the method to the returned object, after `createExercise`:

```ts
    async updateExercise(
      actingUserId: string,
      id: string,
      patch: ExerciseWritePatch,
    ): Promise<ExerciseRecord> {
      const before = toRecord(await loadVisibleRow(actingUserId, id));
      if (before.ownerUserId !== actingUserId) throw new ExerciseImmutableUseForkError();
      if (!before.isActive) throw new ExerciseRetiredError();

      const merged = mergeWritableFields(before, patch);
      assertMergedFieldsValid(merged);

      const rows = await prisma.$queryRaw<ExerciseDbRow[]>`
        UPDATE "exercise"
        SET name = ${merged.name}, modality = ${merged.modality},
            primary_muscle_id = ${merged.primaryMuscleId},
            secondary_muscle_ids = ${merged.secondaryMuscleIds}::text[],
            equipment_id = ${merged.equipmentId}, updated_at = now()
        WHERE id = ${id}::uuid AND owner_user_id = ${actingUserId}::uuid AND is_active = true
        RETURNING id, catalog_key, owner_user_id, name, modality, primary_muscle_id,
                  secondary_muscle_ids, equipment_id, is_active, forked_from_exercise_id,
                  created_at, updated_at
      `;
      const updated = rows[0];
      if (!updated) {
        // Lost a race against a concurrent DELETE on the same row (§6 atomicity
        // note) — re-derive the correct 404/409 rather than assume one.
        const recheck = toRecord(await loadVisibleRow(actingUserId, id));
        if (!recheck.isActive) throw new ExerciseRetiredError();
        throw new ExerciseImmutableUseForkError();
      }
      return toRecord(updated);
    },
```

- [ ] **Step 9: Add the Fake implementation**

In `apps/api/test/helpers/fakes.ts`, update imports:

```ts
import { isExerciseId, MAX_CUSTOM_EXERCISES_PER_USER } from "@sin/core";
import {
  CustomExerciseLimitError,
  ExerciseImmutableUseForkError,
  ExerciseRetiredError,
  NotFoundError,
  ValidationError,
} from "../../src/errors/app-error.js";
import { assertMergedFieldsValid, mergeWritableFields } from "../../src/repositories/exercise-writes.js";
import type {
  CatalogPage,
  ExerciseRecord,
  ExerciseRepository,
  ExerciseWriteFields,
  ExerciseWritePatch,
  ReferenceRecord,
} from "../../src/repositories/exercise.js";
```

Add to `FakeExerciseRepository` (after `createExercise`):

```ts
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
```

- [ ] **Step 10: Wire the route + route unit tests**

In `apps/api/src/routes/exercises.ts`, update the `@sin/core` import to add `UpdateExerciseSchema`, add a `z.object({ id: z.string() })` params schema constant near the top of `registerExerciseRoutes`, and add the route:

```ts
import { z } from "zod";
import {
  CreateExerciseSchema,
  ExercisesResponse,
  ExerciseSchema,
  UpdatedSinceQuery,
  UpdateExerciseSchema,
  type Exercise,
} from "@sin/core";
```

```ts
export function registerExerciseRoutes(
  app: FastifyInstance,
  deps: ExerciseRouteDeps,
): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const exerciseIdParams = z.object({ id: z.string() });

  // ...existing GET and POST routes...

  r.patch(
    "/exercises/:id",
    {
      schema: {
        params: exerciseIdParams,
        body: UpdateExerciseSchema,
        response: { 200: ExerciseSchema },
      },
    },
    async (request) => {
      const actingUserId = request.user!.id;
      const updated = await deps.exerciseRepository.updateExercise(
        actingUserId,
        request.params.id,
        request.body,
      );
      request.log.info(
        { exercise_id: updated.id, owner_user_id: actingUserId },
        "custom_exercise_updated",
      );
      return toDto(updated);
    },
  );
```

Append to `apps/api/test/unit/routes-exercises-writes.test.ts`:

```ts
describe("PATCH /v1/exercises/{id} (Spec 03.2 AC4, AC5, AC8)", () => {
  it("200s in place: same id, updatedAt bumped", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    const { app, repo, exerciseRepo: er } = await buildTestApp({ exerciseRepository: exerciseRepo });
    const user = await repo.findByAuthSub("auth0|user-123");
    const row = er.byId
      .set("018f9c8e-0000-7000-8000-000000000001", {
        id: "018f9c8e-0000-7000-8000-000000000001",
        catalogKey: null,
        ownerUserId: user!.id,
        name: "Old",
        modality: "weight_reps",
        primaryMuscleId: null,
        secondaryMuscleIds: [],
        equipmentId: null,
        isActive: true,
        forkedFromExerciseId: null,
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        updatedAt: new Date("2026-09-01T00:00:00.000Z"),
      })
      .get("018f9c8e-0000-7000-8000-000000000001")!;

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/exercises/${row.id}`,
      headers: JSON_HEADERS,
      payload: { name: "New" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: row.id, name: "New" });
    expect(new Date(res.json().updatedAt).getTime()).toBeGreaterThan(row.updatedAt.getTime());
  });

  it("409 exercise-immutable-use-fork on a global row", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    const globalId = "018f9c8e-0000-7000-8000-000000000002";
    exerciseRepo.byId.set(globalId, {
      id: globalId,
      catalogKey: "back-squat",
      ownerUserId: null,
      name: "Back Squat",
      modality: "weight_reps",
      primaryMuscleId: null,
      secondaryMuscleIds: [],
      equipmentId: null,
      isActive: true,
      forkedFromExerciseId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/exercises/${globalId}`,
      headers: JSON_HEADERS,
      payload: { name: "Hijacked" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().type).toContain("exercise-immutable-use-fork");
  });

  it("404 on an absent id", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/exercises/018f9c8e-0000-7000-8000-0000000000ff",
      headers: JSON_HEADERS,
      payload: { name: "x" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("401 without a token", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/exercises/018f9c8e-0000-7000-8000-0000000000ff",
      headers: { "content-type": "application/json" },
      payload: { name: "x" },
    });
    expect(res.statusCode).toBe(401);
  });
});
```

In `apps/api/test/unit/contract-pipeline.test.ts`, the hardcoded exact path set now needs the new path key. Replace:

```ts
    expect(new Set(Object.keys(doc.paths))).toEqual(
      new Set([
        "/v1/me",
        "/v1/exercises",
        "/v1/muscle-groups",
        "/v1/equipment",
      ]),
    );
```

with:

```ts
    expect(new Set(Object.keys(doc.paths))).toEqual(
      new Set([
        "/v1/me",
        "/v1/exercises",
        "/v1/exercises/{id}",
        "/v1/muscle-groups",
        "/v1/equipment",
      ]),
    );
```

- [ ] **Step 11: Run everything, regenerate OpenAPI**

```bash
pnpm --filter @sin/api run test:unit
RUN_INTEGRATION=1 pnpm --filter @sin/api run test:integration
pnpm --filter @sin/api run openapi:emit
pnpm run typecheck
pnpm run lint
```

Expected: all green.

- [ ] **Step 12: Commit**

```bash
git add apps/api/src/repositories/exercise-writes.ts apps/api/test/unit/exercise-writes.test.ts \
  apps/api/src/repositories/exercise.ts apps/api/src/repositories/exercise.prisma.ts \
  apps/api/test/helpers/fakes.ts apps/api/src/routes/exercises.ts \
  apps/api/test/unit/routes-exercises-writes.test.ts apps/api/test/unit/contract-pipeline.test.ts \
  apps/api/test/integration/exercise-repository.integration.test.ts openapi.json
git commit -m "feat(api): add PATCH /v1/exercises/{id} (owned-row edit, merge-then-validate)"
```

---

## Task 7: `POST /v1/exercises/{id}/fork`

**Files:**
- Modify: `apps/api/src/repositories/exercise.ts`
- Modify: `apps/api/src/repositories/exercise.prisma.ts`
- Modify: `apps/api/test/helpers/fakes.ts`
- Modify: `apps/api/src/routes/exercises.ts`
- Modify: `apps/api/test/unit/routes-exercises-writes.test.ts`
- Modify: `apps/api/test/unit/contract-pipeline.test.ts`
- Modify: `apps/api/test/integration/exercise-repository.integration.test.ts`

**Interfaces:**
- Consumes: `insertWithCap`/`validateReferences` (Task 5), `mergeWritableFields`/`assertMergedFieldsValid` (Task 6), `ExerciseAlreadyOwnedError`/`ExerciseRetiredError`/`CustomExerciseLimitError` (Task 3).
- Produces: `ExerciseRepository.forkExercise(actingUserId: string, originId: string, overlay: ExerciseWritePatch): Promise<ExerciseRecord>`. Completes AC10 (both origin and fork visible together after a fork).

- [ ] **Step 1: Write the failing integration tests**

Add imports to `apps/api/test/integration/exercise-repository.integration.test.ts`:

```ts
import { ExerciseAlreadyOwnedError } from "../../src/errors/app-error.js";
```

Append:

```ts
    describe("Spec 03.2 AC6/AC7/AC10 — forkExercise", () => {
      it("copies unedited origin fields, sets ownerUserId/forkedFromExerciseId, leaves the origin byte-for-byte unchanged", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        await insertMuscleGroup("quads", "Quads", 1);
        await insertEquipment("barbell", "Barbell", 1);
        const originId = uuidv7();
        await insertExercise({ id: originId, name: "Back Squat", catalogKey: "back-squat" });
        await db.prisma.$executeRawUnsafe(
          `UPDATE "exercise" SET primary_muscle_id = 'quads', equipment_id = 'barbell' WHERE id = $1::uuid`,
          originId,
        );
        const originBefore = await repo.findVisibleById(userId, originId);

        const forked = await repo.forkExercise(userId, originId, {});
        expect(forked).toMatchObject({
          catalogKey: null,
          ownerUserId: userId,
          forkedFromExerciseId: originId,
          name: "Back Squat",
          primaryMuscleId: "quads",
          equipmentId: "barbell",
        });

        const originAfter = await repo.findVisibleById(userId, originId);
        expect(originAfter).toEqual(originBefore);
      });

      it("applies overlay fields on top of the origin's copied fields", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        const originId = uuidv7();
        await insertExercise({ id: originId, name: "Deadlift", catalogKey: "deadlift" });

        const forked = await repo.forkExercise(userId, originId, { name: "My Deadlift" });
        expect(forked.name).toBe("My Deadlift");
      });

      it("422s when the overlay, merged with the origin's unedited fields, restates primaryMuscleId", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        const originId = uuidv7();
        await insertExercise({ id: originId, name: "Row", catalogKey: "row" });
        await db.prisma.$executeRawUnsafe(
          `UPDATE "exercise" SET primary_muscle_id = 'lats' WHERE id = $1::uuid`,
          originId,
        );
        await insertMuscleGroup("lats", "Lats", 1);

        await expect(
          repo.forkExercise(userId, originId, { secondaryMuscleIds: ["lats"] }),
        ).rejects.toMatchObject({ fieldErrors: [{ path: "secondaryMuscleIds" }] });
      });

      it("409 exercise-already-owned when forking the caller's own row", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        const id = uuidv7();
        await insertExercise({ id, name: "Mine", ownerUserId: userId });

        await expect(repo.forkExercise(userId, id, {})).rejects.toBeInstanceOf(
          ExerciseAlreadyOwnedError,
        );
      });

      it("409 exercise-retired when forking a retired global row", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        const id = uuidv7();
        await insertExercise({ id, name: "Dead", isActive: false });

        await expect(repo.forkExercise(userId, id, {})).rejects.toBeInstanceOf(
          ExerciseRetiredError,
        );
      });

      it("404 for an absent id", async () => {
        await expect(repo.forkExercise(uuidv7(), uuidv7(), {})).rejects.toBeInstanceOf(
          NotFoundError,
        );
      });

      it("both origin and fork remain visible together, forkedFromExerciseId correct", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        const originId = uuidv7();
        await insertExercise({ id: originId, name: "Bench", catalogKey: "bench" });

        const forked = await repo.forkExercise(userId, originId, {});
        const { rows } = await repo.findVisibleCatalog(userId);
        const originRow = rows.find((r) => r.id === originId);
        const forkRow = rows.find((r) => r.id === forked.id);
        expect(originRow).toBeDefined();
        expect(forkRow).toMatchObject({ forkedFromExerciseId: originId });
      });

      it("shares the create cap: a mixed create+fork burst at the 499/500 boundary never exceeds it", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        await Promise.all(
          Array.from({ length: 499 }, () =>
            insertExercise({ name: `Seed ${uuidv7()}`, ownerUserId: userId, isActive: true }),
          ),
        );
        const globalId = uuidv7();
        await insertExercise({ id: globalId, name: "Global Row" });

        const results = await Promise.allSettled([
          repo.createExercise(userId, {
            name: "Race Create",
            modality: "weight_reps",
            primaryMuscleId: null,
            secondaryMuscleIds: [],
            equipmentId: null,
          }),
          repo.forkExercise(userId, globalId, {}),
        ]);

        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
          CustomExerciseLimitError,
        );

        const finalCount = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*) AS n FROM "exercise" WHERE owner_user_id = $1::uuid AND is_active = true`,
          userId,
        );
        expect(Number(finalCount[0]?.n)).toBe(500);
      });
    });
```

- [ ] **Step 2: Run to confirm it fails**

Run: `RUN_INTEGRATION=1 pnpm --filter @sin/api run test:integration -- exercise-repository`
Expected: FAIL — `repo.forkExercise is not a function`.

- [ ] **Step 3: Add `forkExercise` to the repository interface**

In `apps/api/src/repositories/exercise.ts`, add to `ExerciseRepository` (after `updateExercise`):

```ts
  /**
   * Copy-on-write forks a global, active row (Spec 03.2 §6): copies its
   * writable fields, applies `overlay` on top, re-runs the cross-field check on
   * the merged result, then inserts under the same shared cap as
   * `createExercise` with `forkedFromExerciseId` = the origin's id. Throws
   * `NotFoundError` (not visible), `ExerciseAlreadyOwnedError` (target is
   * already the caller's own row), `ExerciseRetiredError` (target
   * `isActive=false`), `ValidationError` (merged overlay conflicts), or
   * `CustomExerciseLimitError` (shared cap hit).
   */
  forkExercise(
    actingUserId: string,
    originId: string,
    overlay: ExerciseWritePatch,
  ): Promise<ExerciseRecord>;
```

- [ ] **Step 4: Implement in `exercise.prisma.ts`**

Add `ExerciseAlreadyOwnedError` to the error import and add the method after `updateExercise`:

```ts
    async forkExercise(
      actingUserId: string,
      originId: string,
      overlay: ExerciseWritePatch,
    ): Promise<ExerciseRecord> {
      const origin = toRecord(await loadVisibleRow(actingUserId, originId));
      if (origin.ownerUserId === actingUserId) throw new ExerciseAlreadyOwnedError();
      if (!origin.isActive) throw new ExerciseRetiredError();

      const merged = mergeWritableFields(origin, overlay);
      assertMergedFieldsValid(merged);
      await validateReferences(merged);

      const row = await insertWithCap(actingUserId, merged, origin.id);
      if (!row) throw new CustomExerciseLimitError();
      return toRecord(row);
    },
```

- [ ] **Step 5: Add the Fake implementation**

Add `ExerciseAlreadyOwnedError` to the `fakes.ts` error import and add after `updateExercise`:

```ts
  async forkExercise(
    actingUserId: string,
    originId: string,
    overlay: ExerciseWritePatch,
  ): Promise<ExerciseRecord> {
    const origin = await this.findVisibleById(actingUserId, originId);
    if (origin.ownerUserId === actingUserId) throw new ExerciseAlreadyOwnedError();
    if (!origin.isActive) throw new ExerciseRetiredError();
    const merged = mergeWritableFields(origin, overlay);
    assertMergedFieldsValid(merged);
    this.validateReferences(merged);
    return this.insertOwned(actingUserId, merged, origin.id);
  }
```

- [ ] **Step 6: Wire the route + route unit tests**

Add to `apps/api/src/routes/exercises.ts` after the `PATCH` route:

```ts
  r.post(
    "/exercises/:id/fork",
    {
      schema: {
        params: exerciseIdParams,
        body: UpdateExerciseSchema,
        response: { 201: ExerciseSchema },
      },
    },
    async (request, reply) => {
      const actingUserId = request.user!.id;
      const forked = await deps.exerciseRepository.forkExercise(
        actingUserId,
        request.params.id,
        request.body,
      );
      request.log.info(
        {
          exercise_id: forked.id,
          owner_user_id: actingUserId,
          forked_from_exercise_id: forked.forkedFromExerciseId,
        },
        "custom_exercise_forked",
      );
      reply.code(201).header("location", `/v1/exercises/${forked.id}`);
      return toDto(forked);
    },
  );
```

Append to `apps/api/test/unit/routes-exercises-writes.test.ts`:

```ts
describe("POST /v1/exercises/{id}/fork (Spec 03.2 AC6, AC7, AC8, AC10)", () => {
  const globalId = "018f9c8e-0000-7000-8000-000000000003";
  function seedGlobal(exerciseRepo: FakeExerciseRepository): void {
    exerciseRepo.byId.set(globalId, {
      id: globalId,
      catalogKey: "back-squat",
      ownerUserId: null,
      name: "Back Squat",
      modality: "weight_reps",
      primaryMuscleId: null,
      secondaryMuscleIds: [],
      equipmentId: null,
      isActive: true,
      forkedFromExerciseId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  it("201s with a new id, Location header, forkedFromExerciseId = origin id", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    seedGlobal(exerciseRepo);
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const res = await app.inject({
      method: "POST",
      url: `/v1/exercises/${globalId}/fork`,
      headers: JSON_HEADERS,
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).not.toBe(globalId);
    expect(body.forkedFromExerciseId).toBe(globalId);
    expect(body.catalogKey).toBeNull();
    expect(res.headers.location).toBe(`/v1/exercises/${body.id}`);
  });

  it("409 exercise-already-owned when forking the caller's own row", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    const { app, repo } = await buildTestApp({ exerciseRepository: exerciseRepo });
    const user = await repo.findByAuthSub("auth0|user-123");
    const ownId = "018f9c8e-0000-7000-8000-000000000004";
    exerciseRepo.byId.set(ownId, {
      id: ownId,
      catalogKey: null,
      ownerUserId: user!.id,
      name: "Mine",
      modality: "weight_reps",
      primaryMuscleId: null,
      secondaryMuscleIds: [],
      equipmentId: null,
      isActive: true,
      forkedFromExerciseId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/exercises/${ownId}/fork`,
      headers: JSON_HEADERS,
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().type).toContain("exercise-already-owned");
  });

  it("404 for an absent id", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/exercises/018f9c8e-0000-7000-8000-0000000000ff/fork",
      headers: JSON_HEADERS,
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it("401 without a token", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/exercises/${globalId}/fork`,
      headers: { "content-type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("forkedFromExerciseId shows up in GET /v1/exercises and changes the ETag", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.catalog = [makeExerciseRecordForGet()];
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const before = await app.inject({ method: "GET", url: "/v1/exercises", headers: BEARER });
    exerciseRepo.catalog = [
      ...exerciseRepo.catalog,
      { ...makeExerciseRecordForGet(), id: "018f9c8e-0000-7000-8000-000000000005", forkedFromExerciseId: exerciseRepo.catalog[0]!.id },
    ];
    const after = await app.inject({ method: "GET", url: "/v1/exercises", headers: BEARER });

    expect(after.headers.etag).not.toBe(before.headers.etag);
    expect(
      after.json().exercises.find((e: { forkedFromExerciseId: string | null }) => e.forkedFromExerciseId !== null),
    ).toBeDefined();
  });
});

function makeExerciseRecordForGet() {
  return {
    id: "018f9c8e-0000-7000-8000-000000000006",
    catalogKey: "back-squat",
    ownerUserId: null,
    name: "Back Squat",
    modality: "weight_reps",
    primaryMuscleId: null,
    secondaryMuscleIds: [],
    equipmentId: null,
    isActive: true,
    forkedFromExerciseId: null,
    createdAt: new Date("2026-09-01T10:00:00.000Z"),
    updatedAt: new Date("2026-09-01T10:00:00.000Z"),
  };
}
```

In `apps/api/test/unit/contract-pipeline.test.ts`, add `"/v1/exercises/{id}/fork"` to the exact path set from Task 6:

```ts
    expect(new Set(Object.keys(doc.paths))).toEqual(
      new Set([
        "/v1/me",
        "/v1/exercises",
        "/v1/exercises/{id}",
        "/v1/exercises/{id}/fork",
        "/v1/muscle-groups",
        "/v1/equipment",
      ]),
    );
```

- [ ] **Step 7: Run everything, regenerate OpenAPI**

```bash
pnpm --filter @sin/api run test:unit
RUN_INTEGRATION=1 pnpm --filter @sin/api run test:integration
pnpm --filter @sin/api run openapi:emit
pnpm run typecheck
pnpm run lint
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/repositories/exercise.ts apps/api/src/repositories/exercise.prisma.ts \
  apps/api/test/helpers/fakes.ts apps/api/src/routes/exercises.ts \
  apps/api/test/unit/routes-exercises-writes.test.ts apps/api/test/unit/contract-pipeline.test.ts \
  apps/api/test/integration/exercise-repository.integration.test.ts openapi.json
git commit -m "feat(api): add POST /v1/exercises/{id}/fork (copy-on-write, shared cap)"
```

---

## Task 8: `DELETE /v1/exercises/{id}`

**Files:**
- Modify: `apps/api/src/repositories/exercise.ts`
- Modify: `apps/api/src/repositories/exercise.prisma.ts`
- Modify: `apps/api/test/helpers/fakes.ts`
- Modify: `apps/api/src/routes/exercises.ts`
- Modify: `apps/api/test/unit/routes-exercises-writes.test.ts`
- Modify: `apps/api/test/unit/contract-pipeline.test.ts`
- Modify: `apps/api/test/integration/exercise-repository.integration.test.ts`

**Interfaces:**
- Consumes: `loadVisibleRow` (Task 2), `ExerciseImmutableError` (Task 3).
- Produces: `ExerciseRepository.deleteExercise(actingUserId: string, id: string): Promise<void>`. Completes AC8/AC9.

- [ ] **Step 1: Write the failing integration test**

Append to `apps/api/test/integration/exercise-repository.integration.test.ts`:

```ts
import { ExerciseImmutableError } from "../../src/errors/app-error.js";
```

```ts
    describe("Spec 03.2 AC8/AC9 — deleteExercise", () => {
      it("soft-deletes an owned row: is_active false, idempotent on repeat", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        const id = uuidv7();
        await insertExercise({ id, name: "Mine", ownerUserId: userId });

        await repo.deleteExercise(userId, id);
        const afterFirst = await repo.findVisibleById(userId, id);
        expect(afterFirst.isActive).toBe(false);

        await expect(repo.deleteExercise(userId, id)).resolves.toBeUndefined();
        const afterSecond = await repo.findVisibleById(userId, id);
        expect(afterSecond.isActive).toBe(false);
      });

      it("403 exercise-immutable on a global row", async () => {
        const userId = uuidv7();
        await insertUser(userId);
        const id = uuidv7();
        await insertExercise({ id, name: "Global" });

        await expect(repo.deleteExercise(userId, id)).rejects.toBeInstanceOf(
          ExerciseImmutableError,
        );
      });

      it("404 for an absent id and for another user's custom row", async () => {
        const userA = uuidv7();
        const userB = uuidv7();
        await insertUser(userA);
        await insertUser(userB);
        const bRow = uuidv7();
        await insertExercise({ id: bRow, name: "B only", ownerUserId: userB });

        await expect(repo.deleteExercise(userA, bRow)).rejects.toBeInstanceOf(NotFoundError);
        await expect(repo.deleteExercise(userA, uuidv7())).rejects.toBeInstanceOf(NotFoundError);
      });
    });
```

- [ ] **Step 2: Run to confirm it fails**

Run: `RUN_INTEGRATION=1 pnpm --filter @sin/api run test:integration -- exercise-repository`
Expected: FAIL — `repo.deleteExercise is not a function`.

- [ ] **Step 3: Add `deleteExercise` to the repository interface**

In `apps/api/src/repositories/exercise.ts`, add to `ExerciseRepository` (after `forkExercise`):

```ts
  /**
   * Soft-deletes the caller's own custom row (`is_active = false`), idempotent
   * — a repeat call is a no-op success (Spec 03.2 §6, AC9). Throws
   * `NotFoundError` (not visible) or `ExerciseImmutableError` (target is a
   * global row — a visible row, so 403 not 404, D19).
   */
  deleteExercise(actingUserId: string, id: string): Promise<void>;
```

- [ ] **Step 4: Implement in `exercise.prisma.ts`**

Add `ExerciseImmutableError` to the error import and add the method after `forkExercise`:

```ts
    async deleteExercise(actingUserId: string, id: string): Promise<void> {
      const target = toRecord(await loadVisibleRow(actingUserId, id));
      if (target.ownerUserId === null) throw new ExerciseImmutableError();
      await prisma.$executeRaw`
        UPDATE "exercise" SET is_active = false, updated_at = now()
        WHERE id = ${id}::uuid AND owner_user_id = ${actingUserId}::uuid AND is_active = true
      `;
    },
```

- [ ] **Step 5: Add the Fake implementation**

Add `ExerciseImmutableError` to the `fakes.ts` error import and add after `forkExercise`:

```ts
  async deleteExercise(actingUserId: string, id: string): Promise<void> {
    const target = await this.findVisibleById(actingUserId, id);
    if (target.ownerUserId === null) throw new ExerciseImmutableError();
    if (target.isActive) {
      this.byId.set(id, { ...target, isActive: false, updatedAt: new Date() });
    }
  }
```

- [ ] **Step 6: Wire the route + route unit tests**

Add to `apps/api/src/routes/exercises.ts` after the fork route:

```ts
  r.delete(
    "/exercises/:id",
    { schema: { params: exerciseIdParams, response: { 204: z.undefined() } } },
    async (request, reply) => {
      const actingUserId = request.user!.id;
      await deps.exerciseRepository.deleteExercise(actingUserId, request.params.id);
      request.log.info(
        { exercise_id: request.params.id, owner_user_id: actingUserId },
        "custom_exercise_deleted",
      );
      reply.code(204).send();
      return reply;
    },
  );
```

Append to `apps/api/test/unit/routes-exercises-writes.test.ts`:

```ts
describe("DELETE /v1/exercises/{id} (Spec 03.2 AC8, AC9)", () => {
  it("204s on an owned row, idempotent on repeat", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    const { app, repo } = await buildTestApp({ exerciseRepository: exerciseRepo });
    const user = await repo.findByAuthSub("auth0|user-123");
    const id = "018f9c8e-0000-7000-8000-000000000007";
    exerciseRepo.byId.set(id, {
      id,
      catalogKey: null,
      ownerUserId: user!.id,
      name: "Mine",
      modality: "weight_reps",
      primaryMuscleId: null,
      secondaryMuscleIds: [],
      equipmentId: null,
      isActive: true,
      forkedFromExerciseId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const first = await app.inject({ method: "DELETE", url: `/v1/exercises/${id}`, headers: BEARER });
    expect(first.statusCode).toBe(204);
    expect(first.body).toBe("");

    const second = await app.inject({ method: "DELETE", url: `/v1/exercises/${id}`, headers: BEARER });
    expect(second.statusCode).toBe(204);
  });

  it("403 exercise-immutable on a global row", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    const globalId = "018f9c8e-0000-7000-8000-000000000008";
    exerciseRepo.byId.set(globalId, {
      id: globalId,
      catalogKey: "back-squat",
      ownerUserId: null,
      name: "Back Squat",
      modality: "weight_reps",
      primaryMuscleId: null,
      secondaryMuscleIds: [],
      equipmentId: null,
      isActive: true,
      forkedFromExerciseId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const res = await app.inject({ method: "DELETE", url: `/v1/exercises/${globalId}`, headers: BEARER });
    expect(res.statusCode).toBe(403);
    expect(res.json().type).toContain("exercise-immutable");
  });

  it("404 for an absent id", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/exercises/018f9c8e-0000-7000-8000-0000000000ff",
      headers: BEARER,
    });
    expect(res.statusCode).toBe(404);
  });

  it("401 without a token", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/exercises/018f9c8e-0000-7000-8000-0000000000ff",
    });
    expect(res.statusCode).toBe(401);
  });
});
```

In `apps/api/test/unit/contract-pipeline.test.ts`, the `/v1/exercises/{id}` path key already exists from Task 6 (PATCH); `DELETE` just adds a method under it, no path-set change needed there. No edit required for this step.

- [ ] **Step 7: Run everything, regenerate OpenAPI**

```bash
pnpm --filter @sin/api run test:unit
RUN_INTEGRATION=1 pnpm --filter @sin/api run test:integration
pnpm --filter @sin/api run openapi:emit
pnpm run typecheck
pnpm run lint
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/repositories/exercise.ts apps/api/src/repositories/exercise.prisma.ts \
  apps/api/test/helpers/fakes.ts apps/api/src/routes/exercises.ts \
  apps/api/test/unit/routes-exercises-writes.test.ts \
  apps/api/test/integration/exercise-repository.integration.test.ts openapi.json
git commit -m "feat(api): add DELETE /v1/exercises/{id} (idempotent soft-delete)"
```

---

## Task 9: Docs + full-suite verification (AC11, AC13)

**Files:**
- Modify: `docs/DESIGN.md`
- Verify (no expected diff): `docs/specs/README.md`
- Full-repo verification only, no new test files.

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces: nothing new — this is the spec's §11 "DESIGN.md / doc edits" step plus the final green-suite gate before a PR.

- [ ] **Step 1: Update DESIGN.md §4.2**

In `docs/DESIGN.md`, in the "### 4.2 Exercise catalog" section, add the new column to the `exercise` bullet and a one-line D9-resolution note. Change:

```markdown
- **exercise** — `id`, `catalog_key` (kebab-case stable identifier for curated
  rows; `UNIQUE` where `owner_user_id IS NULL`, `NULL` for custom — Spec 03.1),
  `owner_user_id` (NULL = global/curated; `ON DELETE CASCADE`), `name`,
  `modality` (`weight_reps` | `bodyweight_reps` | `weighted_bodyweight` |
  `duration` | `distance_duration`), `primary_muscle_id`, `secondary_muscle_ids`
  (array), `equipment_id`, `is_active`. No image in v1 (text-only picker);
  `image_key` is a reserved post-v1 addition.
```

to:

```markdown
- **exercise** — `id`, `catalog_key` (kebab-case stable identifier for curated
  rows; `UNIQUE` where `owner_user_id IS NULL`, `NULL` for custom — Spec 03.1),
  `owner_user_id` (NULL = global/curated; `ON DELETE CASCADE`), `name`,
  `modality` (`weight_reps` | `bodyweight_reps` | `weighted_bodyweight` |
  `duration` | `distance_duration`), `primary_muscle_id`, `secondary_muscle_ids`
  (array), `equipment_id`, `is_active`, `forked_from_exercise_id` (`uuid NULL
  REFERENCES exercise(id) ON DELETE RESTRICT` — Spec 03.2, resolves D9: kept
  for provenance, but suppressing a forked row's global origin from a catalog
  view is a **client-side** rule in Spec 06, not a server-side visibility
  filter, since the origin's shared `updated_at` can't move per-fork without
  corrupting every other caller's sync cursor). No image in v1 (text-only
  picker); `image_key` is a reserved post-v1 addition.
```

Confirm (no edit needed if already accurate) that the "Editing a global exercise is copy-on-write" sentence in the same section's "Rules" list still reads correctly now that forking is `POST /v1/exercises/{id}/fork`, not an implicit `PATCH` branch — the spec's own review already confirmed this needs no wording change, only a read-through.

Also read `### 4.9 Deletion matrix` and confirm the existing `custom exercise` row ("soft (`is_active = false`)") already matches this spec's `DELETE` semantics exactly — no edit expected there (spec §11 explicitly says "no wording change expected").

- [ ] **Step 2: Confirm `docs/specs/README.md`**

Check `git diff docs/specs/README.md` — the working tree already has the 03.2 row linked and marked `Draft` (uncommitted local change predating this plan). No further edit needed; it will be committed as part of this task's commit alongside the DESIGN.md change.

- [ ] **Step 3: Full verification sweep**

```bash
pnpm install
pnpm run build
pnpm run lint
pnpm run typecheck
pnpm run core:purity
pnpm --filter @sin/core run test:unit
pnpm --filter @sin/api run test:unit
RUN_INTEGRATION=1 pnpm --filter @sin/api run test:integration
pnpm --filter @sin/api run openapi:emit
git diff --exit-code openapi.json
pnpm --filter @sin/web run test:coverage
```

Expected: everything green, `openapi.json` diff-clean (already committed correctly by earlier tasks), no unexpected diffs anywhere.

- [ ] **Step 4: Commit the doc updates**

```bash
git add docs/DESIGN.md docs/specs/README.md
git commit -m "docs: DESIGN.md §4.2 forked_from_exercise_id note (Spec 03.2 §11)"
```

At this point the branch is ready for `/security-review`, `/code-review`, and the `change-auditor` agent per CLAUDE.md's pre-PR checklist — not part of this plan's scope, run them as a separate step before opening the PR.

---

## Self-Review Notes

- **Spec coverage:** AC1→Task 1. AC2→Task 5 (+ Task 4 for schema-level). AC3→Task 5 (sequential) + Task 7 (mixed concurrency, the full AC3 requirement). AC4→Task 6. AC5→Task 6 (incl. the PATCH/DELETE race). AC6→Task 7. AC7→Task 7. AC8→Tasks 6/7/8 (404 cases), Task 8 (403 delete case). AC9→Task 8. AC10→Task 2 (DTO/ETag/OpenAPI plumbing) + Task 7 (both rows visible together after a real fork). AC11→ every route task's 401 test + Task 9's `openapi:emit`/drift verification. AC12→Task 4. AC13→Task 9.
- **Placeholder scan:** every step above ships literal code/SQL/test bodies; no "add appropriate tests" or "TBD" steps remain.
- **Type consistency:** `ExerciseWriteFields`/`ExerciseWritePatch` (Task 5) are the one shape used by `createExercise`/`updateExercise`/`forkExercise` across the interface, both repository implementations, and both merge helpers — checked no task renames or reshapes them. `loadVisibleRow` (Task 2) is the one shared visibility-filtered lookup every write method in `exercise.prisma.ts` calls afterward.
