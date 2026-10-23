// Spec 09.4 AC3, AC5–AC10, AC23 — a workout's own section writes (create / update / remove), real Postgres.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pino } from "pino";
import { uuidv7 } from "uuidv7";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { rebuildRecords } from "../../src/records/rebuild.js";
import { NotFoundError, WorkoutSectionLimitError } from "../../src/errors/app-error.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { captureStatements } from "./one-off-helpers.js";
import { insertExercise, insertUser, recordsOf } from "./records-helpers.js";
import { TRUNCATE_ROUTINES } from "./routine-helpers.js";
import { assertSectionsConsistent, insertWorkoutSection, workoutWithSections } from "./section-helpers.js";

describe.skipIf(!shouldRunIntegration())("Spec 09.4 — workout section writes (real Postgres)", () => {
  let db: IntegrationDb;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    if (!db) return;
    await assertSectionsConsistent(db);
    await db.prisma.$executeRawUnsafe(TRUNCATE_ROUTINES);
  });
  const workouts = () => createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
  const q = <T>(sql: string, ...args: unknown[]) => db.prisma.$queryRawUnsafe<T[]>(sql, ...args);
  const sectionsOf = (workoutId: string) =>
    q<{ id: string; position: number; name: string; notes: string | null; added_in_workout: boolean; updated_at: Date }>(
      `SELECT id::text, position, name, notes, added_in_workout, updated_at FROM "workout_section" WHERE workout_id = $1::uuid ORDER BY position`, workoutId);
  /** Everything except the sections, for "untouched" checks. */
  const untouched = async (workoutId: string) => JSON.stringify([
    await q(`SELECT to_jsonb(w) AS j FROM "workout" w WHERE id = $1::uuid`, workoutId),
    await q(`SELECT to_jsonb(we) - 'section_id' AS j FROM "workout_exercise" we WHERE workout_id = $1::uuid ORDER BY position`, workoutId),
    await q(`SELECT to_jsonb(s) AS j FROM "set_entry" s JOIN "workout_exercise" we ON we.id = s.workout_exercise_id WHERE we.workout_id = $1::uuid ORDER BY s.id`, workoutId),
  ]);
  /** Statement log of `run`: was the per-user PR lock taken before the structure prologue? Any personal_record statement? */
  async function statementsOf(run: () => Promise<unknown>) {
    const seen = captureStatements(db);
    seen.length = 0;
    await run();
    const firstLock = seen.findIndex((s) => s.includes("pg_advisory_xact_lock(hashtext("));
    const prologue = seen.findIndex((s) => s.includes("SET CONSTRAINTS workout_exercise_position_key DEFERRED"));
    return { prLockFirst: firstLock >= 0 && firstLock < prologue, touchesRecords: seen.some((s) => s.includes(`"personal_record"`)) };
  }
  async function fixture(opts: { finished?: boolean; sections?: { name: string; added?: boolean }[]; exercises?: (number | null)[] } = {}) {
    const u = await insertUser(db);
    const ex = await insertExercise(db, { ownerUserId: u });
    const w = await workoutWithSections(db, u, ex, {
      sections: opts.sections ?? [], exercises: opts.exercises ?? [null, null], finished: opts.finished ?? false,
    });
    return { u, ex, ...w };
  }

  describe("09.4 AC3 — create", () => {
    it.each([false, true])("finished=%s: position = count, name trimmed, notes as sent, addedInWorkout true; nothing else changes", async (finished) => {
      const { u, workoutId } = await fixture({ finished, sections: [{ name: "Main" }], exercises: [0, null] });
      const before = await untouched(workoutId);
      const a = await workouts().addWorkoutSection(u, workoutId, { name: "Finisher", notes: "EMOM\t10 min\r\nrest" });
      const b = await workouts().addWorkoutSection(u, workoutId, { name: "Cool-down", notes: null });
      expect([a.position, a.name, a.notes, a.addedInWorkout, a.sectionCount, a.workoutId]).toEqual([1, "Finisher", "EMOM\t10 min\r\nrest", true, 2, workoutId]);
      expect([b.position, b.notes, b.sectionCount]).toEqual([2, null, 3]);
      expect((await sectionsOf(workoutId)).map((s) => [s.name, s.added_in_workout])).toEqual([["Main", false], ["Finisher", true], ["Cool-down", true]]);
      expect(await untouched(workoutId)).toBe(before);
      expect(a.finishedEdit).toEqual(finished ? { workoutId, recordsRecomputed: false, rootCount: 0, recomputeMs: 0 } : null);
    });
  });

  describe("09.4 AC5 — cap", () => {
    it("the eighth create succeeds, the ninth is WorkoutSectionLimitError; copied sections count; removing one frees a slot", async () => {
      const { u, workoutId } = await fixture({ sections: [{ name: "Copied 1" }, { name: "Copied 2" }] });
      for (let i = 3; i <= 8; i++) await workouts().addWorkoutSection(u, workoutId, { name: `S${i}`, notes: null });
      await expect(workouts().addWorkoutSection(u, workoutId, { name: "S9", notes: null })).rejects.toBeInstanceOf(WorkoutSectionLimitError);
      expect(await sectionsOf(workoutId)).toHaveLength(8);
      await workouts().removeWorkoutSection(u, (await sectionsOf(workoutId))[0]!.id);
      const again = await workouts().addWorkoutSection(u, workoutId, { name: "S9", notes: null });
      expect([again.position, again.sectionCount]).toEqual([7, 8]);
    });
    it("the database rejects a ninth row and a duplicate position", async () => {
      const { workoutId } = await fixture();
      for (let i = 0; i < 8; i++) await insertWorkoutSection(db, workoutId, i, `S${i}`);
      await expect(insertWorkoutSection(db, workoutId, 8, "S8")).rejects.toThrow(/23514|check constraint/i);
      await expect(insertWorkoutSection(db, workoutId, 3, "dup")).rejects.toThrow(/23505|unique/i);
    });
  });

  describe("09.4 AC6 — update", () => {
    it("changes exactly the keys sent; notes: null clears; id, position and addedInWorkout never change", async () => {
      const { u, workoutId, sectionIds } = await fixture({ sections: [{ name: "Warm-up" }, { name: "Main" }] });
      const s = sectionIds[1]!;
      const r1 = await workouts().updateWorkoutSection(u, s, { notes: "Heavy" });
      expect([r1.name, r1.notes, r1.nameChanged, r1.notesChanged]).toEqual(["Main", "Heavy", false, true]);
      const r2 = await workouts().updateWorkoutSection(u, s, { name: "Strength" });
      expect([r2.name, r2.notes, r2.nameChanged, r2.notesChanged]).toEqual(["Strength", "Heavy", true, false]);
      const r3 = await workouts().updateWorkoutSection(u, s, { notes: null });
      expect([r3.id, r3.position, r3.name, r3.notes, r3.addedInWorkout, r3.workoutId]).toEqual([s, 1, "Strength", null, false, workoutId]);
      expect((await sectionsOf(workoutId)).map((x) => [x.id, x.position, x.added_in_workout])).toEqual([[sectionIds[0], 0, false], [s, 1, false]]);
    });
    it.each([false, true])("finished=%s: {} and an equal body write nothing (updated_at unchanged, finishedEdit null)", async (finished) => {
      const { u, workoutId, sectionIds } = await fixture({ finished, sections: [{ name: "Warm-up" }] });
      const s = sectionIds[0]!;
      const before = (await sectionsOf(workoutId))[0]!.updated_at;
      for (const patch of [{}, { name: "Warm-up" }, { notes: null }, { name: "Warm-up", notes: null }]) {
        const r = await workouts().updateWorkoutSection(u, s, patch);
        expect([r.nameChanged, r.notesChanged, r.finishedEdit]).toEqual([false, false, null]);
      }
      expect((await sectionsOf(workoutId))[0]!.updated_at).toEqual(before);
      const changed = await workouts().updateWorkoutSection(u, s, { name: "Prep" });
      expect(changed.finishedEdit).toEqual(finished ? { workoutId, recordsRecomputed: false, rootCount: 0, recomputeMs: 0 } : null);
      expect((await sectionsOf(workoutId))[0]!.updated_at.getTime()).toBeGreaterThan(before.getTime());
    });
  });

  describe("09.4 AC7 — remove", () => {
    it("[a1(W), a2(W), ·L, b1(S)] remove W: exercises kept in place, loose; S and C renumbered 0, 1; repeat is 404", async () => {
      const { u, workoutId, sectionIds, exerciseIds } = await fixture({
        sections: [{ name: "W" }, { name: "S" }, { name: "C" }], exercises: [0, 0, null, 1],
      });
      await db.prisma.$executeRawUnsafe(`UPDATE "workout_exercise" SET notes = 'keep me' WHERE id = $1::uuid`, exerciseIds[0]);
      const exercisesBefore = await untouched(workoutId);
      const r = await workouts().removeWorkoutSection(u, sectionIds[0]!);
      expect([r.workoutId, r.exerciseCount, r.finishedEdit]).toEqual([workoutId, 2, null]);
      expect((await sectionsOf(workoutId)).map((s) => [s.id, s.position])).toEqual([[sectionIds[1], 0], [sectionIds[2], 1]]);
      const rows = await q<{ id: string; position: number; section_id: string | null }>(
        `SELECT id::text, position, section_id::text FROM "workout_exercise" WHERE workout_id = $1::uuid ORDER BY position`, workoutId);
      expect(rows.map((x) => [x.id, x.position, x.section_id])).toEqual([
        [exerciseIds[0], 0, null], [exerciseIds[1], 1, null], [exerciseIds[2], 2, null], [exerciseIds[3], 3, sectionIds[1]],
      ]);
      expect(await untouched(workoutId)).toBe(exercisesBefore);
      await expect(workouts().removeWorkoutSection(u, sectionIds[0]!)).rejects.toBeInstanceOf(NotFoundError);
    });
    it("remove the first of three, then create: positions [0, 1, 2], the new one at 2 (Review Focus 4)", async () => {
      const { u, workoutId, sectionIds } = await fixture({ sections: [{ name: "A" }, { name: "B" }, { name: "C" }] });
      await workouts().removeWorkoutSection(u, sectionIds[0]!);
      const created = await workouts().addWorkoutSection(u, workoutId, { name: "D", notes: null });
      expect(created.position).toBe(2);
      expect((await sectionsOf(workoutId)).map((s) => [s.name, s.position])).toEqual([["B", 0], ["C", 1], ["D", 2]]);
    });
  });

  describe("09.4 AC8 — authorization", () => {
    it("malformed, missing and foreign ids are NotFoundError on all three methods", async () => {
      const { workoutId, sectionIds } = await fixture({ sections: [{ name: "W" }] });
      const other = await insertUser(db);
      const before = await sectionsOf(workoutId);
      for (const wid of ["nope", uuidv7(), workoutId]) {
        await expect(workouts().addWorkoutSection(other, wid, { name: "X", notes: null })).rejects.toBeInstanceOf(NotFoundError);
      }
      for (const sid of ["nope", uuidv7(), sectionIds[0]!]) {
        await expect(workouts().updateWorkoutSection(other, sid, { name: "X" })).rejects.toBeInstanceOf(NotFoundError);
        await expect(workouts().removeWorkoutSection(other, sid)).rejects.toBeInstanceOf(NotFoundError);
      }
      expect(await sectionsOf(workoutId)).toEqual(before);
    });
  });

  describe("09.4 AC9 — finished mode", () => {
    it("each write takes the PR lock first, touches no personal_record, and leaves the workout, History row and records equal", async () => {
      const { u, workoutId, sectionIds } = await fixture({ finished: true, sections: [{ name: "W" }], exercises: [0, null] });
      await rebuildRecords(db.prisma, pino({ level: "silent" }), { userId: u });
      const span = () => q(`SELECT started_at, ended_at, local_date FROM "workout" WHERE id = $1::uuid`, workoutId);
      const before = { span: await span(), history: await workouts().listFinishedWorkouts(u, { limit: 10 }), records: await recordsOf(db, u) };
      expect(before.records.length).toBeGreaterThan(0);

      let created!: Awaited<ReturnType<ReturnType<typeof workouts>["addWorkoutSection"]>>;
      const add = await statementsOf(async () => { created = await workouts().addWorkoutSection(u, workoutId, { name: "Finisher", notes: null }); });
      let updated!: Awaited<ReturnType<ReturnType<typeof workouts>["updateWorkoutSection"]>>;
      const upd = await statementsOf(async () => { updated = await workouts().updateWorkoutSection(u, sectionIds[0]!, { name: "Warm" }); });
      let removed!: Awaited<ReturnType<ReturnType<typeof workouts>["removeWorkoutSection"]>>;
      const rem = await statementsOf(async () => { removed = await workouts().removeWorkoutSection(u, sectionIds[0]!); });

      for (const s of [add, upd, rem]) expect(s).toEqual({ prLockFirst: true, touchesRecords: false });
      for (const r of [created, updated, removed]) expect(r.finishedEdit?.recordsRecomputed).toBe(false);
      expect(await span()).toEqual(before.span);
      expect(await workouts().listFinishedWorkouts(u, { limit: 10 })).toEqual(before.history);
      expect(await recordsOf(db, u)).toEqual(before.records);
    });
  });

  describe("09.4 AC10 — live mode", () => {
    it("no PR lock on a live workout", async () => {
      const { u, workoutId, sectionIds } = await fixture({ sections: [{ name: "W" }] });
      const add = await statementsOf(() => workouts().addWorkoutSection(u, workoutId, { name: "X", notes: null }));
      const upd = await statementsOf(() => workouts().updateWorkoutSection(u, sectionIds[0]!, { name: "Y" }));
      const rem = await statementsOf(() => workouts().removeWorkoutSection(u, sectionIds[0]!));
      for (const s of [add, upd, rem]) expect(s).toEqual({ prLockFirst: false, touchesRecords: false });
    });
  });
});
