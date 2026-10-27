// Spec 19.0 AC19 / AC20 — migration 0016 (the hevy tables, the widened source CHECK), real Postgres.
// Owns the whole-schema `prisma migrate diff` no-drift check (moved here from new-modalities-migration, CLAUDE.md).
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { tableHash } from "./account-helpers.js";
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

async function insertWorkout(db: IntegrationDb, userId: string, source = "manual"): Promise<string> {
  const id = uuidv7();
  await db.prisma.$executeRawUnsafe(
    `INSERT INTO "workout" ("id","user_id","started_at","ended_at","local_date","tz_offset_minutes","client_generated_id","source")
     VALUES ($1::uuid,$2::uuid,now() - interval '1 hour',now(),current_date,0,$3::uuid,$4)`,
    id,
    userId,
    uuidv7(),
    source,
  );
  return id;
}

/** Runs a statement that must fail and returns the Postgres error text (it names the constraint). */
async function failure(db: IntegrationDb, sql: string, ...params: unknown[]): Promise<string> {
  try {
    await db.prisma.$executeRawUnsafe(sql, ...params);
  } catch (e) {
    return String((e as Error).message);
  }
  throw new Error("expected the statement to fail");
}

const pairSql = `INSERT INTO "hevy_exercise_pair" ("user_id","hevy_template_id","hevy_title","hevy_type","role","exercise_id","measure_rule","export_as")
  VALUES ($1::uuid,$2,$3,$4,$5,$6::uuid,$7,$8)`;
const linkSql = `INSERT INTO "hevy_link" ("id","user_id","workout_id","hevy_workout_id","origin","claimed_at")
  VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6::timestamptz)`;

