// Spec 05.3 AC16 / AC18 / AC40 — migration 0015 (new modalities, calories, ft, NUMERIC(14,3)), real Postgres.
// Owns the whole-schema `prisma migrate diff` no-drift check (moved here from workout-sections-migration, CLAUDE.md).
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import {
  applyMigrationFile,
  insertExercise,
  insertUser,
  shouldRunIntegration,
  startBareDb,
  type IntegrationDb,
} from "./helpers.js";

const MIGRATIONS = readdirSync(fileURLToPath(new URL("../../prisma/migrations/", import.meta.url)))
  .filter((d) => /^\d{4}_/.test(d))
  .sort();
const BEFORE_0015 = MIGRATIONS.filter((d) => d < "0015");

/** One workout exercise to hang raw set rows on (0001–0014 columns only). */
async function insertWorkoutExercise(db: IntegrationDb, modality = "weight_reps"): Promise<string> {
  const u = await insertUser(db);
  const ex = await insertExercise(db, { ownerUserId: u, modality: "weight_reps" });
  const w = uuidv7();
  await db.prisma.$executeRawUnsafe(
    `INSERT INTO "workout" ("id","user_id","started_at","ended_at","local_date","tz_offset_minutes","client_generated_id")
     VALUES ($1::uuid,$2::uuid,now() - interval '1 hour',now(),current_date,0,$3::uuid)`,
    w, u, uuidv7(),
  );
  const we = uuidv7();
  await db.prisma.$executeRawUnsafe(
    `INSERT INTO "workout_exercise" ("id","workout_id","position","exercise_id","exercise_name_snapshot","modality_snapshot")
     VALUES ($1::uuid,$2::uuid,0,$3::uuid,'Carry',$4)`,
    we, w, ex, modality,
  );
  return we;
}

let setNumber = 0;
async function insertSet(
  db: IntegrationDb,
  we: string,
  cols: { distance?: number | null; distanceUnit?: string | null; reps?: number | null; calories?: number },
): Promise<string> {
  const id = uuidv7();
  const names = ["id", "workout_exercise_id", "set_number", "reps", "distance", "distance_unit"];
  const values: unknown[] = [id, we, ++setNumber, cols.reps ?? null, cols.distance ?? null, cols.distanceUnit ?? null];
  if (cols.calories !== undefined) {
    names.push("calories");
    values.push(cols.calories);
  }
  const casts = ["::uuid", "::uuid", "::smallint", "::smallint", "::numeric", "::text", "::smallint"];
  await db.prisma.$executeRawUnsafe(
    `INSERT INTO "set_entry" (${names.map((n) => `"${n}"`).join(",")}) VALUES (${names.map((_, i) => `$${i + 1}${casts[i]}`).join(",")})`,
    ...values,
  );
  return id;
}

const distanceSnapshot = (db: IntegrationDb) =>
  db.prisma.$queryRawUnsafe<{ id: string; distance_m: string | null }[]>(
    `SELECT id::text, distance_m::text FROM "set_entry" ORDER BY id`,
  );

