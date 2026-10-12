import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { applyMigrationFile, shouldRunIntegration, startBareDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, logWorkout } from "./records-helpers.js";
import { assertDerivedColumnsConsistent, BACKFILL_SQL } from "./planned-set-helpers.js";

const BEFORE_0010 = [
  "0001_create_user", "0002_create_exercise_catalog", "0003_exercise_fork_provenance",
  "0004_exercise_change_xid", "0005_create_workout_session", "0006_create_set_entry",
  "0007_set_entry_client_generated_id", "0008_create_personal_record", "0009_create_routines",
];

describe.skipIf(!shouldRunIntegration())("Spec 09.1 — migration 0010 (real Postgres)", () => {
  let db: IntegrationDb;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startBareDb();
    for (const m of BEFORE_0010) applyMigrationFile(db.url, m);
    // 0009-era data: items with and without a set count, one reps-only (O1), one workout.
    const u = await insertUser(db);
    const ex = await insertExercise(db);
    const routine = uuidv7();
    await db.prisma.$executeRawUnsafe(`INSERT INTO "routine" (id, user_id, name) VALUES ($1::uuid, $2::uuid, 'Old')`, routine, u);
    const item = async (pos: number, sets: number | null, lo: number | null, hi: number | null) => {
      const id = uuidv7();
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "routine_item" (id, routine_id, position, exercise_id, target_sets, target_reps_low, target_reps_high)
         VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7)`, id, routine, pos, ex, sets, lo, hi);
      return id;
    };
    ids.fourBySixEight = await item(0, 4, 6, 8);
    ids.threeNoReps = await item(1, 3, null, null);
    ids.repsOnly = await item(2, null, 8, 10);
    ids.nothing = await item(3, null, null, null);
    await logWorkout(db, u, { startedAt: new Date(Date.now() - 86_400_000), exercises: [{ exerciseId: ex, sets: [{ reps: 5, weight: 5 }] }] });
    ids.snapshotBefore = JSON.stringify(await db.prisma.$queryRawUnsafe(
      `SELECT id, target_sets, target_reps_low, target_reps_high FROM "routine_item" ORDER BY id`));
    applyMigrationFile(db.url, "0010_create_planned_sets");
  }, 240_000);
  afterAll(async () => {
    await db?.stop();
  });

  const rowsOf = (itemId: string) =>
    db.prisma.$queryRawUnsafe<{ position: number; set_type: string; reps_low: number | null; reps_high: number | null; weight: string | null }[]>(
      `SELECT position, set_type, reps_low, reps_high, weight::text FROM "routine_item_set" WHERE routine_item_id = $1::uuid ORDER BY position`, itemId);

  it("AC18 — backfill: N working rows with the rep range, no weight; rowless items untouched; no workout rows", async () => {
    const four = await rowsOf(ids.fourBySixEight!);
    expect(four.map((r) => r.position)).toEqual([0, 1, 2, 3]);
    expect(four.every((r) => r.set_type === "working" && r.reps_low === 6 && r.reps_high === 8 && r.weight === null)).toBe(true);
    expect((await rowsOf(ids.threeNoReps!)).every((r) => r.reps_low === null)).toBe(true);
    expect(await rowsOf(ids.threeNoReps!)).toHaveLength(3);
    expect(await rowsOf(ids.repsOnly!)).toEqual([]);
    expect(await rowsOf(ids.nothing!)).toEqual([]);
    const n = (await db.prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "workout_planned_set"`))[0]!.n;
    expect(n).toBe(0);
    expect(JSON.stringify(await db.prisma.$queryRawUnsafe(
      `SELECT id, target_sets, target_reps_low, target_reps_high FROM "routine_item" ORDER BY id`))).toBe(ids.snapshotBefore);
    await assertDerivedColumnsConsistent(db);
  });

  it("AC19 — re-running the backfill inserts nothing; after a rowless re-create it restores exactly that item", async () => {
    expect(await db.prisma.$executeRawUnsafe(BACKFILL_SQL)).toBe(0);
    await db.prisma.$executeRawUnsafe(`DELETE FROM "routine_item_set" WHERE routine_item_id = $1::uuid`, ids.fourBySixEight);
    expect(await db.prisma.$executeRawUnsafe(BACKFILL_SQL)).toBe(4);
    expect(await rowsOf(ids.fourBySixEight!)).toHaveLength(4);
  });

  it("AC17 — the database rejects each contract violation, on both tables", async () => {
    const we = (await db.prisma.$queryRawUnsafe<{ we: string }[]>(`SELECT id::text AS we FROM "workout_exercise" LIMIT 1`))[0]!.we;
    const targets = [
      { table: "routine_item_set", fk: "routine_item_id", parentId: ids.nothing! },
      { table: "workout_planned_set", fk: "workout_exercise_id", parentId: we },
    ];
    // [label, extra columns, extra values, position]
    const bad: [string, string, string, number][] = [
      ["set_type", ", set_type", ", 'amrap'", 0],
      ["position 20", "", "", 20],
      ["one rep bound", ", reps_low", ", 5", 0],
      ["low > high", ", reps_low, reps_high", ", 9, 8", 0],
      ["reps 0", ", reps_low, reps_high", ", 0, 5", 0],
      ["negative weight", ", weight, weight_unit", ", -1, 'kg'", 0],
      ["weight without unit", ", weight", ", 100", 0],
      ["unit without weight", ", weight_unit", ", 'kg'", 0],
      ["unknown unit", ", weight, weight_unit", ", 10, 'stone'", 0],
    ];
    for (const { table, fk, parentId } of targets) {
      const insert = (cols: string, vals: string, position: number) =>
        db.prisma.$executeRawUnsafe(
          `INSERT INTO "${table}" (id, ${fk}, position${cols}) VALUES ($1::uuid, $2::uuid, ${position}${vals})`, uuidv7(), parentId);
      for (const [label, cols, vals, position] of bad) {
        await expect(insert(cols, vals, position), `${table}: ${label}`).rejects.toThrow();
      }
      await insert("", "", 0);
      await expect(insert("", "", 0), `${table}: duplicate position`).rejects.toThrow();
    }
  });

  it("AC17 — deleting the parent cascades its rows", async () => {
    await db.prisma.$executeRawUnsafe(`DELETE FROM "routine_item" WHERE id = $1::uuid`, ids.threeNoReps);
    expect(await rowsOf(ids.threeNoReps!)).toEqual([]);
    await db.prisma.$executeRawUnsafe(`DELETE FROM "workout_exercise"`);
    const n = (await db.prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "workout_planned_set"`))[0]!.n;
    expect(n).toBe(0);
  });

  it("AC20 — prisma migrate diff reports no difference beyond the two generated set_entry columns", () => {
    const apiDir = fileURLToPath(new URL("../../", import.meta.url));
    const r = spawnSync(
      "pnpm",
      ["exec", "prisma", "migrate", "diff", "--from-url", db.url, "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"],
      { cwd: apiDir, encoding: "utf8" },
    );
    const report = `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`;
    expect(r.status, report).toBe(2);
    const changeLines = r.stdout.split("\n").map((l) => l.trim()).filter((l) => /^\[[*+-]\]/.test(l));
    expect(changeLines, report).toHaveLength(3);
    expect(changeLines[0], report).toBe("[*] Changed the `set_entry` table");
    expect(changeLines[1], report).toMatch(/^\[\*\] Altered column `weight_kg` \(default changed from `Some\(DbGenerated/);
    expect(changeLines[2], report).toMatch(/^\[\*\] Altered column `distance_m` \(default changed from `Some\(DbGenerated/);
  });
});
