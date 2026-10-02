import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { SET_TYPE_VALUES } from "@sin/core";
import { applyMigrationFile, shouldRunIntegration, startBareDb, type IntegrationDb } from "./helpers.js";

const MIGRATIONS = [
  "0001_create_user",
  "0002_create_exercise_catalog",
  "0003_exercise_fork_provenance",
  "0004_exercise_change_xid",
  "0005_create_workout_session",
  "0006_create_set_entry",
];
const CLIENT_ID_MIGRATION = "0007_set_entry_client_generated_id";

/**
 * Spec 05.1 §4 / §10 AC1, AC2 — migrates a fresh container through 0001..0007,
 * asserts set_entry's exact shape, the generated-column arithmetic, and the
 * whole-schema no-drift check. The drift check lives in the NEWEST
 * migration's test: it diffs the migrated DB against the full schema.prisma,
 * so it can only pass once every migration is applied. 0007 is applied after
 * a row already exists, the way it meets a live table.
 */
describe.skipIf(!shouldRunIntegration())("AC1/AC2 — 0006_create_set_entry + 0007 (real Postgres)", () => {
  let db: IntegrationDb;
  let weId: string;
  let preExistingSetId: string;

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startBareDb();
    for (const m of MIGRATIONS) applyMigrationFile(db.url, m);

    const userId = uuidv7();
    const exerciseId = uuidv7();
    const workoutId = uuidv7();
    weId = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "user" ("id", "auth_sub", "email") VALUES ($1::uuid, $2, 'u@ex.com')`,
      userId,
      `auth0|${userId}`,
    );
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" ("id", "name", "modality", "is_active") VALUES ($1::uuid, 'Bench', 'weight_reps', true)`,
      exerciseId,
    );
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "workout" ("id", "user_id", "started_at", "local_date", "tz_offset_minutes", "client_generated_id")
       VALUES ($1::uuid, $2::uuid, now(), current_date, 0, $3::uuid)`,
      workoutId,
      userId,
      uuidv7(),
    );
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "workout_exercise" ("id", "workout_id", "position", "exercise_id", "exercise_name_snapshot", "modality_snapshot")
       VALUES ($1::uuid, $2::uuid, 0, $3::uuid, 'Bench', 'weight_reps')`,
      weId,
      workoutId,
      exerciseId,
    );
    preExistingSetId = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "set_entry" ("id", "workout_exercise_id", "set_number", "reps") VALUES ($1::uuid, $2::uuid, 1, 5)`,
      preExistingSetId,
      weId,
    );
    applyMigrationFile(db.url, CLIENT_ID_MIGRATION);
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  let nextSetNumber = 2;
  async function insertSet(cols: Record<string, unknown>): Promise<Record<string, unknown>> {
    const names = ["id", "workout_exercise_id", "set_number", ...Object.keys(cols)];
    const values = [uuidv7(), weId, nextSetNumber++, ...Object.values(cols)];
    const placeholders = names.map((n, i) =>
      n === "id" || n === "workout_exercise_id" ? `$${i + 1}::uuid` : `$${i + 1}`,
    );
    const rows = await db.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `INSERT INTO "set_entry" (${names.map((n) => `"${n}"`).join(", ")}) VALUES (${placeholders.join(", ")})
       RETURNING weight_kg::float8 AS weight_kg, distance_m::float8 AS distance_m, set_type, is_complete`,
      ...values,
    );
    return rows[0]!;
  }

  it("creates set_entry with the exact §4 columns, types and nullability", async () => {
    const cols = await db.prisma.$queryRawUnsafe<
      {
        column_name: string;
        data_type: string;
        is_nullable: string;
        numeric_precision: number | null;
        numeric_scale: number | null;
        is_generated: string;
      }[]
    >(
      `SELECT column_name, data_type, is_nullable, numeric_precision, numeric_scale, is_generated
       FROM information_schema.columns WHERE table_name = 'set_entry' ORDER BY ordinal_position`,
    );
    const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));
    expect(Object.keys(byName)).toEqual([
      "id", "workout_exercise_id", "set_number", "set_type", "reps", "weight", "weight_unit",
      "weight_kg", "distance", "distance_unit", "distance_m", "duration_s", "rpe",
      "is_complete", "completed_at", "created_at", "updated_at", "client_generated_id",
    ]);
    expect(byName.client_generated_id).toMatchObject({ data_type: "uuid", is_nullable: "YES" });
    expect(byName.id).toMatchObject({ data_type: "uuid", is_nullable: "NO" });
    expect(byName.workout_exercise_id).toMatchObject({ data_type: "uuid", is_nullable: "NO" });
    expect(byName.set_number).toMatchObject({ data_type: "smallint", is_nullable: "NO" });
    expect(byName.set_type).toMatchObject({ data_type: "text", is_nullable: "NO" });
    expect(byName.reps).toMatchObject({ data_type: "smallint", is_nullable: "YES" });
    expect(byName.weight).toMatchObject({ data_type: "numeric", numeric_precision: 7, numeric_scale: 3, is_nullable: "YES" });
    expect(byName.weight_kg).toMatchObject({ data_type: "numeric", numeric_precision: 7, numeric_scale: 3, is_generated: "ALWAYS" });
    expect(byName.distance).toMatchObject({ data_type: "numeric", numeric_precision: 9, numeric_scale: 3 });
    expect(byName.distance_m).toMatchObject({ data_type: "numeric", numeric_precision: 9, numeric_scale: 3, is_generated: "ALWAYS" });
    expect(byName.duration_s).toMatchObject({ data_type: "integer", is_nullable: "YES" });
    expect(byName.rpe).toMatchObject({ data_type: "numeric", numeric_precision: 3, numeric_scale: 1 });
    expect(byName.is_complete).toMatchObject({ data_type: "boolean", is_nullable: "NO" });
    expect(byName.completed_at).toMatchObject({ data_type: "timestamp with time zone", is_nullable: "YES" });
    expect(byName.created_at).toMatchObject({ is_nullable: "NO" });
    expect(byName.updated_at).toMatchObject({ is_nullable: "NO" });
  });

  it("declares the FK to workout_exercise as ON DELETE CASCADE, the three CHECKs, and the plain unique index", async () => {
    const fk = await db.prisma.$queryRawUnsafe<{ confdeltype: string }[]>(
      `SELECT confdeltype FROM pg_constraint WHERE conname = 'set_entry_workout_exercise_id_fkey'`,
    );
    expect(fk[0]?.confdeltype).toBe("c");

    const checks = await db.prisma.$queryRawUnsafe<{ conname: string }[]>(
      `SELECT conname FROM pg_constraint WHERE contype = 'c' AND conrelid = 'set_entry'::regclass ORDER BY conname`,
    );
    expect(checks.map((c) => c.conname)).toEqual([
      "set_entry_distance_unit_check",
      "set_entry_set_type_check",
      "set_entry_weight_unit_check",
    ]);

    const idx = await db.prisma.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'set_entry_workout_exercise_number_key'`,
    );
    expect(idx[0]?.indexdef).toContain("UNIQUE INDEX");
    expect(idx[0]?.indexdef).toContain("(workout_exercise_id, set_number)");
  });

  it("AC22 — 0007 is additive: a row written before it keeps its data and holds a NULL key", async () => {
    const rows = await db.prisma.$queryRawUnsafe<{ reps: number; client_generated_id: string | null }[]>(
      `SELECT reps, client_generated_id FROM "set_entry" WHERE id = $1::uuid`,
      preExistingSetId,
    );
    expect(rows).toEqual([{ reps: 5, client_generated_id: null }]);
  });

  it("AC22 — the key is unique per workout_exercise; any number of sets may have none", async () => {
    const idx = await db.prisma.$queryRawUnsafe<{ indexdef: string }[]>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'set_entry_workout_exercise_client_id_key'`,
    );
    expect(idx[0]?.indexdef).toContain("UNIQUE INDEX");
    expect(idx[0]?.indexdef).toContain("(workout_exercise_id, client_generated_id)");

    const key = uuidv7();
    const insertKeyed = (k: string | null) =>
      db.prisma.$executeRawUnsafe(
        `INSERT INTO "set_entry" ("id", "workout_exercise_id", "set_number", "client_generated_id")
         VALUES ($1::uuid, $2::uuid, $3, $4::uuid)`,
        uuidv7(),
        weId,
        nextSetNumber++,
        k,
      );
    await insertKeyed(key);
    await expect(insertKeyed(key)).rejects.toThrow(/client_generated_id/);
    await insertKeyed(null);
    await insertKeyed(null);
  });

  it("§4 — the generated columns convert with the canonical constants", async () => {
    expect(await insertSet({ weight: 100, weight_unit: "lb" })).toMatchObject({ weight_kg: 45.359 });
    expect(await insertSet({ weight: 60, weight_unit: "kg" })).toMatchObject({ weight_kg: 60 });
    expect(await insertSet({ distance: 5, distance_unit: "km" })).toMatchObject({ distance_m: 5000 });
    expect(await insertSet({ distance: 1, distance_unit: "mi" })).toMatchObject({ distance_m: 1609.344 });
    expect(await insertSet({ distance: 400, distance_unit: "m" })).toMatchObject({ distance_m: 400 });
    expect(await insertSet({ duration_s: 60 })).toMatchObject({ weight_kg: null, distance_m: null });
  });

  it("defaults set_type to 'working' and is_complete to false", async () => {
    expect(await insertSet({})).toMatchObject({ set_type: "working", is_complete: false });
  });

  it("AC2 — rejects an out-of-vocabulary set_type and accepts every SET_TYPE_VALUES member", async () => {
    await expect(insertSet({ set_type: "amrap" })).rejects.toThrow(/set_entry_set_type_check/);
    for (const t of SET_TYPE_VALUES) {
      await expect(insertSet({ set_type: t })).resolves.toMatchObject({ set_type: t });
    }
  });

  it("AC1 — prisma migrate diff (migrated DB → schema.prisma) reports no difference beyond the two generated columns", () => {
    // spawnSync, not execFileSync + try/catch: a CLI that fails to run at all
    // must FAIL this test, not look like "no diff" (05.0 D49's pattern).
    //
    // Prisma has no generated-column DSL: it introspects `weight_kg` /
    // `distance_m` as columns whose default is `dbgenerated(<expression>)`,
    // while the model declares none, and reports that as a changed default.
    // Declaring `@default(dbgenerated(...))` would silence it, but a later
    // `migrate dev` would then emit `ALTER COLUMN ... SET DEFAULT`, which
    // Postgres rejects on a generated column. So the model stays default-free
    // and this test pins the diff to exactly those two columns — any other
    // reported change is real drift (Spec 05.1 §4; plan Task 1 Step 8 fallback).
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
