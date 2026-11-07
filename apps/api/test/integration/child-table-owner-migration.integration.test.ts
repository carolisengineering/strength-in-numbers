// Spec 21.1 Phase A, AC1–AC6 — migration 0019 (an owner column on the eight child tables), real Postgres.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { applyMigrationFile, insertExercise, insertUser, shouldRunIntegration, startBareDb, type IntegrationDb } from "./helpers.js";
import { CHILD_LINKS, ownerMismatches, type ChildTable } from "./owner-consistency.js";

const MIGRATIONS = readdirSync(fileURLToPath(new URL("../../prisma/migrations/", import.meta.url)))
  .filter((d) => /^\d{4}_/.test(d))
  .sort();
const OWNER_MIGRATION = "0019_child_table_owner";
const BACKFILL_MARKER = "-- @@ backfill";

/** Runs SQL text the way `applyMigrationFile` runs a file (Prisma's `db execute`), so PL/pgSQL bodies work. */
function applySqlText(url: string, sql: string): void {
  execFileSync("pnpm", ["exec", "prisma", "db", "execute", "--url", url, "--stdin"], { input: sql, stdio: ["pipe", "inherit", "inherit"] });
}

interface Tree {
  user: string;
  workout: string;
  workoutSection: string;
  workoutExercise: string;
  set: string;
  plannedSet: string;
  routine: string;
  routineSection: string;
  routineItem: string;
  routineItemSet: string;
}

