// Spec 07.5 Phase B, AC14–AC17 and AC32 — migration 0022 (at_weight_kg and the widened personal_record key), real Postgres.
// Owns the whole-schema `prisma migrate diff` no-drift check (moved here from enable-rls-migration, apps/api CLAUDE.md).
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { applyMigrationFile, insertExercise, insertUser, shouldRunIntegration, startBareDb, type IntegrationDb } from "./helpers.js";

const MIGRATION = "0022_reps_at_weight";
const MIGRATIONS = readdirSync(fileURLToPath(new URL("../../prisma/migrations/", import.meta.url)))
  .filter((d) => /^\d{4}_/.test(d))
  .sort();

/**
 * AC15 / AC32: the previous release's recompute statements, copied verbatim from `recomputeRecordsForRoots` as it
 * was before Spec 07.5 Phase B (delete by root, then one 11-column INSERT per row for the seven old types).
 */
const OLD_DELETE = `
    DELETE FROM "personal_record"
    WHERE user_id = $1::uuid AND exercise_id = ANY($2::uuid[])
  `;
const OLD_INSERT = `
        INSERT INTO "personal_record"
          ("id", "user_id", "exercise_id", "record_type", "value", "unit", "previous_value",
           "source_set_entry_id", "workout_id", "achieved_at", "local_date")
        VALUES ($1::uuid, $2::uuid, $3::uuid, $4,
                $5::numeric, $6, $7::numeric,
                $8::uuid, $9::uuid, $10, $11::date)
      `;
const OLD_TYPES: readonly (readonly [string, string])[] = [
  ["heaviest_weight", "kg"],
  ["best_est_1rm", "kg"],
  ["best_set_volume", "kg_reps"],
  ["max_reps", "reps"],
  ["max_calories", "cal"],
  ["max_distance", "m"],
  ["max_duration", "s"],
];