describe.skipIf(!shouldRunIntegration())("Spec 19.0 — migration 0016 (real Postgres)", () => {
  let db: IntegrationDb;
  let user: string;
  let exercise: string;
  let workoutHash: string;
  let exerciseHash: string;

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startBareDb();
    for (const dir of MIGRATIONS.filter((d) => d < "0016")) applyMigrationFile(db.url, dir);
    user = await insertUser(db);
    exercise = await insertExercise(db, { ownerUserId: user, modality: "weight_reps" });
    await insertWorkout(db, user);
    workoutHash = await tableHash(db, "workout");
    exerciseHash = await tableHash(db, "exercise");
    for (const dir of MIGRATIONS.filter((d) => d >= "0016")) applyMigrationFile(db.url, dir);
  }, 240_000);
  afterAll(async () => {
    await db?.stop();
  });

  describe("19.0 AC19 — 0016 applied to a database with data", () => {
    it("existing workout and exercise rows are unchanged", async () => {
      expect(await tableHash(db, "workout")).toBe(workoutHash);
      expect(await tableHash(db, "exercise")).toBe(exerciseHash);
    });

    it("creates the four tables with the §4 columns", async () => {
      const rows = await db.prisma.$queryRawUnsafe<{ table_name: string; column_name: string; data_type: string; is_nullable: string }[]>(
        `SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns
         WHERE table_name IN ('hevy_exercise_pair','hevy_section_rule','hevy_link','hevy_account') ORDER BY table_name, ordinal_position`,
      );
      const by = (t: string) => rows.filter((r) => r.table_name === t).map((r) => `${r.column_name}:${r.data_type}:${r.is_nullable}`);
      expect(by("hevy_exercise_pair")).toEqual([
        "user_id:uuid:NO",
        "hevy_template_id:text:NO",
        "hevy_title:text:NO",
        "hevy_type:text:YES",
        "role:text:NO",
        "exercise_id:uuid:YES",
        "measure_rule:text:YES",
        "export_as:boolean:NO",
        "created_at:timestamp with time zone:NO",
        "updated_at:timestamp with time zone:NO",
      ]);
      expect(by("hevy_section_rule")).toEqual(["user_id:uuid:NO", "name_key:text:NO", "name:text:NO", "treatment:text:NO"]);
      expect(by("hevy_link")).toEqual([
        "id:uuid:NO",
        "user_id:uuid:NO",
        "workout_id:uuid:YES",
        "hevy_workout_id:text:YES",
        "origin:text:NO",
        "claimed_at:timestamp with time zone:YES",
        "synced_fingerprint:text:YES",
        "synced_at:timestamp with time zone:YES",
        "created_at:timestamp with time zone:NO",
        "updated_at:timestamp with time zone:NO",
      ]);
      expect(by("hevy_account")).toEqual(["user_id:uuid:NO", "records_stale:boolean:NO", "updated_at:timestamp with time zone:NO"]);
    });

    it("a valid exercise pair, a skip, both placeholders and an unsupported skip insert", async () => {
      const u = await insertUser(db);
      const ex = await insertExercise(db, { ownerUserId: u });
      await db.prisma.$executeRawUnsafe(pairSql, u, "E1", "Bench", "weight_reps", "exercise", ex, null, true);
      await db.prisma.$executeRawUnsafe(pairSql, u, "S1", "Stretch", "duration", "skip", null, null, false);
      await db.prisma.$executeRawUnsafe(pairSql, u, "W1", "Warmup", "reps_only", "warmup_placeholder", null, null, false);
      await db.prisma.$executeRawUnsafe(pairSql, u, "W2", "Workout", "reps_only", "workout_placeholder", null, null, false);
      // D19: an unsupported Hevy type is a skip with no type.
      await db.prisma.$executeRawUnsafe(pairSql, u, "U1", "Stair machine", null, "skip", null, null, false);
    });

    it.each([
      ["an unknown type", ["X", "t", "cardio", "skip", null, null, false], "hevy_exercise_pair_type_check"],
      ["an unknown role", ["X", "t", "duration", "superset", null, null, false], "hevy_exercise_pair_role_check"],
      ["an unknown rule", ["X", "t", "weight_reps", "exercise", "EX", "double", false], "hevy_exercise_pair_rule_check"],
      ["an exercise pair with no exercise", ["X", "t", "weight_reps", "exercise", null, null, false], "hevy_exercise_pair_exercise_role_check"],
      ["a skip with an exercise", ["X", "t", "weight_reps", "skip", "EX", null, false], "hevy_exercise_pair_exercise_role_check"],
      ["export_as on a skip", ["X", "t", "weight_reps", "skip", null, null, true], "hevy_exercise_pair_export_role_check"],
      ["a rule on a skip", ["X", "t", "reps_only", "skip", null, "calories_as_reps", false], "hevy_exercise_pair_rule_role_check"],
      ["no type on an exercise pair", ["X", "t", null, "exercise", "EX", null, false], "hevy_exercise_pair_type_role_check"],
    ] as const)("rejects %s", async (_l, cells, constraint) => {
      const u = await insertUser(db);
      const ex = await insertExercise(db, { ownerUserId: u });
      const values = cells.map((c) => (c === "EX" ? ex : c));
      expect(await failure(db, pairSql, u, ...values)).toContain(constraint);
    });

    it("rejects a second export_as for one exercise, a duplicate template id and a second warm-up marker", async () => {
      const u = await insertUser(db);
      const ex = await insertExercise(db, { ownerUserId: u });
      await db.prisma.$executeRawUnsafe(pairSql, u, "A", "a", "weight_reps", "exercise", ex, null, true);
      // A raw query's unique violation names its columns, not the index (repositories/pg-errors.ts).
      expect(await failure(db, pairSql, u, "B", "b", "weight_reps", "exercise", ex, null, true)).toContain("Key (user_id, exercise_id)");
      expect(await failure(db, pairSql, u, "A", "a", "duration", "skip", null, null, false)).toContain("Key (user_id, hevy_template_id)");
      await db.prisma.$executeRawUnsafe(pairSql, u, "W1", "Warmup", "reps_only", "warmup_placeholder", null, null, false);
      expect(await failure(db, pairSql, u, "W2", "Warmup 2", "reps_only", "warmup_placeholder", null, null, false)).toContain(
        "Key (user_id, role)",
      );
    });

    it("rejects an unknown treatment and an unknown origin", async () => {
      const u = await insertUser(db);
      expect(
        await failure(db, `INSERT INTO "hevy_section_rule" ("user_id","name_key","name","treatment") VALUES ($1::uuid,'a','A','skip')`, u),
      ).toContain("hevy_section_rule_treatment_check");
      expect(await failure(db, linkSql, uuidv7(), u, null, "H1", "copied", null)).toContain("hevy_link_origin_check");
    });

    it("rejects a link that is neither linked nor claimed, a duplicate Hevy id and a second link for one workout", async () => {
      const u = await insertUser(db);
      const w1 = await insertWorkout(db, u);
      const w2 = await insertWorkout(db, u);
      expect(await failure(db, linkSql, uuidv7(), u, w1, null, "sent", null)).toContain("hevy_link_state_check");
      await db.prisma.$executeRawUnsafe(linkSql, uuidv7(), u, w1, "H1", "sent", null);
      expect(await failure(db, linkSql, uuidv7(), u, w2, "H1", "sent", null)).toContain("Key (user_id, hevy_workout_id)");
      expect(await failure(db, linkSql, uuidv7(), u, w1, "H2", "sent", null)).toContain("Key (workout_id)");
    });

    it("deleting a linked workout leaves a tombstone", async () => {
      const u = await insertUser(db);
      const w = await insertWorkout(db, u);
      const id = uuidv7();
      await db.prisma.$executeRawUnsafe(linkSql, id, u, w, "H9", "sent", null);
      await db.prisma.$executeRawUnsafe(`DELETE FROM "workout" WHERE id = $1::uuid`, w);
      const rows = await db.prisma.$queryRawUnsafe<{ workout_id: string | null; hevy_workout_id: string }[]>(
        `SELECT workout_id::text, hevy_workout_id FROM "hevy_link" WHERE id = $1::uuid`,
        id,
      );
      expect(rows).toEqual([{ workout_id: null, hevy_workout_id: "H9" }]);
    });

    it("deleting the user cascades all four tables", async () => {
      const u = await insertUser(db);
      const ex = await insertExercise(db, { ownerUserId: u });
      const w = await insertWorkout(db, u);
      await db.prisma.$executeRawUnsafe(pairSql, u, "A", "a", "weight_reps", "exercise", ex, null, true);
      await db.prisma.$executeRawUnsafe(`INSERT INTO "hevy_section_rule" VALUES ($1::uuid,'accessory','Accessory','notes_on_first')`, u);
      await db.prisma.$executeRawUnsafe(linkSql, uuidv7(), u, w, "H5", "sent", null);
      await db.prisma.$executeRawUnsafe(`INSERT INTO "hevy_account" ("user_id") VALUES ($1::uuid)`, u);
      await db.prisma.$executeRawUnsafe(`DELETE FROM "user" WHERE id = $1::uuid`, u);
      for (const table of ["hevy_exercise_pair", "hevy_section_rule", "hevy_link", "hevy_account"]) {
        const rows = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table}" WHERE user_id = $1::uuid`, u);
        expect(Number(rows[0]!.n), table).toBe(0);
      }
    });

    it("workout.source takes 'hevy' and refuses 'strava'", async () => {
      await insertWorkout(db, user, "hevy");
      expect(await failure(db, `UPDATE "workout" SET source = 'strava' WHERE user_id = $1::uuid`, user)).toContain("workout_source_check");
    });

    it("the exercise the setup created is still there", async () => {
      const rows = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "exercise" WHERE id = $1::uuid`, exercise);
      expect(Number(rows[0]!.n)).toBe(1);
    });
  });

  it("19.0 AC20 — prisma migrate diff reports no difference beyond the two generated set_entry columns", () => {
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
