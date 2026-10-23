// Spec 09.4 AC11–AC14 — `sectionId` on PATCH /v1/workout-exercises/{id}: server-placed, leaves its superset,
// finished-mode records exactly as 07.4 AC7. Real Postgres.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pino } from "pino";
import { uuidv7 } from "uuidv7";
import { NotFoundError } from "../../src/errors/app-error.js";
import { rebuildRecords } from "../../src/records/rebuild.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { lockUserRecords, recomputeRecordsForRoots } from "../../src/repositories/personal-record.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, recordsOf, type RecordRow } from "./records-helpers.js";
import { TRUNCATE_ROUTINES } from "./routine-helpers.js";
import { assertSectionsConsistent, exerciseIdsOf, workoutWithSections } from "./section-helpers.js";

const shape = (rows: RecordRow[]) =>
  rows.map(({ exercise_id, record_type, value, previous_value, source_set_entry_id, workout_id }) => ({
    exercise_id, record_type, value, previous_value, source_set_entry_id, workout_id,
  }));

describe.skipIf(!shouldRunIntegration())("Spec 09.4 — moving an exercise between sections (real Postgres)", () => {
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
  async function rows(workoutId: string) {
    return q<{ id: string; position: number; section_id: string | null; superset_group: number | null }>(
      `SELECT id::text, position, section_id::text, superset_group FROM "workout_exercise" WHERE workout_id = $1::uuid ORDER BY position`, workoutId);
  }
  async function expectDense(workoutId: string) {
    expect((await rows(workoutId)).map((r) => r.position)).toEqual([...(await rows(workoutId)).keys()]);
  }
  async function fixture(sections: string[], exercises: (number | null)[], opts: { finished?: boolean } = {}) {
    const u = await insertUser(db);
    const ex = await insertExercise(db, { ownerUserId: u });
    const w = await workoutWithSections(db, u, ex, { sections: sections.map((name) => ({ name })), exercises, finished: opts.finished ?? false });
    return { u, ex, ...w };
  }

  describe("09.4 AC12 — placement (spec §6.2)", () => {
    // [sections, exercises (section index | null), index of the moved exercise, target section index | null,
    //  expected order as indexes into the original list]
    it.each([
      ["[·A] + empty W, A into W → end", ["W"], [null], 0, 0, [0]],
      ["[a1(W), a2(W), b1(S), ·X] X into W → after a2", ["W", "S"], [0, 0, 1, null], 3, 0, [0, 1, 3, 2]],
      ["[a1(W), b1(S)] a1 to No section → stays first", ["W", "S"], [0, 1], 0, null, [0, 1]],
      ["[·L, a1(W), b1(S), ·Y] b1 to No section → after L", ["W", "S"], [null, 0, 1, null], 2, null, [0, 2, 1, 3]],
      ["[·X, a1(S), ·M, b2(S)] X into S → after b2 (a gap)", ["W", "S"], [null, 1, null, 1], 0, 1, [1, 2, 3, 0]],
      ["[a1(W), b1(S), c1(S)] c1 into the earlier W", ["W", "S"], [0, 1, 1], 2, 0, [0, 2, 1]],
      ["[a1(W), a2(W), b1(S)] a1 into the later S", ["W", "S"], [0, 0, 1], 0, 1, [1, 2, 0]],
      ["[x1(C), ·Y] Y into S, whose predecessors are empty", ["W", "S", "C"], [2, null], 1, 1, [1, 0]],
      ["[a1(W), ·Y] Y to No section with a loose tail is a section no-op", ["W"], [0, null], 1, null, [0, 1]],
    ] as [string, string[], (number | null)[], number, number | null, number[]][])("%s", async (_name, sections, exercises, moved, target, order) => {
      const { u, workoutId, sectionIds, exerciseIds } = await fixture(sections, exercises);
      const sectionId = target === null ? null : sectionIds[target]!;
      const result = await workouts().updateWorkoutExercise(u, exerciseIds[moved]!, { sectionId });
      expect(await exerciseIdsOf(db, workoutId)).toEqual(order.map((i) => exerciseIds[i]));
      expect(result.sectionId).toBe(sectionId);
      expect(result.position).toBe(order.indexOf(moved));
      expect((await rows(workoutId)).find((r) => r.id === exerciseIds[moved])!.section_id).toBe(sectionId);
      await expectDense(workoutId);
    });
  });

  describe("09.4 AC11 — own section only", () => {
    it("another workout's section, another user's, an unknown or malformed id → NotFoundError; nothing moves", async () => {
      const { u, ex, workoutId, exerciseIds } = await fixture(["W"], [0, null]);
      const mine = await workoutWithSections(db, u, ex, { sections: [{ name: "Elsewhere" }], exercises: [0], finished: true });
      const theirs = await fixture(["Theirs"], [0]);
      const before = await rows(workoutId);
      for (const sectionId of [mine.sectionIds[0]!, theirs.sectionIds[0]!, uuidv7(), "nope"]) {
        await expect(workouts().updateWorkoutExercise(u, exerciseIds[1]!, { sectionId })).rejects.toBeInstanceOf(NotFoundError);
      }
      expect(await rows(workoutId)).toEqual(before);
    });
    it("re-sending the stored section moves nothing, even in a non-contiguous list", async () => {
      const { u, workoutId, sectionIds, exerciseIds } = await fixture(["S"], [0, null, 0]);
      const r = await workouts().updateWorkoutExercise(u, exerciseIds[2]!, { sectionId: sectionIds[0]! });
      expect([r.moved, r.sectioned, r.position]).toEqual([false, false, 2]);
      expect(await exerciseIdsOf(db, workoutId)).toEqual(exerciseIds);
    });
  });

  describe("09.4 AC13 — superset", () => {
    it("a member moved across leaves its group; the other member keeps it", async () => {
      const { u, workoutId, sectionIds, exerciseIds } = await fixture(["W", "S"], [0, 0, 1]);
      await db.prisma.$executeRawUnsafe(`UPDATE "workout_exercise" SET superset_group = 3 WHERE id = ANY($1::uuid[])`, [exerciseIds[0], exerciseIds[1]]);
      const r = await workouts().updateWorkoutExercise(u, exerciseIds[1]!, { sectionId: sectionIds[1]! });
      expect([r.supersetGroup, r.sectioned, r.leftSuperset]).toEqual([null, true, true]);
      expect((await rows(workoutId)).find((x) => x.id === exerciseIds[0])!.superset_group).toBe(3);
    });
    it("a body with supersetGroup stores it as sent", async () => {
      const { u, sectionIds, exerciseIds } = await fixture(["W", "S"], [0, 0, 1]);
      await db.prisma.$executeRawUnsafe(`UPDATE "workout_exercise" SET superset_group = 3 WHERE id = $1::uuid`, exerciseIds[0]);
      const r = await workouts().updateWorkoutExercise(u, exerciseIds[0]!, { sectionId: sectionIds[1]!, supersetGroup: 7 });
      expect([r.supersetGroup, r.leftSuperset]).toEqual([7, false]);
    });
    it("a same-section request never changes the group", async () => {
      const { u, sectionIds, exerciseIds } = await fixture(["W"], [0, 0]);
      await db.prisma.$executeRawUnsafe(`UPDATE "workout_exercise" SET superset_group = 3 WHERE id = $1::uuid`, exerciseIds[0]);
      const r = await workouts().updateWorkoutExercise(u, exerciseIds[0]!, { sectionId: sectionIds[0]! });
      expect([r.supersetGroup, r.leftSuperset]).toEqual([3, false]);
    });
  });

  describe("09.4 AC14 — finished mode follows Spec 07.4", () => {
    async function rebuild(userId: string, roots: string[]) {
      await db.prisma.$transaction(async (tx) => {
        await lockUserRecords(tx, userId);
        await recomputeRecordsForRoots(tx, userId, roots);
      });
    }
    async function expectEqualsRebuild(userId: string, roots: string[]) {
      const live = shape(await recordsOf(db, userId));
      await rebuild(userId, roots);
      expect(shape(await recordsOf(db, userId))).toEqual(live);
    }
    const setsOf = (workoutId: string) =>
      q(`SELECT to_jsonb(s) AS j FROM "set_entry" s JOIN "workout_exercise" we ON we.id = s.workout_exercise_id WHERE we.workout_id = $1::uuid ORDER BY s.id`, workoutId);

    it("(a) a repeated-lineage card moved to a new index recomputes its root", async () => {
      const { u, ex, workoutId, sectionIds, exerciseIds } = await fixture(["W", "S"], [0, 0, 1], { finished: true });
      await rebuildRecords(db.prisma, pino({ level: "silent" }), { userId: u });
      const sets = await setsOf(workoutId);
      const r = await workouts().updateWorkoutExercise(u, exerciseIds[0]!, { sectionId: sectionIds[1]! });
      expect([r.moved, r.finishedEdit?.recordsRecomputed, r.finishedEdit?.rootCount]).toEqual([true, true, 1]);
      expect(await setsOf(workoutId)).toEqual(sets);
      await expectEqualsRebuild(u, [ex]);
    });
    it("(b) a single-lineage card moved recomputes nothing", async () => {
      const { u, ex, workoutId, sectionIds, exerciseIds } = await fixture(["W", "S"], [0, 0, 1], { finished: true });
      const [other1, other2] = [await insertExercise(db, { ownerUserId: u }), await insertExercise(db, { ownerUserId: u })];
      await db.prisma.$executeRawUnsafe(`UPDATE "workout_exercise" SET exercise_id = $2::uuid WHERE id = $1::uuid`, exerciseIds[1], other1);
      await db.prisma.$executeRawUnsafe(`UPDATE "workout_exercise" SET exercise_id = $2::uuid WHERE id = $1::uuid`, exerciseIds[2], other2);
      await rebuildRecords(db.prisma, pino({ level: "silent" }), { userId: u });
      const sets = await setsOf(workoutId);
      const r = await workouts().updateWorkoutExercise(u, exerciseIds[0]!, { sectionId: sectionIds[1]! });
      expect([r.moved, r.finishedEdit?.recordsRecomputed]).toEqual([true, false]);
      expect(await setsOf(workoutId)).toEqual(sets);
      await expectEqualsRebuild(u, [ex, other1, other2]);
    });
    it("(c) a section change that leaves the index unchanged recomputes nothing", async () => {
      const { u, ex, workoutId, exerciseIds } = await fixture(["W", "S"], [0, 1], { finished: true });
      await rebuildRecords(db.prisma, pino({ level: "silent" }), { userId: u });
      const r = await workouts().updateWorkoutExercise(u, exerciseIds[0]!, { sectionId: null });
      expect([r.moved, r.sectioned, r.finishedEdit?.recordsRecomputed]).toEqual([false, true, false]);
      expect((await rows(workoutId))[0]!.section_id).toBeNull();
      await expectEqualsRebuild(u, [ex]);
    });
  });
});
