import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import {
  applyMigrationFile,
  shouldRunIntegration,
  startBareDb,
  type IntegrationDb,
} from "./helpers.js";

/**
 * Spec 05.0 §4 / §10 AC1, AC2 (integration half) — migrates a fresh container
 * through 0001..0005 and asserts the exact §4 shape against real Postgres,
 * plus the no-drift assertion against schema.prisma (03.3 AC1 / D30's
 * pattern) and the CHECK-vocabulary enforcement (03.1 AC2's technique).
 */
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
      // spawnSync (not execFileSync + try/catch): a CLI that fails to run at all
      // (bad path, changed flag) must FAIL this test, not look like "no diff".
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

/**
 * Spec 05.0 §10 AC2 (integration, primary half) — the CHECK vocabularies are
 * enforced by Postgres itself: a raw insert of an out-of-vocabulary value on
 * either column is rejected, and every real value is accepted.
 */
describe.skipIf(!shouldRunIntegration())(
  "AC2 — workout.source / workout_exercise.modality_snapshot CHECK enforcement (real Postgres)",
  () => {
    let db: IntegrationDb;
    let userId: string;
    let exerciseId: string;

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
      userId = uuidv7();
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "user" ("id", "auth_sub", "email") VALUES ($1::uuid, $2, $3)`,
        userId,
        `auth0|${userId}`,
        "workout-check@example.com",
      );
      exerciseId = uuidv7();
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "exercise" ("id", "name", "modality") VALUES ($1::uuid, $2, $3)`,
        exerciseId,
        "check-constraint bench",
        "weight_reps",
      );
    }, 180_000);

    afterAll(async () => {
      await db?.stop();
    });

    // Each workout is inserted already-finished (ended_at set): these tests
    // insert several workouts per user and must not collide with the
    // `workout_user_active_key` partial-unique invariant (at most one
    // in-progress session per user), which is unrelated to what's under test
    // here.
    async function insertWorkout(source: string): Promise<void> {
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "workout"
           ("id", "user_id", "started_at", "ended_at", "local_date", "tz_offset_minutes", "client_generated_id", "source")
         VALUES ($1::uuid, $2::uuid, now(), now(), CURRENT_DATE, 0, $3::uuid, $4)`,
        uuidv7(),
        userId,
        uuidv7(),
        source,
      );
    }

    async function insertWorkoutExercise(modalitySnapshot: string): Promise<void> {
      const workoutId = uuidv7();
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "workout"
           ("id", "user_id", "started_at", "ended_at", "local_date", "tz_offset_minutes", "client_generated_id", "source")
         VALUES ($1::uuid, $2::uuid, now(), now(), CURRENT_DATE, 0, $3::uuid, 'manual')`,
        workoutId,
        userId,
        uuidv7(),
      );
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "workout_exercise"
           ("id", "workout_id", "position", "exercise_id", "exercise_name_snapshot", "modality_snapshot")
         VALUES ($1::uuid, $2::uuid, 0, $3::uuid, 'bench', $4)`,
        uuidv7(),
        workoutId,
        exerciseId,
        modalitySnapshot,
      );
    }

    it("rejects an out-of-vocabulary workout.source", async () => {
      await expect(insertWorkout("bogus")).rejects.toThrow();
    });

    it("accepts each real workout.source value", async () => {
      await expect(insertWorkout("manual")).resolves.toBeUndefined();
    });

    it("rejects an out-of-vocabulary workout_exercise.modality_snapshot", async () => {
      await expect(insertWorkoutExercise("bogus")).rejects.toThrow();
    });

    it("accepts each real workout_exercise.modality_snapshot value", async () => {
      for (const modality of [
        "weight_reps",
        "bodyweight_reps",
        "weighted_bodyweight",
        "duration",
        "distance_duration",
      ]) {
        await expect(insertWorkoutExercise(modality)).resolves.toBeUndefined();
      }
    });
  },
);
