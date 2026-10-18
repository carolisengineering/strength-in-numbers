import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { applyMigrationFile, shouldRunIntegration, startBareDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, logWorkout } from "./records-helpers.js";

const BEFORE_0011 = [
  "0001_create_user", "0002_create_exercise_catalog", "0003_exercise_fork_provenance",
  "0004_exercise_change_xid", "0005_create_workout_session", "0006_create_set_entry",
  "0007_set_entry_client_generated_id", "0008_create_personal_record", "0009_create_routines",
  "0010_create_planned_sets",
];

// AC22's whole-schema `prisma migrate diff` check moved to 0012's test (07.4 AC18, CLAUDE.md).
describe.skipIf(!shouldRunIntegration())("Spec 09.2 — migration 0011 (real Postgres)", () => {
  let db: IntegrationDb;
  const ids: Record<string, string> = {};
  let before = "";
  const q = <T>(sql: string, ...args: unknown[]) => db.prisma.$queryRawUnsafe<T[]>(sql, ...args);
  const x = (sql: string, ...args: unknown[]) => db.prisma.$executeRawUnsafe(sql, ...args);
  /** Every pre-0011 row as jsonb; after the migration the three altered tables drop the new column. */
  const snapshot = async (afterMigration: boolean): Promise<string> => {
    const j = (table: string, drop?: string) =>
      q(`SELECT to_jsonb(t)${afterMigration && drop ? ` - '${drop}'` : ""} AS j FROM "${table}" t ORDER BY id`);
    return JSON.stringify({
      routine: await j("routine"),
      item: await j("routine_item", "section_id"),
      workout: await j("workout", "routine_notes_snapshot"),
      we: await j("workout_exercise", "section_id"),
    });
  };

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startBareDb();
    for (const m of BEFORE_0011) applyMigrationFile(db.url, m);
    // Pre-0011 data: a routine with items, a workout started from it, a manual finished workout.
    const u = await insertUser(db);
    const ex = await insertExercise(db);
    ids.user = u;
    ids.routine = uuidv7();
    await x(`INSERT INTO "routine" (id, user_id, name, notes) VALUES ($1::uuid, $2::uuid, 'Old', 'a note')`, ids.routine, u);
    ids.item = uuidv7();
    await x(
      `INSERT INTO "routine_item" (id, routine_id, position, exercise_id) VALUES ($1::uuid, $2::uuid, 0, $3::uuid)`,
      ids.item, ids.routine, ex,
    );
    const w = await logWorkout(db, u, { startedAt: new Date(Date.now() - 86_400_000), exercises: [{ exerciseId: ex, sets: [{ reps: 5, weight: 5 }] }] });
    ids.workout = w.workoutId;
    await x(`UPDATE "workout" SET routine_id = $1::uuid, routine_name_snapshot = 'Old' WHERE id = $2::uuid`, ids.routine, w.workoutId);
    before = await snapshot(false);
    applyMigrationFile(db.url, "0011_create_routine_sections");
  }, 240_000);
  afterAll(async () => {
    await db?.stop();
  });

  it("AC21 — no backfill: zero section rows, every new column NULL, no existing value changed", async () => {
    for (const t of ["routine_section", "workout_section"]) {
      expect((await q<{ n: number }>(`SELECT count(*)::int AS n FROM "${t}"`))[0]!.n).toBe(0);
    }
    expect((await q<{ n: number }>(`SELECT count(*)::int AS n FROM "routine_item" WHERE section_id IS NOT NULL`))[0]!.n).toBe(0);
    expect((await q<{ n: number }>(`SELECT count(*)::int AS n FROM "workout_exercise" WHERE section_id IS NOT NULL`))[0]!.n).toBe(0);
    expect((await q<{ n: number }>(`SELECT count(*)::int AS n FROM "workout" WHERE routine_notes_snapshot IS NOT NULL`))[0]!.n).toBe(0);
    expect(await snapshot(true)).toBe(before);
  });

  it("AC20 — the database rejects each contract violation on both section tables", async () => {
    const targets = [
      { table: "routine_section", fk: "routine_id", parent: ids.routine! },
      { table: "workout_section", fk: "workout_id", parent: ids.workout! },
    ];
    for (const { table, fk, parent } of targets) {
      const insert = (cols: string, vals: string, position: number) =>
        x(`INSERT INTO "${table}" (id, ${fk}, position, ${cols}) VALUES ($1::uuid, $2::uuid, ${position}, ${vals})`, uuidv7(), parent);
      await expect(insert("name", `'ok'`, 8), `${table}: position 8`).rejects.toThrow();
      await expect(insert("name", `'ok'`, -1), `${table}: position -1`).rejects.toThrow();
      await expect(insert("name", `''`, 0), `${table}: empty name`).rejects.toThrow();
      await expect(insert("name", `'${"n".repeat(41)}'`, 0), `${table}: 41-char name`).rejects.toThrow();
      await expect(insert("name", `' padded'`, 0), `${table}: leading space`).rejects.toThrow();
      await expect(insert("name", `'padded '`, 0), `${table}: trailing space`).rejects.toThrow();
      await expect(insert("name, notes", `'ok', ''`, 0), `${table}: empty notes`).rejects.toThrow();
      await expect(insert("name, notes", `'ok', '${"x".repeat(2001)}'`, 0), `${table}: 2001-char notes`).rejects.toThrow();
      // The legal extremes are accepted: 40-char name, 2000-char notes, NULL notes; positions 0..7.
      await insert("name, notes", `'${"n".repeat(40)}', '${"x".repeat(2000)}'`, 0);
      await expect(insert("name", `'dup'`, 0), `${table}: duplicate (parent, position)`).rejects.toThrow();
      for (let p = 1; p <= 7; p += 1) await insert("name", `'s${p}'`, p);
      await expect(insert("name", `'ninth'`, 8), `${table}: ninth section`).rejects.toThrow();
    }
    await expect(x(`UPDATE "workout" SET routine_notes_snapshot = '' WHERE id = $1::uuid`, ids.workout)).rejects.toThrow();
    await expect(x(`UPDATE "workout" SET routine_notes_snapshot = $2 WHERE id = $1::uuid`, ids.workout, "x".repeat(2001))).rejects.toThrow();
    await x(`UPDATE "workout" SET routine_notes_snapshot = $2 WHERE id = $1::uuid`, ids.workout, "x".repeat(2000));
    await x(`UPDATE "workout" SET routine_notes_snapshot = NULL WHERE id = $1::uuid`, ids.workout);
  });

  it("AC20 — deleting a section NULLs its items' section_id and never deletes them; deleting the parent cascades", async () => {
    const section = (await q<{ id: string }>(`SELECT id::text FROM "routine_section" WHERE routine_id = $1::uuid AND position = 1`, ids.routine))[0]!.id;
    await x(`UPDATE "routine_item" SET section_id = $1::uuid WHERE id = $2::uuid`, section, ids.item);
    await x(`DELETE FROM "routine_section" WHERE id = $1::uuid`, section);
    const item = await q<{ section_id: string | null }>(`SELECT section_id::text FROM "routine_item" WHERE id = $1::uuid`, ids.item);
    expect(item).toEqual([{ section_id: null }]);

    const wsec = (await q<{ id: string }>(`SELECT id::text FROM "workout_section" WHERE workout_id = $1::uuid AND position = 1`, ids.workout))[0]!.id;
    await x(`UPDATE "workout_exercise" SET section_id = $1::uuid WHERE workout_id = $2::uuid`, wsec, ids.workout);
    await x(`DELETE FROM "workout_section" WHERE id = $1::uuid`, wsec);
    expect((await q<{ n: number }>(`SELECT count(*)::int AS n FROM "workout_exercise" WHERE workout_id = $1::uuid AND section_id IS NULL`, ids.workout))[0]!.n).toBeGreaterThan(0);

    await x(`DELETE FROM "routine" WHERE id = $1::uuid`, ids.routine);
    expect((await q<{ n: number }>(`SELECT count(*)::int AS n FROM "routine_section"`))[0]!.n).toBe(0);
    await x(`DELETE FROM "workout" WHERE id = $1::uuid`, ids.workout);
    expect((await q<{ n: number }>(`SELECT count(*)::int AS n FROM "workout_section"`))[0]!.n).toBe(0);
  });

  it("AC20 — both partial indexes on section_id exist", async () => {
    const rows = await q<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'
         AND indexname IN ('routine_item_section_idx', 'workout_exercise_section_idx')`,
    );
    expect(rows.map((r) => r.indexname).sort()).toEqual(["routine_item_section_idx", "workout_exercise_section_idx"]);
    for (const r of rows) expect(r.indexdef).toMatch(/WHERE \(section_id IS NOT NULL\)/);
  });
});
