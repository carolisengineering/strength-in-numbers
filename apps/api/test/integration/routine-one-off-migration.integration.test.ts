// Spec 09.3 AC26 — migration 0013 (routine.one_off_until), real Postgres. The whole-schema
// `prisma migrate diff` no-drift check (09.3 AC27) moved to workout-sections-migration with 0014 (CLAUDE.md).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrationFile, shouldRunIntegration, startBareDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, logWorkout } from "./records-helpers.js";

const BEFORE_0013 = [
  "0001_create_user", "0002_create_exercise_catalog", "0003_exercise_fork_provenance",
  "0004_exercise_change_xid", "0005_create_workout_session", "0006_create_set_entry",
  "0007_set_entry_client_generated_id", "0008_create_personal_record", "0009_create_routines",
  "0010_create_planned_sets", "0011_create_routine_sections", "0012_workout_planned_duration",
];

describe.skipIf(!shouldRunIntegration())("Spec 09.3 — migration 0013 (real Postgres)", () => {
  let db: IntegrationDb;
  const ids: Record<string, string> = {};
  let before = "";
  const q = <T>(sql: string, ...args: unknown[]) => db.prisma.$queryRawUnsafe<T[]>(sql, ...args);
  const x = (sql: string, ...args: unknown[]) => db.prisma.$executeRawUnsafe(sql, ...args);
  const snapshot = async (afterMigration: boolean): Promise<string> =>
    JSON.stringify(await q(`SELECT to_jsonb(t)${afterMigration ? ` - 'one_off_until'` : ""} AS j FROM "routine" t ORDER BY id`));
  const checkViolation = (p: Promise<unknown>) => expect(p).rejects.toThrow(/23514|check constraint/i);

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startBareDb();
    for (const m of BEFORE_0013) applyMigrationFile(db.url, m);
    const u = await insertUser(db);
    const ex = await insertExercise(db);
    ids.withItems = "018fcb3e-3b8a-7d6e-9c1a-0000000a0001";
    ids.plain = "018fcb3e-3b8a-7d6e-9c1a-0000000a0002";
    await x(`INSERT INTO "routine" (id, user_id, name, created_at) VALUES ($1::uuid, $2::uuid, 'Push A', now() - interval '3 days')`, ids.withItems, u);
    await x(`INSERT INTO "routine" (id, user_id, name, notes) VALUES ($1::uuid, $2::uuid, 'Legs', 'slow')`, ids.plain, u);
    await x(`INSERT INTO "routine_section" (id, routine_id, position, name) VALUES (gen_random_uuid(), $1::uuid, 0, 'Strength')`, ids.withItems);
    await x(`INSERT INTO "routine_item" (id, routine_id, position, exercise_id, target_sets) VALUES (gen_random_uuid(), $1::uuid, 0, $2::uuid, 3)`, ids.withItems, ex);
    const live = await logWorkout(db, u, { startedAt: new Date(Date.now() - 3_600_000), finish: "none", exercises: [{ exerciseId: ex, sets: [] }] });
    await x(`UPDATE "workout" SET routine_id = $2::uuid WHERE id = $1::uuid`, live.workoutId, ids.withItems);
    before = await snapshot(false);
    applyMigrationFile(db.url, "0013_routine_one_off");
  }, 240_000);
  afterAll(async () => {
    await db?.stop();
  });

  it("09.3 AC26 — no backfill: every routine keeps its values and the new column is NULL", async () => {
    expect((await q<{ n: number }>(`SELECT count(*)::int AS n FROM "routine" WHERE one_off_until IS NOT NULL`))[0]!.n).toBe(0);
    expect(await snapshot(true)).toBe(before);
  });

  it("09.3 AC26 — the CHECK: an expiry must come after created_at", async () => {
    const set = (expr: string) => x(`UPDATE "routine" SET one_off_until = ${expr} WHERE id = $1::uuid`, ids.withItems);
    await checkViolation(set("created_at"));
    await checkViolation(set("created_at - interval '1 second'"));
    await set("created_at + interval '1 second'");
    await set("NULL");
  });
});