describe.skipIf(!shouldRunIntegration())("Spec 21.1 Phase A — migration 0019 (real Postgres)", () => {
  let db: IntegrationDb;
  let exercise: string;
  let a: Tree;
  let b: Tree;
  /** The set inserted after the fill triggers exist and before the backfill runs (Review Focus 1). */
  let midMigrationSet: string;
  /** `is_nullable` of `workout.user_id` and `routine.user_id` before `0019` (Review Focus 2). */
  let rootNullable: Record<string, string>;

  const sql = (text: string, ...args: unknown[]) => db.prisma.$executeRawUnsafe(text, ...args);
  const one = async <T>(text: string, ...args: unknown[]) => (await db.prisma.$queryRawUnsafe<T[]>(text, ...args))[0]!;
  const ownerOf = async (table: ChildTable, where: string, ...args: unknown[]) =>
    (await one<{ user_id: string | null }>(`SELECT user_id::text FROM "${table}" WHERE ${where}`, ...args)).user_id;

  /** A whole tree for one user (a finished workout, so a user may have several): every one of the eight child tables gets a row. Inserts never name `user_id`. */
  async function insertTree(user: string): Promise<Tree> {
    const t: Tree = {
      user,
      workout: uuidv7(),
      workoutSection: uuidv7(),
      workoutExercise: uuidv7(),
      set: uuidv7(),
      plannedSet: uuidv7(),
      routine: uuidv7(),
      routineSection: uuidv7(),
      routineItem: uuidv7(),
      routineItemSet: uuidv7(),
    };
    await sql(
      `INSERT INTO "workout" ("id","user_id","started_at","ended_at","local_date","tz_offset_minutes","client_generated_id")
       VALUES ($1::uuid,$2::uuid,now() - interval '1 hour',now(),current_date,0,$3::uuid)`,
      t.workout,
      user,
      uuidv7(),
    );
    await sql(`INSERT INTO "workout_section" (id, workout_id, position, name) VALUES ($1::uuid, $2::uuid, 0, 'Main')`, t.workoutSection, t.workout);
    await sql(
      `INSERT INTO "workout_exercise" (id, workout_id, position, exercise_id, exercise_name_snapshot, modality_snapshot, section_id)
       VALUES ($1::uuid, $2::uuid, 0, $3::uuid, 'Bench', 'weight_reps', $4::uuid)`,
      t.workoutExercise,
      t.workout,
      exercise,
      t.workoutSection,
    );
    await insertSet(t.set, t.workoutExercise, 1);
    await sql(`INSERT INTO "workout_planned_set" (id, workout_exercise_id, position) VALUES ($1::uuid, $2::uuid, 0)`, t.plannedSet, t.workoutExercise);
    await sql(`INSERT INTO "workout_section_round" (workout_section_id, round_no, seconds) VALUES ($1::uuid, 1, 60)`, t.workoutSection);
    await sql(`INSERT INTO "routine" (id, user_id, name) VALUES ($1::uuid, $2::uuid, $3)`, t.routine, user, `R ${t.routine}`);
    await sql(`INSERT INTO "routine_section" (id, routine_id, position, name) VALUES ($1::uuid, $2::uuid, 0, 'Main')`, t.routineSection, t.routine);
    await sql(
      `INSERT INTO "routine_item" (id, routine_id, position, exercise_id, section_id) VALUES ($1::uuid, $2::uuid, 0, $3::uuid, $4::uuid)`,
      t.routineItem,
      t.routine,
      exercise,
      t.routineSection,
    );
    await sql(`INSERT INTO "routine_item_set" (id, routine_item_id, position) VALUES ($1::uuid, $2::uuid, 0)`, t.routineItemSet, t.routineItem);
    return t;
  }

  async function insertSet(id: string, workoutExercise: string, setNumber: number) {
    await sql(
      `INSERT INTO "set_entry" (id, workout_exercise_id, set_number, client_generated_id) VALUES ($1::uuid, $2::uuid, $3, $4::uuid)`,
      id,
      workoutExercise,
      setNumber,
      uuidv7(),
    );
  }

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startBareDb();
    for (const dir of MIGRATIONS.filter((d) => d < OWNER_MIGRATION)) applyMigrationFile(db.url, dir);
    const roots = await db.prisma.$queryRawUnsafe<{ table_name: string; is_nullable: string }[]>(
      `SELECT table_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'user_id' AND table_name IN ('workout', 'routine')`,
    );
    rootNullable = Object.fromEntries(roots.map((r) => [r.table_name, r.is_nullable]));
    exercise = await insertExercise(db, { name: "Bench" });
    a = await insertTree(await insertUser(db));
    b = await insertTree(await insertUser(db));

    // The migration in two halves, as a live API could see it: a set inserted between the trigger step
    // and the backfill must be filled by the trigger, not left NULL to fail the NOT NULL step.
    const text = readFileSync(fileURLToPath(new URL(`../../prisma/migrations/${OWNER_MIGRATION}/migration.sql`, import.meta.url)), "utf8");
    const at = text.indexOf(BACKFILL_MARKER);
    if (at < 0) throw new Error(`${OWNER_MIGRATION} has no "${BACKFILL_MARKER}" marker`);
    applySqlText(db.url, text.slice(0, at));
    midMigrationSet = uuidv7();
    await insertSet(midMigrationSet, a.workoutExercise, 2);
    applySqlText(db.url, text.slice(at));
    for (const dir of MIGRATIONS.filter((d) => d > OWNER_MIGRATION)) applyMigrationFile(db.url, dir);
  }, 240_000);
  afterAll(async () => {
    await db?.stop();
  });

  describe("AC1 — every child row has the right owner", () => {
    it("user_id is NOT NULL on all eight child tables", async () => {
      const rows = await db.prisma.$queryRawUnsafe<{ table_name: string; is_nullable: string; data_type: string }[]>(
        `SELECT table_name, is_nullable, data_type FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'user_id' AND table_name = ANY($1::text[]) ORDER BY table_name`,
        CHILD_LINKS.map((l) => l.child),
      );
      expect(rows).toHaveLength(8);
      for (const r of rows) expect(r, r.table_name).toMatchObject({ is_nullable: "NO", data_type: "uuid" });
    });

    it("the consistency query returns 0 for every table", async () => {
      expect(await ownerMismatches(db)).toEqual(Object.fromEntries(CHILD_LINKS.map((l) => [l.child, 0])));
    });

    it("each backfilled row carries its own root's owner, not the other user's", async () => {
      for (const t of [a, b]) {
        expect(await ownerOf("workout_exercise", "id = $1::uuid", t.workoutExercise)).toBe(t.user);
        expect(await ownerOf("workout_section", "id = $1::uuid", t.workoutSection)).toBe(t.user);
        expect(await ownerOf("set_entry", "id = $1::uuid", t.set)).toBe(t.user);
        expect(await ownerOf("workout_planned_set", "id = $1::uuid", t.plannedSet)).toBe(t.user);
        expect(await ownerOf("workout_section_round", "workout_section_id = $1::uuid", t.workoutSection)).toBe(t.user);
        expect(await ownerOf("routine_item", "id = $1::uuid", t.routineItem)).toBe(t.user);
        expect(await ownerOf("routine_section", "id = $1::uuid", t.routineSection)).toBe(t.user);
        expect(await ownerOf("routine_item_set", "id = $1::uuid", t.routineItemSet)).toBe(t.user);
      }
    });
  });

  describe("AC2 — inserts that do not mention user_id still work", () => {
    it("a new row of each child table gets its parent's owner from the fill trigger", async () => {
      const t = await insertTree(b.user);
      expect(await ownerOf("workout_exercise", "id = $1::uuid", t.workoutExercise)).toBe(b.user);
      expect(await ownerOf("workout_section", "id = $1::uuid", t.workoutSection)).toBe(b.user);
      expect(await ownerOf("set_entry", "id = $1::uuid", t.set)).toBe(b.user);
      expect(await ownerOf("workout_planned_set", "id = $1::uuid", t.plannedSet)).toBe(b.user);
      expect(await ownerOf("workout_section_round", "workout_section_id = $1::uuid", t.workoutSection)).toBe(b.user);
      expect(await ownerOf("routine_item", "id = $1::uuid", t.routineItem)).toBe(b.user);
      expect(await ownerOf("routine_section", "id = $1::uuid", t.routineSection)).toBe(b.user);
      expect(await ownerOf("routine_item_set", "id = $1::uuid", t.routineItemSet)).toBe(b.user);
      expect(await ownerMismatches(db)).toEqual(Object.fromEntries(CHILD_LINKS.map((l) => [l.child, 0])));
    });
  });

  describe("Review Focus — the migration window", () => {
    it("a set inserted after the triggers and before the backfill is filled by the trigger", async () => {
      expect(await ownerOf("set_entry", "id = $1::uuid", midMigrationSet)).toBe(a.user);
    });
    it("every root owner was already NOT NULL before 0019, so a trigger can never fill NULL", () => {
      expect(rootNullable).toEqual({ workout: "NO", routine: "NO" });
    });
  });
});
