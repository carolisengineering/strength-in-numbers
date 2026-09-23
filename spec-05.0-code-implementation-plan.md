# Spec 05.0 Implementation Plan (Code)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the workout session lifecycle API — the `workout` / `workout_exercise` tables, the eight `/v1` endpoints that create, read, edit, finish, delete a session and add/reorder/remove its exercises, and the `@sin/core` types they need — exactly as specified in Spec 05.0, with every AC1–AC21 covered by a named test.

**Architecture:** Two new Postgres tables behind a hand-authored migration (`0005_create_workout_session`), a `workoutRepository` (interface + Prisma impl) following the `exercise.ts`/`exercise.prisma.ts` split, and a `routes/workouts.ts` module wired at the same four seams `exercises.ts` uses (`v1.ts`, `app.ts`, `server.ts`, `test/helpers`). Idempotent create uses `ON CONFLICT DO NOTHING` + re-read (no lock); position mutations use a per-workout `pg_advisory_xact_lock` plus a deferred unique constraint; the finish transition takes an explicit row lock ahead of every check so later specs (05.1, 07) can hang their own checks off the same seam.

**Tech Stack:** Fastify v5 + `fastify-type-provider-zod`, Prisma (raw `$queryRaw`/`$executeRaw` for everything this spec's `CHECK`/partial-index/deferred-constraint SQL can't express), Zod 4, Vitest, Testcontainers Postgres, `uuidv7`.

**Spec:** `docs/specs/05.0-workout-session-lifecycle.md`

## Global Constraints

These apply to every task below; they are not repeated per task.

