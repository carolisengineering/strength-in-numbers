// Spec 07.4 AC18 — migration 0012 (workout.planned_duration_s), real Postgres. The whole-schema
// `prisma migrate diff` no-drift check moved on to routine-one-off-migration with 0013 (Spec 09.3 AC27).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrationFile, shouldRunIntegration, startBareDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, logWorkout } from "./records-helpers.js";

const BEFORE_0012 = [
  "0001_create_user", "0002_create_exercise_catalog", "0003_exercise_fork_provenance",
  "0004_exercise_change_xid", "0005_create_workout_session", "0006_create_set_entry",
  "0007_set_entry_client_generated_id", "0008_create_personal_record", "0009_create_routines",
  "0010_create_planned_sets", "0011_create_routine_sections",
];

describe.skipIf(!shouldRunIntegration())("Spec 07.4 — migration 0012 (real Postgres)", () => {
  let db: IntegrationDb;
  const ids: Record<string, string> = {};
  let before = "";
  const q = <T>(sql: string, ...args: unknown[]) => db.prisma.$queryRawUnsafe<T[]>(sql, ...args);
  const x = (sql: string, ...args: unknown[]) => db.prisma.$executeRawUnsafe(sql, ...args);
  const snapshot = async (afterMigration: boolean): Promise<string> =>
    JSON.stringify(await q(`SELECT to_jsonb(t)${afterMigration ? ` - 'planned_duration_s'` : ""} AS j FROM "workout" t ORDER BY id`));
  const checkViolation = (p: Promise<unknown>) => expect(p).rejects.toThrow(/23514|check constraint/i);

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startBareDb();
    for (const m of BEFORE_0012) applyMigrationFile(db.url, m);
    const u = await insertUser(db);
    const ex = await insertExercise(db);
    ids.finished = (await logWorkout(db, u, { startedAt: new Date(Date.now() - 2 * 86_400_000), exercises: [{ exerciseId: ex, sets: [{ reps: 5, weight: 5 }] }] })).workoutId;
    ids.live = (await logWorkout(db, u, { startedAt: new Date(Date.now() - 3_600_000), finish: "none", exercises: [{ exerciseId: ex, sets: [] }] })).workoutId;
    before = await snapshot(false);
    applyMigrationFile(db.url, "0012_workout_planned_duration");
  }, 240_000);
  afterAll(async () => {
    await db?.stop();
  });

  it("07.4 AC18 — no backfill: every row keeps its values and the new column is NULL", async () => {
    expect((await q<{ n: number }>(`SELECT count(*)::int AS n FROM "workout" WHERE planned_duration_s IS NOT NULL`))[0]!.n).toBe(0);
    expect(await snapshot(true)).toBe(before);
  });

  it("07.4 AC18 — the range CHECK: 0 and 86400 accepted, -1 and 86401 rejected", async () => {
    const set = (v: number) => x(`UPDATE "workout" SET planned_duration_s = $2 WHERE id = $1::uuid`, ids.live, v);
    await checkViolation(set(-1));
    await checkViolation(set(86_401));
    await set(0);
    await set(86_400);
  });

  it("07.4 AC18 — the live-only CHECK: no plan on a finished row, and a finish must clear the plan", async () => {
    await checkViolation(x(`UPDATE "workout" SET planned_duration_s = 60 WHERE id = $1::uuid`, ids.finished));
    await x(`UPDATE "workout" SET planned_duration_s = 60 WHERE id = $1::uuid`, ids.live);
    await checkViolation(x(`UPDATE "workout" SET ended_at = now() WHERE id = $1::uuid`, ids.live));
    await x(`UPDATE "workout" SET ended_at = now(), planned_duration_s = NULL WHERE id = $1::uuid`, ids.live);
  });
});
