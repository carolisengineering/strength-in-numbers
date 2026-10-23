import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { NotFoundError, WorkoutSectionLimitError, type AppError } from "../../src/errors/app-error.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser } from "./records-helpers.js";
import { TRUNCATE_ROUTINES } from "./routine-helpers.js";
import { assertSectionsConsistent, workoutWithSections } from "./section-helpers.js";

/**
 * Spec 09.4 AC5 / AC10 / AC15 — section writes raced against each other, exercise adds and moves, set writes,
 * a finish and a discard. Each iteration uses fresh rows, runs the pair with Promise.allSettled, and checks:
 * every rejection is an expected AppError (never 40P01 / 40001 or anything a route would answer 500), the
 * sections stay consistent, and exercise positions stay dense and unique.
 */
const ITERATIONS = 50;

type Outcome = PromiseSettledResult<unknown>;

describe.skipIf(!shouldRunIntegration())("Spec 09.4 — workout section races (real Postgres)", () => {
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

  /** A rejection must be one of `allowed` — any other error (a deadlock, a serialization failure, a raw Prisma error) is a 500. */
  function rejectedWith(o: Outcome, ...allowed: (abstract new (...args: never[]) => AppError)[]): boolean {
    if (o.status === "fulfilled") return false;
    const err = o.reason as Error;
    expect(String(err?.message ?? err)).not.toMatch(/40P01|40001|deadlock|could not serialize/i);
    expect(allowed.some((E) => err instanceof E), `unexpected rejection: ${String(err?.stack ?? err)}`).toBe(true);
    return true;
  }
  const ok = (o: Outcome) => o.status === "fulfilled";
  const value = <T>(o: PromiseSettledResult<T>) => (o as PromiseFulfilledResult<T>).value;

  async function expectConsistent(workoutId: string) {
    await assertSectionsConsistent(db);
    const positions = (await q<{ position: number }>(
      `SELECT position FROM "workout_exercise" WHERE workout_id = $1::uuid ORDER BY position`, workoutId)).map((r) => r.position);
    expect(positions).toEqual([...positions.keys()]);
  }

  async function fresh(sections: { name: string; added?: boolean }[], exercises: (number | null)[]) {
    const u = await insertUser(db);
    const ex = await insertExercise(db, { ownerUserId: u });
    const w = await workoutWithSections(db, u, ex, { sections, exercises });
    // One complete working set, so a finish is legal.
    await workouts().createSet(u, w.exerciseIds[0]!, { reps: 5, weight: 100, weightUnit: "kg", isComplete: true });
    return { u, ex, ...w };
  }

  it("09.4 AC5 — two creates at seven: exactly one 201 and one workout-section-limit, eight rows", async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const { u, workoutId } = await fresh([1, 2, 3, 4, 5, 6, 7].map((n) => ({ name: `S${n}` })), [0]);
      const [a, b] = await Promise.allSettled([
        workouts().addWorkoutSection(u, workoutId, { name: "A", notes: null }),
        workouts().addWorkoutSection(u, workoutId, { name: "B", notes: null }),
      ]);
      const rejected = [a!, b!].filter((o) => rejectedWith(o, WorkoutSectionLimitError));
      expect([[a!, b!].filter(ok).length, rejected.length]).toEqual([1, 1]);
      expect((await q<{ n: number }>(`SELECT count(*)::int AS n FROM "workout_section" WHERE workout_id = $1::uuid`, workoutId))[0]!.n).toBe(8);
      await expectConsistent(workoutId);
    }
  }, 300_000);

  it.each(["create", "update", "remove"] as const)("09.4 AC10 — section %s × finish: both succeed, the write ran live or in finished mode", async (kind) => {
    for (let i = 0; i < ITERATIONS; i++) {
      const { u, workoutId, sectionIds } = await fresh([{ name: "W", added: true }], [0, null]);
      const write = () =>
        kind === "create" ? workouts().addWorkoutSection(u, workoutId, { name: "C", notes: null })
        : kind === "update" ? workouts().updateWorkoutSection(u, sectionIds[0]!, { name: "Renamed" })
        : workouts().removeWorkoutSection(u, sectionIds[0]!);
      const [w, f] = await Promise.allSettled([write(), workouts().updateWorkout(u, workoutId, { endedAt: new Date().toISOString() })]);
      expect([ok(w!), ok(f!)], String((w as PromiseRejectedResult).reason ?? (f as PromiseRejectedResult).reason)).toEqual([true, true]);
      const edit = value(w!).finishedEdit;
      expect(edit === null || edit.recordsRecomputed === false).toBe(true);
      await expectConsistent(workoutId);
    }
  }, 300_000);

  describe("09.4 AC15", () => {
    it("(a) two moves of one exercise", async () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const { u, workoutId, sectionIds, exerciseIds } = await fresh([{ name: "W" }, { name: "S" }], [0, 1, null]);
        const outs = await Promise.allSettled([
          workouts().updateWorkoutExercise(u, exerciseIds[2]!, { sectionId: sectionIds[0]! }),
          workouts().updateWorkoutExercise(u, exerciseIds[2]!, { sectionId: sectionIds[1]! }),
        ]);
        expect(outs.every(ok)).toBe(true);
        await expectConsistent(workoutId);
      }
    }, 300_000);

    it("(b) a move × removal of its target section: the move lands or is 404, never a dangling section_id", async () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const { u, workoutId, sectionIds, exerciseIds } = await fresh([{ name: "W" }, { name: "S" }], [0, null]);
        const [m, r] = await Promise.allSettled([
          workouts().updateWorkoutExercise(u, exerciseIds[1]!, { sectionId: sectionIds[1]! }),
          workouts().removeWorkoutSection(u, sectionIds[1]!),
        ]);
        expect(ok(r!)).toBe(true);
        if (!ok(m!)) rejectedWith(m!, NotFoundError);
        const [row] = await q<{ section_id: string | null }>(`SELECT section_id::text FROM "workout_exercise" WHERE id = $1::uuid`, exerciseIds[1]);
        expect(row!.section_id).toBeNull();
        await expectConsistent(workoutId);
      }
    }, 300_000);

    it("(c) a move × a plain add", async () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const { u, ex, workoutId, sectionIds, exerciseIds } = await fresh([{ name: "W" }, { name: "S", added: true }], [0, 1, null]);
        const outs = await Promise.allSettled([
          workouts().updateWorkoutExercise(u, exerciseIds[2]!, { sectionId: sectionIds[0]! }),
          workouts().addWorkoutExercise(u, workoutId, { exerciseId: ex }),
        ]);
        expect(outs.every(ok)).toBe(true);
        await expectConsistent(workoutId);
      }
    }, 300_000);

    it("(d) a section create × a plain add: the add is in the new section or loose", async () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const { u, ex, workoutId } = await fresh([{ name: "W" }], [0]);
        const [c, a] = await Promise.allSettled([
          workouts().addWorkoutSection(u, workoutId, { name: "C", notes: null }),
          workouts().addWorkoutExercise(u, workoutId, { exerciseId: ex }),
        ]);
        expect([ok(c!), ok(a!)]).toEqual([true, true]);
        expect([null, value(c!).id]).toContain(value(a!).sectionId);
        await expectConsistent(workoutId);
      }
    }, 300_000);

    it("(e) a section remove × a set write on one of its exercises", async () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const { u, workoutId, sectionIds, exerciseIds } = await fresh([{ name: "W" }], [0, 0]);
        const outs = await Promise.allSettled([
          workouts().removeWorkoutSection(u, sectionIds[0]!),
          workouts().createSet(u, exerciseIds[1]!, { reps: 8, weight: 60, weightUnit: "kg", isComplete: true }),
        ]);
        expect(outs.every(ok)).toBe(true);
        await expectConsistent(workoutId);
      }
    }, 300_000);

    it("(f) a move × a discard: the move lands or is 404; the discard succeeds", async () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const { u, workoutId, sectionIds, exerciseIds } = await fresh([{ name: "W" }, { name: "S" }], [0, null]);
        const [m, d] = await Promise.allSettled([
          workouts().updateWorkoutExercise(u, exerciseIds[1]!, { sectionId: sectionIds[1]! }),
          workouts().deleteWorkout(u, workoutId),
        ]);
        expect(ok(d!)).toBe(true);
        if (!ok(m!)) rejectedWith(m!, NotFoundError);
        expect((await q<{ n: number }>(`SELECT count(*)::int AS n FROM "workout" WHERE id = $1::uuid`, workoutId))[0]!.n).toBe(0);
        await assertSectionsConsistent(db);
      }
    }, 300_000);
  });
});