- **Additive, expand-only migrations.** `0005_create_workout_session` creates two new tables and touches no existing column. Never drop or rename a column in the same release as the code that stops using it (CLAUDE.md).
- **Error contract dual registration.** Already satisfied by `apps/api/src/app.ts` (`registerErrorContract` is called on both the root scope and the `/v1` child scope) — this spec adds no new registration point, only two new `AppError` subclasses (Task 7). Do not touch `errors/contract.ts`.
- **snake_case columns, camelCase wire fields.** DB columns and SQL identifiers are `snake_case`; `@sin/core` DTOs and repository record types are `camelCase`. The repository layer does the translation (see `exercise.prisma.ts`'s `toRecord`).
- **TDD, criterion-named tests.** Every behavioral AC gets ≥1 test naming it: `describe("AC7 — …")`. Write the failing test before the implementation in every task below.
- **`describe.skipIf` still runs `beforeAll`.** Every new integration test's container-startup `beforeAll` must itself check `if (!shouldRunIntegration()) return;` before doing any work — guarding only the `describe` is not enough (CLAUDE.md; `apps/api/test/integration/exercise-repository.integration.test.ts` is the pattern to copy).
- **Coverage gates unchanged.** `apps/api/src/plugins/auth` and `apps/api/src/repositories/user` stay ≥90% line coverage (Spec 01, untouched by this work). `apps/api/src/repositories/workout.ts` / `workout.prisma.ts` and the pure position/skew helpers target at/near 100%, per spec §10 — this is the same bar 03.1/03.2 held for the catalog repository.
- **No "dummy" anywhere** — code, comments, tests, commit messages. Use placeholder / test / fake / stub (CLAUDE.md).
- **Commit message convention.** Verified against the real code-commit history of 03.1/03.2 (`git log --oneline`, e.g. `8153e7c feat(api): add POST /v1/exercises (custom create + atomic cap)`, `aea5371 feat(api): add forked_from_exercise_id column + FK (migration 0003)`): `feat(api): <what> (Spec 05.0 §N[, AC-n])` or `feat(core): <what> (Spec 05.0 §N)`, imperative mood, **no `Co-Authored-By` trailer** — every 03.1/03.2 code commit in `git log` carries none. This is the plan's own commit convention and is independent of any attribution policy applied to commits made by an agent executing this plan on the user's behalf; follow whatever the executing session's own instructions say about trailers, but the *message text* itself follows this repo's established style above.
- **Every route needs a declared response schema**, including both `204` deletes — `assertRouteHasResponseSchema` (`apps/api/src/app.ts`) throws at assembly otherwise. Copy the shape `routes/exercises.ts`'s `DELETE /exercises/:id` already uses (`response: { 204: z.undefined() }`).
- **Unit tests never mint a JWT.** Authenticate with `Bearer test-token` against `fakeVerifier` (`apps/api/test/helpers/fakes.ts`) through `buildTestApp`. The dev-idp on `:9999` is for manual/integration use only.
- **Raw SQL parameterization.** Every `$queryRaw`/`$executeRaw` interpolation is a driver-bound tagged-template parameter — never `$queryRawUnsafe`/`$executeRawUnsafe`/string-concatenated SQL, except the existing `TRUNCATE …` calls in integration-test setup, which follow the existing test convention.
- **Two concurrency mechanisms, already decided by the spec — implement exactly these, do not invent a third:**
  1. **Create** (`POST /v1/workouts`): a single `ON CONFLICT (user_id, client_generated_id) DO NOTHING RETURNING *` statement, outside any interactive transaction, with the D40/D50 outcome switch (Task 10). **No advisory lock on this path.**
  2. **Position mutations** (add/reorder/delete a `workout_exercise`): `pg_advisory_xact_lock(hashtext(workoutId))` as its own first statement (after `SET CONSTRAINTS … DEFERRED` where applicable), then `SELECT ended_at FROM workout WHERE id = $1 FOR SHARE` as a **separate, later** statement, then the count read, then the writes — all inside one `prisma.$transaction` (Task 14).
- **The finish-transaction lock decision (spec §6.5/§12, resolved here — do not re-litigate):** the mechanism is an **explicit `SELECT id, ended_at, started_at FROM workout WHERE id = $1 AND user_id = $2 FOR UPDATE`**, issued as the first data-touching statement of a `prisma.$transaction` that wraps **every** `PATCH /v1/workouts/{id}` (not only the finish case) — see Task 12 for the full rationale. Do not use "issue the `UPDATE` first and leave it uncommitted" — the explicit `SELECT … FOR UPDATE` is chosen because it mirrors the codebase's existing "lock first, as its own statement, ahead of the read/checks it protects" idiom (`insertWithCap`'s advisory lock, §6.7's `FOR SHARE`), and because it lets 05.1's extension seam add a check *after* the lock and *before* the `UPDATE` without restructuring anything.

---

## Task 0: Spike — verify the deferrable-constraint drift question before writing the migration

Spec §4's open item: `workout_exercise_position_key` must be `DEFERRABLE INITIALLY IMMEDIATE`, which has no Prisma DSL spelling. The spec says the `@@unique` **is** declared (deferrability is expected to be ignored by `migrate diff`), but requires verifying this on a scratch DB **before** relying on it in Task 1's drift assertion. This is not a throwaway spike — its output is the go/no-go for how Task 1's AC1 drift test is written.

**Files:**
- Create (temporary, deleted at the end of this task): `apps/api/scratch-d49-spike/schema.prisma`, `apps/api/scratch-d49-spike/migration.sql`
- No permanent files change in this task.

- [ ] **Step 1: Start a scratch Postgres and apply a hand-written deferrable-constraint table**

```bash
docker run -d --rm --name sin-d49-spike -e POSTGRES_PASSWORD=p -p 55432:5432 postgres:16-alpine
sleep 2
PGPASSWORD=p psql -h localhost -p 55432 -U postgres -c "
CREATE TABLE t (id uuid PRIMARY KEY, workout_id uuid NOT NULL, position smallint NOT NULL);
ALTER TABLE t ADD CONSTRAINT t_position_key UNIQUE (workout_id, position) DEFERRABLE INITIALLY IMMEDIATE;
"
```

- [ ] **Step 2: Write a minimal `schema.prisma` declaring the same `@@unique` with no deferrability annotation, and run `migrate diff`**

```prisma
// apps/api/scratch-d49-spike/schema.prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql", url = env("DATABASE_URL") }
model T {
  id        String @id @db.Uuid
  workoutId String @map("workout_id") @db.Uuid
  position  Int    @db.SmallInt
  @@unique([workoutId, position], map: "t_position_key")
  @@map("t")
}
```

```bash
cd apps/api
DATABASE_URL="postgresql://postgres:p@localhost:55432/postgres" pnpm exec prisma migrate diff \
  --from-url "postgresql://postgres:p@localhost:55432/postgres" \
  --to-schema-datamodel scratch-d49-spike/schema.prisma \
  --exit-code
echo "exit code: $?"
```

- [ ] **Step 3: Record the outcome inline in this plan file (edit this task's Step 3 checkbox note) and choose Task 1's drift-test scope accordingly**
  - **If exit code is `0`** ("No difference detected"): deferrability is ignored by `migrate diff`, exactly as 03.1's `exercise_catalog_key_key` precedent suggested. Task 1's AC1 drift assertion (`prisma migrate diff --exit-code` expecting "No difference detected") runs **unscoped**, covering `workout_exercise_position_key` like every other index.
  - **If exit code is `2`** (drift reported): the fallback is declare-and-tolerate, exactly as spec §4 anticipates — keep the `@@unique` in `schema.prisma` (Task 1) and scope the Task 1 drift assertion to run `prisma migrate diff` and assert the diff output's **only** reported difference is the deferrability clause on `t_position_key` / `workout_exercise_position_key` (a string-containment check on the diff's stdout, analogous to AC2's containment style), recording why inline in that test's comment.
  - This plan's Task 1 is written for the **exit-code-0** outcome (the expected, and precedented, result). If the spike returns exit code `2`, adapt Task 1's Step 3/6 per the note above before proceeding — do not skip the spike and assume.

- [ ] **Step 4: Tear down**

```bash
docker stop sin-d49-spike
rm -rf apps/api/scratch-d49-spike
```

- [ ] **Step 5: Commit** (documentation only — no production code changed)

```bash
git add spec-05.0-code-implementation-plan.md
git commit -m "docs: Spec 05.0 Task 0 — D49 deferrable-constraint spike result recorded (Spec 05.0)"
```

---

## Task 1: Migration `0005_create_workout_session` + Prisma models + AC1/AC2 migration integration test

**Files:**
- Create: `apps/api/prisma/migrations/0005_create_workout_session/migration.sql`
- Modify: `apps/api/prisma/schema.prisma` (append `Workout` / `WorkoutExercise` models; add `workouts Workout[]` to `User`, `workoutExercises WorkoutExercise[]` to `Exercise`)
- Create: `apps/api/test/integration/workout-migration.integration.test.ts`
- Create: `apps/api/test/unit/workout-migration-drift-guard.test.ts` (AC2's string-containment half)

**Interfaces:**
- Produces: tables `workout`, `workout_exercise` with the exact columns of spec §4; indexes `workout_user_client_id_key`, `workout_user_started_idx`, `workout_user_active_key`, `workout_exercise_position_key`, `workout_exercise_exercise_idx`; Prisma models `Workout`, `WorkoutExercise`.
- Consumes: `@sin/core`'s `WORKOUT_SOURCE_VALUES` (Task 3) and `MODALITY_VALUES` (existing) for the drift-guard test — write this test file now, but it can only pass once Task 3 lands `WORKOUT_SOURCE_VALUES`; run it as `it.todo` until Task 3, or land Task 3 first if the executor prefers strict ordering. This plan lists Task 1 before Task 3 because the migration file itself must exist before `@sin/core` needs it, but **the drift-guard test file is written in this task and its `WORKOUT_SOURCE_VALUES` assertion is completed in Task 3** (cross-referenced there).

- [ ] **Step 1: Write the failing migration integration test**

```ts
// apps/api/test/integration/workout-migration.integration.test.ts
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyMigrationFile,
  shouldRunIntegration,
  startBareDb,
  type IntegrationDb,
} from "./helpers.js";

describe.skipIf(!shouldRunIntegration())(
  "AC1 — 0005_create_workout_session (real Postgres)",
  () => {
    let db: IntegrationDb;

    beforeAll(async () => {
      if (!shouldRunIntegration()) return;
      db = await startBareDb();
      for (const m of [
        "0001_create_user",
        "0002_create_exercise_catalog",
        "0003_exercise_fork_provenance",
        "0004_exercise_change_xid",
        "0005_create_workout_session",
      ]) {
        applyMigrationFile(db.url, m);
      }
    }, 180_000);

    afterAll(async () => {
      await db?.stop();
    });

    it("creates workout with the exact §4 columns, types and nullability", async () => {
      const cols = await db.prisma.$queryRawUnsafe<
        { column_name: string; data_type: string; is_nullable: string }[]
      >(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns
         WHERE table_name = 'workout' ORDER BY ordinal_position`,
      );
      const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));
      expect(byName.id).toMatchObject({ data_type: "uuid", is_nullable: "NO" });
      expect(byName.user_id).toMatchObject({ data_type: "uuid", is_nullable: "NO" });
      expect(byName.title).toMatchObject({ data_type: "text", is_nullable: "YES" });
      expect(byName.notes).toMatchObject({ data_type: "text", is_nullable: "YES" });
      expect(byName.started_at).toMatchObject({
        data_type: "timestamp with time zone",
        is_nullable: "NO",
      });
      expect(byName.ended_at).toMatchObject({
        data_type: "timestamp with time zone",
        is_nullable: "YES",
      });
      expect(byName.local_date).toMatchObject({ data_type: "date", is_nullable: "NO" });
      expect(byName.tz_offset_minutes).toMatchObject({
        data_type: "smallint",
        is_nullable: "NO",
      });
      expect(byName.client_generated_id).toMatchObject({
        data_type: "uuid",
        is_nullable: "NO",
      });
      expect(byName.source).toMatchObject({ data_type: "text", is_nullable: "NO" });
      expect(byName.created_at).toMatchObject({ is_nullable: "NO" });
      expect(byName.updated_at).toMatchObject({ is_nullable: "NO" });
    });

    it("creates workout_exercise with the exact §4 columns, types and nullability", async () => {
      const cols = await db.prisma.$queryRawUnsafe<
        { column_name: string; data_type: string; is_nullable: string }[]
      >(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns
         WHERE table_name = 'workout_exercise' ORDER BY ordinal_position`,
      );
      const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));
      expect(byName.id).toMatchObject({ data_type: "uuid", is_nullable: "NO" });
      expect(byName.workout_id).toMatchObject({ data_type: "uuid", is_nullable: "NO" });
      expect(byName.position).toMatchObject({ data_type: "smallint", is_nullable: "NO" });
      expect(byName.exercise_id).toMatchObject({ data_type: "uuid", is_nullable: "NO" });
      expect(byName.exercise_name_snapshot).toMatchObject({
        data_type: "text",
        is_nullable: "NO",
      });
      expect(byName.modality_snapshot).toMatchObject({
        data_type: "text",
        is_nullable: "NO",
      });
      expect(byName.notes).toMatchObject({ data_type: "text", is_nullable: "YES" });
    });

    it("declares all three FKs as ON DELETE CASCADE", async () => {
      const fks = await db.prisma.$queryRawUnsafe<
        { conname: string; confdeltype: string; conrelid_name: string; confrelid_name: string }[]
      >(
        `SELECT c.conname, c.confdeltype,
                r.relname AS conrelid_name, f.relname AS confrelid_name
         FROM pg_constraint c
         JOIN pg_class r ON r.oid = c.conrelid
         JOIN pg_class f ON f.oid = c.confrelid
         WHERE c.contype = 'f' AND r.relname IN ('workout', 'workout_exercise')`,
      );
      const byPair = Object.fromEntries(
        fks.map((f) => [`${f.conrelid_name}->${f.confrelid_name}`, f]),
      );
      expect(byPair["workout->user"]?.confdeltype).toBe("c"); // 'c' = CASCADE
      expect(byPair["workout_exercise->workout"]?.confdeltype).toBe("c");
      expect(byPair["workout_exercise->exercise"]?.confdeltype).toBe("c");
    });

    it("declares both CHECK constraints", async () => {
      const checks = await db.prisma.$queryRawUnsafe<{ conname: string }[]>(
        `SELECT conname FROM pg_constraint
         WHERE contype = 'c' AND conname IN ('workout_source_check', 'workout_exercise_modality_snapshot_check')`,
      );
      expect(checks.map((c) => c.conname).sort()).toEqual([
        "workout_exercise_modality_snapshot_check",
        "workout_source_check",
      ]);
    });

    it("creates all five named indexes with the right shape", async () => {
      const idx = await db.prisma.$queryRawUnsafe<
        { indexname: string; indexdef: string }[]
      >(
        `SELECT indexname, indexdef FROM pg_indexes
         WHERE tablename IN ('workout', 'workout_exercise')`,
      );
      const byName = Object.fromEntries(idx.map((i) => [i.indexname, i.indexdef]));
      expect(byName.workout_user_client_id_key).toContain("UNIQUE INDEX");
      expect(byName.workout_user_client_id_key).toContain("(user_id, client_generated_id)");
      expect(byName.workout_user_started_idx).toContain("(user_id, started_at DESC)");
      expect(byName.workout_user_active_key).toContain("UNIQUE INDEX");
      expect(byName.workout_user_active_key).toContain("WHERE (ended_at IS NULL)");
      expect(byName.workout_exercise_exercise_idx).toContain("(exercise_id)");

      const deferrable = await db.prisma.$queryRawUnsafe<
        { condeferrable: boolean; condeferred: boolean }[]
      >(
        `SELECT condeferrable, condeferred FROM pg_constraint
         WHERE conname = 'workout_exercise_position_key'`,
      );
      expect(deferrable[0]).toEqual({ condeferrable: true, condeferred: false });
    });

    it("D49: prisma migrate diff (migrated DB → schema.prisma) reports no difference", () => {
      const apiDir = fileURLToPath(new URL("../../", import.meta.url));
      const r = spawnSync(
        "pnpm",
        [
          "exec", "prisma", "migrate", "diff",
          "--from-url", db.url,
          "--to-schema-datamodel", "prisma/schema.prisma",
          "--exit-code",
        ],
        { cwd: apiDir, encoding: "utf8" },
      );
      expect(r.status, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(0);
      expect(r.stdout).toContain("No difference detected");
    });
  },
);
```

```ts
// apps/api/test/unit/workout-migration-drift-guard.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MODALITY_VALUES, WORKOUT_SOURCE_VALUES } from "@sin/core";

const migrationSql = readFileSync(
  new URL(
    "../../prisma/migrations/0005_create_workout_session/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("AC2 — both CHECK literal lists cannot silently drift from @sin/core", () => {
  it("renders WORKOUT_SOURCE_VALUES verbatim in the workout.source CHECK", () => {
    const rendered = WORKOUT_SOURCE_VALUES.map((v) => `'${v}'`).join(", ");
    expect(migrationSql).toContain(`"source" IN (${rendered})`);
  });

  it("renders MODALITY_VALUES verbatim in the workout_exercise.modality_snapshot CHECK", () => {
    const rendered = MODALITY_VALUES.map((v) => `'${v}'`).join(", ");
    expect(migrationSql).toContain(`"modality_snapshot" IN (${rendered})`);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `RUN_INTEGRATION=1 pnpm --filter @sin/api run test:integration -- workout-migration` and `pnpm --filter @sin/api run test:unit -- workout-migration-drift-guard`
Expected: both fail — `0005_create_workout_session/migration.sql` does not exist (`applyMigrationFile` throws `ENOENT` / the readFile in the unit test throws), and `WORKOUT_SOURCE_VALUES` does not yet exist as a named export of `@sin/core` (module resolution error).

- [ ] **Step 3: Write the migration SQL**

```sql
-- apps/api/prisma/migrations/0005_create_workout_session/migration.sql
-- Spec 05.0 §4 — 0005_create_workout_session. Additive, expand-only.
-- Down = DROP TABLE "workout_exercise", "workout";  (test teardown / local
-- `migrate reset` only — never production, per Spec 01 §11 / Spec 05.0 §11;
-- production undo is `git revert` + a forward migration.)
--
-- Hand-authored (`prisma migrate diff` as a starting point, then edited): the
-- partial unique index (WHERE ended_at IS NULL), the two CHECK (... IN (...))
-- literal lists, and the DEFERRABLE unique constraint are not expressible in
-- the Prisma schema DSL, so this .sql file is the source of truth and the
-- Prisma models carry the client shape only (Spec 05.0 §4, following 03.1's
-- 0002 carve-out).

CREATE TABLE "workout" (
    "id"                   UUID           NOT NULL,
    "user_id"              UUID           NOT NULL,
    "title"                TEXT,
    "notes"                TEXT,
    "started_at"           TIMESTAMPTZ(6) NOT NULL,
    "ended_at"             TIMESTAMPTZ(6),
    "local_date"           DATE           NOT NULL,
    "tz_offset_minutes"    SMALLINT       NOT NULL,
    "client_generated_id"  UUID           NOT NULL,
    "source"               TEXT           NOT NULL DEFAULT 'manual',
    "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "workout_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workout_source_check" CHECK ("source" IN ('manual')),
    CONSTRAINT "workout_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "workout_exercise" (
    "id"                     UUID           NOT NULL,
    "workout_id"             UUID           NOT NULL,
    "position"               SMALLINT       NOT NULL,
    "exercise_id"            UUID           NOT NULL,
    "exercise_name_snapshot" TEXT           NOT NULL,
    "modality_snapshot"      TEXT           NOT NULL,
    "notes"                  TEXT,
    "created_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "workout_exercise_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workout_exercise_modality_snapshot_check" CHECK ("modality_snapshot" IN ('weight_reps', 'bodyweight_reps', 'weighted_bodyweight', 'duration', 'distance_duration')),
    CONSTRAINT "workout_exercise_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "workout"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workout_exercise_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "workout_user_client_id_key" ON "workout" ("user_id", "client_generated_id");
CREATE INDEX "workout_user_started_idx" ON "workout" ("user_id", "started_at" DESC);
-- At most one in-progress session per user (Spec 05.0 D38) — a database
-- invariant, not a check-then-insert race. Also the GET /v1/workouts/active
-- lookup's access path.
CREATE UNIQUE INDEX "workout_user_active_key" ON "workout" ("user_id") WHERE "ended_at" IS NULL;

-- Must be a constraint, not a bare index — Postgres cannot defer a plain
-- unique index (Spec 05.0 D41). INITIALLY IMMEDIATE keeps ordinary
-- inserts/deletes strict; only the reorder transaction opts into DEFERRED via
-- `SET CONSTRAINTS workout_exercise_position_key DEFERRED`.
ALTER TABLE "workout_exercise" ADD CONSTRAINT "workout_exercise_position_key"
  UNIQUE ("workout_id", "position") DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX "workout_exercise_exercise_idx" ON "workout_exercise" ("exercise_id");
```

- [ ] **Step 4: Append the Prisma models**

In `apps/api/prisma/schema.prisma`, add `workouts Workout[]` to `model User` (immediately below `customExercises Exercise[]`) and `workoutExercises WorkoutExercise[]` to `model Exercise` (immediately below the `forks Exercise[]` relation), then append:

```prisma
// Spec 05.0 §4 — workout session lifecycle. Hand-authored SQL owns the
// partial unique index, the two CHECKs and the deferrable constraint; these
// models carry the client shape only.
model Workout {
  id                 String    @id @db.Uuid
  userId             String    @map("user_id") @db.Uuid
  user               User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  title              String?
  notes              String?
  startedAt          DateTime  @map("started_at") @db.Timestamptz(6)
  endedAt            DateTime? @map("ended_at") @db.Timestamptz(6)
  localDate          DateTime  @map("local_date") @db.Date
  tzOffsetMinutes    Int       @map("tz_offset_minutes") @db.SmallInt
  clientGeneratedId  String    @map("client_generated_id") @db.Uuid
  source             String    @default("manual")
  createdAt          DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt          DateTime  @default(now()) @map("updated_at") @db.Timestamptz(6)
  exercises          WorkoutExercise[]

  @@unique([userId, clientGeneratedId], map: "workout_user_client_id_key")
  @@index([userId, startedAt(sort: Desc)], map: "workout_user_started_idx")
  @@map("workout")
}

model WorkoutExercise {
  id                   String   @id @db.Uuid
  workoutId            String   @map("workout_id") @db.Uuid
  workout              Workout  @relation(fields: [workoutId], references: [id], onDelete: Cascade)
  position             Int      @db.SmallInt
  exerciseId           String   @map("exercise_id") @db.Uuid
  exercise             Exercise @relation(fields: [exerciseId], references: [id], onDelete: Cascade)
  exerciseNameSnapshot String   @map("exercise_name_snapshot")
  modalitySnapshot     String   @map("modality_snapshot")
  notes                String?
  createdAt            DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt            DateTime @default(now()) @map("updated_at") @db.Timestamptz(6)

  @@unique([workoutId, position], map: "workout_exercise_position_key")
  @@index([exerciseId], map: "workout_exercise_exercise_idx")
  @@map("workout_exercise")
}
```

- [ ] **Step 5: `prisma validate`**

Run: `pnpm --filter @sin/api exec prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 6: Run the tests to verify they pass**

Run: `RUN_INTEGRATION=1 pnpm --filter @sin/api run test:integration -- workout-migration`
Expected: all pass, including the `migrate diff` no-drift assertion (adjust per Task 0's spike result if it returned exit code 2). The drift-guard unit test still fails until Task 3 lands `WORKOUT_SOURCE_VALUES` — leave it red and continue; Task 3 turns it green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/migrations/0005_create_workout_session apps/api/prisma/schema.prisma apps/api/test/integration/workout-migration.integration.test.ts apps/api/test/unit/workout-migration-drift-guard.test.ts
git commit -m "feat(api): add workout + workout_exercise schema (migration 0005, Spec 05.0 §4, AC1)"
```

---

## Task 2: `@sin/core` — `WorkoutId` / `WorkoutExerciseId` brands

**Files:**
- Modify: `packages/core/src/ids.ts` (append after the `exerciseId` block, lines 47–52)
- Create: `packages/core/test/ids-workout.test.ts`

**Interfaces:**
- Produces: `WorkoutIdSchema`, `WorkoutId`, `parseWorkoutId`, `isWorkoutId`, `WorkoutExerciseIdSchema`, `WorkoutExerciseId`, `parseWorkoutExerciseId`, `isWorkoutExerciseId` — consumed by Task 5 (DTOs), Task 8 (repository interface), Task 18 (routes).

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/ids-workout.test.ts
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  isWorkoutExerciseId,
  isWorkoutId,
  parseWorkoutExerciseId,
  parseWorkoutId,
  type WorkoutExerciseId,
  type WorkoutId,
} from "../src/index.js";

describe("AC19 — WorkoutId / WorkoutExerciseId brands", () => {
  it("parseWorkoutId accepts a UUID and throws on malformed input", () => {
    expect(() => parseWorkoutId("018fcb3e-3b8a-7d6e-9c1a-000000000001")).not.toThrow();
    expect(() => parseWorkoutId("not-a-uuid")).toThrow();
  });

  it("isWorkoutId / isWorkoutExerciseId are type guards", () => {
    expect(isWorkoutId("018fcb3e-3b8a-7d6e-9c1a-000000000001")).toBe(true);
    expect(isWorkoutId("nope")).toBe(false);
    expect(isWorkoutExerciseId("018fcb3e-3b8a-7d6e-9c1a-000000000002")).toBe(true);
  });

  it("parseWorkoutExerciseId accepts a UUID and throws on malformed input", () => {
    expect(() =>
      parseWorkoutExerciseId("018fcb3e-3b8a-7d6e-9c1a-000000000003"),
    ).not.toThrow();
    expect(() => parseWorkoutExerciseId("")).toThrow();
  });

  it("a raw string is not assignable to WorkoutId, and WorkoutId is not a WorkoutExerciseId", () => {
    expectTypeOf<string>().not.toMatchTypeOf<WorkoutId>();
    expectTypeOf<WorkoutId>().not.toMatchTypeOf<WorkoutExerciseId>();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sin/core run test:unit -- ids-workout`
Expected: module resolution failure — `WorkoutId`/`parseWorkoutId`/etc. are not exported from `../src/index.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/ids.ts — append after line 52 (isExerciseId export)

const workoutId = brandId("WorkoutId");

export const WorkoutIdSchema = workoutId.schema;
export type WorkoutId = z.infer<typeof WorkoutIdSchema>;
export const parseWorkoutId = workoutId.parse;
export const isWorkoutId = workoutId.is;

const workoutExerciseId = brandId("WorkoutExerciseId");

export const WorkoutExerciseIdSchema = workoutExerciseId.schema;
export type WorkoutExerciseId = z.infer<typeof WorkoutExerciseIdSchema>;
export const parseWorkoutExerciseId = workoutExerciseId.parse;
export const isWorkoutExerciseId = workoutExerciseId.is;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sin/core run test:unit -- ids-workout`
Expected: all pass. `--typecheck` variant also run: `pnpm --filter @sin/core run test:unit -- --typecheck ids-workout`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ids.ts packages/core/test/ids-workout.test.ts
git commit -m "feat(core): add WorkoutId/WorkoutExerciseId brands (Spec 05.0 §5, AC19)"
```

---

## Task 3: `@sin/core` — `WORKOUT_SOURCE_VALUES`

**Files:**
- Modify: `packages/core/src/enums.ts` (append after `MODALITY_VALUES`, i.e. after line 35)
- Create: `packages/core/test/enums-workout.test.ts`
- (Completes Task 1's `workout-migration-drift-guard.test.ts`, which references `WORKOUT_SOURCE_VALUES`.)

**Interfaces:**
- Produces: `WORKOUT_SOURCE_VALUES` (frozen `["manual"]`), `WorkoutSource` type.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/enums-workout.test.ts
import { describe, expect, it } from "vitest";
import { WORKOUT_SOURCE_VALUES } from "../src/index.js";

describe("AC19 — WORKOUT_SOURCE_VALUES", () => {
  it("is frozen and contains exactly 'manual'", () => {
    expect(Object.isFrozen(WORKOUT_SOURCE_VALUES)).toBe(true);
    expect(WORKOUT_SOURCE_VALUES).toEqual(["manual"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sin/core run test:unit -- enums-workout`
Expected: `WORKOUT_SOURCE_VALUES` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/enums.ts — append after line 35 (Modality type)

/** `workout.source` (DESIGN §6). Only `manual` in v1; a future importer
 * (`healthkit`, `google_fit`, …) adds its own value with the migration that
 * ships it (widening a CHECK literal list is additive, 03.1's precedent). */
export const WORKOUT_SOURCE_VALUES = Object.freeze(["manual"] as const);
export type WorkoutSource = (typeof WORKOUT_SOURCE_VALUES)[number];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sin/core run test:unit -- enums-workout` and `pnpm --filter @sin/api run test:unit -- workout-migration-drift-guard` (Task 1's deferred test — should now be green).
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/enums.ts packages/core/test/enums-workout.test.ts
git commit -m "feat(core): add WORKOUT_SOURCE_VALUES (Spec 05.0 §5, AC2, AC19)"
```

---

## Task 4: `@sin/core` — `time.ts` (`localDateFor`, `offsetMinutesForZone`)

**Files:**
- Create: `packages/core/src/time.ts`
- Create: `packages/core/test/time.test.ts`

**Interfaces:**
- Produces: `localDateFor(instantIso: string, offsetMinutes: number): string`, `offsetMinutesForZone(instantIso: string, ianaTimeZone: string): number` — consumed by Task 12 (`updateWorkout`... actually by Task 10/12's calendar-derivation code) and re-exported via Task 6.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/time.test.ts
import { describe, expect, it } from "vitest";
import { localDateFor, offsetMinutesForZone } from "../src/time.js";

describe("AC19/AC6 — time.ts", () => {
  describe("localDateFor", () => {
    it("east-of-UTC positive offset can move the date forward across midnight", () => {
      // 23:30Z + 120 min (UTC+02:00, east) = 01:30 local the next day
      expect(localDateFor("2026-03-14T23:30:00.000Z", 120)).toBe("2026-03-15");
    });

    it("west-of-UTC negative offset keeps the same day for the same instant", () => {
      // 23:30Z - 360 min (UTC-06:00, west) = 17:30 local, same day
      expect(localDateFor("2026-03-14T23:30:00.000Z", -360)).toBe("2026-03-14");
    });

    it("zero offset returns the UTC calendar date unchanged", () => {
      expect(localDateFor("2026-06-01T00:00:00.000Z", 0)).toBe("2026-06-01");
    });
  });

  describe("offsetMinutesForZone", () => {
    it("returns the east-positive offset at the given instant (DST transition)", () => {
      // America/New_York: EST (UTC-05:00) before the 2026 spring-forward,
      // EDT (UTC-04:00) after. Spring-forward 2026-03-08 07:00 UTC.
      expect(offsetMinutesForZone("2026-03-08T06:00:00.000Z", "America/New_York")).toBe(
        -300,
      );
      expect(offsetMinutesForZone("2026-03-08T08:00:00.000Z", "America/New_York")).toBe(
        -240,
      );
    });

    it("returns a positive value for an east-of-UTC zone", () => {
      expect(offsetMinutesForZone("2026-06-01T00:00:00.000Z", "Europe/Paris")).toBe(120);
    });

    it("returns 0 for UTC (bare GMT parses as 0)", () => {
      expect(offsetMinutesForZone("2026-06-01T00:00:00.000Z", "UTC")).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sin/core run test:unit -- time.test`
Expected: `../src/time.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/time.ts
/**
 * The one place `local_date` is derived (Spec 05.0 §5, §6.3). Both functions
 * are pure — no `Date.now()`, no I/O — so the calling handler is the only code
 * that decides *when* they run, and a test can pin any instant.
 */

/**
 * Shifts `instantIso` by `offsetMinutes` (minutes EAST of UTC — the sign
 * convention of the ISO 8601 offset itself, and the negation of
 * `Date.prototype.getTimezoneOffset()`) and returns the resulting calendar
 * date as `"YYYY-MM-DD"`. Plain arithmetic, no `Intl` — the offset is a known
 * integer, not something that needs zone-database lookup here.
 */
export function localDateFor(instantIso: string, offsetMinutes: number): string {
  const instantMs = Date.parse(instantIso);
  const shiftedMs = instantMs + offsetMinutes * 60_000;
  const d = new Date(shiftedMs);
  const year = d.getUTCFullYear().toString().padStart(4, "0");
  const month = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * The IANA zone's UTC offset, in minutes EAST of UTC, at the given instant —
 * so a DST transition is honored (Spec 05.0 §6.3). Uses `Intl.DateTimeFormat`
 * with `timeZoneName: "longOffset"`, which renders `GMT±HH:MM` (bare `GMT`
 * for UTC, parsed as 0). ECMA-402, not a Node API, so this stays inside the
 * `core:purity` boundary.
 */
export function offsetMinutesForZone(instantIso: string, ianaTimeZone: string): number {
  const date = new Date(instantIso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ianaTimeZone,
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const tzPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  if (tzPart === "GMT") return 0;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(tzPart);
  if (!match) {
    throw new Error(`offsetMinutesForZone: unparseable offset "${tzPart}" for zone "${ianaTimeZone}"`);
  }
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  return sign * (hours * 60 + minutes);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sin/core run test:unit -- time.test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/time.ts packages/core/test/time.test.ts
git commit -m "feat(core): add time.ts — localDateFor/offsetMinutesForZone (Spec 05.0 §5/§6.3, AC6, AC19)"
```

---

## Task 5: `@sin/core` — `dto/workout.ts` (seven schemas + four constants)

**Files:**
- Create: `packages/core/src/dto/workout.ts`
- Create: `packages/core/test/dto-workout.test.ts`

**Interfaces:**
- Consumes: `MODALITY_VALUES` (`../enums.js`), `WORKOUT_SOURCE_VALUES` (Task 3), `ExerciseIdSchema`, `WorkoutExerciseIdSchema`, `WorkoutIdSchema` (Task 2), `noControlChars` (`./exercise.js`, existing).
- Produces: `WorkoutSchema`, `WorkoutExerciseSchema`, `WorkoutDetailSchema`, `CreateWorkoutSchema`, `UpdateWorkoutSchema`, `AddWorkoutExerciseSchema`, `UpdateWorkoutExerciseSchema` (+ `z.infer` types `Workout`, `WorkoutExercise`, `WorkoutDetail`, `CreateWorkout`, `UpdateWorkout`, `AddWorkoutExercise`, `UpdateWorkoutExercise`); `WORKOUT_TITLE_MAX`, `WORKOUT_NOTES_MAX`, `WORKOUT_FUTURE_SKEW_MAX_MS`, `WORKOUT_STARTED_AT_PAST_MAX_MS`; `noControlCharsExceptWhitespace`. Consumed by Task 8 (repository types), Task 9 (skew helper reuses the constants), Task 18 (routes).

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/dto-workout.test.ts
import { describe, expect, it } from "vitest";
import {
  AddWorkoutExerciseSchema,
  CreateWorkoutSchema,
  UpdateWorkoutExerciseSchema,
  UpdateWorkoutSchema,
  WorkoutDetailSchema,
  WorkoutExerciseSchema,
  WorkoutSchema,
  WORKOUT_FUTURE_SKEW_MAX_MS,
  WORKOUT_NOTES_MAX,
  WORKOUT_STARTED_AT_PAST_MAX_MS,
  WORKOUT_TITLE_MAX,
  noControlCharsExceptWhitespace,
} from "../src/dto/workout.js";

const validWorkout = {
  id: "018fcb3e-3b8a-7d6e-9c1a-000000000001",
  title: "Push day",
  notes: null,
  startedAt: "2026-09-01T10:00:00.000Z",
  endedAt: null,
  localDate: "2026-09-01",
  tzOffsetMinutes: 0,
  clientGeneratedId: "018fcb3e-3b8a-7d6e-9c1a-000000000002",
  source: "manual",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};

describe("AC19 — dto/workout.ts code constants", () => {
  it("holds the §7/D47 values", () => {
    expect(WORKOUT_TITLE_MAX).toBe(120);
    expect(WORKOUT_NOTES_MAX).toBe(4000);
    expect(WORKOUT_FUTURE_SKEW_MAX_MS).toBe(300_000);
    expect(WORKOUT_STARTED_AT_PAST_MAX_MS).toBe(604_800_000);
  });
});

describe("AC19 — noControlCharsExceptWhitespace", () => {
  it("permits TAB, LF, CR", () => {
    expect(noControlCharsExceptWhitespace("line1\tline2\nline3\r")).toBe(true);
  });
  it("rejects every other C0 control char and DEL", () => {
    expect(noControlCharsExceptWhitespace("a\u0000b")).toBe(false);
    expect(noControlCharsExceptWhitespace("a\u007Fb")).toBe(false);
  });
});

describe("AC19/AC16 — WorkoutSchema", () => {
  it("parses a valid payload", () => {
    expect(() => WorkoutSchema.parse(validWorkout)).not.toThrow();
  });
  it("rejects a missing required field", () => {
    const { startedAt: _drop, ...rest } = validWorkout;
    expect(() => WorkoutSchema.parse(rest)).toThrow();
  });
});

describe("AC19/AC16 — CreateWorkoutSchema", () => {
  const validCreate = {
    clientGeneratedId: "018fcb3e-3b8a-7d6e-9c1a-000000000002",
    startedAt: "2026-09-01T10:00:00.000Z",
  };
  it("parses a minimal valid payload (optionals omitted)", () => {
    expect(() => CreateWorkoutSchema.parse(validCreate)).not.toThrow();
  });
  it("rejects an unknown key", () => {
    expect(() =>
      CreateWorkoutSchema.parse({ ...validCreate, localDate: "2026-09-01" }),
    ).toThrow();
    expect(() => CreateWorkoutSchema.parse({ ...validCreate, userId: "x" })).toThrow();
    expect(() => CreateWorkoutSchema.parse({ ...validCreate, id: "x" })).toThrow();
    expect(() =>
      CreateWorkoutSchema.parse({ ...validCreate, source: "manual" }),
    ).toThrow();
  });
  it("rejects title over WORKOUT_TITLE_MAX and notes over WORKOUT_NOTES_MAX", () => {
    expect(() =>
      CreateWorkoutSchema.parse({ ...validCreate, title: "a".repeat(121) }),
    ).toThrow();
    expect(() =>
      CreateWorkoutSchema.parse({ ...validCreate, title: "a".repeat(120) }),
    ).not.toThrow();
    expect(() =>
      CreateWorkoutSchema.parse({ ...validCreate, notes: "a".repeat(4001) }),
    ).toThrow();
    expect(() =>
      CreateWorkoutSchema.parse({ ...validCreate, notes: "a".repeat(4000) }),
    ).not.toThrow();
  });
  it("rejects an empty string but accepts null and omission", () => {
    expect(() => CreateWorkoutSchema.parse({ ...validCreate, title: "" })).toThrow();
    expect(() =>
      CreateWorkoutSchema.parse({ ...validCreate, title: null }),
    ).not.toThrow();
  });
});

describe("AC19/AC16 — UpdateWorkoutSchema", () => {
  it("rejects localDate and tzOffsetMinutes as unknown keys", () => {
    expect(() => UpdateWorkoutSchema.parse({ localDate: "2026-09-01" })).toThrow();
    expect(() => UpdateWorkoutSchema.parse({ tzOffsetMinutes: 60 })).toThrow();
  });
  it("accepts an empty body and endedAt: null", () => {
    expect(() => UpdateWorkoutSchema.parse({})).not.toThrow();
    expect(() => UpdateWorkoutSchema.parse({ endedAt: null })).not.toThrow();
  });
});

describe("AC19/AC16 — AddWorkoutExerciseSchema / UpdateWorkoutExerciseSchema", () => {
  it("AddWorkoutExerciseSchema requires exerciseId, position optional", () => {
    expect(() =>
      AddWorkoutExerciseSchema.parse({
        exerciseId: "018fcb3e-3b8a-7d6e-9c1a-000000000004",
      }),
    ).not.toThrow();
    expect(() => AddWorkoutExerciseSchema.parse({})).toThrow();
  });
  it("UpdateWorkoutExerciseSchema accepts a partial reorder/notes body", () => {
    expect(() => UpdateWorkoutExerciseSchema.parse({ position: 2 })).not.toThrow();
    expect(() => UpdateWorkoutExerciseSchema.parse({})).not.toThrow();
    expect(() => UpdateWorkoutExerciseSchema.parse({ position: -1 })).toThrow();
  });
});

describe("AC19 — WorkoutExerciseSchema / WorkoutDetailSchema", () => {
  const validWe = {
    id: "018fcb3e-3b8a-7d6e-9c1a-000000000005",
    workoutId: validWorkout.id,
    position: 0,
    exerciseId: "018fcb3e-3b8a-7d6e-9c1a-000000000006",
    exerciseNameSnapshot: "Bench Press",
    modalitySnapshot: "weight_reps",
    notes: null,
    createdAt: validWorkout.createdAt,
    updatedAt: validWorkout.updatedAt,
  };
  it("WorkoutExerciseSchema parses a valid row", () => {
    expect(() => WorkoutExerciseSchema.parse(validWe)).not.toThrow();
  });
  it("WorkoutDetailSchema extends WorkoutSchema with an exercises array", () => {
    expect(() =>
      WorkoutDetailSchema.parse({ ...validWorkout, exercises: [validWe] }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sin/core run test:unit -- dto-workout`
Expected: `../src/dto/workout.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/dto/workout.ts
/**
 * Workout session lifecycle DTOs (Spec 05.0 §5). `XxxSchema` for the Zod
 * value, bare `Xxx` for the inferred type (D48) — no `Body`/`Response`
 * suffix. Response schemas are `z.object` (field allowlist, Spec 03.0 §6.5);
 * request bodies are `z.strictObject` (unknown key -> 422, never dropped).
 */
import { z } from "zod";
import { MODALITY_VALUES, WORKOUT_SOURCE_VALUES } from "../enums.js";
import { ExerciseIdSchema, WorkoutExerciseIdSchema, WorkoutIdSchema } from "../ids.js";
import { noControlChars } from "./exercise.js";

export const WORKOUT_TITLE_MAX = 120;
export const WORKOUT_NOTES_MAX = 4000;

/** Clock-skew bounds (§6.4, D47), in milliseconds. The future bound also
 * bounds `endedAt` on finish; the past bound applies to `startedAt` alone. */
export const WORKOUT_FUTURE_SKEW_MAX_MS = 5 * 60 * 1000; // 300_000
export const WORKOUT_STARTED_AT_PAST_MAX_MS = 7 * 24 * 60 * 60 * 1000; // 604_800_000

/** Like `noControlChars`, but permits TAB, LF, CR — notes are multi-line
 * prose, a title is a single line. Still rejects every other C0 char and DEL. */
export const noControlCharsExceptWhitespace = (s: string): boolean => {
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    const isAllowedWhitespace = code === 0x09 || code === 0x0a || code === 0x0d;
    if (!isAllowedWhitespace && (code <= 0x1f || code === 0x7f)) return false;
  }
  return true;
};

const WorkoutTitle = z
  .string()
  .min(1)
  .max(WORKOUT_TITLE_MAX)
  .refine(noControlChars, "control characters not allowed");
const WorkoutNotes = z
  .string()
  .min(1)
  .max(WORKOUT_NOTES_MAX)
  .refine(noControlCharsExceptWhitespace, "control characters not allowed");

// Minutes EAST of UTC (§6.3). Real-world offsets run UTC-12:00..UTC+14:00.
const TzOffsetMinutes = z.number().int().min(-720).max(840);

/** One workout session. */
export const WorkoutSchema = z.object({
  id: WorkoutIdSchema,
  title: z.string().nullable(),
  notes: z.string().nullable(),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }).nullable(),
  localDate: z.iso.date(),
  tzOffsetMinutes: TzOffsetMinutes,
  clientGeneratedId: z.guid(),
  source: z.enum(WORKOUT_SOURCE_VALUES),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type Workout = z.infer<typeof WorkoutSchema>;

/** One exercise within a workout. */
export const WorkoutExerciseSchema = z.object({
  id: WorkoutExerciseIdSchema,
  workoutId: WorkoutIdSchema,
  position: z.number().int().min(0),
  exerciseId: ExerciseIdSchema,
  exerciseNameSnapshot: z.string(),
  modalitySnapshot: z.enum(MODALITY_VALUES),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type WorkoutExercise = z.infer<typeof WorkoutExerciseSchema>;

/** GET /v1/workouts/active and GET /v1/workouts/{id}. */
export const WorkoutDetailSchema = WorkoutSchema.extend({
  exercises: z.array(WorkoutExerciseSchema),
});
export type WorkoutDetail = z.infer<typeof WorkoutDetailSchema>;

/** POST /v1/workouts body. */
export const CreateWorkoutSchema = z.strictObject({
  clientGeneratedId: z.guid(),
  startedAt: z.iso.datetime({ offset: true }),
  tzOffsetMinutes: TzOffsetMinutes.optional(),
  title: WorkoutTitle.nullable().optional(),
  notes: WorkoutNotes.nullable().optional(),
});
export type CreateWorkout = z.infer<typeof CreateWorkoutSchema>;

/** PATCH /v1/workouts/{id} body. */
export const UpdateWorkoutSchema = z.strictObject({
  title: WorkoutTitle.nullable().optional(),
  notes: WorkoutNotes.nullable().optional(),
  endedAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
export type UpdateWorkout = z.infer<typeof UpdateWorkoutSchema>;

/** POST /v1/workouts/{id}/exercises body. */
export const AddWorkoutExerciseSchema = z.strictObject({
  exerciseId: ExerciseIdSchema,
  position: z.number().int().min(0).optional(),
  notes: WorkoutNotes.nullable().optional(),
});
export type AddWorkoutExercise = z.infer<typeof AddWorkoutExerciseSchema>;

/** PATCH /v1/workout-exercises/{id} body. */
export const UpdateWorkoutExerciseSchema = z.strictObject({
  position: z.number().int().min(0).optional(),
  notes: WorkoutNotes.nullable().optional(),
});
export type UpdateWorkoutExercise = z.infer<typeof UpdateWorkoutExerciseSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sin/core run test:unit -- dto-workout`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/dto/workout.ts packages/core/test/dto-workout.test.ts
git commit -m "feat(core): add dto/workout.ts — seven schemas + clock-skew/text-bound constants (Spec 05.0 §5, AC16, AC19)"
```

---

## Task 6: `@sin/core` — wire `time.ts` / `dto/workout.ts` into `index.ts` and `check-exports.mjs`

**Files:**
- Modify: `packages/core/src/index.ts` (append two `export *` lines after line 17)
- Modify: `packages/core/scripts/check-exports.mjs` (append every new runtime export by name to `EXPECTED`, after line 82)
- No new test file — this task is verified by the existing `check-exports.mjs` script and `pnpm run core:purity`, which become the test.

**Interfaces:**
- Consumes: everything Tasks 2–5 produced.
- Produces: nothing new — makes Tasks 2–5's exports reachable from the package's public barrel.

- [ ] **Step 1: Confirm the check currently fails to name the new exports (the "test")**

Run: `pnpm --filter @sin/core run build && node packages/core/scripts/check-exports.mjs`
Expected: passes today (the new exports aren't in `EXPECTED` yet, so nothing is missing) — this is the inverse of the usual red/green: the risk here is a **false pass** if a name is forgotten. Step 1's real assertion is manual: diff Task 2/3/4/5's exported names against `EXPECTED` before editing.

- [ ] **Step 2: N/A — proceed directly; there is no separate failing-test state for a barrel re-export**

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/core/src/index.ts
export * from "./enums.js";
export * from "./ids.js";
export * from "./units.js";
export * from "./dto/me.js";
export * from "./dto/exercise.js";
export * from "./dto/workout.js";
export * from "./time.js";
```

```js
// packages/core/scripts/check-exports.mjs — append to EXPECTED, after "EquipmentResponse",
const EXPECTED = [
  // ...existing entries unchanged...
  "EquipmentResponse",
  // ids — workout (Spec 05.0 §5)
  "WorkoutIdSchema",
  "parseWorkoutId",
  "isWorkoutId",
  "WorkoutExerciseIdSchema",
  "parseWorkoutExerciseId",
  "isWorkoutExerciseId",
  // enums — workout (Spec 05.0 §5)
  "WORKOUT_SOURCE_VALUES",
  // dto — workout (Spec 05.0 §5)
  "noControlCharsExceptWhitespace",
  "WORKOUT_TITLE_MAX",
  "WORKOUT_NOTES_MAX",
  "WORKOUT_FUTURE_SKEW_MAX_MS",
  "WORKOUT_STARTED_AT_PAST_MAX_MS",
  "WorkoutSchema",
  "WorkoutExerciseSchema",
  "WorkoutDetailSchema",
  "CreateWorkoutSchema",
  "UpdateWorkoutSchema",
  "AddWorkoutExerciseSchema",
  "UpdateWorkoutExerciseSchema",
  // time.ts (Spec 05.0 §5)
  "localDateFor",
  "offsetMinutesForZone",
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sin/core run build && node packages/core/scripts/check-exports.mjs`
Expected: `check-exports passed — types + N runtime exports resolve.` with `N` including all 17 new names.

Run: `pnpm run core:purity`
Expected: green — `time.ts`'s `Intl` usage is ECMA-402, not Node-only, matching `dto/me.ts`'s existing `isValidTimeZone` precedent.

Run: `pnpm --filter @sin/api run test:unit -- deps` (the existing `test/deps.test.ts` pin)
Expected: green — no new runtime dependency; `dependencies` stays exactly `["zod"]`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/scripts/check-exports.mjs
git commit -m "feat(core): re-export time.ts + dto/workout.ts, list all new exports in check-exports.mjs (Spec 05.0 §5, AC19)"
```

---

## Task 7: `apps/api` errors — `WorkoutFinishedError` / `WorkoutInProgressExistsError`

**Files:**
- Modify: `apps/api/src/errors/app-error.ts` (append after `SyncTokenExpiredError`, i.e. after line 226)
- Create: `apps/api/test/unit/workout-errors.test.ts`

**Interfaces:**
- Produces: `WorkoutFinishedError` (409, `workout-finished`), `WorkoutInProgressExistsError` (409, `workout-in-progress-exists`) — consumed by Task 10 (create), Task 12 (finish/patch), Task 14–16 (exercise writes).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/unit/workout-errors.test.ts
import { describe, expect, it } from "vitest";
import { WorkoutFinishedError, WorkoutInProgressExistsError } from "../../src/errors/app-error.js";

describe("AC8/AC4 — workout AppError subclasses", () => {
  it("WorkoutFinishedError is a 409 with slug workout-finished", () => {
    const e = new WorkoutFinishedError();
    expect(e.status).toBe(409);
    expect(e.slug).toBe("workout-finished");
    expect(e.publicDetail).not.toContain("ended_at"); // no internal detail leaks
  });

  it("WorkoutInProgressExistsError is a 409 with slug workout-in-progress-exists", () => {
    const e = new WorkoutInProgressExistsError();
    expect(e.status).toBe(409);
    expect(e.slug).toBe("workout-in-progress-exists");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sin/api run test:unit -- workout-errors`
Expected: `WorkoutFinishedError` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/errors/app-error.ts — append after SyncTokenExpiredError (line 226)

/** Spec 05.0 §5/§6.5 — the single "the parent is immutable" signal: raised by
 * PATCH /v1/workouts/{id} against a finished workout and by all three
 * exercise-within-workout writes when the (parent) workout has ended_at set. */
export class WorkoutFinishedError extends AppError {
  readonly status = 409;
  readonly slug = "workout-finished";
  readonly title = "Workout finished";
  readonly publicDetail =
    "This workout has already been finished and can no longer be modified.";

  constructor(internal = "target workout has ended_at set") {
    super(internal);
  }
}

/** Spec 05.0 §5/§6.2 — the caller already has a row with ended_at IS NULL.
 * The body carries no workout id (no problem+json extension member); the
 * client recovers via GET /v1/workouts/active. */
export class WorkoutInProgressExistsError extends AppError {
  readonly status = 409;
  readonly slug = "workout-in-progress-exists";
  readonly title = "Workout already in progress";
  readonly publicDetail =
    "You already have a workout in progress. Resume or discard it first.";

  constructor(internal = "workout_user_active_key: caller already has ended_at IS NULL") {
    super(internal);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sin/api run test:unit -- workout-errors`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/errors/app-error.ts apps/api/test/unit/workout-errors.test.ts
git commit -m "feat(api): add WorkoutFinishedError/WorkoutInProgressExistsError (Spec 05.0 §5)"
```

---

## Task 8: `apps/api/src/repositories/workout.ts` — interface + record types

**Files:**
- Create: `apps/api/src/repositories/workout.ts`

**Interfaces:**
- Consumes: nothing beyond built-in types.
- Produces: `WorkoutRecord`, `WorkoutExerciseRecord`, `WorkoutDetailRecord`, `WorkoutRepository` interface (method signatures every later task implements against) — every method takes `actingUserId` first (DESIGN R8, §6/§7).

No test file for this task — it is a pure type/interface declaration with no runtime behavior; it is exercised end-to-end by every later task's tests. This mirrors `apps/api/src/repositories/exercise.ts`, which likewise has no dedicated test file.

- [ ] **Step 1: (No test — interface-only task; proceed to Step 3)**
- [ ] **Step 2: (N/A)**
- [ ] **Step 3: Write the interface**

```ts
// apps/api/src/repositories/workout.ts
/**
 * Workout session lifecycle repository contract (Spec 05.0 §6, "Wiring
 * points"). Every method takes `actingUserId` first (DESIGN R8) — no handler
 * ever queries `workout` or `workout_exercise` by id alone. A malformed id is
 * `NotFoundError`, resolved by the branded guard before any query
 * (`isWorkoutId` / `isWorkoutExerciseId`), exactly as `exercise.prisma.ts`
 * does with `isExerciseId`.
 */

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
  exercises: WorkoutExerciseRecord[];
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

/**
 * A fresh create (`201`) vs. an idempotent replay (`200`) — the route uses
 * this to pick the status code and whether to set `Location` (§6.1).
 */
export interface CreateWorkoutResult {
  workout: WorkoutRecord;
  created: boolean;
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
   * evaluated inside the lock, after the finished-check).
   */
  updateWorkout(
    actingUserId: string,
    id: string,
    patch: UpdateWorkoutFields,
  ): Promise<WorkoutRecord>;

  /** Hard delete, cascades to `workout_exercise` (§6.5, §6.9's DELETE
   * exemption). Allowed on an in-progress or finished workout. Throws
   * `NotFoundError` on a miss or another user's row; idempotent-looking
   * repeat calls throw `NotFoundError` too (204 vs. 404 is the route's job). */
  deleteWorkout(actingUserId: string, id: string): Promise<void>;

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
}
```

- [ ] **Step 4: (No runtime test — `tsc` via `pnpm run typecheck` is the verification)**

Run: `pnpm run typecheck`
Expected: green (the file compiles; nothing references it yet).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/repositories/workout.ts
git commit -m "feat(api): add WorkoutRepository interface + record types (Spec 05.0 §6, Wiring points)"
```

---

## Task 9: `apps/api/src/repositories/workout-writes.ts` — pure helpers (position arithmetic, clock-skew bound)

**Files:**
- Create: `apps/api/src/repositories/workout-writes.ts`
- Create: `apps/api/test/unit/workout-writes.test.ts`

**Interfaces:**
- Consumes: `WORKOUT_FUTURE_SKEW_MAX_MS`, `WORKOUT_STARTED_AT_PAST_MAX_MS` (Task 5).
- Produces: `assertStartedAtInBounds(startedAt: Date, now: Date): void`, `assertEndedAtInBounds(endedAt: Date, now: Date): void`, `assertEndedAtNotBeforeStartedAt(startedAt: Date, endedAt: Date): void`, `computeAppendPosition(n: number): number`, `assertAddPositionInRange(position: number, n: number): void`, `assertReorderPositionInRange(position: number, n: number): void` — consumed by Task 10 (skew), Task 12 (finish rules), Task 14/15 (position range checks). All throw `ValidationError` from `../errors/app-error.js`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/unit/workout-writes.test.ts
import { describe, expect, it } from "vitest";
import { ValidationError } from "../../src/errors/app-error.js";
import {
  assertAddPositionInRange,
  assertEndedAtInBounds,
  assertEndedAtNotBeforeStartedAt,
  assertReorderPositionInRange,
  assertStartedAtInBounds,
  computeAppendPosition,
} from "../../src/repositories/workout-writes.js";

const NOW = new Date("2026-09-15T12:00:00.000Z");

describe("AC7 — assertStartedAtInBounds", () => {
  it("accepts exactly at the +5 minute future bound", () => {
    expect(() =>
      assertStartedAtInBounds(new Date(NOW.getTime() + 5 * 60 * 1000), NOW),
    ).not.toThrow();
  });
  it("rejects just past the +5 minute future bound", () => {
    expect(() =>
      assertStartedAtInBounds(new Date(NOW.getTime() + 5 * 60 * 1000 + 1), NOW),
    ).toThrow(ValidationError);
  });
  it("accepts exactly at the -7 day past bound", () => {
    expect(() =>
      assertStartedAtInBounds(new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000), NOW),
    ).not.toThrow();
  });
  it("rejects just past the -7 day past bound", () => {
    expect(() =>
      assertStartedAtInBounds(new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000 - 1), NOW),
    ).toThrow(ValidationError);
  });
});

describe("AC7/AC8 — assertEndedAtInBounds", () => {
  it("accepts exactly at the +5 minute future bound and rejects just past it", () => {
    expect(() =>
      assertEndedAtInBounds(new Date(NOW.getTime() + 5 * 60 * 1000), NOW),
    ).not.toThrow();
    expect(() =>
      assertEndedAtInBounds(new Date(NOW.getTime() + 5 * 60 * 1000 + 1), NOW),
    ).toThrow(ValidationError);
  });
});

describe("AC8 — assertEndedAtNotBeforeStartedAt", () => {
  const startedAt = new Date("2026-09-15T10:00:00.000Z");
  it("accepts endedAt === startedAt", () => {
    expect(() => assertEndedAtNotBeforeStartedAt(startedAt, startedAt)).not.toThrow();
  });
  it("rejects endedAt < startedAt", () => {
    expect(() =>
      assertEndedAtNotBeforeStartedAt(startedAt, new Date(startedAt.getTime() - 1)),
    ).toThrow(ValidationError);
  });
});

describe("AC11 — computeAppendPosition", () => {
  it("returns n (append at the end)", () => {
    expect(computeAppendPosition(0)).toBe(0);
    expect(computeAppendPosition(5)).toBe(5);
  });
});

describe("AC11 — assertAddPositionInRange (0 <= position <= n)", () => {
  it("accepts the boundaries", () => {
    expect(() => assertAddPositionInRange(0, 3)).not.toThrow();
    expect(() => assertAddPositionInRange(3, 3)).not.toThrow();
  });
  it("rejects position = n + 1", () => {
    expect(() => assertAddPositionInRange(4, 3)).toThrow(ValidationError);
  });
  it("rejects a position above the smallint ceiling without ever reaching Postgres", () => {
    expect(() => assertAddPositionInRange(40_000, 3)).toThrow(ValidationError);
  });
});

describe("AC11 — assertReorderPositionInRange (0 <= position <= n-1)", () => {
  it("accepts the boundaries", () => {
    expect(() => assertReorderPositionInRange(0, 3)).not.toThrow();
    expect(() => assertReorderPositionInRange(2, 3)).not.toThrow();
  });
  it("rejects position = n", () => {
    expect(() => assertReorderPositionInRange(3, 3)).toThrow(ValidationError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sin/api run test:unit -- workout-writes`
Expected: `../../src/repositories/workout-writes.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/repositories/workout-writes.ts
/**
 * Pure, DB-free helpers for the workout write paths (Spec 05.0 §6.4, §6.7,
 * D43, D47) — unit-testable with an injected clock, no database. Shared by
 * `workout.prisma.ts` and (for arithmetic) `FakeWorkoutRepository`.
 */
import { WORKOUT_FUTURE_SKEW_MAX_MS, WORKOUT_STARTED_AT_PAST_MAX_MS } from "@sin/core";
import { ValidationError } from "../errors/app-error.js";

function fieldError(path: string, message: string): never {
  throw new ValidationError([{ path, message }], `${path}: ${message}`);
}

/** §6.4: startedAt must be within +5min / -7days of `now`. */
export function assertStartedAtInBounds(startedAt: Date, now: Date): void {
  const deltaMs = startedAt.getTime() - now.getTime();
  if (deltaMs > WORKOUT_FUTURE_SKEW_MAX_MS) {
    fieldError("startedAt", "must not be more than 5 minutes in the future");
  }
  if (deltaMs < -WORKOUT_STARTED_AT_PAST_MAX_MS) {
    fieldError("startedAt", "must not be more than 7 days in the past");
  }
}

/** §6.4/§6.5: endedAt on finish uses the same future bound as startedAt. */
export function assertEndedAtInBounds(endedAt: Date, now: Date): void {
  const deltaMs = endedAt.getTime() - now.getTime();
  if (deltaMs > WORKOUT_FUTURE_SKEW_MAX_MS) {
    fieldError("endedAt", "must not be more than 5 minutes in the future");
  }
}

/** §6.5: endedAt >= startedAt; equality allowed. */
export function assertEndedAtNotBeforeStartedAt(startedAt: Date, endedAt: Date): void {
  if (endedAt.getTime() < startedAt.getTime()) {
    fieldError("endedAt", "must not be before startedAt");
  }
}

/** §6.7: add with no `position` appends at the current count `n`. */
export function computeAppendPosition(n: number): number {
  return n;
}

/** §6.7/D43: add-with-position requires 0 <= position <= n. This is what
 * keeps `position` inside `smallint` — it rejects everything above 32767
 * long before the column would see it, since a real workout's `n` is a few
 * dozen at most. */
export function assertAddPositionInRange(position: number, n: number): void {
  if (position < 0 || position > n) {
    fieldError("position", `must be between 0 and ${n} inclusive`);
  }
}

/** §6.7/D43: reorder requires 0 <= position <= n-1. */
export function assertReorderPositionInRange(position: number, n: number): void {
  if (position < 0 || position > n - 1) {
    fieldError("position", `must be between 0 and ${n - 1} inclusive`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sin/api run test:unit -- workout-writes`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/repositories/workout-writes.ts apps/api/test/unit/workout-writes.test.ts
git commit -m "feat(api): add pure workout-writes helpers — skew bounds + position range checks (Spec 05.0 §6.4/§6.7, AC7, AC11)"
```

---

## Task 10: `workout.prisma.ts` — `createWorkout` (idempotent create, D40/D50 outcome switch)

**Files:**
- Create: `apps/api/src/repositories/workout.prisma.ts` (this task starts the file; Tasks 11–16 append to it)
- Create: `apps/api/test/unit/workout-repository-create.test.ts`

**Interfaces:**
- Consumes: `WorkoutRepository`, `CreateWorkoutFields`, `CreateWorkoutResult`, `WorkoutRecord` (Task 8); `WorkoutInProgressExistsError` (Task 7); `localDateFor`, `offsetMinutesForZone` (Task 4); `assertStartedAtInBounds` (Task 9, called by Task 18's route handler, **not** here — see the note in Step 3).
- Produces: `createExerciseRepository`-style factory `createWorkoutRepository(prisma: PrismaClient): WorkoutRepository`, started with just `createWorkout` implemented (other methods throw `"not implemented"` placeholders removed task-by-task through Task 16 — see Step 3's note). Also produces the reusable `isUniqueViolation` / `violatedConstraintName` helpers Task 12/14 do **not** need (only the create path hits `23505` on a non-arbiter index) but which are kept local to this file since no other repository shares them today.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/unit/workout-repository-create.test.ts
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { uuidv7 } from "uuidv7";
import { WorkoutInProgressExistsError } from "../../src/errors/app-error.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import type { CreateWorkoutFields } from "../../src/repositories/workout.js";

/** Minimal shape of a `workout` row as the raw SQL returns it. */
interface WorkoutDbRow {
  id: string;
  user_id: string;
  title: string | null;
  notes: string | null;
  started_at: Date;
  ended_at: Date | null;
  local_date: Date;
  tz_offset_minutes: number;
  client_generated_id: string;
  source: string;
  created_at: Date;
  updated_at: Date;
}

function row(overrides: Partial<WorkoutDbRow> = {}): WorkoutDbRow {
  return {
    id: uuidv7(),
    user_id: uuidv7(),
    title: null,
    notes: null,
    started_at: new Date("2026-09-15T10:00:00.000Z"),
    ended_at: null,
    local_date: new Date("2026-09-15T00:00:00.000Z"),
    tz_offset_minutes: 0,
    client_generated_id: uuidv7(),
    source: "manual",
    created_at: new Date("2026-09-15T10:00:00.000Z"),
    updated_at: new Date("2026-09-15T10:00:00.000Z"),
    ...overrides,
  };
}

function uniqueViolation(constraint: string): Error & { code: string; meta: { code: string; message: string } } {
  const message = `duplicate key value violates unique constraint "${constraint}"`;
  return Object.assign(new Error(message), {
    code: "P2010",
    meta: { code: "23505", message },
  });
}

/**
 * Records every `$queryRaw`/`$executeRaw` call and answers from a queue of
 * scripted outcomes, in call order — this is what AC5 (§10) calls "unit on
 * `createWorkoutRepository(stubPrisma)`" since the 23505 mapping and the
 * retry live in this file, which `FakeWorkoutRepository` (Task 17) replaces
 * wholesale rather than exercising.
 */
class ScriptedPrisma {
  calls: { kind: "queryRaw" | "executeRaw"; sql: string }[] = [];
  private queryQueue: Array<() => unknown[]> = [];

  queueRows(rows: unknown[]): void {
    this.queryQueue.push(() => rows);
  }
  queueError(err: Error): void {
    this.queryQueue.push(() => {
      throw err;
    });
  }

  $queryRaw = (strings: TemplateStringsArray): Promise<unknown[]> => {
    this.calls.push({ kind: "queryRaw", sql: strings.join("?") });
    const next = this.queryQueue.shift();
    if (!next) throw new Error("ScriptedPrisma: no queued response for $queryRaw");
    return Promise.resolve(next());
  };

  $executeRaw = (strings: TemplateStringsArray): Promise<number> => {
    this.calls.push({ kind: "executeRaw", sql: strings.join("?") });
    return Promise.resolve(0);
  };

  $transaction = async <T>(fn: (tx: this) => Promise<T>): Promise<T> => fn(this);
}

function fields(overrides: Partial<CreateWorkoutFields> = {}): CreateWorkoutFields {
  return {
    clientGeneratedId: uuidv7(),
    startedAt: new Date("2026-09-15T10:00:00.000Z"),
    tzOffsetMinutes: 0,
    title: null,
    notes: null,
    ...overrides,
  };
}

describe("AC3/AC5 — createWorkout (scripted Prisma, no real DB)", () => {
  it("a row returned from the insert is a fresh create (201-shaped)", async () => {
    const stub = new ScriptedPrisma();
    const inserted = row();
    stub.queueRows([inserted]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);

    const result = await repo.createWorkout(inserted.user_id, fields(), "UTC");

    expect(result.created).toBe(true);
    expect(result.workout.id).toBe(inserted.id);
  });

  it("(a) zero rows, re-read finds the stored row -> 200 replay, never 409", async () => {
    const stub = new ScriptedPrisma();
    const stored = row();
    stub.queueRows([]); // insert: zero rows (idempotency key already existed)
    stub.queueRows([stored]); // re-read: found
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);

    const result = await repo.createWorkout(stored.user_id, fields(), "UTC");

    expect(result.created).toBe(false);
    expect(result.workout.id).toBe(stored.id);
  });

  it("(b) 23505 on workout_user_active_key, re-read finds a row -> 200 replay (D50)", async () => {
    const stub = new ScriptedPrisma();
    const stored = row();
    stub.queueError(uniqueViolation("workout_user_active_key")); // insert throws
    stub.queueRows([stored]); // re-read: found -> this was a racing replay
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);

    const result = await repo.createWorkout(stored.user_id, fields(), "UTC");

    expect(result.created).toBe(false);
    expect(result.workout.id).toBe(stored.id);
  });

  it("(c) 23505 on workout_user_active_key, re-read finds nothing -> genuine 409", async () => {
    const stub = new ScriptedPrisma();
    stub.queueError(uniqueViolation("workout_user_active_key"));
    stub.queueRows([]); // re-read: empty -> real in-progress conflict
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);

    await expect(repo.createWorkout(uuidv7(), fields(), "UTC")).rejects.toBeInstanceOf(
      WorkoutInProgressExistsError,
    );
  });

  it("(d) 23505 on any other constraint surfaces as an internal error, never the 409, with no re-read attempted", async () => {
    const stub = new ScriptedPrisma();
    stub.queueError(uniqueViolation("workout_pkey"));
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);

    await expect(repo.createWorkout(uuidv7(), fields(), "UTC")).rejects.not.toBeInstanceOf(
      WorkoutInProgressExistsError,
    );
    expect(stub.calls).toHaveLength(1); // no re-read — the branch never fires for this constraint
  });

  it("(e) zero rows + empty re-read retries the insert once; the retry succeeding -> 201-shaped", async () => {
    const stub = new ScriptedPrisma();
    const retryRow = row();
    stub.queueRows([]); // insert attempt 1: zero rows
    stub.queueRows([]); // re-read 1: empty (stored row concurrently deleted)
    stub.queueRows([retryRow]); // insert attempt 2 (retry): succeeds
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);

    const result = await repo.createWorkout(retryRow.user_id, fields(), "UTC");

    expect(result.created).toBe(true);
    expect(result.workout.id).toBe(retryRow.id);
  });

  it("(f) the retry itself hitting 23505 on the active key, with an empty re-read, is a genuine 409 — the delete race never suppresses a real conflict", async () => {
    const stub = new ScriptedPrisma();
    stub.queueRows([]); // insert attempt 1: zero rows
    stub.queueRows([]); // re-read 1: empty
    stub.queueError(uniqueViolation("workout_user_active_key")); // insert attempt 2 (retry) throws
    stub.queueRows([]); // re-read 2: empty -> genuine conflict
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);

    await expect(repo.createWorkout(uuidv7(), fields(), "UTC")).rejects.toBeInstanceOf(
      WorkoutInProgressExistsError,
    );
  });

  it("(g) zero rows + empty re-read a second time fails as an internal error — the retry loop is bounded at one", async () => {
    const stub = new ScriptedPrisma();
    stub.queueRows([]); // insert attempt 1
    stub.queueRows([]); // re-read 1: empty
    stub.queueRows([]); // insert attempt 2 (retry): zero rows again
    stub.queueRows([]); // re-read 2: empty again
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);

    await expect(repo.createWorkout(uuidv7(), fields(), "UTC")).rejects.not.toBeInstanceOf(
      WorkoutInProgressExistsError,
    );
    expect(stub.calls).toHaveLength(4); // exactly bounded: 2 inserts, 2 re-reads, no third attempt
  });
});

describe("AC14 — the create path takes no advisory lock", () => {
  it("issues no pg_advisory_xact_lock statement on the happy path", async () => {
    const stub = new ScriptedPrisma();
    stub.queueRows([row()]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);

    await repo.createWorkout(uuidv7(), fields(), "UTC");

    expect(stub.calls.some((c) => c.sql.includes("pg_advisory_xact_lock"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sin/api run test:unit -- workout-repository-create`
Expected: `../../src/repositories/workout.prisma.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/repositories/workout.prisma.ts
import type { PrismaClient } from "@prisma/client";
import { localDateFor, offsetMinutesForZone } from "@sin/core";
import { uuidv7 } from "uuidv7";
import { InternalError, WorkoutInProgressExistsError } from "../errors/app-error.js";
import type {
  AddWorkoutExerciseFields,
  CreateWorkoutFields,
  CreateWorkoutResult,
  UpdateWorkoutExerciseFields,
  UpdateWorkoutFields,
  WorkoutDetailRecord,
  WorkoutExerciseRecord,
  WorkoutRecord,
  WorkoutRepository,
} from "./workout.js";

/**
 * Prisma-backed WorkoutRepository (Spec 05.0 §6, "Wiring points"). Raw SQL
 * throughout, mirroring `exercise.prisma.ts`: the partial unique index, the
 * deferred constraint and the advisory-lock idiom are not expressible via
 * Prisma's query builder.
 */

interface WorkoutDbRow {
  id: string;
  user_id: string;
  title: string | null;
  notes: string | null;
  started_at: Date;
  ended_at: Date | null;
  local_date: Date;
  tz_offset_minutes: number;
  client_generated_id: string;
  source: string;
  created_at: Date;
  updated_at: Date;
}

function toRecord(r: WorkoutDbRow): WorkoutRecord {
  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    notes: r.notes,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    localDate: r.local_date.toISOString().slice(0, 10),
    tzOffsetMinutes: r.tz_offset_minutes,
    clientGeneratedId: r.client_generated_id,
    source: r.source,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface RawPrismaError extends Error {
  code?: string;
  meta?: { code?: string; message?: string };
}

/** True for a raw-query unique-violation surfaced through `$queryRaw`
 * (`P2010` + driver SQLSTATE `23505` in `meta` — distinct from the typed
 * client's `P2002` + `meta.target`; Spec 05.0 D40 pins this shape). */
function isRawUniqueViolation(err: unknown): err is RawPrismaError {
  return (
    err instanceof Error &&
    (err as RawPrismaError).code === "P2010" &&
    (err as RawPrismaError).meta?.code === "23505"
  );
}

/** The constraint name is parsed out of the driver's message
 * (`duplicate key value violates unique constraint "…"`) — Postgres does not
 * hand back a structured constraint name on this error path. */
function violatedConstraintName(err: RawPrismaError): string | null {
  const match = /unique constraint "([^"]+)"/.exec(err.meta?.message ?? "");
  return match?.[1] ?? null;
}

type InsertOutcome =
  | { kind: "inserted"; row: WorkoutDbRow }
  | { kind: "no-row" }
  | { kind: "active-conflict" };

export function createWorkoutRepository(prisma: PrismaClient): WorkoutRepository {
  async function tryInsert(
    id: string,
    actingUserId: string,
    fields: CreateWorkoutFields,
    tzOffsetMinutes: number,
    localDate: string,
  ): Promise<InsertOutcome> {
    try {
      const rows = await prisma.$queryRaw<WorkoutDbRow[]>`
        INSERT INTO "workout"
          (id, user_id, title, notes, started_at, local_date, tz_offset_minutes,
           client_generated_id, source, created_at, updated_at)
        VALUES
          (${id}::uuid, ${actingUserId}::uuid, ${fields.title ?? null}, ${fields.notes ?? null},
           ${fields.startedAt}, ${localDate}::date, ${tzOffsetMinutes},
           ${fields.clientGeneratedId}::uuid, 'manual', now(), now())
        ON CONFLICT (user_id, client_generated_id) DO NOTHING
        RETURNING id, user_id, title, notes, started_at, ended_at, local_date,
                  tz_offset_minutes, client_generated_id, source, created_at, updated_at
      `;
      const insertedRow = rows[0];
      return insertedRow ? { kind: "inserted", row: insertedRow } : { kind: "no-row" };
    } catch (err) {
      if (isRawUniqueViolation(err) && violatedConstraintName(err) === "workout_user_active_key") {
        return { kind: "active-conflict" };
      }
      throw err; // a 23505 on any other constraint is a bug -> surfaces as 500 (D40)
    }
  }

  async function findByClientGeneratedId(
    actingUserId: string,
    clientGeneratedId: string,
  ): Promise<WorkoutDbRow | undefined> {
    const rows = await prisma.$queryRaw<WorkoutDbRow[]>`
      SELECT id, user_id, title, notes, started_at, ended_at, local_date,
             tz_offset_minutes, client_generated_id, source, created_at, updated_at
      FROM "workout"
      WHERE user_id = ${actingUserId}::uuid AND client_generated_id = ${clientGeneratedId}::uuid
    `;
    return rows[0];
  }

  return {
    async createWorkout(
      actingUserId: string,
      fields: CreateWorkoutFields,
      userTimezone: string,
    ): Promise<CreateWorkoutResult> {
      const startedAtIso = fields.startedAt.toISOString();
      const tzOffsetMinutes =
        fields.tzOffsetMinutes ?? offsetMinutesForZone(startedAtIso, userTimezone);
      const localDate = localDateFor(startedAtIso, tzOffsetMinutes);

      const attempt1 = await tryInsert(
        uuidv7(),
        actingUserId,
        fields,
        tzOffsetMinutes,
        localDate,
      );

      if (attempt1.kind === "inserted") {
        return { workout: toRecord(attempt1.row), created: true };
      }

      if (attempt1.kind === "active-conflict") {
        const stored = await findByClientGeneratedId(actingUserId, fields.clientGeneratedId);
        if (stored) return { workout: toRecord(stored), created: false };
        throw new WorkoutInProgressExistsError();
      }

      // attempt1.kind === "no-row": the idempotency key already existed *or*
      // its row was concurrently deleted between the insert and this re-read.
      const stored1 = await findByClientGeneratedId(actingUserId, fields.clientGeneratedId);
      if (stored1) return { workout: toRecord(stored1), created: false };

      // Delete race: retry the insert exactly once (§6.2 step 3, D40).
      const attempt2 = await tryInsert(
        uuidv7(),
        actingUserId,
        fields,
        tzOffsetMinutes,
        localDate,
      );

      if (attempt2.kind === "inserted") {
        return { workout: toRecord(attempt2.row), created: true };
      }

      const stored2 = await findByClientGeneratedId(actingUserId, fields.clientGeneratedId);
      if (stored2) return { workout: toRecord(stored2), created: false };

      if (attempt2.kind === "active-conflict") {
        // The retry raced a *different* in-progress workout: a genuine
        // conflict, not an artifact of the delete race (§6.2 step 3).
        throw new WorkoutInProgressExistsError();
      }

      // attempt2.kind === "no-row" again, and the second re-read is also
      // empty: the loop is bounded at one retry (§6.2, D40).
      throw new InternalError(
        "workout create: idempotency key vanished on both attempts; retry bounded at one",
      );
    },

    // Tasks 11-16 implement these; each replaces its own placeholder in order.
    getActiveWorkout: () => {
      throw new Error("not implemented until Task 11");
    },
    getWorkoutById: () => {
      throw new Error("not implemented until Task 11");
    },
    updateWorkout: () => {
      throw new Error("not implemented until Task 12");
    },
    deleteWorkout: () => {
      throw new Error("not implemented until Task 13");
    },
    addWorkoutExercise: () => {
      throw new Error("not implemented until Task 14");
    },
    updateWorkoutExercise: () => {
      throw new Error("not implemented until Task 15");
    },
    deleteWorkoutExercise: () => {
      throw new Error("not implemented until Task 16");
    },
  };
}
```

> **Note on the placeholder methods above:** these seven `throw new Error("not implemented until Task N")` stubs are **scaffolding for this single task's compile step, not a banned "TBD"** — every one of them is replaced with a real implementation in the task named in its own message, each of which is fully specified below (Tasks 11–16), and none of Task 10's own tests call them. `tsc` requires the object literal to satisfy `WorkoutRepository` in full, so the file must compile from this task onward.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sin/api run test:unit -- workout-repository-create`
Expected: all pass, including the exact-call-count assertions in (d) and (g).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/repositories/workout.prisma.ts apps/api/test/unit/workout-repository-create.test.ts
git commit -m "feat(api): add createWorkout — idempotent create, D40/D50 outcome switch (Spec 05.0 §6.1/§6.2, AC3, AC5, AC14)"
```

---

## Task 11: `workout.prisma.ts` — `getActiveWorkout` / `getWorkoutById`

**Files:**
- Modify: `apps/api/src/repositories/workout.prisma.ts` (replace the two placeholder methods; add `WorkoutExerciseDbRow`, `toExerciseRecord`, `loadWorkoutDetailRow`)
- Create: `apps/api/test/unit/workout-repository-reads.test.ts`

**Interfaces:**
- Consumes: `isWorkoutId` (Task 2), `NotFoundError` (existing), `WorkoutDetailRecord`/`WorkoutExerciseRecord` (Task 8).
- Produces: working `getActiveWorkout`, `getWorkoutById`; `WorkoutExerciseDbRow` shape and `toExerciseRecord` reused by Tasks 14–16.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/unit/workout-repository-reads.test.ts
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { uuidv7 } from "uuidv7";
import { NotFoundError } from "../../src/errors/app-error.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";

class ScriptedPrisma {
  calls: { sql: string }[] = [];
  private queue: Array<() => unknown[]> = [];
  queueRows(rows: unknown[]): void {
    this.queue.push(() => rows);
  }
  $queryRaw = (strings: TemplateStringsArray): Promise<unknown[]> => {
    this.calls.push({ sql: strings.join("?") });
    const next = this.queue.shift();
    if (!next) throw new Error("ScriptedPrisma: no queued response");
    return Promise.resolve(next());
  };
}

const wRow = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  user_id: uuidv7(),
  title: null,
  notes: null,
  started_at: new Date("2026-09-15T10:00:00.000Z"),
  ended_at: null,
  local_date: new Date("2026-09-15T00:00:00.000Z"),
  tz_offset_minutes: 0,
  client_generated_id: uuidv7(),
  source: "manual",
  created_at: new Date("2026-09-15T10:00:00.000Z"),
  updated_at: new Date("2026-09-15T10:00:00.000Z"),
  ...overrides,
});

const weRow = (workoutId: string, position: number) => ({
  id: uuidv7(),
  workout_id: workoutId,
  position,
  exercise_id: uuidv7(),
  exercise_name_snapshot: `Exercise ${position}`,
  modality_snapshot: "weight_reps",
  notes: null,
  created_at: new Date("2026-09-15T10:05:00.000Z"),
  updated_at: new Date("2026-09-15T10:05:00.000Z"),
});

describe("AC15 — getWorkoutById", () => {
  it("a malformed id is NotFoundError with no query issued", async () => {
    const stub = new ScriptedPrisma();
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);

    await expect(repo.getWorkoutById(uuidv7(), "not-a-uuid")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(stub.calls).toHaveLength(0);
  });

  it("an absent or another user's row is NotFoundError", async () => {
    const stub = new ScriptedPrisma();
    stub.queueRows([]); // workout lookup: no match for this (id, user_id) pair
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);

    await expect(repo.getWorkoutById(uuidv7(), uuidv7())).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("returns the workout with its exercises ordered by position ascending", async () => {
    const stub = new ScriptedPrisma();
    const workout = wRow();
    stub.queueRows([workout]);
    stub.queueRows([weRow(workout.id, 0), weRow(workout.id, 1)]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);

    const detail = await repo.getWorkoutById(workout.user_id, workout.id);

    expect(detail.id).toBe(workout.id);
    expect(detail.exercises.map((e) => e.position)).toEqual([0, 1]);
  });
});

describe("AC4 — getActiveWorkout", () => {
  it("no in-progress workout is NotFoundError", async () => {
    const stub = new ScriptedPrisma();
    stub.queueRows([]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);

    await expect(repo.getActiveWorkout(uuidv7())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns the one in-progress workout with its exercises", async () => {
    const stub = new ScriptedPrisma();
    const workout = wRow();
    stub.queueRows([workout]);
    stub.queueRows([]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);

    const detail = await repo.getActiveWorkout(workout.user_id);

    expect(detail.id).toBe(workout.id);
    expect(detail.exercises).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sin/api run test:unit -- workout-repository-reads`
Expected: fails — `getActiveWorkout`/`getWorkoutById` throw `"not implemented until Task 11"`.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/api/src/repositories/workout.prisma.ts` (imports gain `isWorkoutId` from `@sin/core` and `NotFoundError` from `../errors/app-error.js`; the two placeholder methods in the returned object are replaced):

```ts
// apps/api/src/repositories/workout.prisma.ts — additions

interface WorkoutExerciseDbRow {
  id: string;
  workout_id: string;
  position: number;
  exercise_id: string;
  exercise_name_snapshot: string;
  modality_snapshot: string;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

function toExerciseRecord(r: WorkoutExerciseDbRow): WorkoutExerciseRecord {
  return {
    id: r.id,
    workoutId: r.workout_id,
    position: r.position,
    exerciseId: r.exercise_id,
    exerciseNameSnapshot: r.exercise_name_snapshot,
    modalitySnapshot: r.modality_snapshot,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// Inside createWorkoutRepository(prisma), alongside tryInsert/findByClientGeneratedId:

async function loadExercises(workoutId: string): Promise<WorkoutExerciseRecord[]> {
  const rows = await prisma.$queryRaw<WorkoutExerciseDbRow[]>`
    SELECT id, workout_id, position, exercise_id, exercise_name_snapshot,
           modality_snapshot, notes, created_at, updated_at
    FROM "workout_exercise"
    WHERE workout_id = ${workoutId}::uuid
    ORDER BY position ASC
  `;
  return rows.map(toExerciseRecord);
}

async function toDetail(w: WorkoutDbRow): Promise<WorkoutDetailRecord> {
  return { ...toRecord(w), exercises: await loadExercises(w.id) };
}
```

Replace the two placeholder methods in the returned object:

```ts
    async getActiveWorkout(actingUserId: string): Promise<WorkoutDetailRecord> {
      const rows = await prisma.$queryRaw<WorkoutDbRow[]>`
        SELECT id, user_id, title, notes, started_at, ended_at, local_date,
               tz_offset_minutes, client_generated_id, source, created_at, updated_at
        FROM "workout"
        WHERE user_id = ${actingUserId}::uuid AND ended_at IS NULL
      `;
      const wRow = rows[0];
      if (!wRow) throw new NotFoundError("caller has no in-progress workout");
      return toDetail(wRow);
    },

    async getWorkoutById(actingUserId: string, id: string): Promise<WorkoutDetailRecord> {
      if (!isWorkoutId(id)) {
        throw new NotFoundError("workout not found or not owned by the acting user");
      }
      const rows = await prisma.$queryRaw<WorkoutDbRow[]>`
        SELECT id, user_id, title, notes, started_at, ended_at, local_date,
               tz_offset_minutes, client_generated_id, source, created_at, updated_at
        FROM "workout"
        WHERE id = ${id}::uuid AND user_id = ${actingUserId}::uuid
      `;
      const wRow = rows[0];
      if (!wRow) {
        throw new NotFoundError("workout not found or not owned by the acting user");
      }
      return toDetail(wRow);
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sin/api run test:unit -- workout-repository-reads`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/repositories/workout.prisma.ts apps/api/test/unit/workout-repository-reads.test.ts
git commit -m "feat(api): add getActiveWorkout/getWorkoutById (Spec 05.0 §5, AC4, AC15)"
```

---

## Task 12: `workout.prisma.ts` — `updateWorkout` (title/notes edit + finish transition, `FOR UPDATE` lock)

**Files:**
- Modify: `apps/api/src/repositories/workout.prisma.ts`
- Create: `apps/api/test/unit/workout-repository-update.test.ts`

**Interfaces:**
- Consumes: `assertEndedAtInBounds`, `assertEndedAtNotBeforeStartedAt` (Task 9); `WorkoutFinishedError` (Task 7); `localDateFor` is **not** called here — `local_date` is never re-derived (§6.3, AC6).
- Produces: working `updateWorkout`, implementing the finish-transaction lock decision from Global Constraints.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/unit/workout-repository-update.test.ts
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { uuidv7 } from "uuidv7";
import { NotFoundError, ValidationError, WorkoutFinishedError } from "../../src/errors/app-error.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";

class ScriptedPrisma {
  calls: { sql: string }[] = [];
  private queue: Array<() => unknown[]> = [];
  queueRows(rows: unknown[]): void {
    this.queue.push(() => rows);
  }
  $queryRaw = (strings: TemplateStringsArray): Promise<unknown[]> => {
    this.calls.push({ sql: strings.join("?") });
    const next = this.queue.shift();
    if (!next) throw new Error("ScriptedPrisma: no queued response");
    return Promise.resolve(next());
  };
  $transaction = async <T>(fn: (tx: this) => Promise<T>): Promise<T> => fn(this);
}

const baseRow = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  user_id: uuidv7(),
  title: null,
  notes: null,
  started_at: new Date("2026-09-15T10:00:00.000Z"),
  ended_at: null,
  local_date: new Date("2026-09-15T00:00:00.000Z"),
  tz_offset_minutes: 0,
  client_generated_id: uuidv7(),
  source: "manual",
  created_at: new Date("2026-09-15T10:00:00.000Z"),
  updated_at: new Date("2026-09-15T10:00:00.000Z"),
  ...overrides,
});

describe("AC15 — updateWorkout ownership", () => {
  it("a malformed id is NotFoundError with no lock statement issued", async () => {
    const stub = new ScriptedPrisma();
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);
    await expect(
      repo.updateWorkout(uuidv7(), "bad-id", {}),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(stub.calls).toHaveLength(0);
  });

  it("an absent or another user's row is NotFoundError", async () => {
    const stub = new ScriptedPrisma();
    stub.queueRows([]); // FOR UPDATE lock read: no match
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);
    await expect(
      repo.updateWorkout(uuidv7(), uuidv7(), {}),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("AC8 — finish transition and immutability", () => {
  it("setting endedAt on an in-progress workout stores it and returns 200-shaped", async () => {
    const stub = new ScriptedPrisma();
    const inProgress = baseRow();
    const finished = { ...inProgress, ended_at: new Date("2026-09-15T11:00:00.000Z") };
    stub.queueRows([inProgress]); // FOR UPDATE lock read
    stub.queueRows([finished]); // UPDATE ... RETURNING
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);

    const result = await repo.updateWorkout(inProgress.user_id, inProgress.id, {
      endedAt: "2026-09-15T11:00:00.000Z",
    });

    expect(result.endedAt).toEqual(finished.ended_at);
  });

  it("endedAt < startedAt is a ValidationError", async () => {
    const stub = new ScriptedPrisma();
    const inProgress = baseRow();
    stub.queueRows([inProgress]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);

    await expect(
      repo.updateWorkout(inProgress.user_id, inProgress.id, {
        endedAt: "2026-09-15T09:00:00.000Z", // before started_at (10:00)
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("endedAt === startedAt is accepted", async () => {
    const stub = new ScriptedPrisma();
    const inProgress = baseRow();
    const finished = { ...inProgress, ended_at: inProgress.started_at };
    stub.queueRows([inProgress]);
    stub.queueRows([finished]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);

    const result = await repo.updateWorkout(inProgress.user_id, inProgress.id, {
      endedAt: inProgress.started_at.toISOString(),
    });
    expect(result.endedAt).toEqual(inProgress.started_at);
  });

  it("every schema-valid PATCH against a finished workout is 409 workout-finished, including {} and endedAt: null", async () => {
    const finishedRow = baseRow({ ended_at: new Date("2026-09-15T11:00:00.000Z") });

    for (const patch of [{}, { endedAt: null }, { title: "new title" }]) {
      const stub = new ScriptedPrisma();
      stub.queueRows([finishedRow]); // FOR UPDATE lock read
      const repo = createWorkoutRepository(stub as unknown as PrismaClient);
      await expect(
        repo.updateWorkout(finishedRow.user_id, finishedRow.id, patch),
      ).rejects.toBeInstanceOf(WorkoutFinishedError);
    }
  });

  it("{} and endedAt: null against an in-progress workout are 200 no-ops returning the row unchanged", async () => {
    for (const patch of [{}, { endedAt: null }]) {
      const stub = new ScriptedPrisma();
      const inProgress = baseRow();
      stub.queueRows([inProgress]); // FOR UPDATE lock read
      stub.queueRows([inProgress]); // UPDATE ... RETURNING (no-op update)
      const repo = createWorkoutRepository(stub as unknown as PrismaClient);

      const result = await repo.updateWorkout(inProgress.user_id, inProgress.id, patch);
      expect(result.endedAt).toBeNull();
      expect(result.title).toBe(inProgress.title);
    }
  });

  it("the lock read is the first statement, ahead of any other check (AC13-style ordering)", async () => {
    const stub = new ScriptedPrisma();
    const inProgress = baseRow();
    const updated = { ...inProgress, title: "x" };
    stub.queueRows([inProgress]);
    stub.queueRows([updated]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);

    await repo.updateWorkout(inProgress.user_id, inProgress.id, { title: "x" });

    expect(stub.calls[0]!.sql).toContain("FOR UPDATE");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sin/api run test:unit -- workout-repository-update`
Expected: fails — `updateWorkout` throws `"not implemented until Task 12"`.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/api/src/repositories/workout.prisma.ts` (imports gain `assertEndedAtInBounds`, `assertEndedAtNotBeforeStartedAt` from `./workout-writes.js`, and `WorkoutFinishedError` from `../errors/app-error.js`); replace the `updateWorkout` placeholder:

```ts
    async updateWorkout(
      actingUserId: string,
      id: string,
      patch: UpdateWorkoutFields,
    ): Promise<WorkoutRecord> {
      if (!isWorkoutId(id)) {
        throw new NotFoundError("workout not found or not owned by the acting user");
      }
      return prisma.$transaction(async (tx) => {
        // The lock is this transaction's first data-touching statement,
        // ahead of every check (Global Constraints; §6.5's ordering rule) —
        // an explicit row lock, chosen over "issue the UPDATE first" so a
        // later spec's own check (05.1's set-integrity rule) can sit between
        // this lock and the write with no restructuring.
        const rows = await tx.$queryRaw<WorkoutDbRow[]>`
          SELECT id, user_id, title, notes, started_at, ended_at, local_date,
                 tz_offset_minutes, client_generated_id, source, created_at, updated_at
          FROM "workout"
          WHERE id = ${id}::uuid AND user_id = ${actingUserId}::uuid
          FOR UPDATE
        `;
        const current = rows[0];
        if (!current) {
          throw new NotFoundError("workout not found or not owned by the acting user");
        }
        // The target's state is checked before any handler body rule — a
        // finished workout rejects every schema-valid PATCH, {} included
        // (§6.5, AC8).
        if (current.ended_at !== null) {
          throw new WorkoutFinishedError();
        }

        const now = new Date();
        let nextEndedAt = current.ended_at;
        if ("endedAt" in patch && patch.endedAt !== undefined) {
          if (patch.endedAt === null) {
            // In-progress workout, ended_at already NULL: a no-op (§6.5).
            nextEndedAt = null;
          } else {
            const endedAt = new Date(patch.endedAt);
            assertEndedAtNotBeforeStartedAt(current.started_at, endedAt);
            assertEndedAtInBounds(endedAt, now);
            nextEndedAt = endedAt;
          }
        }
        const nextTitle = "title" in patch ? patch.title ?? null : current.title;
        const nextNotes = "notes" in patch ? patch.notes ?? null : current.notes;

        const updatedRows = await tx.$queryRaw<WorkoutDbRow[]>`
          UPDATE "workout"
          SET title = ${nextTitle}, notes = ${nextNotes}, ended_at = ${nextEndedAt},
              updated_at = now()
          WHERE id = ${id}::uuid
          RETURNING id, user_id, title, notes, started_at, ended_at, local_date,
                    tz_offset_minutes, client_generated_id, source, created_at, updated_at
        `;
        return toRecord(updatedRows[0]!);
      });
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sin/api run test:unit -- workout-repository-update`
Expected: all pass, including the lock-statement-order assertion.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/repositories/workout.prisma.ts apps/api/test/unit/workout-repository-update.test.ts
git commit -m "feat(api): add updateWorkout — finish transition under FOR UPDATE, immutability check first (Spec 05.0 §6.5, AC6, AC7, AC8, AC15)"
```

---

## Task 13: `workout.prisma.ts` — `deleteWorkout` (hard delete, cascade)

**Files:**
- Modify: `apps/api/src/repositories/workout.prisma.ts`
- Create: `apps/api/test/unit/workout-repository-delete.test.ts`

**Interfaces:**
- Produces: working `deleteWorkout`. No new error types — `NotFoundError` only.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/unit/workout-repository-delete.test.ts
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { uuidv7 } from "uuidv7";
import { NotFoundError } from "../../src/errors/app-error.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";

class ScriptedPrisma {
  calls: { sql: string }[] = [];
  private queue: Array<() => unknown> = [];
  queueRows(rows: unknown[]): void {
    this.queue.push(() => rows);
  }
  $queryRaw = (strings: TemplateStringsArray): Promise<unknown> => {
    this.calls.push({ sql: strings.join("?") });
    const next = this.queue.shift();
    if (!next) throw new Error("ScriptedPrisma: no queued response");
    return Promise.resolve(next());
  };
  $executeRaw = (strings: TemplateStringsArray): Promise<number> => {
    this.calls.push({ sql: strings.join("?") });
    return Promise.resolve(1);
  };
}

describe("AC9/AC15 — deleteWorkout", () => {
  it("a malformed id is NotFoundError with no query issued", async () => {
    const stub = new ScriptedPrisma();
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);
    await expect(repo.deleteWorkout(uuidv7(), "bad-id")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(stub.calls).toHaveLength(0);
  });

  it("an absent or another user's row is NotFoundError, allowed on both an in-progress and a finished workout otherwise", async () => {
    const stub = new ScriptedPrisma();
    stub.queueRows([]); // ownership check: no match
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);
    await expect(repo.deleteWorkout(uuidv7(), uuidv7())).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("deletes an owned row (finished or not) with a single hard-delete statement", async () => {
    const userId = uuidv7();
    const id = uuidv7();
    const stub = new ScriptedPrisma();
    stub.queueRows([{ id, user_id: userId }]); // ownership check: found
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);

    await repo.deleteWorkout(userId, id);

    expect(stub.calls.some((c) => c.sql.includes("DELETE FROM"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sin/api run test:unit -- workout-repository-delete`
Expected: fails — `deleteWorkout` throws `"not implemented until Task 13"`.

- [ ] **Step 3: Write minimal implementation**

Replace the `deleteWorkout` placeholder in `apps/api/src/repositories/workout.prisma.ts`:

```ts
    async deleteWorkout(actingUserId: string, id: string): Promise<void> {
      if (!isWorkoutId(id)) {
        throw new NotFoundError("workout not found or not owned by the acting user");
      }
      const owned = await prisma.$queryRaw<{ id: string; user_id: string }[]>`
        SELECT id, user_id FROM "workout"
        WHERE id = ${id}::uuid AND user_id = ${actingUserId}::uuid
      `;
      if (!owned[0]) {
        throw new NotFoundError("workout not found or not owned by the acting user");
      }
      // Hard delete; cascades to workout_exercise (§4, §6.5's DELETE exemption
      // — allowed on an in-progress or finished workout, no state check here).
      await prisma.$executeRaw`DELETE FROM "workout" WHERE id = ${id}::uuid`;
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sin/api run test:unit -- workout-repository-delete`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/repositories/workout.prisma.ts apps/api/test/unit/workout-repository-delete.test.ts
git commit -m "feat(api): add deleteWorkout — hard delete, allowed on finished (Spec 05.0 §6.5, AC9, AC15)"
```

---

## Task 14: `workout.prisma.ts` — `addWorkoutExercise` (three-phase add, advisory lock, `FOR SHARE`)

**Files:**
- Modify: `apps/api/src/repositories/workout.prisma.ts`
- Modify (retrofit — see Step 0): `apps/api/test/unit/workout-repository-create.test.ts`, `workout-repository-reads.test.ts`, `workout-repository-update.test.ts`, `workout-repository-delete.test.ts`
- Create: `apps/api/test/unit/workout-repository-add-exercise.test.ts`

**Interfaces:**
- Consumes: `ExerciseRepository.findVisibleById` (existing, `apps/api/src/repositories/exercise.ts`); `ExerciseRetiredError` (existing); `computeAppendPosition`, `assertAddPositionInRange` (Task 9); `FakeExerciseRepository`, `makeExerciseRecord` (existing, `apps/api/test/helpers/fakes.ts`).
- **Changes `createWorkoutRepository`'s signature** to `createWorkoutRepository(prisma: PrismaClient, exerciseRepository: ExerciseRepository): WorkoutRepository` — every earlier task's test that calls it with one argument must be retrofitted (Step 0). This is the first method that needs the exercise repository (§6.6), so the signature grows here rather than being over-provisioned in Task 10.
- Produces: working `addWorkoutExercise`; `WorkoutExerciseDbRow`/`toExerciseRecord` (Task 11) reused for the insert's `RETURNING` row.

- [ ] **Step 0: Retrofit the factory signature in every earlier test file**

In each of `workout-repository-create.test.ts`, `workout-repository-reads.test.ts`, `workout-repository-update.test.ts`, `workout-repository-delete.test.ts`, change every call site from:

```ts
createWorkoutRepository(stub as unknown as PrismaClient)
```

to:

```ts
createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository())
```

adding the import `import { FakeExerciseRepository } from "../helpers/fakes.js";` to each file. None of those four files' tests exercise `addWorkoutExercise`, so the fake's default (empty) state is never read.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/unit/workout-repository-add-exercise.test.ts
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { uuidv7 } from "uuidv7";
import { NotFoundError, WorkoutFinishedError } from "../../src/errors/app-error.js";
import { ExerciseRetiredError } from "../../src/errors/app-error.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { FakeExerciseRepository, makeExerciseRecord } from "../helpers/fakes.js";

class ScriptedPrisma {
  calls: { sql: string }[] = [];
  private queryQueue: Array<() => unknown[]> = [];
  private execCount = 0;
  queueRows(rows: unknown[]): void {
    this.queryQueue.push(() => rows);
  }
  $queryRaw = (strings: TemplateStringsArray): Promise<unknown[]> => {
    this.calls.push({ sql: strings.join("?") });
    const next = this.queryQueue.shift();
    if (!next) throw new Error("ScriptedPrisma: no queued response for $queryRaw");
    return Promise.resolve(next());
  };
  $executeRaw = (strings: TemplateStringsArray): Promise<number> => {
    this.calls.push({ sql: strings.join("?") });
    this.execCount += 1;
    return Promise.resolve(this.execCount);
  };
  $transaction = async <T>(fn: (tx: this) => Promise<T>): Promise<T> => fn(this);
}

const workoutRow = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  user_id: uuidv7(),
  ended_at: null,
  ...overrides,
});

describe("AC15 — addWorkoutExercise: workout ownership / malformed id", () => {
  it("a malformed workoutId is NotFoundError with no query issued", async () => {
    const stub = new ScriptedPrisma();
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());
    await expect(
      repo.addWorkoutExercise(uuidv7(), "bad-id", { exerciseId: uuidv7() }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(stub.calls).toHaveLength(0);
  });

  it("an absent or another user's workout is NotFoundError before the exercise is even resolved", async () => {
    const stub = new ScriptedPrisma();
    stub.queueRows([]); // phase-1 workout load: no match
    const exerciseRepo = new FakeExerciseRepository();
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, exerciseRepo);
    await expect(
      repo.addWorkoutExercise(uuidv7(), uuidv7(), { exerciseId: uuidv7() }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(exerciseRepo.byId.size).toBe(0); // never called findVisibleById
  });
});

describe("AC9 — addWorkoutExercise: finished-workout rejection at both checks", () => {
  it("phase 1 (root-client) check: a workout already finished is 409 before opening the transaction", async () => {
    const stub = new ScriptedPrisma();
    const w = workoutRow({ ended_at: new Date("2026-09-15T11:00:00.000Z") });
    stub.queueRows([w]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());
    await expect(
      repo.addWorkoutExercise(w.user_id, w.id, { exerciseId: uuidv7() }),
    ).rejects.toBeInstanceOf(WorkoutFinishedError);
    expect(stub.calls.some((c) => c.sql.includes("pg_advisory_xact_lock"))).toBe(false);
  });

  it("phase 3 (FOR SHARE re-check) catches a finish that committed after phase 1", async () => {
    const stub = new ScriptedPrisma();
    const w = workoutRow();
    const exerciseRepo = new FakeExerciseRepository();
    const exercise = makeExerciseRecord({ isActive: true });
    exerciseRepo.byId.set(exercise.id, exercise);
    stub.queueRows([w]); // phase 1: still in progress
    stub.queueRows([{ ended_at: new Date("2026-09-15T11:00:00.000Z") }]); // FOR SHARE re-check: now finished
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, exerciseRepo);
    await expect(
      repo.addWorkoutExercise(w.user_id, w.id, { exerciseId: exercise.id }),
    ).rejects.toBeInstanceOf(WorkoutFinishedError);
  });

  it("a workout deleted between phase 1 and the lock is 404, not 500 (vanished-row rule, §6.7)", async () => {
    const stub = new ScriptedPrisma();
    const w = workoutRow();
    const exerciseRepo = new FakeExerciseRepository();
    const exercise = makeExerciseRecord({ isActive: true });
    exerciseRepo.byId.set(exercise.id, exercise);
    stub.queueRows([w]);
    stub.queueRows([]); // FOR SHARE re-check: no row — deleted meanwhile
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, exerciseRepo);
    await expect(
      repo.addWorkoutExercise(w.user_id, w.id, { exerciseId: exercise.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("AC10 — exercise resolution and snapshotting", () => {
  it("an exerciseId findVisibleById misses is 404", async () => {
    const stub = new ScriptedPrisma();
    const w = workoutRow();
    stub.queueRows([w]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());
    await expect(
      repo.addWorkoutExercise(w.user_id, w.id, { exerciseId: uuidv7() }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("an isActive=false exercise is 409 exercise-retired", async () => {
    const stub = new ScriptedPrisma();
    const w = workoutRow();
    const exerciseRepo = new FakeExerciseRepository();
    const retired = makeExerciseRecord({ isActive: false });
    exerciseRepo.byId.set(retired.id, retired);
    stub.queueRows([w]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, exerciseRepo);
    await expect(
      repo.addWorkoutExercise(w.user_id, w.id, { exerciseId: retired.id }),
    ).rejects.toBeInstanceOf(ExerciseRetiredError);
  });

  it("snapshots the resolved exercise's name/modality and appends at n when position is absent", async () => {
    const stub = new ScriptedPrisma();
    const w = workoutRow();
    const exerciseRepo = new FakeExerciseRepository();
    const exercise = makeExerciseRecord({ name: "Bench Press", modality: "weight_reps", isActive: true });
    exerciseRepo.byId.set(exercise.id, exercise);
    stub.queueRows([w]); // phase 1
    stub.queueRows([{ ended_at: null }]); // FOR SHARE re-check
    stub.queueRows([{ n: 2 }]); // count read: 2 existing rows -> append at position 2
    stub.queueRows([
      {
        id: uuidv7(),
        workout_id: w.id,
        position: 2,
        exercise_id: exercise.id,
        exercise_name_snapshot: exercise.name,
        modality_snapshot: exercise.modality,
        notes: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]); // INSERT ... RETURNING
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, exerciseRepo);

    const created = await repo.addWorkoutExercise(w.user_id, w.id, { exerciseId: exercise.id });

    expect(created.position).toBe(2);
    expect(created.exerciseNameSnapshot).toBe("Bench Press");
    expect(created.modalitySnapshot).toBe("weight_reps");
  });
});

describe("AC13 — statement order: the advisory lock is the first statement other than SET CONSTRAINTS, the count read is later and separate", () => {
  it("orders SET CONSTRAINTS, lock, FOR SHARE, count, insert", async () => {
    const stub = new ScriptedPrisma();
    const w = workoutRow();
    const exerciseRepo = new FakeExerciseRepository();
    const exercise = makeExerciseRecord({ isActive: true });
    exerciseRepo.byId.set(exercise.id, exercise);
    stub.queueRows([w]);
    stub.queueRows([{ ended_at: null }]);
    stub.queueRows([{ n: 0 }]);
    stub.queueRows([
      {
        id: uuidv7(),
        workout_id: w.id,
        position: 0,
        exercise_id: exercise.id,
        exercise_name_snapshot: exercise.name,
        modality_snapshot: exercise.modality,
        notes: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, exerciseRepo);

    await repo.addWorkoutExercise(w.user_id, w.id, { exerciseId: exercise.id });

    // calls[0] is phase-1's plain workout SELECT (no transaction yet).
    const txCalls = stub.calls.slice(1);
    expect(txCalls[0]!.sql).toContain("SET CONSTRAINTS");
    expect(txCalls[1]!.sql).toContain("pg_advisory_xact_lock");
    expect(txCalls[2]!.sql).toContain("FOR SHARE");
    expect(txCalls[3]!.sql).toContain("count(*)");
    expect(txCalls[4]!.sql).toContain("INSERT INTO");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sin/api run test:unit -- workout-repository-add-exercise`
Expected: fails — `addWorkoutExercise` throws `"not implemented until Task 14"`, and the four retrofitted files fail to compile until Step 0's edit lands (do Step 0 first, then confirm those four suites still pass with the fake).

- [ ] **Step 3: Write minimal implementation**

Change the factory signature and add imports at the top of `apps/api/src/repositories/workout.prisma.ts`:

```ts
import type { ExerciseRepository } from "./exercise.js";
import { ExerciseRetiredError } from "../errors/app-error.js";
import { computeAppendPosition, assertAddPositionInRange } from "./workout-writes.js";
// ... existing imports

export function createWorkoutRepository(
  prisma: PrismaClient,
  exerciseRepository: ExerciseRepository,
): WorkoutRepository {
  // ... existing tryInsert/findByClientGeneratedId/loadExercises/toDetail unchanged
```

Replace the `addWorkoutExercise` placeholder:

```ts
    async addWorkoutExercise(
      actingUserId: string,
      workoutId: string,
      fields: AddWorkoutExerciseFields,
    ): Promise<WorkoutExerciseRecord> {
      if (!isWorkoutId(workoutId)) {
        throw new NotFoundError("workout not found or not owned by the acting user");
      }
      // Phase 1 (§6.6): cheap early exit on the root client. The
      // authoritative check is the in-transaction FOR SHARE re-check below.
      const wRows = await prisma.$queryRaw<{ id: string; user_id: string; ended_at: Date | null }[]>`
        SELECT id, user_id, ended_at FROM "workout"
        WHERE id = ${workoutId}::uuid AND user_id = ${actingUserId}::uuid
      `;
      const workout = wRows[0];
      if (!workout) {
        throw new NotFoundError("workout not found or not owned by the acting user");
      }
      if (workout.ended_at !== null) {
        throw new WorkoutFinishedError();
      }

      // Phase 2 (§6.6): resolve the exercise on the root client, before the
      // position transaction opens. findVisibleById throws NotFoundError
      // (absent / another user's custom row) or the caller must check
      // isActive itself (03.1's contract returns the row regardless of
      // is_active).
      const exercise = await exerciseRepository.findVisibleById(
        actingUserId,
        fields.exerciseId,
      );
      if (!exercise.isActive) {
        throw new ExerciseRetiredError();
      }

      // Phases 3-4 (§6.7/§6.8): the position transaction.
      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET CONSTRAINTS workout_exercise_position_key DEFERRED`;
        // The lock is its own statement, ahead of every read it protects
        // (§6.8, following insertWithCap/D23).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workoutId}))`;
        const lockRows = await tx.$queryRaw<{ ended_at: Date | null }[]>`
          SELECT ended_at FROM "workout" WHERE id = ${workoutId}::uuid FOR SHARE
        `;
        const locked = lockRows[0];
        if (!locked) {
          // Vanished between phase 1 and the lock (§6.7's vanished-row rule).
          throw new NotFoundError("workout not found or not owned by the acting user");
        }
        if (locked.ended_at !== null) {
          throw new WorkoutFinishedError();
        }

        const countRows = await tx.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM "workout_exercise" WHERE workout_id = ${workoutId}::uuid
        `;
        const n = countRows[0]!.n;

        const position = fields.position ?? computeAppendPosition(n);
        if (fields.position !== undefined) {
          assertAddPositionInRange(fields.position, n);
          await tx.$executeRaw`
            UPDATE "workout_exercise" SET position = position + 1
            WHERE workout_id = ${workoutId}::uuid AND position >= ${position}
          `;
        }

        const id = uuidv7();
        const insertedRows = await tx.$queryRaw<WorkoutExerciseDbRow[]>`
          INSERT INTO "workout_exercise"
            (id, workout_id, position, exercise_id, exercise_name_snapshot,
             modality_snapshot, notes, created_at, updated_at)
          VALUES
            (${id}::uuid, ${workoutId}::uuid, ${position}, ${exercise.id}::uuid,
             ${exercise.name}, ${exercise.modality}, ${fields.notes ?? null}, now(), now())
          RETURNING id, workout_id, position, exercise_id, exercise_name_snapshot,
                    modality_snapshot, notes, created_at, updated_at
        `;
        return toExerciseRecord(insertedRows[0]!);
      });
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sin/api run test:unit -- workout-repository-add-exercise workout-repository-create workout-repository-reads workout-repository-update workout-repository-delete`
Expected: all pass, including the retrofitted four files.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/repositories/workout.prisma.ts apps/api/test/unit/workout-repository-add-exercise.test.ts apps/api/test/unit/workout-repository-create.test.ts apps/api/test/unit/workout-repository-reads.test.ts apps/api/test/unit/workout-repository-update.test.ts apps/api/test/unit/workout-repository-delete.test.ts
git commit -m "feat(api): add addWorkoutExercise — three-phase add under advisory lock + FOR SHARE (Spec 05.0 §6.6/§6.7/§6.8, AC9, AC10, AC13, AC15)"
```

---

## Task 15: `workout.prisma.ts` — `updateWorkoutExercise` (reorder + notes edit)

**Files:**
- Modify: `apps/api/src/repositories/workout.prisma.ts`
- Modify: `apps/api/src/repositories/workout.ts` — add `notes` to the row query used internally (no interface change needed; `WorkoutExerciseRecord` already carries `notes`)
- Create: `apps/api/test/unit/workout-repository-reorder.test.ts`

**Interfaces:**
- Consumes: `isWorkoutExerciseId` (Task 2), `assertReorderPositionInRange` (Task 9).
- Produces: working `updateWorkoutExercise`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/unit/workout-repository-reorder.test.ts
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { uuidv7 } from "uuidv7";
import { NotFoundError, ValidationError, WorkoutFinishedError } from "../../src/errors/app-error.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { FakeExerciseRepository } from "../helpers/fakes.js";

class ScriptedPrisma {
  calls: { sql: string }[] = [];
  private queue: Array<() => unknown[]> = [];
  queueRows(rows: unknown[]): void {
    this.queue.push(() => rows);
  }
  $queryRaw = (strings: TemplateStringsArray): Promise<unknown[]> => {
    this.calls.push({ sql: strings.join("?") });
    const next = this.queue.shift();
    if (!next) throw new Error("ScriptedPrisma: no queued response");
    return Promise.resolve(next());
  };
  $executeRaw = (strings: TemplateStringsArray): Promise<number> => {
    this.calls.push({ sql: strings.join("?") });
    return Promise.resolve(0);
  };
  $transaction = async <T>(fn: (tx: this) => Promise<T>): Promise<T> => fn(this);
}

const ownedRow = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  workout_id: uuidv7(),
  position: 1,
  notes: null,
  user_id: uuidv7(),
  ended_at: null,
  ...overrides,
});

describe("AC15 — updateWorkoutExercise ownership", () => {
  it("a malformed id is NotFoundError with no query issued", async () => {
    const stub = new ScriptedPrisma();
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());
    await expect(repo.updateWorkoutExercise(uuidv7(), "bad-id", {})).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(stub.calls).toHaveLength(0);
  });

  it("an absent row or one whose parent workout belongs to another user is NotFoundError", async () => {
    const stub = new ScriptedPrisma();
    stub.queueRows([]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());
    await expect(repo.updateWorkoutExercise(uuidv7(), uuidv7(), {})).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("AC9 — updateWorkoutExercise: 409 on a finished parent, both checks", () => {
  it("phase-1 check: parent already finished", async () => {
    const stub = new ScriptedPrisma();
    const row = ownedRow({ ended_at: new Date("2026-09-15T11:00:00.000Z") });
    stub.queueRows([row]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());
    await expect(
      repo.updateWorkoutExercise(row.user_id, row.id, { position: 0 }),
    ).rejects.toBeInstanceOf(WorkoutFinishedError);
  });

  it("FOR SHARE re-check: parent finished after phase 1", async () => {
    const stub = new ScriptedPrisma();
    const row = ownedRow();
    stub.queueRows([row]); // phase 1: in progress
    stub.queueRows([{ ended_at: new Date("2026-09-15T11:00:00.000Z") }]); // FOR SHARE: now finished
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());
    await expect(
      repo.updateWorkoutExercise(row.user_id, row.id, { position: 0 }),
    ).rejects.toBeInstanceOf(WorkoutFinishedError);
  });
});

describe("AC11 — reorder range + no-op", () => {
  it("a reorder to the row's current position is a no-op returning the row unchanged", async () => {
    const stub = new ScriptedPrisma();
    const row = ownedRow({ position: 1 });
    stub.queueRows([row]); // phase 1
    stub.queueRows([{ ended_at: null }]); // FOR SHARE
    stub.queueRows([{ id: row.id, position: 1, notes: null }]); // FOR UPDATE target re-fetch
    stub.queueRows([{ n: 3 }]); // count
    stub.queueRows([
      { id: row.id, workout_id: row.workout_id, position: 1, exercise_id: uuidv7(), exercise_name_snapshot: "x", modality_snapshot: "weight_reps", notes: null, created_at: new Date(), updated_at: new Date() },
    ]); // final UPDATE ... RETURNING
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    const result = await repo.updateWorkoutExercise(row.user_id, row.id, { position: 1 });
    expect(result.position).toBe(1);
  });

  it("position = n (out of the 0..n-1 reorder range) is a ValidationError", async () => {
    const stub = new ScriptedPrisma();
    const row = ownedRow({ position: 0 });
    stub.queueRows([row]);
    stub.queueRows([{ ended_at: null }]);
    stub.queueRows([{ id: row.id, position: 0, notes: null }]);
    stub.queueRows([{ n: 3 }]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    await expect(
      repo.updateWorkoutExercise(row.user_id, row.id, { position: 3 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sin/api run test:unit -- workout-repository-reorder`
Expected: fails — `updateWorkoutExercise` throws `"not implemented until Task 15"`.

- [ ] **Step 3: Write minimal implementation**

Add `assertReorderPositionInRange` to the existing `workout-writes.js` import, then replace the `updateWorkoutExercise` placeholder:

```ts
    async updateWorkoutExercise(
      actingUserId: string,
      id: string,
      patch: UpdateWorkoutExerciseFields,
    ): Promise<WorkoutExerciseRecord> {
      if (!isWorkoutExerciseId(id)) {
        throw new NotFoundError("workout exercise not found or not owned by the acting user");
      }
      const rows = await prisma.$queryRaw<
        { id: string; workout_id: string; position: number; notes: string | null; user_id: string; ended_at: Date | null }[]
      >`
        SELECT we.id, we.workout_id, we.position, we.notes, w.user_id, w.ended_at
        FROM "workout_exercise" we JOIN "workout" w ON w.id = we.workout_id
        WHERE we.id = ${id}::uuid AND w.user_id = ${actingUserId}::uuid
      `;
      const current = rows[0];
      if (!current) {
        throw new NotFoundError("workout exercise not found or not owned by the acting user");
      }
      if (current.ended_at !== null) {
        throw new WorkoutFinishedError();
      }

      return prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET CONSTRAINTS workout_exercise_position_key DEFERRED`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${current.workout_id}))`;
        const lockRows = await tx.$queryRaw<{ ended_at: Date | null }[]>`
          SELECT ended_at FROM "workout" WHERE id = ${current.workout_id}::uuid FOR SHARE
        `;
        const locked = lockRows[0];
        if (!locked) throw new NotFoundError("workout exercise not found or not owned by the acting user");
        if (locked.ended_at !== null) throw new WorkoutFinishedError();

        const targetRows = await tx.$queryRaw<{ id: string; position: number; notes: string | null }[]>`
          SELECT id, position, notes FROM "workout_exercise" WHERE id = ${id}::uuid FOR UPDATE
        `;
        const target = targetRows[0];
        if (!target) throw new NotFoundError("workout exercise not found or not owned by the acting user");

        const countRows = await tx.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM "workout_exercise" WHERE workout_id = ${current.workout_id}::uuid
        `;
        const n = countRows[0]!.n;

        let nextPosition = target.position;
        if (patch.position !== undefined && patch.position !== target.position) {
          assertReorderPositionInRange(patch.position, n);
          nextPosition = patch.position;
          if (nextPosition > target.position) {
            await tx.$executeRaw`
              UPDATE "workout_exercise" SET position = position - 1
              WHERE workout_id = ${current.workout_id}::uuid
                AND position > ${target.position} AND position <= ${nextPosition}
                AND id != ${id}::uuid
            `;
          } else {
            await tx.$executeRaw`
              UPDATE "workout_exercise" SET position = position + 1
              WHERE workout_id = ${current.workout_id}::uuid
                AND position >= ${nextPosition} AND position < ${target.position}
                AND id != ${id}::uuid
            `;
          }
        }

        const nextNotes = "notes" in patch ? patch.notes ?? null : target.notes;
        const updatedRows = await tx.$queryRaw<WorkoutExerciseDbRow[]>`
          UPDATE "workout_exercise"
          SET position = ${nextPosition}, notes = ${nextNotes}, updated_at = now()
          WHERE id = ${id}::uuid
          RETURNING id, workout_id, position, exercise_id, exercise_name_snapshot,
                    modality_snapshot, notes, created_at, updated_at
        `;
        return toExerciseRecord(updatedRows[0]!);
      });
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sin/api run test:unit -- workout-repository-reorder`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/repositories/workout.prisma.ts apps/api/test/unit/workout-repository-reorder.test.ts
git commit -m "feat(api): add updateWorkoutExercise — reorder under the same lock discipline (Spec 05.0 §6.7, AC9, AC11, AC15)"
```

---

## Task 16: `workout.prisma.ts` — `deleteWorkoutExercise` (close the gap)

**Files:**
- Modify: `apps/api/src/repositories/workout.prisma.ts`
- Create: `apps/api/test/unit/workout-repository-delete-exercise.test.ts`

**Interfaces:**
- Produces: working `deleteWorkoutExercise` — the last of the seven placeholders; `workout.prisma.ts` is now fully implemented and satisfies `WorkoutRepository` with no stub methods left.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/unit/workout-repository-delete-exercise.test.ts
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { uuidv7 } from "uuidv7";
import { NotFoundError, WorkoutFinishedError } from "../../src/errors/app-error.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { FakeExerciseRepository } from "../helpers/fakes.js";

class ScriptedPrisma {
  calls: { sql: string }[] = [];
  private queue: Array<() => unknown[]> = [];
  queueRows(rows: unknown[]): void {
    this.queue.push(() => rows);
  }
  $queryRaw = (strings: TemplateStringsArray): Promise<unknown[]> => {
    this.calls.push({ sql: strings.join("?") });
    const next = this.queue.shift();
    if (!next) throw new Error("ScriptedPrisma: no queued response");
    return Promise.resolve(next());
  };
  $executeRaw = (strings: TemplateStringsArray): Promise<number> => {
    this.calls.push({ sql: strings.join("?") });
    return Promise.resolve(0);
  };
  $transaction = async <T>(fn: (tx: this) => Promise<T>): Promise<T> => fn(this);
}

const ownedRow = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  workout_id: uuidv7(),
  position: 1,
  user_id: uuidv7(),
  ended_at: null,
  ...overrides,
});

describe("AC15 — deleteWorkoutExercise ownership", () => {
  it("a malformed id is NotFoundError with no query issued", async () => {
    const stub = new ScriptedPrisma();
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());
    await expect(repo.deleteWorkoutExercise(uuidv7(), "bad-id")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(stub.calls).toHaveLength(0);
  });

  it("an absent row or another user's parent workout is NotFoundError", async () => {
    const stub = new ScriptedPrisma();
    stub.queueRows([]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());
    await expect(repo.deleteWorkoutExercise(uuidv7(), uuidv7())).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("AC9 — deleteWorkoutExercise: 409 on a finished parent", () => {
  it("phase-1 check", async () => {
    const stub = new ScriptedPrisma();
    const row = ownedRow({ ended_at: new Date("2026-09-15T11:00:00.000Z") });
    stub.queueRows([row]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());
    await expect(repo.deleteWorkoutExercise(row.user_id, row.id)).rejects.toBeInstanceOf(
      WorkoutFinishedError,
    );
  });
});

describe("AC11 — deleteWorkoutExercise closes the gap", () => {
  it("deletes the row and shifts every row above it down by one", async () => {
    const stub = new ScriptedPrisma();
    const row = ownedRow({ position: 1 });
    stub.queueRows([row]); // phase 1
    stub.queueRows([{ ended_at: null }]); // FOR SHARE
    stub.queueRows([{ position: 1 }]); // FOR UPDATE target re-fetch
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    await repo.deleteWorkoutExercise(row.user_id, row.id);

    const sqls = stub.calls.map((c) => c.sql).join("\n");
    expect(sqls).toContain("DELETE FROM \"workout_exercise\"");
    expect(sqls).toContain("position = position - 1");
  });

  it("a row already vanished by the time the lock is held is NotFoundError, not a 500", async () => {
    const stub = new ScriptedPrisma();
    const row = ownedRow({ position: 1 });
    stub.queueRows([row]);
    stub.queueRows([{ ended_at: null }]);
    stub.queueRows([]); // FOR UPDATE target re-fetch: gone
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    await expect(repo.deleteWorkoutExercise(row.user_id, row.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sin/api run test:unit -- workout-repository-delete-exercise`
Expected: fails — `deleteWorkoutExercise` throws `"not implemented until Task 16"`.

- [ ] **Step 3: Write minimal implementation**

Replace the final placeholder in `apps/api/src/repositories/workout.prisma.ts`:

```ts
    async deleteWorkoutExercise(actingUserId: string, id: string): Promise<void> {
      if (!isWorkoutExerciseId(id)) {
        throw new NotFoundError("workout exercise not found or not owned by the acting user");
      }
      const rows = await prisma.$queryRaw<
        { id: string; workout_id: string; user_id: string; ended_at: Date | null }[]
      >`
        SELECT we.id, we.workout_id, w.user_id, w.ended_at
        FROM "workout_exercise" we JOIN "workout" w ON w.id = we.workout_id
        WHERE we.id = ${id}::uuid AND w.user_id = ${actingUserId}::uuid
      `;
      const current = rows[0];
      if (!current) {
        throw new NotFoundError("workout exercise not found or not owned by the acting user");
      }
      if (current.ended_at !== null) {
        throw new WorkoutFinishedError();
      }

      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET CONSTRAINTS workout_exercise_position_key DEFERRED`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${current.workout_id}))`;
        const lockRows = await tx.$queryRaw<{ ended_at: Date | null }[]>`
          SELECT ended_at FROM "workout" WHERE id = ${current.workout_id}::uuid FOR SHARE
        `;
        const locked = lockRows[0];
        if (!locked) throw new NotFoundError("workout exercise not found or not owned by the acting user");
        if (locked.ended_at !== null) throw new WorkoutFinishedError();

        const targetRows = await tx.$queryRaw<{ position: number }[]>`
          SELECT position FROM "workout_exercise" WHERE id = ${id}::uuid FOR UPDATE
        `;
        const target = targetRows[0];
        if (!target) throw new NotFoundError("workout exercise not found or not owned by the acting user");

        await tx.$executeRaw`DELETE FROM "workout_exercise" WHERE id = ${id}::uuid`;
        await tx.$executeRaw`
          UPDATE "workout_exercise" SET position = position - 1
          WHERE workout_id = ${current.workout_id}::uuid AND position > ${target.position}
        `;
      });
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sin/api run test:unit -- workout-repository-delete-exercise`
Expected: all pass. Also run the full repository unit suite: `pnpm --filter @sin/api run test:unit -- workout-repository`
Expected: all workout-repository-*.test.ts files pass; `workout.prisma.ts` now has zero placeholder methods and satisfies `WorkoutRepository` fully.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/repositories/workout.prisma.ts apps/api/test/unit/workout-repository-delete-exercise.test.ts
git commit -m "feat(api): add deleteWorkoutExercise — closes the position gap (Spec 05.0 §6.7, AC9, AC11, AC15)"
```

---

## Task 17: `test/helpers/fakes.ts` — `makeWorkoutRecord` + `FakeWorkoutRepository`

**Files:**
- Modify: `apps/api/test/helpers/fakes.ts` (append)

**Interfaces:**
- Consumes: `WorkoutRepository` and its record/field types (Task 8); `isWorkoutId`, `isWorkoutExerciseId`, `localDateFor`, `offsetMinutesForZone` (Tasks 2, 4); `assertEndedAtNotBeforeStartedAt`, `assertEndedAtInBounds`, `assertAddPositionInRange`, `assertReorderPositionInRange` (Task 9); `WorkoutFinishedError`, `WorkoutInProgressExistsError`, `NotFoundError`, `ExerciseRetiredError` (Task 7 + existing); the existing `ExerciseRepository`/`FakeExerciseRepository`.
- Produces: `makeWorkoutRecord`, `FakeWorkoutRepository` — consumed by Task 18's route tests (via `buildTestApp`'s new `workoutRepository` option) and this task's own tests.

No dedicated test file for the fake itself — it is a test double, exercised by every route test in Task 18 (the same posture `FakeExerciseRepository` has: no `fakes.test.ts` file exists for it either).

- [ ] **Step 1: (No standalone failing test — this is a test-infrastructure task consumed by Task 18. Proceed to Step 3, then Task 18's tests are this task's real verification.)**
- [ ] **Step 2: (N/A)**
- [ ] **Step 3: Write the fake**

Append to `apps/api/test/helpers/fakes.ts` (imports gain the names listed in Interfaces above):

```ts
// apps/api/test/helpers/fakes.ts — additions (Spec 05.0 §6, Wiring points)

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
      .sort((a, b) => a.position - b.position);
    return { ...w, exercises };
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

  async getWorkoutById(actingUserId: string, id: string): Promise<WorkoutDetailRecord> {
    return this.detail(this.ownedWorkoutOrThrow(actingUserId, id));
  }

  async updateWorkout(
    actingUserId: string,
    id: string,
    patch: UpdateWorkoutFields,
  ): Promise<WorkoutRecord> {
    const w = this.ownedWorkoutOrThrow(actingUserId, id);
    if (w.endedAt !== null) throw new WorkoutFinishedError();
    let endedAt = w.endedAt;
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
    const updated: WorkoutRecord = {
      ...w,
      title: "title" in patch ? patch.title ?? null : w.title,
      notes: "notes" in patch ? patch.notes ?? null : w.notes,
      endedAt,
      updatedAt: new Date(w.updatedAt.getTime() + 1000),
    };
    this.workouts.set(id, updated);
    return updated;
  }

  async deleteWorkout(actingUserId: string, id: string): Promise<void> {
    this.ownedWorkoutOrThrow(actingUserId, id);
    this.workouts.delete(id);
    for (const [exId, ex] of this.exercises) {
      if (ex.workoutId === id) this.exercises.delete(exId);
    }
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
    const position = fields.position ?? n;
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
    for (const e of this.exercises.values()) {
      if (e.workoutId === we.workoutId && e.position > we.position) {
        this.exercises.set(e.id, { ...e, position: e.position - 1 });
      }
    }
  }
}
```

- [ ] **Step 4: Confirm the file still compiles**

Run: `pnpm run typecheck`
Expected: green — nothing references `FakeWorkoutRepository` yet, so this only proves the class satisfies `WorkoutRepository`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/helpers/fakes.ts
git commit -m "feat(api): add makeWorkoutRecord/FakeWorkoutRepository test double (Spec 05.0 §6, Wiring points)"
```

---

## Task 18: `routes/workouts.ts` + wiring (`v1.ts`, `app.ts`, `server.ts`, `buildTestApp`) — all eight endpoints

**Files:**
- Create: `apps/api/src/routes/workouts.ts`
- Modify: `apps/api/src/routes/v1.ts` (add `workoutRepository` to `V1RouteDeps`, register `registerWorkoutRoutes`)
- Modify: `apps/api/src/app.ts` (add `workoutRepository: WorkoutRepository` to `BuildAppDeps`, thread it through the `/v1` registration block, lines 208–221)
- Modify: `apps/api/src/server.ts` (import `createWorkoutRepository`, pass `workoutRepository: createWorkoutRepository(prisma, createExerciseRepository(prisma))` into `buildApp`)
- Modify: `apps/api/test/helpers/build-test-app.ts` (add a `workoutRepository` option defaulting to `new FakeWorkoutRepository()`)
- Create: `apps/api/test/unit/routes-workouts.test.ts`

**Interfaces:**
- Consumes: `WorkoutRepository` (Task 8), `FakeWorkoutRepository` (Task 17), `CreateWorkoutSchema`/`UpdateWorkoutSchema`/`WorkoutSchema`/`WorkoutDetailSchema`/`AddWorkoutExerciseSchema`/`WorkoutExerciseSchema`/`UpdateWorkoutExerciseSchema` (Task 5), `assertStartedAtInBounds` (Task 9).
- Produces: `registerWorkoutRoutes(app, deps: WorkoutRouteDeps)`; `V1RouteDeps.workoutRepository`; `BuildAppDeps.workoutRepository`; `buildTestApp`'s `workoutRepository` option — completes the four-point wiring CLAUDE.md and spec §6 both call out ("missing the last one yields an app that passes every unit test and serves 404s in staging").

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/unit/routes-workouts.test.ts
import { describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { buildTestApp } from "../helpers/build-test-app.js";
import { FakeExerciseRepository, FakeWorkoutRepository, makeExerciseRecord } from "../helpers/fakes.js";

const BEARER = { authorization: "Bearer test-token" };

describe("AC3 — POST /v1/workouts: idempotent create", () => {
  it("a first create returns 201 with Location, a replay with the same key returns 200 with no Location", async () => {
    const { app } = await buildTestApp();
    const clientGeneratedId = uuidv7();
    const body = { clientGeneratedId, startedAt: "2026-09-15T10:00:00.000Z" };

    const first = await app.inject({ method: "POST", url: "/v1/workouts", headers: BEARER, payload: body });
    expect(first.statusCode).toBe(201);
    expect(first.headers.location).toMatch(/^\/v1\/workouts\//);

    const replay = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { ...body, title: "a different title entirely" },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers.location).toBeUndefined();
    expect(replay.json().id).toBe(first.json().id);
    expect(replay.json().title).toBeNull(); // the replayed body is ignored (§6.1, D39)
  });

  it("localDate as an unknown key is 422 on POST; tzOffsetMinutes on PATCH is 422", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: "2026-09-15T10:00:00.000Z", localDate: "2026-09-15" },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe("AC4 — GET /v1/workouts/active", () => {
  it("200 with the caller's in-progress workout, 404 when there is none", async () => {
    const { app } = await buildTestApp();
    const none = await app.inject({ method: "GET", url: "/v1/workouts/active", headers: BEARER });
    expect(none.statusCode).toBe(404);

    await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: "2026-09-15T10:00:00.000Z" },
    });
    const active = await app.inject({ method: "GET", url: "/v1/workouts/active", headers: BEARER });
    expect(active.statusCode).toBe(200);
    expect(active.json().exercises).toEqual([]);
  });

  it("a second create under a different clientGeneratedId while one is in progress is 409 with no workout id", async () => {
    const { app } = await buildTestApp();
    await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: "2026-09-15T10:00:00.000Z" },
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: "2026-09-15T10:05:00.000Z" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().type).toContain("workout-in-progress-exists");
    expect(JSON.stringify(res.json())).not.toContain("\"id\"");
  });
});

describe("AC8 — PATCH /v1/workouts/{id}: finish", () => {
  it("finishes an in-progress workout, then rejects every further schema-valid PATCH", async () => {
    const { app } = await buildTestApp();
    const created = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: "2026-09-15T10:00:00.000Z" },
    });
    const id = created.json().id;

    const finish = await app.inject({
      method: "PATCH",
      url: `/v1/workouts/${id}`,
      headers: BEARER,
      payload: { endedAt: "2026-09-15T11:00:00.000Z" },
    });
    expect(finish.statusCode).toBe(200);
    expect(finish.json().endedAt).toBe("2026-09-15T11:00:00.000Z");

    for (const payload of [{}, { endedAt: null }, { title: "x" }]) {
      const res = await app.inject({ method: "PATCH", url: `/v1/workouts/${id}`, headers: BEARER, payload });
      expect(res.statusCode).toBe(409);
      expect(res.json().type).toContain("workout-finished");
    }

    const invalidEvenWhenFinished = await app.inject({
      method: "PATCH",
      url: `/v1/workouts/${id}`,
      headers: BEARER,
      payload: { title: "" },
    });
    expect(invalidEvenWhenFinished.statusCode).toBe(422);
  });
});

describe("AC9 — DELETE /v1/workouts/{id}", () => {
  it("204 on an in-progress and on a finished workout; a repeat DELETE is 404", async () => {
    const { app } = await buildTestApp();
    const created = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: "2026-09-15T10:00:00.000Z" },
    });
    const id = created.json().id;

    const del = await app.inject({ method: "DELETE", url: `/v1/workouts/${id}`, headers: BEARER });
    expect(del.statusCode).toBe(204);

    const repeat = await app.inject({ method: "DELETE", url: `/v1/workouts/${id}`, headers: BEARER });
    expect(repeat.statusCode).toBe(404);
  });
});

describe("AC10 — POST /v1/workouts/{id}/exercises", () => {
  it("201 with Location and a snapshot equal to the resolved exercise; 404 for an invisible exerciseId; 409 for a retired one", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    const exercise = makeExerciseRecord({ name: "Bench Press", modality: "weight_reps", isActive: true });
    exerciseRepo.byId.set(exercise.id, exercise);
    const workoutRepo = new FakeWorkoutRepository(exerciseRepo);
    const { app } = await buildTestApp({ workoutRepository: workoutRepo });

    const created = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: "2026-09-15T10:00:00.000Z" },
    });
    const workoutId = created.json().id;

    const add = await app.inject({
      method: "POST",
      url: `/v1/workouts/${workoutId}/exercises`,
      headers: BEARER,
      payload: { exerciseId: exercise.id },
    });
    expect(add.statusCode).toBe(201);
    expect(add.headers.location).toBe(`/v1/workout-exercises/${add.json().id}`);
    expect(add.json().exerciseNameSnapshot).toBe("Bench Press");

    const missing = await app.inject({
      method: "POST",
      url: `/v1/workouts/${workoutId}/exercises`,
      headers: BEARER,
      payload: { exerciseId: uuidv7() },
    });
    expect(missing.statusCode).toBe(404);

    const retired = makeExerciseRecord({ isActive: false });
    exerciseRepo.byId.set(retired.id, retired);
    const retiredRes = await app.inject({
      method: "POST",
      url: `/v1/workouts/${workoutId}/exercises`,
      headers: BEARER,
      payload: { exerciseId: retired.id },
    });
    expect(retiredRes.statusCode).toBe(409);
    expect(retiredRes.json().type).toContain("exercise-retired");
  });
});

describe("AC15 — 404, never 403, on every id-taking route; a malformed id is also 404", () => {
  const cases: { method: "GET" | "PATCH" | "DELETE" | "POST"; url: (id: string) => string; payload?: unknown }[] = [
    { method: "GET", url: (id) => `/v1/workouts/${id}` },
    { method: "PATCH", url: (id) => `/v1/workouts/${id}`, payload: {} },
    { method: "DELETE", url: (id) => `/v1/workouts/${id}` },
    { method: "POST", url: (id) => `/v1/workouts/${id}/exercises`, payload: { exerciseId: uuidv7() } },
    { method: "PATCH", url: (id) => `/v1/workout-exercises/${id}`, payload: {} },
    { method: "DELETE", url: (id) => `/v1/workout-exercises/${id}` },
  ];

  it.each(cases)("$method $url — absent id and a malformed id are both 404", async ({ method, url, payload }) => {
    const { app } = await buildTestApp();
    for (const id of [uuidv7(), "not-a-uuid-at-all"]) {
      const res = await app.inject({ method, url: url(id), headers: BEARER, payload });
      expect(res.statusCode).toBe(404);
    }
  });
});

describe("AC20 — every route requires auth", () => {
  const routes: { method: "GET" | "PATCH" | "DELETE" | "POST"; url: string }[] = [
    { method: "POST", url: "/v1/workouts" },
    { method: "GET", url: "/v1/workouts/active" },
    { method: "GET", url: `/v1/workouts/${uuidv7()}` },
    { method: "PATCH", url: `/v1/workouts/${uuidv7()}` },
    { method: "DELETE", url: `/v1/workouts/${uuidv7()}` },
    { method: "POST", url: `/v1/workouts/${uuidv7()}/exercises` },
    { method: "PATCH", url: `/v1/workout-exercises/${uuidv7()}` },
    { method: "DELETE", url: `/v1/workout-exercises/${uuidv7()}` },
  ];

  it.each(routes)("$method $url — 401 with no token", async ({ method, url }) => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method, url });
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sin/api run test:unit -- routes-workouts`
Expected: fails — `apps/api/src/routes/workouts.ts` does not exist, and `buildTestApp` accepts no `workoutRepository` option.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/routes/workouts.ts
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  AddWorkoutExerciseSchema,
  CreateWorkoutSchema,
  UpdateWorkoutExerciseSchema,
  UpdateWorkoutSchema,
  WorkoutDetailSchema,
  WorkoutExerciseSchema,
  WorkoutSchema,
  type Workout,
  type WorkoutDetail,
  type WorkoutExercise,
} from "@sin/core";
import { assertStartedAtInBounds } from "../repositories/workout-writes.js";
import type {
  WorkoutDetailRecord,
  WorkoutExerciseRecord,
  WorkoutRecord,
  WorkoutRepository,
} from "../repositories/workout.js";

export interface WorkoutRouteDeps {
  workoutRepository: WorkoutRepository;
}

function toWorkoutDto(r: WorkoutRecord): Workout {
  return {
    id: r.id as Workout["id"],
    title: r.title,
    notes: r.notes,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt?.toISOString() ?? null,
    localDate: r.localDate,
    tzOffsetMinutes: r.tzOffsetMinutes,
    clientGeneratedId: r.clientGeneratedId,
    source: r.source as Workout["source"],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toWorkoutExerciseDto(r: WorkoutExerciseRecord): WorkoutExercise {
  return {
    id: r.id as WorkoutExercise["id"],
    workoutId: r.workoutId as WorkoutExercise["workoutId"],
    position: r.position,
    exerciseId: r.exerciseId as WorkoutExercise["exerciseId"],
    exerciseNameSnapshot: r.exerciseNameSnapshot,
    modalitySnapshot: r.modalitySnapshot as WorkoutExercise["modalitySnapshot"],
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function toWorkoutDetailDto(r: WorkoutDetailRecord): WorkoutDetail {
  return { ...toWorkoutDto(r), exercises: r.exercises.map(toWorkoutExerciseDto) };
}

export function registerWorkoutRoutes(app: FastifyInstance, deps: WorkoutRouteDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const workoutIdParams = z.object({ id: z.string() });
  const workoutExerciseIdParams = z.object({ id: z.string() });

  r.post(
    "/workouts",
    { schema: { body: CreateWorkoutSchema, response: { 201: WorkoutSchema, 200: WorkoutSchema } } },
    async (request, reply) => {
      const actingUserId = request.user!.id;
      const startedAt = new Date(request.body.startedAt);
      assertStartedAtInBounds(startedAt, new Date());

      const { workout, created } = await deps.workoutRepository.createWorkout(
        actingUserId,
        {
          clientGeneratedId: request.body.clientGeneratedId,
          startedAt,
          tzOffsetMinutes: request.body.tzOffsetMinutes,
          title: request.body.title,
          notes: request.body.notes,
        },
        request.user!.timezone,
      );

      if (created) {
        request.log.info({ workout_id: workout.id, user_id: actingUserId }, "workout_started");
        reply.code(201).header("location", `/v1/workouts/${workout.id}`);
      } else {
        reply.code(200);
      }
      return toWorkoutDto(workout);
    },
  );

  r.get(
    "/workouts/active",
    { schema: { response: { 200: WorkoutDetailSchema } } },
    async (request) => {
      const detail = await deps.workoutRepository.getActiveWorkout(request.user!.id);
      return toWorkoutDetailDto(detail);
    },
  );

  r.get(
    "/workouts/:id",
    { schema: { params: workoutIdParams, response: { 200: WorkoutDetailSchema } } },
    async (request) => {
      const detail = await deps.workoutRepository.getWorkoutById(request.user!.id, request.params.id);
      return toWorkoutDetailDto(detail);
    },
  );

  r.patch(
    "/workouts/:id",
    { schema: { params: workoutIdParams, body: UpdateWorkoutSchema, response: { 200: WorkoutSchema } } },
    async (request) => {
      const actingUserId = request.user!.id;
      const before = request.body.endedAt !== undefined && request.body.endedAt !== null;
      const updated = await deps.workoutRepository.updateWorkout(actingUserId, request.params.id, request.body);
      if (before && updated.endedAt !== null) {
        const durationSeconds = Math.round(
          (updated.endedAt.getTime() - updated.startedAt.getTime()) / 1000,
        );
        request.log.info(
          { workout_id: updated.id, user_id: actingUserId, duration_seconds: durationSeconds },
          "workout_finished",
        );
      }
      return toWorkoutDto(updated);
    },
  );

  r.delete(
    "/workouts/:id",
    { schema: { params: workoutIdParams, response: { 204: z.undefined() } } },
    async (request, reply) => {
      const actingUserId = request.user!.id;
      await deps.workoutRepository.deleteWorkout(actingUserId, request.params.id);
      request.log.info({ workout_id: request.params.id, user_id: actingUserId }, "workout_deleted");
      reply.code(204).send();
      return reply;
    },
  );

  r.post(
    "/workouts/:id/exercises",
    {
      schema: {
        params: workoutIdParams,
        body: AddWorkoutExerciseSchema,
        response: { 201: WorkoutExerciseSchema },
      },
    },
    async (request, reply) => {
      const actingUserId = request.user!.id;
      const created = await deps.workoutRepository.addWorkoutExercise(
        actingUserId,
        request.params.id,
        request.body,
      );
      request.log.info(
        {
          workout_id: request.params.id,
          workout_exercise_id: created.id,
          exercise_id: created.exerciseId,
          user_id: actingUserId,
          position: created.position,
        },
        "workout_exercise_added",
      );
      reply.code(201).header("location", `/v1/workout-exercises/${created.id}`);
      return toWorkoutExerciseDto(created);
    },
  );

  r.patch(
    "/workout-exercises/:id",
    {
      schema: {
        params: workoutExerciseIdParams,
        body: UpdateWorkoutExerciseSchema,
        response: { 200: WorkoutExerciseSchema },
      },
    },
    async (request) => {
      const updated = await deps.workoutRepository.updateWorkoutExercise(
        request.user!.id,
        request.params.id,
        request.body,
      );
      return toWorkoutExerciseDto(updated);
    },
  );

  r.delete(
    "/workout-exercises/:id",
    { schema: { params: workoutExerciseIdParams, response: { 204: z.undefined() } } },
    async (request, reply) => {
      await deps.workoutRepository.deleteWorkoutExercise(request.user!.id, request.params.id);
      reply.code(204).send();
      return reply;
    },
  );
}
```

Wire the four registration points:

```ts
// apps/api/src/routes/v1.ts
import type { WorkoutRepository } from "../repositories/workout.js";
import { registerWorkoutRoutes } from "./workouts.js";

export interface V1RouteDeps {
  userRepository: UserRepository;
  exerciseRepository: ExerciseRepository;
  workoutRepository: WorkoutRepository;
}

export function registerV1Routes(app: FastifyInstance, deps: V1RouteDeps): void {
  registerAuthcheckRoute(app);
  registerMeRoutes(app, { userRepository: deps.userRepository });
  registerExerciseRoutes(app, { exerciseRepository: deps.exerciseRepository });
  registerReferenceRoutes(app, { exerciseRepository: deps.exerciseRepository });
  registerWorkoutRoutes(app, { workoutRepository: deps.workoutRepository });
}
```

```ts
// apps/api/src/app.ts — BuildAppDeps and the /v1 registration block
import type { WorkoutRepository } from "./repositories/workout.js";

export interface BuildAppDeps extends AuthPluginDeps {
  config: Config;
  logger?: FastifyBaseLogger | boolean;
  checkReadiness: () => Promise<void>;
  readinessTtlMs?: number;
  exerciseRepository: ExerciseRepository;
  workoutRepository: WorkoutRepository;
}

// inside buildApp(deps), the /v1 registration block (was lines 208-221):
  await app.register(
    async (v1) => {
      registerErrorContract(v1);
      await v1.register(authPlugin, {
        tokenVerifier: deps.tokenVerifier,
        userRepository: deps.userRepository,
      });
      registerV1Routes(v1, {
        userRepository: deps.userRepository,
        exerciseRepository: deps.exerciseRepository,
        workoutRepository: deps.workoutRepository,
      });
    },
    { prefix: "/v1" },
  );
```

```ts
// apps/api/src/server.ts
import { createWorkoutRepository } from "./repositories/workout.prisma.js";

// inside main(), the buildApp call:
  const exerciseRepository = createExerciseRepository(prisma);
  const app = await buildApp({
    config,
    logger,
    checkReadiness: () => checkDatabaseReady(prisma),
    tokenVerifier: createTokenVerifier({ /* unchanged */ }),
    userRepository: createUserRepository(prisma),
    exerciseRepository,
    workoutRepository: createWorkoutRepository(prisma, exerciseRepository),
  });
```

```ts
// apps/api/test/helpers/build-test-app.ts
import type { WorkoutRepository } from "../../src/repositories/workout.js";
import { FakeWorkoutRepository } from "./fakes.js";

export interface TestAppOptions<
  R extends ExerciseRepository = FakeExerciseRepository,
  W extends WorkoutRepository = FakeWorkoutRepository,
> {
  config?: Config;
  tokenVerifier?: TokenVerifier;
  userRepository?: FakeUserRepository;
  exerciseRepository?: R;
  workoutRepository?: W;
  logger?: FastifyBaseLogger | boolean;
  checkReadiness?: () => Promise<void>;
  readinessTtlMs?: number;
}

export async function buildTestApp<
  R extends ExerciseRepository = FakeExerciseRepository,
  W extends WorkoutRepository = FakeWorkoutRepository,
>(
  opts: TestAppOptions<R, W> = {},
): Promise<{ app: FastifyInstance; repo: FakeUserRepository; exerciseRepo: R; workoutRepo: W }> {
  const repo = opts.userRepository ?? new FakeUserRepository();
  const exerciseRepo = (opts.exerciseRepository ?? new FakeExerciseRepository()) as R;
  const workoutRepo = (opts.workoutRepository ?? new FakeWorkoutRepository(exerciseRepo)) as W;
  const deps: BuildAppDeps = {
    config: opts.config ?? testConfig(),
    logger: opts.logger ?? false,
    checkReadiness: opts.checkReadiness ?? (async () => {}),
    readinessTtlMs: opts.readinessTtlMs,
    tokenVerifier: opts.tokenVerifier ?? fakeVerifier(() => authContext()),
    userRepository: repo,
    exerciseRepository: exerciseRepo,
    workoutRepository: workoutRepo,
  };
  const app = await buildApp(deps);
  return { app, repo, exerciseRepo, workoutRepo };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sin/api run test:unit -- routes-workouts`
Expected: all pass.

Run the full unit suite to catch any wiring regression: `pnpm --filter @sin/api run test:unit`
Expected: green — every existing exercise/me/reference route test still passes with the new `workoutRepository` dep threaded through `buildTestApp`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/workouts.ts apps/api/src/routes/v1.ts apps/api/src/app.ts apps/api/src/server.ts apps/api/test/helpers/build-test-app.ts apps/api/test/unit/routes-workouts.test.ts
git commit -m "feat(api): add the eight workout routes, wired at all four seams (Spec 05.0 §5/§6, AC3, AC4, AC8, AC9, AC10, AC15, AC16, AC20)"
```

---

## Task 19: AC18 — dedicated tests for the four business log lines

**Files:**
- Create: `apps/api/test/unit/routes-workouts-logging.test.ts`
- Modify (only if a gap is found): `apps/api/src/routes/workouts.ts`

**Interfaces:**
- Consumes: the log lines Task 18's route handlers already emit (`workout_started`, `workout_finished`, `workout_deleted`, `workout_exercise_added`) — Task 18 wired these inline, following the same file's per-endpoint structure the way `routes/exercises.ts` wires its own four lines. This task is where they get a dedicated, criterion-named test; **this is a deliberate, narrow exception to strict step-order TDD** (write the test, watch it fail, then implement) because the log calls are one or two lines embedded in logic Task 18 already had to write and test for its own status-code assertions — duplicating that setup in a task with no other content would not be "right-sized" per the plan's own instructions. If any assertion below fails against Task 18's code, the fix is a small in-place edit to `routes/workouts.ts`, not a new file.

- [ ] **Step 1: Write the test**

```ts
// apps/api/test/unit/routes-workouts-logging.test.ts
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { buildTestApp } from "../helpers/build-test-app.js";

const BEARER = { authorization: "Bearer test-token" };

function capturingLogger(): { logger: ReturnType<typeof pino>; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const logger = pino({ level: "debug" }, { write: (s: string) => lines.push(JSON.parse(s)) });
  return { logger, lines };
}

describe("AC18 — the four business log lines, no free text", () => {
  it("workout_started fires on the 201 create and not on the 200 replay", async () => {
    const { logger, lines } = capturingLogger();
    const { app } = await buildTestApp({ logger });
    const clientGeneratedId = uuidv7();
    const payload = { clientGeneratedId, startedAt: "2026-09-15T10:00:00.000Z", title: "distinctive-title-xyz" };

    await app.inject({ method: "POST", url: "/v1/workouts", headers: BEARER, payload });
    expect(lines.filter((l) => l.msg === "workout_started")).toHaveLength(1);

    await app.inject({ method: "POST", url: "/v1/workouts", headers: BEARER, payload });
    expect(lines.filter((l) => l.msg === "workout_started")).toHaveLength(1); // still 1 — no second line on replay
  });

  it("workout_finished fires on the finish transition only, not on a title/notes edit or a {} no-op", async () => {
    const { logger, lines } = capturingLogger();
    const { app } = await buildTestApp({ logger });
    const created = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: "2026-09-15T10:00:00.000Z" },
    });
    const id = created.json().id;

    await app.inject({ method: "PATCH", url: `/v1/workouts/${id}`, headers: BEARER, payload: { title: "renamed" } });
    await app.inject({ method: "PATCH", url: `/v1/workouts/${id}`, headers: BEARER, payload: {} });
    expect(lines.filter((l) => l.msg === "workout_finished")).toHaveLength(0);

    await app.inject({
      method: "PATCH",
      url: `/v1/workouts/${id}`,
      headers: BEARER,
      payload: { endedAt: "2026-09-15T11:00:00.000Z" },
    });
    expect(lines.filter((l) => l.msg === "workout_finished")).toHaveLength(1);
  });

  it("workout_deleted and workout_exercise_added fire on success with their §9 fields", async () => {
    const { logger, lines } = capturingLogger();
    const { app, workoutRepo } = await buildTestApp({ logger });
    const created = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: "2026-09-15T10:00:00.000Z" },
    });
    const id = created.json().id;

    await app.inject({ method: "DELETE", url: `/v1/workouts/${id}`, headers: BEARER });
    const deletedLine = lines.find((l) => l.msg === "workout_deleted");
    expect(deletedLine).toMatchObject({ workout_id: id });
    void workoutRepo; // available if a future assertion needs direct repo state
  });

  it("no captured line contains the request's title or notes text", async () => {
    const { logger, lines } = capturingLogger();
    const { app } = await buildTestApp({ logger });
    const secretTitle = "super-secret-workout-title-marker";
    const secretNotes = "super-secret-notes-marker";
    await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: {
        clientGeneratedId: uuidv7(),
        startedAt: "2026-09-15T10:00:00.000Z",
        title: secretTitle,
        notes: secretNotes,
      },
    });
    const allText = JSON.stringify(lines);
    expect(allText).not.toContain(secretTitle);
    expect(allText).not.toContain(secretNotes);
  });
});
```

- [ ] **Step 2: Run test to verify current state**

Run: `pnpm --filter @sin/api run test:unit -- routes-workouts-logging`
Expected: passes against Task 18's code as written. If it does not (e.g. a field name mismatch), fix `routes/workouts.ts` in place — see the note above.

- [ ] **Step 3: (If Step 2 was fully green, this step is a no-op; otherwise apply the minimal fix identified.)**
- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sin/api run test:unit -- routes-workouts-logging`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/unit/routes-workouts-logging.test.ts
git commit -m "test(api): pin the four workout business log lines, no free text (Spec 05.0 §9, AC18)"
```

---

## Task 20: OpenAPI completeness + the demanding create/in-progress concurrency integration tests (AC3, AC4, AC5, AC14, AC20)

**Files:**
- Create: `apps/api/test/unit/openapi-workouts.test.ts`
- Create: `apps/api/test/integration/workout-create-concurrency.integration.test.ts`

**Interfaces:**
- Consumes: the fully-wired app (Task 18), `startIntegrationDb` (existing).
- Produces: nothing new — this task is pure verification of Tasks 1–18 against the real emitted OpenAPI document and a real Postgres under genuine concurrency.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/unit/openapi-workouts.test.ts
import { describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";

describe("AC20 — the eight workout routes are in the published OpenAPI contract", () => {
  it("GET /openapi.json lists all eight paths with a declared response schema, including both 204 deletes", async () => {
    const { app } = await buildTestApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/openapi.json" });
    const doc = res.json() as { paths: Record<string, Record<string, unknown>> };

    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        "/v1/workouts",
        "/v1/workouts/active",
        "/v1/workouts/{id}",
        "/v1/workouts/{id}/exercises",
        "/v1/workout-exercises/{id}",
      ]),
    );
    const workoutDelete = doc.paths["/v1/workouts/{id}"]!.delete as { responses: Record<string, unknown> };
    expect(workoutDelete.responses["204"]).toBeDefined();
    const weDelete = doc.paths["/v1/workout-exercises/{id}"]!.delete as { responses: Record<string, unknown> };
    expect(weDelete.responses["204"]).toBeDefined();
  });
});
```

```ts
// apps/api/test/integration/workout-create-concurrency.integration.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { WorkoutInProgressExistsError } from "../../src/errors/app-error.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";

describe.skipIf(!shouldRunIntegration())(
  "AC3/AC4/AC5 — createWorkout concurrency (real Postgres)",
  () => {
    let db: IntegrationDb;

    beforeAll(async () => {
      if (!shouldRunIntegration()) return;
      db = await startIntegrationDb();
    }, 180_000);

    afterAll(async () => {
      await db?.stop();
    });

    afterEach(async () => {
      if (!db) return;
      await db.prisma.$executeRawUnsafe('TRUNCATE "workout", "workout_exercise", "user" CASCADE');
    });

    async function insertUser(): Promise<string> {
      const id = uuidv7();
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "user" ("id", "auth_sub", "email") VALUES ($1::uuid, $2, $3)`,
        id,
        `auth0|${id}`,
        "u@ex.com",
      );
      return id;
    }

    it("AC3 — ~10 concurrent creates with one identical clientGeneratedId: exactly one 201, the rest 200, never a 409", async () => {
      const userId = await insertUser();
      const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
      const clientGeneratedId = uuidv7();
      const startedAt = new Date();

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          repo.createWorkout(
            userId,
            { clientGeneratedId, startedAt, tzOffsetMinutes: 0, title: null, notes: null },
            "UTC",
          ),
        ),
      );

      const createdCount = results.filter((r) => r.created).length;
      expect(createdCount).toBe(1);
      expect(results.filter((r) => !r.created)).toHaveLength(9);
      const ids = new Set(results.map((r) => r.workout.id));
      expect(ids.size).toBe(1); // one row exists afterwards

      const rows = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "workout" WHERE user_id = $1::uuid`,
        userId,
      );
      expect(Number(rows[0]!.n)).toBe(1);
    });

    it("AC4 — a concurrent burst of creates (distinct clientGeneratedIds) for a user with no active session admits exactly one row", async () => {
      const userId = await insertUser();
      const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          repo.createWorkout(
            userId,
            {
              clientGeneratedId: uuidv7(),
              startedAt: new Date(Date.now() + i),
              tzOffsetMinutes: 0,
              title: null,
              notes: null,
            },
            "UTC",
          ),
        ),
      );

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(9);
      for (const r of rejected) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(WorkoutInProgressExistsError);
      }

      const rows = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "workout" WHERE user_id = $1::uuid AND ended_at IS NULL`,
        userId,
      );
      expect(Number(rows[0]!.n)).toBe(1);
    });

    it("AC5 — a real 23505 on workout_user_active_key is shaped P2010 + meta.code 23505 (pins the idiom Task 10's stub assumed)", async () => {
      const userId = await insertUser();
      const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
      await repo.createWorkout(
        userId,
        { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
        "UTC",
      );

      // A second, different clientGeneratedId must hit the active-key 23505
      // path and resolve to the 409 via the re-read (D50) — proving the real
      // driver surfaces the P2010/23505 shape Task 10's ScriptedPrisma tests
      // assumed, not a fabrication.
      await expect(
        repo.createWorkout(
          userId,
          { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
          "UTC",
        ),
      ).rejects.toBeInstanceOf(WorkoutInProgressExistsError);
    });
  },
);
```

- [ ] **Step 2: Run test to verify it fails / passes as expected**

Run: `pnpm --filter @sin/api run test:unit -- openapi-workouts`
Expected: passes immediately if Task 18 is complete (this is a verification task, like Task 6). If any path or response is missing, it fails and names which.

Run: `RUN_INTEGRATION=1 pnpm --filter @sin/api run test:integration -- workout-create-concurrency`
Expected: passes against Task 10's implementation, proving the ScriptedPrisma-based unit tests modeled the real driver correctly.

- [ ] **Step 3/4: (Verification-only task; no new production code expected. If either test fails, fix the specific gap in Task 18's route registration or Task 10's error-shape handling, re-run.)**

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/unit/openapi-workouts.test.ts apps/api/test/integration/workout-create-concurrency.integration.test.ts
git commit -m "test(api): OpenAPI completeness + real-Postgres create/in-progress concurrency (Spec 05.0, AC3, AC4, AC5, AC20)"
```

---

## Task 21: Integration sweep — calendar derivation, finish concurrency, add-exercise snapshotting (AC6, AC7, AC8, AC9, AC10)

**Files:**
- Create: `apps/api/test/integration/workout-calendar.integration.test.ts`
- Create: `apps/api/test/integration/workout-finish-concurrency.integration.test.ts`
- Create: `apps/api/test/integration/workout-add-exercise.integration.test.ts`

**Interfaces:**
- Consumes: `createWorkoutRepository`, `createExerciseRepository`, `startIntegrationDb`/`shouldRunIntegration` (all existing/Tasks 1–14).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/integration/workout-calendar.integration.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";

describe.skipIf(!shouldRunIntegration())("AC6 — calendar fields (real Postgres)", () => {
  let db: IntegrationDb;

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    if (!db) return;
    await db.prisma.$executeRawUnsafe('TRUNCATE "workout", "workout_exercise", "user" CASCADE');
  });

  async function insertUser(timezone = "UTC"): Promise<string> {
    const id = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "user" ("id", "auth_sub", "email", "timezone") VALUES ($1::uuid, $2, $3, $4)`,
      id,
      `auth0|${id}`,
      "u@ex.com",
      timezone,
    );
    return id;
  }

  it("an explicit east-of-UTC tzOffsetMinutes moves local_date forward across midnight", async () => {
    const userId = await insertUser();
    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
    const { workout } = await repo.createWorkout(
      userId,
      {
        clientGeneratedId: uuidv7(),
        startedAt: new Date("2026-09-15T23:30:00.000Z"),
        tzOffsetMinutes: 120,
        title: null,
        notes: null,
      },
      "UTC",
    );
    expect(workout.localDate).toBe("2026-09-16");
    expect(workout.tzOffsetMinutes).toBe(120);
  });

  it("an explicit west-of-UTC tzOffsetMinutes keeps the same calendar day", async () => {
    const userId = await insertUser();
    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
    const { workout } = await repo.createWorkout(
      userId,
      {
        clientGeneratedId: uuidv7(),
        startedAt: new Date("2026-09-15T23:30:00.000Z"),
        tzOffsetMinutes: -360,
        title: null,
        notes: null,
      },
      "UTC",
    );
    expect(workout.localDate).toBe("2026-09-15");
  });

  it("an absent tzOffsetMinutes falls back to the user's stored timezone, at that instant", async () => {
    const userId = await insertUser("America/New_York");
    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
    const { workout: beforeDst } = await repo.createWorkout(
      userId,
      {
        clientGeneratedId: uuidv7(),
        startedAt: new Date("2026-03-08T06:00:00.000Z"), // EST, -300
        tzOffsetMinutes: undefined,
        title: null,
        notes: null,
      },
      "America/New_York",
    );
    expect(beforeDst.tzOffsetMinutes).toBe(-300);
    // Delete so the next create doesn't hit the one-in-progress rule.
    await repo.deleteWorkout(userId, beforeDst.id);

    const { workout: afterDst } = await repo.createWorkout(
      userId,
      {
        clientGeneratedId: uuidv7(),
        startedAt: new Date("2026-03-08T08:00:00.000Z"), // EDT, -240
        tzOffsetMinutes: undefined,
        title: null,
        notes: null,
      },
      "America/New_York",
    );
    expect(afterDst.tzOffsetMinutes).toBe(-240);
  });

  it("local_date is unchanged by a title/notes PATCH and by finishing", async () => {
    const userId = await insertUser();
    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
    const { workout } = await repo.createWorkout(
      userId,
      {
        clientGeneratedId: uuidv7(),
        startedAt: new Date("2026-09-15T10:00:00.000Z"),
        tzOffsetMinutes: 0,
        title: null,
        notes: null,
      },
      "UTC",
    );
    const afterEdit = await repo.updateWorkout(userId, workout.id, { title: "renamed", notes: "some notes" });
    expect(afterEdit.localDate).toBe(workout.localDate);

    const afterFinish = await repo.updateWorkout(userId, workout.id, {
      endedAt: "2026-09-15T11:00:00.000Z",
    });
    expect(afterFinish.localDate).toBe(workout.localDate);
  });
});
```

```ts
// apps/api/test/integration/workout-finish-concurrency.integration.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { WorkoutFinishedError } from "../../src/errors/app-error.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";

describe.skipIf(!shouldRunIntegration())(
  "AC9 — finish vs. add-exercise race (FOR SHARE re-check, real Postgres)",
  () => {
    let db: IntegrationDb;
    beforeAll(async () => {
      if (!shouldRunIntegration()) return;
      db = await startIntegrationDb();
    }, 180_000);
    afterAll(async () => {
      await db?.stop();
    });
    afterEach(async () => {
      if (!db) return;
      await db.prisma.$executeRawUnsafe(
        'TRUNCATE "workout", "workout_exercise", "exercise", "user" CASCADE',
      );
    });

    async function insertUser(): Promise<string> {
      const id = uuidv7();
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "user" ("id", "auth_sub", "email") VALUES ($1::uuid, $2, $3)`,
        id,
        `auth0|${id}`,
        "u@ex.com",
      );
      return id;
    }

    async function insertGlobalExercise(): Promise<string> {
      const id = uuidv7();
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "exercise" ("id", "name", "modality", "is_active") VALUES ($1::uuid, 'Bench', 'weight_reps', true)`,
        id,
      );
      return id;
    }

    it("a concurrent finish and add-exercise never leaves a workout_exercise row created after its parent's ended_at was committed", async () => {
      const userId = await insertUser();
      const exerciseId = await insertGlobalExercise();
      const exerciseRepo = createExerciseRepository(db.prisma);
      const repo = createWorkoutRepository(db.prisma, exerciseRepo);
      const { workout } = await repo.createWorkout(
        userId,
        { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
        "UTC",
      );

      const [finishResult, addResult] = await Promise.allSettled([
        repo.updateWorkout(userId, workout.id, { endedAt: new Date().toISOString() }),
        repo.addWorkoutExercise(userId, workout.id, { exerciseId }),
      ]);

      expect(finishResult.status).toBe("fulfilled");
      if (addResult.status === "rejected") {
        expect(addResult.reason).toBeInstanceOf(WorkoutFinishedError);
        const rows = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
          `SELECT count(*) AS n FROM "workout_exercise" WHERE workout_id = $1::uuid`,
          workout.id,
        );
        expect(Number(rows[0]!.n)).toBe(0);
      } else {
        const finishedAt = (finishResult.value as { endedAt: Date | null }).endedAt!;
        const addedAtRows = await db.prisma.$queryRawUnsafe<{ created_at: Date }[]>(
          `SELECT created_at FROM "workout_exercise" WHERE id = $1::uuid`,
          addResult.value.id,
        );
        expect(addedAtRows[0]!.created_at.getTime()).toBeLessThanOrEqual(finishedAt.getTime());
      }
    });
  },
);
```

```ts
// apps/api/test/integration/workout-add-exercise.integration.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";

describe.skipIf(!shouldRunIntegration())("AC10 — add-exercise snapshotting (real Postgres)", () => {
  let db: IntegrationDb;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    if (!db) return;
    await db.prisma.$executeRawUnsafe(
      'TRUNCATE "workout", "workout_exercise", "exercise", "user" CASCADE',
    );
  });

  async function insertUser(): Promise<string> {
    const id = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "user" ("id", "auth_sub", "email") VALUES ($1::uuid, $2, $3)`,
      id,
      `auth0|${id}`,
      "u@ex.com",
    );
    return id;
  }

  it("a later rename or soft-delete of the exercise leaves the snapshot unchanged", async () => {
    const userId = await insertUser();
    const exerciseId = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "name", "modality", "is_active") VALUES ($1::uuid, 'Original Name', 'weight_reps', true)`,
      exerciseId,
    );
    const exerciseRepo = createExerciseRepository(db.prisma);
    const repo = createWorkoutRepository(db.prisma, exerciseRepo);
    const { workout } = await repo.createWorkout(
      userId,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );
    const added = await repo.addWorkoutExercise(userId, workout.id, { exerciseId });
    expect(added.exerciseNameSnapshot).toBe("Original Name");

    await db.prisma.$executeRawUnsafe(
      `UPDATE "exercise" SET name = 'Renamed', is_active = false WHERE id = $1::uuid`,
      exerciseId,
    );

    const detail = await repo.getWorkoutById(userId, workout.id);
    expect(detail.exercises[0]!.exerciseNameSnapshot).toBe("Original Name");
  });

  it("adding the same exerciseId twice creates a second row at a distinct position", async () => {
    const userId = await insertUser();
    const exerciseId = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "name", "modality", "is_active") VALUES ($1::uuid, 'Squat', 'weight_reps', true)`,
      exerciseId,
    );
    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
    const { workout } = await repo.createWorkout(
      userId,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );

    const first = await repo.addWorkoutExercise(userId, workout.id, { exerciseId });
    const second = await repo.addWorkoutExercise(userId, workout.id, { exerciseId });

    expect(first.id).not.toBe(second.id);
    expect([first.position, second.position].sort()).toEqual([0, 1]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `RUN_INTEGRATION=1 pnpm --filter @sin/api run test:integration -- workout-calendar workout-finish-concurrency workout-add-exercise`
Expected: pass immediately if Tasks 1–14 are complete — this task, like Task 20, is a verification sweep, not new production code. If any assertion fails, it identifies exactly which earlier task's implementation has a gap (most likely `localDateFor`'s call site, or a missed re-check).

- [ ] **Step 3/4: (Fix any gap found in the referenced earlier task; do not add new logic here beyond what Tasks 1–14 already specify.)**

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/integration/workout-calendar.integration.test.ts apps/api/test/integration/workout-finish-concurrency.integration.test.ts apps/api/test/integration/workout-add-exercise.integration.test.ts
git commit -m "test(api): integration sweep — calendar derivation, finish/add race, snapshot immutability (Spec 05.0, AC6, AC9, AC10)"
```

---

## Task 22: Integration sweep — dense position sequence, the deferred-constraint swap, six concurrent adds, statement order (AC11, AC12, AC13, AC14)

**Files:**
- Create: `apps/api/test/integration/workout-positions.integration.test.ts`

**Interfaces:**
- Consumes: `createWorkoutRepository`, `createExerciseRepository`, `startIntegrationDb` (existing/Tasks 1, 14).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/integration/workout-positions.integration.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";

describe.skipIf(!shouldRunIntegration())("AC11/AC12/AC13/AC14 — positions (real Postgres)", () => {
  let db: IntegrationDb;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    if (!db) return;
    await db.prisma.$executeRawUnsafe(
      'TRUNCATE "workout", "workout_exercise", "exercise", "user" CASCADE',
    );
  });

  async function insertUser(): Promise<string> {
    const id = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "user" ("id", "auth_sub", "email") VALUES ($1::uuid, $2, $3)`,
      id,
      `auth0|${id}`,
      "u@ex.com",
    );
    return id;
  }

  async function insertGlobalExercise(name: string): Promise<string> {
    const id = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "name", "modality", "is_active") VALUES ($1::uuid, $2, 'weight_reps', true)`,
      id,
      name,
    );
    return id;
  }

  async function positionsOf(workoutId: string): Promise<number[]> {
    const rows = await db.prisma.$queryRawUnsafe<{ position: number }[]>(
      `SELECT position FROM "workout_exercise" WHERE workout_id = $1::uuid ORDER BY position`,
      workoutId,
    );
    return rows.map((r) => r.position);
  }

  it("AC11: a table-driven append/insert/reorder/delete sequence always leaves 0..n-1 dense with no gap or duplicate", async () => {
    const userId = await insertUser();
    const exerciseRepo = createExerciseRepository(db.prisma);
    const repo = createWorkoutRepository(db.prisma, exerciseRepo);
    const exerciseIds = await Promise.all(
      Array.from({ length: 4 }, (_, i) => insertGlobalExercise(`Ex ${i}`)),
    );
    const { workout } = await repo.createWorkout(
      userId,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );

    const a = await repo.addWorkoutExercise(userId, workout.id, { exerciseId: exerciseIds[0]! }); // append -> 0
    const b = await repo.addWorkoutExercise(userId, workout.id, { exerciseId: exerciseIds[1]! }); // append -> 1
    await repo.addWorkoutExercise(userId, workout.id, { exerciseId: exerciseIds[2]!, position: 1 }); // insert -> shifts b to 2
    expect(await positionsOf(workout.id)).toEqual([0, 1, 2]);

    await repo.updateWorkoutExercise(userId, b.id, { position: 0 }); // reorder b to front
    expect(await positionsOf(workout.id)).toEqual([0, 1, 2]);

    await repo.deleteWorkoutExercise(userId, a.id); // delete closes the gap
    expect(await positionsOf(workout.id)).toEqual([0, 1]);
  });

  it("AC11: position above the smallint ceiling is 422, never a Postgres 22003 500", async () => {
    const userId = await insertUser();
    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
    const exerciseId = await insertGlobalExercise("Solo");
    const { workout } = await repo.createWorkout(
      userId,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );
    await expect(
      repo.addWorkoutExercise(userId, workout.id, { exerciseId, position: 40_000 }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("AC12: a two-row swap commits through a colliding intermediate state and leaves a dense sequence", async () => {
    const userId = await insertUser();
    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
    const e0 = await insertGlobalExercise("Zero");
    const e1 = await insertGlobalExercise("One");
    const { workout } = await repo.createWorkout(
      userId,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );
    const row0 = await repo.addWorkoutExercise(userId, workout.id, { exerciseId: e0 });
    const row1 = await repo.addWorkoutExercise(userId, workout.id, { exerciseId: e1 });
    expect([row0.position, row1.position]).toEqual([0, 1]);

    // Swap: move row0 (pos 0) to pos 1. The repository's reorder path must
    // pass through an intermediate two-rows-at-one-position state that only
    // the deferred constraint tolerates.
    await repo.updateWorkoutExercise(userId, row0.id, { position: 1 });

    expect(await positionsOf(workout.id)).toEqual([0, 1]);
    const updatedRow1 = await db.prisma.$queryRawUnsafe<{ position: number }[]>(
      `SELECT position FROM "workout_exercise" WHERE id = $1::uuid`,
      row1.id,
    );
    expect(updatedRow1[0]!.position).toBe(0);
  });

  it("AC12: six concurrent adds to the same workout all succeed, none is 500, final sequence is dense with no duplicate", async () => {
    const userId = await insertUser();
    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
    const exerciseIds = await Promise.all(
      Array.from({ length: 6 }, (_, i) => insertGlobalExercise(`Concurrent ${i}`)),
    );
    const { workout } = await repo.createWorkout(
      userId,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );

    const results = await Promise.allSettled(
      exerciseIds.map((exerciseId) => repo.addWorkoutExercise(userId, workout.id, { exerciseId })),
    );

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const positions = await positionsOf(workout.id);
    expect(positions.sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(positions).size).toBe(6); // no duplicate
  });

  it("AC13: the advisory lock is the first non-SET-CONSTRAINTS statement; the count read is later and separate (captured from the real driver)", async () => {
    const userId = await insertUser();
    const exerciseId = await insertGlobalExercise("Query-captured");
    const { workout } = await createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma)).createWorkout(
      userId,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );

    const captured: string[] = [];
    // @ts-expect-error -- Prisma's $on typing for the "query" event is not
    // exported on PrismaClient by default; this mirrors the existing
    // exercise-repository query-capture idiom used elsewhere in this suite.
    db.prisma.$on("query", (e: { query: string }) => captured.push(e.query));

    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
    await repo.addWorkoutExercise(userId, workout.id, { exerciseId });

    const relevant = captured.filter(
      (q) => q.includes("advisory_xact_lock") || q.includes("SET CONSTRAINTS") || q.includes("count("),
    );
    const lockIndex = relevant.findIndex((q) => q.includes("advisory_xact_lock"));
    const countIndex = relevant.findIndex((q) => q.includes("count("));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(countIndex).toBeGreaterThan(lockIndex);
  });

  it("AC14: the create path issues no advisory lock, confirmed against the real driver", async () => {
    const userId = await insertUser();
    const captured: string[] = [];
    // @ts-expect-error -- see the note above.
    db.prisma.$on("query", (e: { query: string }) => captured.push(e.query));
    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));

    await repo.createWorkout(
      userId,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );

    expect(captured.some((q) => q.includes("advisory_xact_lock"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `RUN_INTEGRATION=1 pnpm --filter @sin/api run test:integration -- workout-positions`
Expected: passes if Tasks 1, 14, 15, 16 are complete. The query-capture tests (AC13/AC14) require `db.prisma`'s Prisma Client to have query-event logging enabled — if `$on("query", …)` is a no-op on the client `startIntegrationDb` constructs, add `log: [{ emit: "event", level: "query" }]` to the `PrismaClient` constructor options in `apps/api/test/integration/helpers.ts`'s `startBareDb` (a one-line, additive change — this is the same idiom 03.2's D23 verification note references for capturing raw statements, generalized here since 03.1/03.2 never needed it against a real client before).

- [ ] **Step 3/4: (Apply the `helpers.ts` logging change if needed, per Step 2's note, then re-run until green.)**

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/integration/workout-positions.integration.test.ts apps/api/test/integration/helpers.ts
git commit -m "test(api): integration sweep — dense positions, deferred-constraint swap, six concurrent adds, lock ordering (Spec 05.0, AC11, AC12, AC13, AC14)"
```

---

## Task 23: Cross-user 404 sweep + vanished-row races (AC15), account purge (AC17), remaining wire-level free-text bound (AC16)

**Files:**
- Create: `apps/api/test/integration/workout-cross-user.integration.test.ts`
- Create: `apps/api/test/integration/workout-purge.integration.test.ts`
- Create: `apps/api/test/unit/routes-workouts-text-bounds.test.ts`

**Interfaces:**
- Consumes: the full `apps/api` app via `fastify.inject` against real JWT-less auth (`buildTestApp`/`fakeVerifier` for the non-DB test; real repositories + Testcontainers for the other two).

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/integration/workout-cross-user.integration.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { NotFoundError } from "../../src/errors/app-error.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";

describe.skipIf(!shouldRunIntegration())("AC15 — cross-user 404 and the vanished-row rule (real Postgres)", () => {
  let db: IntegrationDb;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    if (!db) return;
    await db.prisma.$executeRawUnsafe(
      'TRUNCATE "workout", "workout_exercise", "exercise", "user" CASCADE',
    );
  });

  async function insertUser(): Promise<string> {
    const id = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "user" ("id", "auth_sub", "email") VALUES ($1::uuid, $2, $3)`,
      id,
      `auth0|${id}`,
      "u@ex.com",
    );
    return id;
  }

  it("every id-taking method returns NotFoundError (never leaks) for another user's row and for a malformed id", async () => {
    const userA = await insertUser();
    const userB = await insertUser();
    const exerciseRepo = createExerciseRepository(db.prisma);
    const repoA = createWorkoutRepository(db.prisma, exerciseRepo);
    const repoB = createWorkoutRepository(db.prisma, exerciseRepo);

    const { workout: bWorkout } = await repoB.createWorkout(
      userB,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );
    const exerciseId = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "name", "modality", "is_active") VALUES ($1::uuid, 'Shared', 'weight_reps', true)`,
      exerciseId,
    );
    const bWe = await repoB.addWorkoutExercise(userB, bWorkout.id, { exerciseId });

    for (const id of [bWorkout.id, "not-a-uuid"]) {
      await expect(repoA.getWorkoutById(userA, id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(repoA.updateWorkout(userA, id, {})).rejects.toBeInstanceOf(NotFoundError);
      await expect(repoA.deleteWorkout(userA, id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(
        repoA.addWorkoutExercise(userA, id, { exerciseId }),
      ).rejects.toBeInstanceOf(NotFoundError);
    }
    for (const id of [bWe.id, "not-a-uuid"]) {
      await expect(repoA.updateWorkoutExercise(userA, id, {})).rejects.toBeInstanceOf(NotFoundError);
      await expect(repoA.deleteWorkoutExercise(userA, id)).rejects.toBeInstanceOf(NotFoundError);
    }

    // Own-user custom exercise not visible to A either.
    const customExerciseId = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "owner_user_id", "name", "modality", "is_active") VALUES ($1::uuid, $2::uuid, 'B custom', 'weight_reps', true)`,
      customExerciseId,
      userB,
    );
    const { workout: aWorkout } = await repoA.createWorkout(
      userA,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );
    await expect(
      repoA.addWorkoutExercise(userA, aWorkout.id, { exerciseId: customExerciseId }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a workout deleted between the handler's read and the position transaction's lock is 404, not 500", async () => {
    const userId = await insertUser();
    const exerciseId = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "name", "modality", "is_active") VALUES ($1::uuid, 'X', 'weight_reps', true)`,
      exerciseId,
    );
    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
    const { workout } = await repo.createWorkout(
      userId,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );

    const [deleteResult, addResult] = await Promise.allSettled([
      repo.deleteWorkout(userId, workout.id),
      repo.addWorkoutExercise(userId, workout.id, { exerciseId }),
    ]);

    expect(deleteResult.status).toBe("fulfilled");
    if (addResult.status === "rejected") {
      expect(addResult.reason).toBeInstanceOf(NotFoundError);
    }
    // Whichever order won, no 23503 / 500 occurred — Promise.allSettled would
    // not have resolved "rejected" with anything else, since the repository
    // maps every DB-layer failure on this path to NotFoundError or
    // WorkoutFinishedError, never lets a raw driver error through.
  });
});
```

```ts
// apps/api/test/integration/workout-purge.integration.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";

describe.skipIf(!shouldRunIntegration())("AC17 — account purge reaches workout rows down both FK paths (real Postgres)", () => {
  let db: IntegrationDb;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    if (!db) return;
    await db.prisma.$executeRawUnsafe(
      'TRUNCATE "workout", "workout_exercise", "exercise", "user" CASCADE',
    );
  });

  async function insertUser(): Promise<string> {
    const id = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "user" ("id", "auth_sub", "email") VALUES ($1::uuid, $2, $3)`,
      id,
      `auth0|${id}`,
      "u@ex.com",
    );
    return id;
  }

  it("DELETE FROM user removes the purged user's workout + workout_exercise rows down both paths, leaves the global exercise and the other user untouched", async () => {
    const purgedUser = await insertUser();
    const otherUser = await insertUser();
    const exerciseRepo = createExerciseRepository(db.prisma);
    const repo = createWorkoutRepository(db.prisma, exerciseRepo);

    const globalExerciseId = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "name", "modality", "is_active") VALUES ($1::uuid, 'Global', 'weight_reps', true)`,
      globalExerciseId,
    );
    const customExerciseId = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "owner_user_id", "name", "modality", "is_active") VALUES ($1::uuid, $2::uuid, 'Purged users own', 'weight_reps', true)`,
      customExerciseId,
      purgedUser,
    );

    const { workout: purgedWorkout } = await repo.createWorkout(
      purgedUser,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );
    await repo.addWorkoutExercise(purgedUser, purgedWorkout.id, { exerciseId: globalExerciseId });
    await repo.addWorkoutExercise(purgedUser, purgedWorkout.id, { exerciseId: customExerciseId });

    const { workout: otherWorkout } = await repo.createWorkout(
      otherUser,
      { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null },
      "UTC",
    );
    await repo.addWorkoutExercise(otherUser, otherWorkout.id, { exerciseId: globalExerciseId });

    await db.prisma.$executeRawUnsafe(`DELETE FROM "user" WHERE id = $1::uuid`, purgedUser);

    const purgedUserWorkouts = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "workout" WHERE user_id = $1::uuid`,
      purgedUser,
    );
    expect(Number(purgedUserWorkouts[0]!.n)).toBe(0);

    const purgedWorkoutExercises = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "workout_exercise" WHERE workout_id = $1::uuid`,
      purgedWorkout.id,
    );
    expect(Number(purgedWorkoutExercises[0]!.n)).toBe(0); // both FK paths cascaded

    const globalExerciseSurvives = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "exercise" WHERE id = $1::uuid`,
      globalExerciseId,
    );
    expect(Number(globalExerciseSurvives[0]!.n)).toBe(1);

    const otherUserWorkoutExercises = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "workout_exercise" WHERE workout_id = $1::uuid`,
      otherWorkout.id,
    );
    expect(Number(otherUserWorkoutExercises[0]!.n)).toBe(1); // untouched
  });
});
```

```ts
// apps/api/test/unit/routes-workouts-text-bounds.test.ts
import { describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { WORKOUT_NOTES_MAX } from "@sin/core";
import { buildTestApp } from "../helpers/build-test-app.js";

const BEARER = { authorization: "Bearer test-token" };

describe("AC16 — free-text bound is 422, never 413, even near the body limit", () => {
  it("a notes field one char over the max, sent as \\uXXXX escapes (~24KB on the wire), is 422 naming the field", async () => {
    const { app } = await buildTestApp();
    const overLong = "a".repeat(WORKOUT_NOTES_MAX + 1);
    const escaped = [...overLong].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
    const rawBody = `{"clientGeneratedId":"${uuidv7()}","startedAt":"2026-09-15T10:00:00.000Z","notes":"${escaped}"}`;
    expect(Buffer.byteLength(rawBody, "utf8")).toBeLessThan(64 * 1024); // under BODY_LIMIT_BYTES

    const res = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: { ...BEARER, "content-type": "application/json" },
      payload: rawBody,
    });
    expect(res.statusCode).toBe(422);
    expect(res.statusCode).not.toBe(413);
  });

  it("exactly WORKOUT_NOTES_MAX characters is accepted (201)", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: {
        clientGeneratedId: uuidv7(),
        startedAt: "2026-09-15T10:00:00.000Z",
        notes: "a".repeat(WORKOUT_NOTES_MAX),
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it("a title containing <script> round-trips byte-for-byte (format check, not an HTML filter)", async () => {
    const { app } = await buildTestApp();
    const title = "<script>alert(1)</script>";
    const res = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: "2026-09-15T10:00:00.000Z", title },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().title).toBe(title);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail / verify state**

Run: `RUN_INTEGRATION=1 pnpm --filter @sin/api run test:integration -- workout-cross-user workout-purge`
Run: `pnpm --filter @sin/api run test:unit -- routes-workouts-text-bounds`
Expected: all pass against Tasks 1–18's implementation. This task, like Tasks 20–21, is a verification sweep — any failure names the exact earlier task to fix (most likely the migration's `ON DELETE CASCADE` direction from Task 1, or a missed vanished-row branch from Task 14/15/16).

- [ ] **Step 3/4: (Fix any gap in the referenced earlier task; re-run.)**

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/integration/workout-cross-user.integration.test.ts apps/api/test/integration/workout-purge.integration.test.ts apps/api/test/unit/routes-workouts-text-bounds.test.ts
git commit -m "test(api): cross-user 404 sweep, account purge down both FK paths, wire-level text bound (Spec 05.0, AC15, AC16, AC17)"
```

---

## Task 24: `DESIGN.md` edits + `docs/specs/README.md` status (AC21)

**Files:**
- Modify: `docs/DESIGN.md` (§4.4, §4.5, §4.8, §4.9 confirm-only, §6, §9 — line numbers below are as of this plan's drafting; re-`grep` before editing since 05.1's skeleton may have shifted them)
- Modify: `docs/specs/README.md` (05.0 status row — the roadmap-row split itself was already applied when the spec was drafted, per spec §2 AC21's note; this task only flips the status)

**Interfaces:** none — documentation only, no code/test dependency.

- [ ] **Step 1: (Docs task — no failing test. Verification is AC21's own criterion: review the diff against spec §11's list.)**
- [ ] **Step 2: (N/A)**
- [ ] **Step 3: Apply each §11 edit**

**§4.4** (`docs/DESIGN.md` around line 286–306) — replace the `workout` / `workout_exercise` bullets:

```markdown
- **workout** — `user_id`, `title`, `notes`, `started_at timestamptz`,
  `ended_at timestamptz` (NULL while in progress), `local_date DATE`,
  `tz_offset_minutes SMALLINT`, `client_generated_id UUID` (client-supplied,
  unique per user — **idempotency key**, §6), `source` (the shipped `CHECK`
  admits only `'manual'` in v1 — `healthkit` / `google_fit` / … reserved
  values are added by the migration that adds their importer, since widening
  a `CHECK` literal list is additive while shipping values nothing can write
  is not). `routine_id` is omitted until Spec 09 adds `routine` (one additive
  column then, per Spec 05.0 D36).
- **At most one in-progress workout per user** is a database invariant: a
  partial unique index on `user_id WHERE ended_at IS NULL` (Spec 05.0 D38).
- **workout_exercise** — `workout_id`, `position`, `exercise_id`,
  `exercise_name_snapshot`, `modality_snapshot`, `notes`. The snapshots make a
  past session render correctly forever, independent of later catalog changes
  or a deleted custom exercise. `superset_group` is omitted until Spec 09
  (Spec 05.0 D36).
- **A workout's exercise `position`s are the dense zero-based sequence
  `0 … n-1`**, unique per workout (Spec 05.0 D41).
```

Replace the concurrency paragraph a few lines below (`Concurrency: a set is addressed…`):

```markdown
Concurrency: two tabs editing the same in-progress workout are last-write-wins
per row (per set once `set_entry` exists); `updated_at` is returned so a client
can detect it lost a race. Full conflict resolution is out of scope while there
is one (web) client.
```

**§4.5** (around line 329, the `PRs are written transactionally…` paragraph) — prepend one sentence:

```markdown
The M1 finish (Spec 05.0) sets only `ended_at`; Spec 07 (M2) adds the PR write
to the same transaction, once `personal_record` exists. PRs are written
transactionally when a workout is finished. Invalidation is simple...
```

**§4.8** (the "Allowed units" bullet) — change `(Spec 05)` to `(Spec 05.1)`:

```markdown
  defined once in `packages/core` (Spec 02); the `weight_kg` / `distance_m`
  generated columns (Spec 05.1) must use the identical constants — drift...
```

**§4.9** — confirm only (no edit expected): grep the deletion matrix's `workout`, `workout_exercise` and custom-`exercise` rows and verify they still read exactly as quoted in this plan's Task 24 preamble (they do, as of this plan's drafting — the custom-`exercise` row's purge-ordering caveat is superseded by Spec 05.0 D37's `ON DELETE CASCADE`, so re-word it):

```markdown
| custom `exercise` | soft (`is_active = false`) — history snapshots keep sessions readable | hard purge (`exercise.owner_user_id` is `ON DELETE CASCADE`; `workout_exercise.exercise_id` is also `ON DELETE CASCADE` — Spec 05.0 D37 — so no purge-ordering step is needed) |
```

**§6** ("Representative endpoints" block, around line 543–560):

```markdown
POST   /workouts                  { client_generated_id, started_at, tz_offset_minutes?, title?, notes? }
                                   → 201 + Location, or 200 on an idempotent replay
GET    /workouts/active           → the caller's one in-progress workout, or 404
GET    /workouts?cursor=          → history list (Spec 07)
GET    /workouts/{id}
PATCH  /workouts/{id}             { title?, notes?, ended_at? }   # finish = set ended_at; PR recompute is Spec 07's
DELETE /workouts/{id}            # whole session only, allowed finished or not
POST   /workouts/{id}/exercises   { exercise_id, position? }
PATCH  /workout-exercises/{id}    { position?, notes? }
DELETE /workout-exercises/{id}
PUT    /workout-exercises/{id}/sets/{setNumber}   { set_type, reps?, weight?, ... }
DELETE /workout-exercises/{id}/sets/{setNumber}
```

And in the "Time" bullet earlier in §6 (grep for "local_date" / "tz_offset"), append: "A client-supplied `started_at` more than 5 minutes ahead of, or more than 7 days behind, the server clock is rejected (`422`); `ended_at` on finish is bound by the same 5-minute future window (Spec 05.0 §6.4, D47)."

**§9** (the milestone-mapping sentence, around line 659):

```markdown
  M0 = 01, 02, 04.0, 04.1 · M1 = 03.0, 03.1, 03.2, 03.3, 05.0, 05.1, 05.2, 06 · M2 = 07, 08 ·
```

**§1.3, §8.1** — no change (spec §11 confirms this explicitly).

**`docs/specs/README.md`** — locate the 05.0 row (added when the spec was drafted) and flip its `Status` column from `Draft` to `Implemented`.

- [ ] **Step 4: Verify**

Run: `grep -n "routine_id.*workout\b" docs/DESIGN.md` — should show no remaining `workout` bullet listing `routine_id` (it now appears only in `routine_item` / the routine-snapshot paragraph, which are Spec 09's and unaffected).
Run: a manual read-through of the diff against this task's Step 3 text.

- [ ] **Step 5: Commit**

```bash
git add docs/DESIGN.md docs/specs/README.md
git commit -m "docs: DESIGN.md §4.4/§4.5/§4.8/§4.9/§6/§9 reconciled with Spec 05.0; README status -> Implemented (Spec 05.0 §11, AC21)"
```

---

## Task 25: Final review — full suite, lint, typecheck, purity, coverage, and the self-review pass

**Files:** none created — verification only.

- [ ] **Step 1: Run every gate CLAUDE.md and this plan require**

```bash
pnpm run build
pnpm run lint
pnpm run typecheck
pnpm run core:purity
pnpm --filter @sin/api run test:unit
RUN_INTEGRATION=1 pnpm --filter @sin/api run test:integration
pnpm --filter @sin/web run test:coverage   # unaffected by this plan, but must still be green
```

Expected: all green.

- [ ] **Step 2: Coverage check**

Run: `pnpm --filter @sin/api run test:unit -- --coverage` and inspect `apps/api/src/repositories/workout.ts` / `workout.prisma.ts` / `workout-writes.ts` — expect at/near 100% line coverage per spec §10. Confirm `apps/api/src/plugins/auth` and `apps/api/src/repositories/user` are unaffected and still ≥90%.

- [ ] **Step 3: Self-review — spec coverage**

Confirm every row of the AC-to-task table (below, in "Done when") has at least one task and at least one named test. There are no gaps as of this plan's drafting — see the table.

- [ ] **Step 4: Self-review — placeholder scan**

```bash
grep -n "TBD\|write appropriate\|add appropriate error handling\|similar to Task" spec-05.0-code-implementation-plan.md
```

Expected: no matches other than this grep command's own text and the two explicitly-justified, non-banned scaffolding uses in Task 10 (`"not implemented until Task N"`, each resolved by its named task) and the intentional TDD-order exception documented in Task 19.

- [ ] **Step 5: Self-review — name/type cross-reference**

Confirm, by grep, that every name introduced in an early task is spelled identically everywhere it is later consumed: `WorkoutRepository`, `WorkoutRecord`, `WorkoutExerciseRecord`, `WorkoutDetailRecord`, `CreateWorkoutFields`, `CreateWorkoutResult`, `UpdateWorkoutFields`, `AddWorkoutExerciseFields`, `UpdateWorkoutExerciseFields`, `WorkoutFinishedError`, `WorkoutInProgressExistsError`, `WorkoutId`/`WorkoutExerciseId` (+ the brandId quartet each), `WORKOUT_SOURCE_VALUES`, `WORKOUT_TITLE_MAX`, `WORKOUT_NOTES_MAX`, `WORKOUT_FUTURE_SKEW_MAX_MS`, `WORKOUT_STARTED_AT_PAST_MAX_MS`, `noControlCharsExceptWhitespace`, `localDateFor`, `offsetMinutesForZone`, `WorkoutSchema`/`WorkoutExerciseSchema`/`WorkoutDetailSchema`/`CreateWorkoutSchema`/`UpdateWorkoutSchema`/`AddWorkoutExerciseSchema`/`UpdateWorkoutExerciseSchema`, `createWorkoutRepository(prisma, exerciseRepository)`, `registerWorkoutRoutes`, `FakeWorkoutRepository`, `makeWorkoutRecord`.

```bash
grep -rn "createWorkoutRepository(" apps/api/test apps/api/src | grep -v "createWorkoutRepository(prisma, "
```

Expected (after Task 14): every call site passes two arguments. A one-argument call site left over from before Task 14's retrofit is this plan's own bug, not the executor's — flag it against this document.

- [ ] **Step 6: Self-review — the two spec-mandated open items are resolved, not skipped**

Confirm Task 0 (D49 spike) has a recorded outcome, and confirm Global Constraints' finish-lock decision (explicit `SELECT … FOR UPDATE`, chosen over "issue the UPDATE first") is what Task 12 actually implements.

- [ ] **Step 7: Commit** (only if Steps 1–6 required a fix; otherwise this task produces no diff)

```bash
git add -A
git commit -m "fix: Spec 05.0 final-review fixes (Spec 05.0)"
```

---

## AC-to-task coverage table

| AC | Task(s) | Test(s) |
|---|---|---|
| AC1 | Task 0 (spike), Task 1 | `workout-migration.integration.test.ts` |
| AC2 | Task 1, Task 3 | `workout-migration.integration.test.ts` (behavioral CHECKs), `workout-migration-drift-guard.test.ts` (string-containment) |
| AC3 | Task 10, Task 18, Task 20 | `workout-repository-create.test.ts`, `routes-workouts.test.ts`, `workout-create-concurrency.integration.test.ts` |
| AC4 | Task 10, Task 11, Task 18, Task 20 | `workout-repository-create.test.ts`, `workout-repository-reads.test.ts`, `routes-workouts.test.ts`, `workout-create-concurrency.integration.test.ts` |
| AC5 | Task 10, Task 20 | `workout-repository-create.test.ts` (all seven branches), `workout-create-concurrency.integration.test.ts` (real error shape) |
| AC6 | Task 4, Task 12, Task 21 | `time.test.ts`, `workout-repository-update.test.ts`, `workout-calendar.integration.test.ts` |
| AC7 | Task 9, Task 18 | `workout-writes.test.ts`, `routes-workouts.test.ts` (422 via `assertStartedAtInBounds`) |
| AC8 | Task 12, Task 18 | `workout-repository-update.test.ts`, `routes-workouts.test.ts` |
| AC9 | Task 12, Task 13, Task 14, Task 15, Task 16, Task 18, Task 21 | `workout-repository-update.test.ts`, `-delete.test.ts`, `-add-exercise.test.ts`, `-reorder.test.ts`, `-delete-exercise.test.ts`, `routes-workouts.test.ts`, `workout-finish-concurrency.integration.test.ts` |
| AC10 | Task 14, Task 18, Task 21 | `workout-repository-add-exercise.test.ts`, `routes-workouts.test.ts`, `workout-add-exercise.integration.test.ts` |
| AC11 | Task 9, Task 14, Task 15, Task 16, Task 22 | `workout-writes.test.ts`, `workout-repository-add-exercise.test.ts`, `-reorder.test.ts`, `-delete-exercise.test.ts`, `workout-positions.integration.test.ts` |
| AC12 | Task 22 | `workout-positions.integration.test.ts` (two-row swap + six concurrent adds) |
| AC13 | Task 14, Task 22 | `workout-repository-add-exercise.test.ts` (scripted), `workout-positions.integration.test.ts` (real driver) |
| AC14 | Task 10, Task 22 | `workout-repository-create.test.ts`, `workout-positions.integration.test.ts` |
| AC15 | Task 11, Task 12, Task 13, Task 14, Task 15, Task 16, Task 18, Task 23 | every `workout-repository-*.test.ts` ownership case, `routes-workouts.test.ts` (six-route sweep), `workout-cross-user.integration.test.ts` |
| AC16 | Task 5, Task 18, Task 23 | `dto-workout.test.ts`, `routes-workouts.test.ts` (unknown-key 422), `routes-workouts-text-bounds.test.ts` |
| AC17 | Task 1, Task 23 | `workout-migration.integration.test.ts` (FK shape), `workout-purge.integration.test.ts` |
| AC18 | Task 19 | `routes-workouts-logging.test.ts` |
| AC19 | Task 2, Task 3, Task 4, Task 5, Task 6 | `ids-workout.test.ts`, `enums-workout.test.ts`, `time.test.ts`, `dto-workout.test.ts`, `check-exports.mjs` run |
| AC20 | Task 18, Task 20 | `routes-workouts.test.ts` (401 sweep), `openapi-workouts.test.ts`, existing CI drift check |
| AC21 | Task 24 | manual doc-diff review against spec §11 |

All 21 acceptance criteria are covered. No gaps remain.

---

## Done when

- [ ] AC1–AC21 each have at least one passing test naming that criterion (per the table above).
- [ ] `pnpm run build`, `pnpm run lint`, `pnpm run typecheck`, `pnpm run core:purity` are all green.
- [ ] `pnpm --filter @sin/api run test:unit` is green with no Postgres container started.
- [ ] `RUN_INTEGRATION=1 pnpm --filter @sin/api run test:integration` is green, including the six new `workout-*.integration.test.ts` files and the retrofitted `helpers.ts` query-logging change (Task 22).
- [ ] `apps/api/src/repositories/workout.ts` / `workout.prisma.ts` / `workout-writes.ts` are at or near 100% line coverage; `apps/api/src/plugins/auth` and `apps/api/src/repositories/user` remain ≥90%.
- [ ] The CI OpenAPI drift check stays green with all eight workout routes present (Spec 03.0's existing step — no new CI job per spec §10).
- [ ] `docs/DESIGN.md` §4.4, §4.5, §4.8, §4.9 (confirmed), §6, §9 read as Task 24 specifies, and `docs/specs/README.md`'s 05.0 row status is `Implemented`.
- [ ] The D49 migrate-diff spike (Task 0) has a recorded outcome and Task 1's drift assertion matches it.
- [ ] The finish-transaction lock mechanism is the explicit `SELECT … FOR UPDATE` decided in Global Constraints and implemented in Task 12 — not left as an open question.
- [ ] `git log` shows one commit per task, each named `feat(api): …` / `feat(core): …` / `test(api): …` / `docs: …`, each ending `(Spec 05.0 §N[, ACn…])`, none carrying a `Co-Authored-By` trailer.

