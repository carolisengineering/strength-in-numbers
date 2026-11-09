// Spec 21.1 Phase A, AC1–AC6 — migration 0019 (an owner column on the eight child tables), real Postgres.
// The whole-schema `prisma migrate diff` no-drift check moved to app-role-migration with 0020 (apps/api CLAUDE.md).
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

  describe("AC2, AC5 — inserts that do not mention user_id (every writer and fixture before 0019) still work", () => {
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

  describe("AC3 — a wrong user_id is refused by the database", () => {
    /** Inserts one row of `child` under A's parent while naming B as its owner. */
    const insertUnderAAsB: Record<ChildTable, () => Promise<unknown>> = {
      workout_exercise: () =>
        sql(
          `INSERT INTO "workout_exercise" (id, workout_id, position, exercise_id, exercise_name_snapshot, modality_snapshot, user_id)
           VALUES ($1::uuid, $2::uuid, 1, $3::uuid, 'Bench', 'weight_reps', $4::uuid)`,
          uuidv7(),
          a.workout,
          exercise,
          b.user,
        ),
      workout_section: () =>
        sql(`INSERT INTO "workout_section" (id, workout_id, position, name, user_id) VALUES ($1::uuid, $2::uuid, 1, 'X', $3::uuid)`, uuidv7(), a.workout, b.user),
      set_entry: () =>
        sql(
          `INSERT INTO "set_entry" (id, workout_exercise_id, set_number, client_generated_id, user_id) VALUES ($1::uuid, $2::uuid, 9, $3::uuid, $4::uuid)`,
          uuidv7(),
          a.workoutExercise,
          uuidv7(),
          b.user,
        ),
      workout_planned_set: () =>
        sql(`INSERT INTO "workout_planned_set" (id, workout_exercise_id, position, user_id) VALUES ($1::uuid, $2::uuid, 1, $3::uuid)`, uuidv7(), a.workoutExercise, b.user),
      workout_section_round: () =>
        sql(`INSERT INTO "workout_section_round" (workout_section_id, round_no, seconds, user_id) VALUES ($1::uuid, 2, 120, $2::uuid)`, a.workoutSection, b.user),
      routine_item: () =>
        sql(`INSERT INTO "routine_item" (id, routine_id, position, exercise_id, user_id) VALUES ($1::uuid, $2::uuid, 1, $3::uuid, $4::uuid)`, uuidv7(), a.routine, exercise, b.user),
      routine_section: () =>
        sql(`INSERT INTO "routine_section" (id, routine_id, position, name, user_id) VALUES ($1::uuid, $2::uuid, 1, 'X', $3::uuid)`, uuidv7(), a.routine, b.user),
      routine_item_set: () =>
        sql(`INSERT INTO "routine_item_set" (id, routine_item_id, position, user_id) VALUES ($1::uuid, $2::uuid, 1, $3::uuid)`, uuidv7(), a.routineItem, b.user),
    };

    it.each(CHILD_LINKS.map((l) => l.child))("a %s row naming another owner than its parent's fails 23503", async (child) => {
      await expect(insertUnderAAsB[child]()).rejects.toThrow(/23503/);
    });

    /** Inserts one row of `child` under a parent id that exists nowhere, leaving `user_id` to the trigger. */
    const insertUnderMissingParent: Record<ChildTable, () => Promise<unknown>> = {
      workout_exercise: () =>
        sql(
          `INSERT INTO "workout_exercise" (id, workout_id, position, exercise_id, exercise_name_snapshot, modality_snapshot)
           VALUES ($1::uuid, $2::uuid, 0, $3::uuid, 'Bench', 'weight_reps')`,
          uuidv7(),
          uuidv7(),
          exercise,
        ),
      workout_section: () => sql(`INSERT INTO "workout_section" (id, workout_id, position, name) VALUES ($1::uuid, $2::uuid, 0, 'X')`, uuidv7(), uuidv7()),
      set_entry: () =>
        sql(`INSERT INTO "set_entry" (id, workout_exercise_id, set_number, client_generated_id) VALUES ($1::uuid, $2::uuid, 1, $3::uuid)`, uuidv7(), uuidv7(), uuidv7()),
      workout_planned_set: () =>
        sql(`INSERT INTO "workout_planned_set" (id, workout_exercise_id, position) VALUES ($1::uuid, $2::uuid, 0)`, uuidv7(), uuidv7()),
      workout_section_round: () =>
        sql(`INSERT INTO "workout_section_round" (workout_section_id, round_no, seconds) VALUES ($1::uuid, 1, 60)`, uuidv7()),
      routine_item: () =>
        sql(`INSERT INTO "routine_item" (id, routine_id, position, exercise_id) VALUES ($1::uuid, $2::uuid, 0, $3::uuid)`, uuidv7(), uuidv7(), exercise),
      routine_section: () => sql(`INSERT INTO "routine_section" (id, routine_id, position, name) VALUES ($1::uuid, $2::uuid, 0, 'X')`, uuidv7(), uuidv7()),
      routine_item_set: () => sql(`INSERT INTO "routine_item_set" (id, routine_item_id, position) VALUES ($1::uuid, $2::uuid, 0)`, uuidv7(), uuidv7()),
    };

    it.each(CHILD_LINKS.map((l) => l.child))("a %s row under a parent that exists nowhere still fails 23503, not 23502", async (child) => {
      // The fill trigger finds no parent; it raises the foreign-key violation itself rather than leaving user_id
      // NULL for NOT NULL to refuse first (code review). Callers that read the SQLSTATE see what they saw before 0019.
      await expect(insertUnderMissingParent[child]()).rejects.toThrow(/23503/);
    });

    it("moving A's set (number 2; B's exercise has only 1) under B's workout exercise fails 23503", async () => {
      await expect(sql(`UPDATE "set_entry" SET workout_exercise_id = $1::uuid WHERE id = $2::uuid`, b.workoutExercise, midMigrationSet)).rejects.toThrow(/23503/);
    });

    it("rewriting a child's owner fails 23503", async () => {
      await expect(sql(`UPDATE "routine_item_set" SET user_id = $1::uuid WHERE id = $2::uuid`, b.user, a.routineItemSet)).rejects.toThrow(/23503/);
      await expect(
        sql(`UPDATE "workout_section_round" SET user_id = $1::uuid WHERE workout_section_id = $2::uuid`, b.user, a.workoutSection),
      ).rejects.toThrow(/23503/);
    });
  });

  describe("AC4 — composite foreign keys replace the single-column ones and keep ON DELETE CASCADE", () => {
    const countWhere = async (table: ChildTable | "workout" | "routine", where: string, ...args: unknown[]) =>
      (await one<{ n: number }>(`SELECT count(*)::int AS n FROM "${table}" WHERE ${where}`, ...args)).n;

    it("deleting a workout removes its exercises, sections, rounds, sets and planned sets", async () => {
      const t = await insertTree(await insertUser(db));
      await sql(`DELETE FROM "workout" WHERE id = $1::uuid`, t.workout);
      expect(await countWhere("workout_exercise", "workout_id = $1::uuid", t.workout)).toBe(0);
      expect(await countWhere("workout_section", "workout_id = $1::uuid", t.workout)).toBe(0);
      expect(await countWhere("workout_section_round", "workout_section_id = $1::uuid", t.workoutSection)).toBe(0);
      expect(await countWhere("set_entry", "id = $1::uuid", t.set)).toBe(0);
      expect(await countWhere("workout_planned_set", "id = $1::uuid", t.plannedSet)).toBe(0);
      expect(await countWhere("routine_item_set", "id = $1::uuid", t.routineItemSet)).toBe(1);
    });

    it("deleting a routine removes its items, item sets and sections", async () => {
      const t = await insertTree(await insertUser(db));
      await sql(`DELETE FROM "routine" WHERE id = $1::uuid`, t.routine);
      expect(await countWhere("routine_item", "routine_id = $1::uuid", t.routine)).toBe(0);
      expect(await countWhere("routine_section", "routine_id = $1::uuid", t.routine)).toBe(0);
      expect(await countWhere("routine_item_set", "id = $1::uuid", t.routineItemSet)).toBe(0);
      expect(await countWhere("set_entry", "id = $1::uuid", t.set)).toBe(1);
    });

    it("deleting a user removes every row of theirs and leaves the other user's", async () => {
      const user = await insertUser(db);
      await insertTree(user);
      await sql(`DELETE FROM "user" WHERE id = $1::uuid`, user);
      for (const { child } of CHILD_LINKS) {
        expect(await countWhere(child, "user_id = $1::uuid", user), child).toBe(0);
        expect(await countWhere(child, "user_id = $1::uuid", a.user), child).toBeGreaterThan(0);
      }
    });

    it("pg_constraint has the eight composite keys (cascading) and none of the old single-column ones", async () => {
      const rows = await db.prisma.$queryRawUnsafe<{ conname: string; child: string; parent: string; cols: number; del: string; upd: string; valid: boolean }[]>(
        `SELECT conname, conrelid::regclass::text AS child, confrelid::regclass::text AS parent, cardinality(conkey) AS cols,
                confdeltype::text AS del, confupdtype::text AS upd, convalidated AS valid
           FROM pg_constraint WHERE contype = 'f' AND conrelid::regclass::text = ANY($1::text[])`,
        CHILD_LINKS.map((l) => l.child),
      );
      const names = rows.map((r) => r.conname);
      for (const { child, parent, oldFkey } of CHILD_LINKS) {
        expect(names, oldFkey).not.toContain(oldFkey);
        const owner = rows.find((r) => r.conname === `${child}_${parent}_owner_fkey`);
        expect(owner, `${child} → ${parent}`).toEqual({
          conname: `${child}_${parent}_owner_fkey`,
          child,
          parent,
          cols: 2,
          del: "c",
          upd: "c",
          valid: true,
        });
      }
    });
  });

  // AC5/AC6's whole-schema no-drift check moved to app-role-migration (0020 is the newest migration).

  describe("Review Focus — the migration window", () => {
    it("a set inserted after the triggers and before the backfill is filled by the trigger", async () => {
      expect(await ownerOf("set_entry", "id = $1::uuid", midMigrationSet)).toBe(a.user);
    });
    it("the first statements take every lock up front, in the API's write order (routine, workout, then parents before children), with a lock timeout", () => {
      // `prisma migrate deploy` runs the file as one transaction, so each lock is held to the commit. Taking them all in
      // one statement, before the long work, in the order the API's locking writes use, keeps the conflict window to
      // that statement (a read naming a child first can still deadlock with it; the runbook covers the retry).
      const text = readFileSync(fileURLToPath(new URL(`../../prisma/migrations/${OWNER_MIGRATION}/migration.sql`, import.meta.url)), "utf8");
      const statements = text
        .split("\n")
        .filter((l) => l.trim() !== "" && !l.trim().startsWith("--"))
        .join("\n")
        .split(";")
        .map((s) => s.replace(/\s+/g, " ").trim());
      expect(statements[0]).toBe("SET lock_timeout = '5s'");
      expect(statements[1]).toBe(
        'LOCK TABLE "routine", "workout", "routine_item", "routine_section", "routine_item_set", "workout_exercise", "workout_section", "set_entry", "workout_planned_set", "workout_section_round" IN ACCESS EXCLUSIVE MODE',
      );
      expect(statements.filter((s) => s !== "").at(-1)).toBe("RESET lock_timeout");
    });
    it("every root owner was already NOT NULL before 0019, so a trigger can never fill NULL", () => {
      expect(rootNullable).toEqual({ workout: "NO", routine: "NO" });
    });
  });
});