describe.skipIf(!shouldRunIntegration())("Spec 07.5 Phase B — migration 0022 (real Postgres)", () => {
  let db: IntegrationDb;
  let user: string;
  let root: string;
  let workout: string;
  let set: string;
  const startedAt = new Date("2026-10-02T10:00:00.000Z");

  const sql = (text: string, ...args: unknown[]) => db.prisma.$executeRawUnsafe(text, ...args);

  /** One personal_record row by SQL; `atWeightKg` is omitted from the column list when undefined. */
  function insertRecord(recordType: string, unit: string, atWeightKg?: string | null) {
    const withWeight = atWeightKg !== undefined;
    return sql(
      `INSERT INTO "personal_record"
         ("id","user_id","exercise_id","record_type","value","unit","previous_value","source_set_entry_id","workout_id","achieved_at","local_date"${withWeight ? `,"at_weight_kg"` : ""})
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,10,$5,NULL,$6::uuid,$7::uuid,$8,'2026-10-02'::date${withWeight ? `,$9::numeric` : ""})`,
      uuidv7(),
      user,
      root,
      recordType,
      unit,
      set,
      workout,
      startedAt,
      ...(withWeight ? [atWeightKg] : []),
    );
  }

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startBareDb();
    for (const dir of MIGRATIONS.filter((d) => d < MIGRATION)) applyMigrationFile(db.url, dir);
    user = await insertUser(db);
    root = await insertExercise(db, { name: "Lateral Raise" });
    workout = uuidv7();
    await sql(
      `INSERT INTO "workout" ("id","user_id","started_at","ended_at","local_date","tz_offset_minutes","client_generated_id")
       VALUES ($1::uuid,$2::uuid,$3,$3::timestamptz + interval '1 hour','2026-10-02'::date,0,$4::uuid)`,
      workout,
      user,
      startedAt,
      uuidv7(),
    );
    const workoutExercise = uuidv7();
    await sql(
      `INSERT INTO "workout_exercise" (id, workout_id, position, exercise_id, exercise_name_snapshot, modality_snapshot)
       VALUES ($1::uuid, $2::uuid, 0, $3::uuid, 'Lateral Raise', 'weight_reps')`,
      workoutExercise,
      workout,
      root,
    );
    set = uuidv7();
    await sql(
      `INSERT INTO "set_entry" (id, workout_exercise_id, set_number, client_generated_id) VALUES ($1::uuid, $2::uuid, 1, $3::uuid)`,
      set,
      workoutExercise,
      uuidv7(),
    );
    applyMigrationFile(db.url, MIGRATION);
  }, 240_000);

  afterEach(async () => {
    if (db) await sql(`DELETE FROM "personal_record"`);
  });

  afterAll(async () => {
    await db?.stop();
  });

  describe("07.5 AC14 — 0022 adds at_weight_kg and the at-weight CHECK", () => {
    it("at_weight_kg is a nullable numeric(7,3)", async () => {
      const [col] = await db.prisma.$queryRawUnsafe<{ data_type: string; numeric_precision: number; numeric_scale: number; is_nullable: string }[]>(
        `SELECT data_type, numeric_precision, numeric_scale, is_nullable FROM information_schema.columns
          WHERE table_name = 'personal_record' AND column_name = 'at_weight_kg'`,
      );
      expect(col).toEqual({ data_type: "numeric", numeric_precision: 7, numeric_scale: 3, is_nullable: "YES" });
    });

    it("a max_reps_at_weight row needs a weight above 0 and the reps unit; the old types refuse one", async () => {
      await expect(insertRecord("max_reps_at_weight", "reps", null)).rejects.toThrow(/personal_record_at_weight_check/);
      await expect(insertRecord("max_reps_at_weight", "reps", "0")).rejects.toThrow(/personal_record_at_weight_check/);
      await expect(insertRecord("max_reps_at_weight", "kg", "12.5")).rejects.toThrow(/personal_record_type_unit_check/);
      await expect(insertRecord("heaviest_weight", "kg", "10")).rejects.toThrow(/personal_record_at_weight_check/);
      await expect(insertRecord("max_reps_at_weight", "reps", "12.5")).resolves.toBe(1);
      await expect(insertRecord("heaviest_weight", "kg")).resolves.toBe(1);
    });
  });

  describe("07.5 AC16 — uniqueness per (user, root, type, weight)", () => {
    it("one row per old type, one per weight for the new type", async () => {
      await insertRecord("heaviest_weight", "kg");
      await expect(insertRecord("heaviest_weight", "kg")).rejects.toThrow(/23505.*\(user_id, exercise_id, record_type, at_weight_kg\)/);
      await insertRecord("max_reps_at_weight", "reps", "12.5");
      await insertRecord("max_reps_at_weight", "reps", "15");
      await expect(insertRecord("max_reps_at_weight", "reps", "12.500")).rejects.toThrow(/23505.*\(user_id, exercise_id, record_type, at_weight_kg\)/);
    });

    it("the old three-column key is gone and the new index treats NULLs as equal", async () => {
      const indexes = await db.prisma.$queryRawUnsafe<{ indexname: string; indexdef: string }[]>(
        `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'personal_record' AND indexname LIKE 'personal_record_user_exercise_type%'`,
      );
      expect(indexes.map((i) => i.indexname)).toEqual(["personal_record_user_exercise_type_weight_key"]);
      expect(indexes[0]!.indexdef).toMatch(/\(user_id, exercise_id, record_type, at_weight_kg\) NULLS NOT DISTINCT$/);
    });
  });

  describe("07.5 AC15, AC32 — the previous release's statements on the migrated schema", () => {
    it("the old delete and seven-type insert run, and leave no max_reps_at_weight row behind", async () => {
      await insertRecord("max_reps_at_weight", "reps", "12.5");
      await sql(OLD_DELETE, user, [root]);
      for (const [recordType, unit] of OLD_TYPES) {
        await sql(OLD_INSERT, uuidv7(), user, root, recordType, "10.000", unit, null, set, workout, startedAt, "2026-10-02");
      }
      const rows = await db.prisma.$queryRawUnsafe<{ record_type: string; at_weight_kg: string | null }[]>(
        `SELECT record_type, at_weight_kg::text FROM "personal_record" WHERE user_id = $1::uuid ORDER BY record_type`,
        user,
      );
      expect(rows.map((r) => r.record_type)).toEqual(OLD_TYPES.map(([t]) => t).sort());
      expect(rows.every((r) => r.at_weight_kg === null)).toBe(true);
    });
  });

  // Moved from enable-rls-migration (Spec 21.1 Phase A AC5/AC6): the whole-schema no-drift check lives in the newest
  // migration's test.
  describe("AC5, AC6 (Spec 21.1) — schema.prisma matches the migrated schema", () => {
    it("prisma migrate diff reports only the generated set_entry columns and the hand-authored record key", () => {
      const apiDir = fileURLToPath(new URL("../../", import.meta.url));
      const r = spawnSync(
        "pnpm",
        ["exec", "prisma", "migrate", "diff", "--from-url", db.url, "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"],
        { cwd: apiDir, encoding: "utf8" },
      );
      const report = `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`;
      expect(r.status, report).toBe(2);
      const changeLines = r.stdout.split("\n").map((l) => l.trim()).filter((l) => /^\[[*+-]\]/.test(l));
      // The long-standing difference: the two generated set_entry columns (Specs 05.1, 05.3). 0020's role, grants,
      // functions and policies, and 0021's switch, are outside Prisma's model.
      // 0022's key (… NULLS NOT DISTINCT) is hand-authored; Prisma can't model it, so it reads as removed.
      const expected = [
        "[*] Changed the `personal_record` table",
        "[-] Removed unique index on columns (user_id, exercise_id, record_type, at_weight_kg)",
        "[*] Changed the `set_entry` table",
        expect.stringMatching(/^\[\*\] Altered column `weight_kg` \(default changed from `Some\(DbGenerated/),
        expect.stringMatching(/^\[\*\] Altered column `distance_m` \(default changed from `Some\(DbGenerated/),
      ];
      expect(changeLines, report).toEqual(expected);
    });
  });
});
