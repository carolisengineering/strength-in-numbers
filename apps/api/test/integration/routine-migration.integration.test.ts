import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, logWorkout } from "./records-helpers.js";

/**
 * Spec 09 AC27 — migration 0009 applies cleanly over 0001–0008 and the
 * database itself carries the contract (CHECKs, the expression unique index,
 * ON DELETE SET NULL). Raw SQL here on purpose: these are the rules the
 * repository must never be the only guard for.
 */
describe.skipIf(!shouldRunIntegration())("AC27 — migration 0009 applies cleanly and the DB enforces the contract", () => {
  let db: IntegrationDb;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    if (db) await db.prisma.$executeRawUnsafe('TRUNCATE "routine", "workout", "exercise", "user" CASCADE');
  });

  async function routine(userId: string, name = "Push A"): Promise<string> {
    const id = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "routine" ("id","user_id","name") VALUES ($1::uuid,$2::uuid,$3)`,
      id,
      userId,
      name,
    );
    return id;
  }
  const insertItem = (routineId: string, exerciseId: string, cols: string, vals: string) =>
    db.prisma.$executeRawUnsafe(
      `INSERT INTO "routine_item" ("id","routine_id","position","exercise_id"${cols}) VALUES ($1::uuid,$2::uuid,0,$3::uuid${vals})`,
      uuidv7(),
      routineId,
      exerciseId,
    );
  const count = async (table: string): Promise<number> => {
    const [row] = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table}"`);
    return Number(row!.n);
  };

  it("existing workouts are untouched: the new columns read NULL", async () => {
    const u = await insertUser(db);
    const ex = await insertExercise(db);
    const { workoutId } = await logWorkout(db, u, { startedAt: new Date(), exercises: [{ exerciseId: ex, sets: [] }] });
    const [w] = await db.prisma.$queryRawUnsafe<{ routine_id: null; routine_name_snapshot: null }[]>(
      `SELECT routine_id, routine_name_snapshot FROM "workout" WHERE id = $1::uuid`,
      workoutId,
    );
    expect(w).toEqual({ routine_id: null, routine_name_snapshot: null });
    const [we] = await db.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT superset_group, target_sets, target_reps_low, target_reps_high, target_rpe, rest_seconds
       FROM "workout_exercise" WHERE workout_id = $1::uuid`,
      workoutId,
    );
    expect(Object.keys(we!)).toHaveLength(6);
    expect(Object.values(we!).every((v) => v === null)).toBe(true);
  });

  it("rejects a rep range with one bound, low > high, off-step or out-of-range RPE, negative rest, group outside 1..99", async () => {
    const u = await insertUser(db);
    const ex = await insertExercise(db);
    const r = await routine(u);
    const check = /routine_item_targets_check/;
    await expect(insertItem(r, ex, ',"target_reps_low"', ",6")).rejects.toThrow(check);
    await expect(insertItem(r, ex, ',"target_reps_low","target_reps_high"', ",9,8")).rejects.toThrow(check);
    await expect(insertItem(r, ex, ',"target_rpe"', ",83")).rejects.toThrow(check);
    await expect(insertItem(r, ex, ',"target_rpe"', ",55")).rejects.toThrow(check);
    await expect(insertItem(r, ex, ',"rest_seconds"', ",-1")).rejects.toThrow(check);
    await expect(insertItem(r, ex, ',"superset_group"', ",0")).rejects.toThrow(check);
    await expect(insertItem(r, ex, ',"superset_group"', ",100")).rejects.toThrow(check);
    await expect(
      insertItem(r, ex, ',"target_rpe","target_reps_low","target_reps_high","rest_seconds","superset_group"', ",85,6,8,90,1"),
    ).resolves.toBe(1);
  });

  it("rejects a duplicate (routine_id, position) and a duplicate (user_id, lower(name)); another user may reuse the name", async () => {
    const u = await insertUser(db);
    const ex = await insertExercise(db);
    const r = await routine(u);
    await insertItem(r, ex, "", "");
    // The driver surfaces only the DETAIL line, which names the key columns, not the index.
    await expect(insertItem(r, ex, "", "")).rejects.toThrow(/Key \(routine_id, "position"\)=/);
    await expect(routine(u, "push a")).rejects.toThrow(/Key \(user_id, lower\(name\)\)=/);
    const other = await insertUser(db);
    await expect(routine(other, "PUSH A")).resolves.toBeTypeOf("string");
  });

  it("rejects an untrimmed or empty name, and the same target / group CHECKs on workout_exercise", async () => {
    const u = await insertUser(db);
    await expect(routine(u, " Push ")).rejects.toThrow(/routine_name_check/);
    await expect(routine(u, "")).rejects.toThrow(/routine_name_check/);
    const ex = await insertExercise(db);
    const { workoutId } = await logWorkout(db, u, { startedAt: new Date(), exercises: [{ exerciseId: ex, sets: [] }] });
    await expect(
      db.prisma.$executeRawUnsafe(`UPDATE "workout_exercise" SET target_rpe = 83 WHERE workout_id = $1::uuid`, workoutId),
    ).rejects.toThrow(/workout_exercise_targets_check/);
    await expect(
      db.prisma.$executeRawUnsafe(`UPDATE "workout_exercise" SET superset_group = 100 WHERE workout_id = $1::uuid`, workoutId),
    ).rejects.toThrow(/workout_exercise_superset_group_check/);
  });

  it("deleting a routine cascades its items and nulls workout.routine_id, keeping the snapshot", async () => {
    const u = await insertUser(db);
    const ex = await insertExercise(db);
    const r = await routine(u);
    await insertItem(r, ex, "", "");
    const { workoutId } = await logWorkout(db, u, { startedAt: new Date(), exercises: [] });
    await db.prisma.$executeRawUnsafe(
      `UPDATE "workout" SET routine_id = $1::uuid, routine_name_snapshot = 'Push A' WHERE id = $2::uuid`,
      r,
      workoutId,
    );
    await db.prisma.$executeRawUnsafe(`DELETE FROM "routine" WHERE id = $1::uuid`, r);
    expect(await count("routine_item")).toBe(0);
    const [w] = await db.prisma.$queryRawUnsafe<{ routine_id: null; routine_name_snapshot: string }[]>(
      `SELECT routine_id, routine_name_snapshot FROM "workout" WHERE id = $1::uuid`,
      workoutId,
    );
    expect(w).toEqual({ routine_id: null, routine_name_snapshot: "Push A" });
  });

  it("prisma migrate diff (migrated DB → schema.prisma) reports no difference beyond the two generated columns", () => {
    // The whole-schema no-drift check lives in the NEWEST migration's test; it
    // moved here from personal-record-migration.integration.test.ts (0008).
    // spawnSync, not execFileSync + try/catch: a CLI that fails to run at all
    // must FAIL this test, not look like "no diff" (05.0 D49's pattern).
    //
    // Prisma has no generated-column DSL: it introspects 05.1's `weight_kg` /
    // `distance_m` as columns whose default is `dbgenerated(<expression>)`,
    // while the model declares none, and reports that as a changed default.
    // Any other reported change is real drift. (0009's partial index
    // `workout_routine_idx` and expression index `routine_user_name_key` are
    // not modelled either, and `migrate diff` does not report them.)
    const apiDir = fileURLToPath(new URL("../../", import.meta.url));
    const r = spawnSync(
      "pnpm",
      ["exec", "prisma", "migrate", "diff", "--from-url", db.url, "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"],
      { cwd: apiDir, encoding: "utf8" },
    );
    const report = `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`;
    expect(r.status, report).toBe(2); // 2 = "diff found"; anything else means the CLI itself failed
    const changeLines = r.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^\[[*+-]\]/.test(l));
    expect(changeLines, report).toHaveLength(3);
    expect(changeLines[0], report).toBe("[*] Changed the `set_entry` table");
    expect(changeLines[1], report).toMatch(/^\[\*\] Altered column `weight_kg` \(default changed from `Some\(DbGenerated/);
    expect(changeLines[2], report).toMatch(/^\[\*\] Altered column `distance_m` \(default changed from `Some\(DbGenerated/);
  });
});