describe.skipIf(!shouldRunIntegration())("Spec 05.3 — migration 0015 (real Postgres)", () => {
  let db: IntegrationDb;
  let before: { id: string; distance_m: string | null }[];
  let legacySet: string;
  let indexesBefore: string[];
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startBareDb();
    for (const dir of BEFORE_0015) applyMigrationFile(db.url, dir);
    const we = await insertWorkoutExercise(db, "distance_duration");
    await insertSet(db, we, { distance: 400, distanceUnit: "m" });
    await insertSet(db, we, { distance: 1.5, distanceUnit: "km" });
    await insertSet(db, we, { distance: 1, distanceUnit: "mi" });
    await insertSet(db, we, { distance: 3.107, distanceUnit: "mi" });
    await insertSet(db, we, {});
    const legacyWe = await insertWorkoutExercise(db);
    legacySet = await insertSet(db, legacyWe, { reps: 5 });
    before = await distanceSnapshot(db);
    indexesBefore = (await db.prisma.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'set_entry' ORDER BY indexname`,
    )).map((r) => r.indexdef);
    for (const dir of MIGRATIONS.filter((d) => d >= "0015")) applyMigrationFile(db.url, dir);
  }, 240_000);
  afterAll(async () => {
    await db?.stop();
  });

  describe("05.3 AC16 — 0015 applied to a database with data", () => {
    it("set_entry.calories is SMALLINT, nullable, with no default", async () => {
      const rows = await db.prisma.$queryRawUnsafe<{ data_type: string; is_nullable: string; column_default: string | null }[]>(
        `SELECT data_type, is_nullable, column_default FROM information_schema.columns
         WHERE table_name = 'set_entry' AND column_name = 'calories'`,
      );
      expect(rows).toEqual([{ data_type: "smallint", is_nullable: "YES", column_default: null }]);
    });

    it("a negative calories value fails set_entry_calories_check", async () => {
      const we = await insertWorkoutExercise(db, "calories");
      await expect(insertSet(db, we, { calories: -1 })).rejects.toThrow("set_entry_calories_check");
      await insertSet(db, we, { calories: 20 });
    });

    it("exercise and workout_exercise accept the new modalities and reject a ninth", async () => {
      const u = await insertUser(db);
      await insertExercise(db, { ownerUserId: u, modality: "calories" });
      await insertExercise(db, { ownerUserId: u, modality: "weight_distance" });
      await expect(insertExercise(db, { ownerUserId: u, modality: "rowing" })).rejects.toThrow("exercise_modality_check");
      await insertWorkoutExercise(db, "weight_duration");
      await expect(insertWorkoutExercise(db, "rowing")).rejects.toThrow("workout_exercise_modality_snapshot_check");
    });

    it("personal_record accepts max_calories/cal and rejects max_calories/kg and an unknown unit", async () => {
      const we = await insertWorkoutExercise(db, "calories");
      const setId = await insertSet(db, we, { calories: 30 });
      const meta = await db.prisma.$queryRawUnsafe<{ user_id: string; workout_id: string; exercise_id: string }[]>(
        `SELECT w.user_id::text, w.id::text AS workout_id, x.exercise_id::text FROM "workout_exercise" x
         JOIN "workout" w ON w.id = x.workout_id WHERE x.id = $1::uuid`,
        we,
      );
      const { user_id, workout_id, exercise_id } = meta[0]!;
      const insert = (type: string, unit: string) =>
        db.prisma.$executeRawUnsafe(
          `INSERT INTO "personal_record" ("id","user_id","exercise_id","record_type","value","unit","source_set_entry_id","workout_id","achieved_at","local_date")
           VALUES ($1::uuid,$2::uuid,$3::uuid,$4,30,$5,$6::uuid,$7::uuid,now(),current_date)`,
          uuidv7(), user_id, exercise_id, type, unit, setId, workout_id,
        );
      await insert("max_calories", "cal");
      await expect(insert("max_distance", "kg")).rejects.toThrow("personal_record_type_unit_check");
      // Postgres may report the type↔unit CHECK first; either way the unit is refused.
      await expect(insert("max_duration", "min")).rejects.toThrow(/personal_record_(type_)?unit_check/);
    });

    it("personal_record.value and previous_value are NUMERIC(14,3)", async () => {
      const rows = await db.prisma.$queryRawUnsafe<{ column_name: string; numeric_precision: number; numeric_scale: number }[]>(
        `SELECT column_name, numeric_precision, numeric_scale FROM information_schema.columns
         WHERE table_name = 'personal_record' AND column_name IN ('value','previous_value') ORDER BY column_name`,
      );
      expect(rows).toEqual([
        { column_name: "previous_value", numeric_precision: 14, numeric_scale: 3 },
        { column_name: "value", numeric_precision: 14, numeric_scale: 3 },
      ]);
    });

    it("a pre-existing weight_reps set reads back unchanged, with a NULL calories", async () => {
      const rows = await db.prisma.$queryRawUnsafe<{ reps: number; calories: number | null }[]>(
        `SELECT reps, calories FROM "set_entry" WHERE id = $1::uuid`,
        legacySet,
      );
      expect(rows).toEqual([{ reps: 5, calories: null }]);
    });
  });

  describe("05.3 AC40 — feet in the database", () => {
    it("every pre-existing row's distance_m is identical after 0015 (m, km, mi, null)", async () => {
      const after = await distanceSnapshot(db);
      const ids = new Set(before.map((r) => r.id));
      expect(after.filter((r) => ids.has(r.id))).toEqual(before);
      expect(before.map((r) => r.distance_m)).toContain("1609.344");
    });

    it("ft rows store distance * 0.3048 rounded to numeric(9,3)", async () => {
      const we = await insertWorkoutExercise(db, "weight_distance");
      const cases: [number, string][] = [[40, "12.192"], [100, "30.480"], [0.001, "0.000"], [999999.999, "304800.000"]];
      for (const [distance, expected] of cases) {
        const id = await insertSet(db, we, { distance, distanceUnit: "ft" });
        const rows = await db.prisma.$queryRawUnsafe<{ distance_m: string }[]>(
          `SELECT distance_m::text FROM "set_entry" WHERE id = $1::uuid`, id);
        expect(rows[0]!.distance_m).toBe(expected);
      }
    });

    it("yd is rejected by the unit CHECK", async () => {
      const we = await insertWorkoutExercise(db, "weight_distance");
      await expect(insertSet(db, we, { distance: 10, distanceUnit: "yd" })).rejects.toThrow("set_entry_distance_unit_check");
    });

    it("a distance with a NULL unit has a NULL distance_m (no catch-all arm)", async () => {
      const we = await insertWorkoutExercise(db, "weight_distance");
      const id = await insertSet(db, we, { distance: 10, distanceUnit: null });
      const rows = await db.prisma.$queryRawUnsafe<{ distance_m: string | null }[]>(
        `SELECT distance_m::text FROM "set_entry" WHERE id = $1::uuid`, id);
      expect(rows[0]!.distance_m).toBeNull();
    });

    it("distance_m is still numeric(9,3) GENERATED ALWAYS, and set_entry's indexes are unchanged", async () => {
      const cols = await db.prisma.$queryRawUnsafe<{ numeric_precision: number; numeric_scale: number; is_generated: string }[]>(
        `SELECT numeric_precision, numeric_scale, is_generated FROM information_schema.columns
         WHERE table_name = 'set_entry' AND column_name = 'distance_m'`,
      );
      expect(cols).toEqual([{ numeric_precision: 9, numeric_scale: 3, is_generated: "ALWAYS" }]);
      const idx = (await db.prisma.$queryRawUnsafe<{ indexdef: string }[]>(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'set_entry' ORDER BY indexname`,
      )).map((r) => r.indexdef);
      expect(idx).toEqual(indexesBefore);
    });
  });

  it("05.3 AC18 — prisma migrate diff reports no difference beyond the two generated set_entry columns", () => {
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
