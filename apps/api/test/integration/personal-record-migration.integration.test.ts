import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { RECORD_UNIT_BY_TYPE } from "@sin/core";
import { applyMigrationFile, shouldRunIntegration, startBareDb, type IntegrationDb } from "./helpers.js";

const MIGRATIONS = [
  "0001_create_user",
  "0002_create_exercise_catalog",
  "0003_exercise_fork_provenance",
  "0004_exercise_change_xid",
  "0005_create_workout_session",
  "0006_create_set_entry",
  "0007_set_entry_client_generated_id",
];

/**
 * Spec 07.0 AC1/AC2 — 0008 on top of 0001..0007. The whole-schema no-drift
 * check lives in the NEWEST migration's test (it diffs against the full
 * schema.prisma, so it can only pass once every migration is applied); it
 * moved on to routine-migration.integration.test.ts (0009, Spec 09 AC27).
 */
describe.skipIf(!shouldRunIntegration())("AC1/AC2 — 0008_create_personal_record (real Postgres)", () => {
  let db: IntegrationDb;
  const ids = { user: uuidv7(), exercise: uuidv7(), workout: uuidv7(), we: uuidv7(), set: uuidv7() };

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startBareDb();
    for (const m of MIGRATIONS) applyMigrationFile(db.url, m);
    applyMigrationFile(db.url, "0008_create_personal_record");
    const p = db.prisma;
    await p.$executeRawUnsafe(`INSERT INTO "user" ("id","auth_sub","email") VALUES ($1::uuid,$2,'u@ex.com')`, ids.user, `auth0|${ids.user}`);
    await p.$executeRawUnsafe(`INSERT INTO "exercise" ("id","name","modality","is_active") VALUES ($1::uuid,'Bench','weight_reps',true)`, ids.exercise);
    await p.$executeRawUnsafe(
      `INSERT INTO "workout" ("id","user_id","started_at","ended_at","local_date","tz_offset_minutes","client_generated_id")
       VALUES ($1::uuid,$2::uuid,now(),now(),current_date,0,$3::uuid)`,
      ids.workout,
      ids.user,
      uuidv7(),
    );
    await p.$executeRawUnsafe(
      `INSERT INTO "workout_exercise" ("id","workout_id","position","exercise_id","exercise_name_snapshot","modality_snapshot")
       VALUES ($1::uuid,$2::uuid,0,$3::uuid,'Bench','weight_reps')`,
      ids.we,
      ids.workout,
      ids.exercise,
    );
    await p.$executeRawUnsafe(
      `INSERT INTO "set_entry" ("id","workout_exercise_id","set_number","reps","weight","weight_unit") VALUES ($1::uuid,$2::uuid,1,5,100,'kg')`,
      ids.set,
      ids.we,
    );
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  async function insertRecord(recordType: string, unit: string, value = "100.000"): Promise<void> {
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "personal_record" ("id","user_id","exercise_id","record_type","value","unit","source_set_entry_id","workout_id","achieved_at","local_date")
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::numeric,$6,$7::uuid,$8::uuid,now(),current_date)`,
      uuidv7(),
      ids.user,
      ids.exercise,
      recordType,
      value,
      unit,
      ids.set,
      ids.workout,
    );
  }

  it("AC1 — exact columns, types and nullability", async () => {
    const cols = await db.prisma.$queryRawUnsafe<
      { column_name: string; data_type: string; is_nullable: string; numeric_precision: number | null; numeric_scale: number | null }[]
    >(
      `SELECT column_name, data_type, is_nullable, numeric_precision, numeric_scale
       FROM information_schema.columns WHERE table_name = 'personal_record' ORDER BY ordinal_position`,
    );
    expect(cols.map((c) => [c.column_name, c.data_type, c.is_nullable])).toEqual([
      ["id", "uuid", "NO"],
      ["user_id", "uuid", "NO"],
      ["exercise_id", "uuid", "NO"],
      ["record_type", "text", "NO"],
      ["value", "numeric", "NO"],
      ["unit", "text", "NO"],
      ["previous_value", "numeric", "YES"],
      ["source_set_entry_id", "uuid", "NO"],
      ["workout_id", "uuid", "NO"],
      ["achieved_at", "timestamp with time zone", "NO"],
      ["local_date", "date", "NO"],
      ["created_at", "timestamp with time zone", "NO"],
    ]);
    const value = cols.find((c) => c.column_name === "value")!;
    expect([value.numeric_precision, value.numeric_scale]).toEqual([12, 3]);
  });

  it("AC1 — four cascading FKs and the three indexes", async () => {
    const fks = await db.prisma.$queryRawUnsafe<{ conname: string; confdeltype: string }[]>(
      `SELECT conname, confdeltype FROM pg_constraint WHERE conrelid = 'personal_record'::regclass AND contype = 'f' ORDER BY conname`,
    );
    expect(fks).toHaveLength(4);
    expect(fks.every((f) => f.confdeltype === "c")).toBe(true);
    const idx = await db.prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'personal_record' ORDER BY indexname`,
    );
    expect(idx.map((i) => i.indexname)).toEqual([
      "personal_record_pkey",
      "personal_record_source_set_idx",
      "personal_record_user_exercise_type_key",
      "personal_record_workout_idx",
    ]);
  });

  it("AC2 — rejects bad type, bad unit, mismatched pair, zero value; accepts every legal pair", async () => {
    await expect(insertRecord("rep_pr_at_weight", "kg")).rejects.toThrow(/personal_record_record_type_check/);
    // An unknown unit also breaks the type↔unit pairing, and Postgres may
    // report either constraint first — both are the vocabulary guard.
    await expect(insertRecord("heaviest_weight", "lb")).rejects.toThrow(/personal_record_(type_)?unit_check/);
    await expect(insertRecord("max_reps", "kg")).rejects.toThrow(/personal_record_type_unit_check/);
    await expect(insertRecord("heaviest_weight", "kg", "0")).rejects.toThrow(/personal_record_value_check/);
    for (const [type, unit] of Object.entries(RECORD_UNIT_BY_TYPE)) {
      await expect(insertRecord(type, unit)).resolves.toBeUndefined();
    }
  });

  it("AC2 — the hostile-but-valid max set volume fits numeric(12,3) (D4)", async () => {
    await db.prisma.$executeRawUnsafe(`DELETE FROM "personal_record"`);
    await expect(insertRecord("best_set_volume", "kg_reps", "327666967.233")).resolves.toBeUndefined();
  });

  // The whole-schema `prisma migrate diff` no-drift check moved to the newest
  // migration's test (routine-migration.integration.test.ts, Spec 09 AC27).
});
