// Spec 09.5 AC22 — timed-section writes race each other, timer changes, removal, set writes, a finish and a
// discard without a deadlock, a 500 or a state assertSectionsConsistent rejects.
import type { SectionTimer } from "@sin/core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type {
  AppError} from "../../src/errors/app-error.js";
import {
  NotFoundError,
  SectionResultExistsError,
  SectionTimerMismatchError,
  ValidationError,
} from "../../src/errors/app-error.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser } from "./records-helpers.js";
import { TRUNCATE_ROUTINES } from "./routine-helpers.js";
import { assertSectionsConsistent, workoutWithSections } from "./section-helpers.js";

const ITERATIONS = 50;
const AMRAP: SectionTimer = { format: "amrap", capSeconds: 720 };
const SET_TIMER: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };
type Outcome = PromiseSettledResult<unknown>;
type ErrorClass = abstract new (...args: never[]) => AppError;

describe.skipIf(!shouldRunIntegration())("Spec 09.5 — timed-section races (real Postgres)", () => {
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

  /** Fulfilled, or rejected with one of `allowed` — never a deadlock, a serialization failure or a raw error (a 500). */
  function settledLegally(o: Outcome, ...allowed: ErrorClass[]): boolean {
    if (o.status === "fulfilled") return true;
    const err = o.reason as Error;
    expect(String(err?.message ?? err)).not.toMatch(/40P01|40001|deadlock|could not serialize/i);
    expect(allowed.some((E) => err instanceof E), `unexpected rejection: ${String(err?.stack ?? err)}`).toBe(true);
    return false;
  }

  /** A live AMRAP section holding exercises 0 and 1 (one complete set, so a finish is legal) and a loose exercise. */
  async function fresh(timer: SectionTimer = AMRAP) {
    const u = await insertUser(db);
    const ex = await insertExercise(db, { ownerUserId: u });
    const w = await workoutWithSections(db, u, ex, { sections: [{ name: "Main" }], exercises: [0, 0, null] });
    const sectionId = w.sectionIds[0]!;
    await workouts().updateWorkoutSection(u, sectionId, { timer });
    const set = await workouts().createSet(u, w.exerciseIds[0]!, { reps: 5, weight: 100, weightUnit: "kg", isComplete: true });
    return { u, sectionId, setId: set.set.id, ...w };
  }
  const readings = async (sectionId: string) =>
    (await q<{ round_no: number; seconds: number }>(
      `SELECT round_no, seconds FROM "workout_section_round" WHERE workout_section_id = $1::uuid ORDER BY round_no`,
      sectionId,
    )).map((r) => [r.round_no, r.seconds]);

  describe("09.5 AC22 — races", () => {
    it("(a) two round-time writes on one AMRAP section: at most one refused, readings stay strictly increasing", async () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const { u, sectionId } = await fresh();
        await workouts().setSectionRoundTime(u, sectionId, 1, 100);
        const [a, b] = await Promise.allSettled([
          workouts().setSectionRoundTime(u, sectionId, 2, 300),
          workouts().setSectionRoundTime(u, sectionId, 3, 280),
        ]);
        const fulfilled = [a!, b!].filter((o) => settledLegally(o, ValidationError)).length;
        expect(fulfilled).toBeGreaterThanOrEqual(1);
        const seconds = (await readings(sectionId)).map(([, s]) => s!);
        expect(seconds).toEqual([...seconds].sort((x, y) => x - y));
        await assertSectionsConsistent(db);
      }
    }, 300_000);

    it("(b) a round-time write against a timer change with discardResult: the write is judged by whichever timer it met", async () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const { u, sectionId } = await fresh();
        await workouts().setSectionRoundTime(u, sectionId, 1, 400);
        const [w, t] = await Promise.allSettled([
          workouts().setSectionRoundTime(u, sectionId, 2, 500),
          workouts().updateWorkoutSection(u, sectionId, { timer: SET_TIMER, discardResult: true }),
        ]);
        settledLegally(w!, SectionTimerMismatchError, ValidationError);
        expect(t!.status).toBe("fulfilled");
        // Whatever ran first, the end state fits the Set Timer (the AMRAP readings were discarded or never written).
        expect((await readings(sectionId)).every(([round, s]) => round! <= 5 && s! <= 300)).toBe(true);
        await assertSectionsConsistent(db);
      }
    }, 300_000);

    it("(c) a round-time write against the section's removal: no orphan round row", async () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const { u, sectionId } = await fresh();
        const [w, r] = await Promise.allSettled([workouts().setSectionRoundTime(u, sectionId, 1, 100), workouts().removeWorkoutSection(u, sectionId)]);
        settledLegally(w!, NotFoundError);
        expect(r!.status).toBe("fulfilled");
        expect(await readings(sectionId)).toEqual([]);
        await assertSectionsConsistent(db);
      }
    }, 300_000);

    it("(d) a result write against a timer change", async () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const { u, sectionId } = await fresh();
        const [w, t] = await Promise.allSettled([
          workouts().setSectionResult(u, sectionId, { rounds: 4, reps: 2 }),
          workouts().updateWorkoutSection(u, sectionId, { timer: { format: "time_cap", capSeconds: 900 } }),
        ]);
        settledLegally(w!, SectionTimerMismatchError, ValidationError);
        settledLegally(t!, SectionResultExistsError);
        await assertSectionsConsistent(db);
      }
    }, 300_000);

    it("(e) a round-time write against a set write on the section's exercises: both fulfill", async () => {
      for (let i = 0; i < ITERATIONS; i++) {
        const { u, sectionId, exerciseIds, setId } = await fresh();
        const [w, s1, s2] = await Promise.allSettled([
          workouts().setSectionRoundTime(u, sectionId, 1, 100),
          workouts().createSet(u, exerciseIds[1]!, { reps: 3, weight: 60, weightUnit: "kg", isComplete: true }),
          workouts().updateSet(u, setId, { reps: 6 }),
        ]);
        for (const o of [w!, s1!, s2!]) expect(settledLegally(o)).toBe(true);
        await assertSectionsConsistent(db);
      }
    }, 300_000);

    const recordWrites: [string, (u: string, s: string) => Promise<unknown>][] = [
      ["round set", (u, s) => workouts().setSectionRoundTime(u, s, 1, 100)],
      ["round clear", (u, s) => workouts().clearSectionRoundTime(u, s, 1)],
      ["result set", (u, s) => workouts().setSectionResult(u, s, { rounds: 1, reps: 2 })],
      ["result clear", (u, s) => workouts().clearSectionResult(u, s)],
    ];
    it.each(recordWrites)("(f) %s against a finish and against a discard", async (_n, write) => {
      for (let i = 0; i < ITERATIONS; i++) {
        const fin = await fresh();
        const [w1, f] = await Promise.allSettled([write(fin.u, fin.sectionId), workouts().updateWorkout(fin.u, fin.workoutId, { endedAt: new Date().toISOString() })]);
        expect(settledLegally(w1!)).toBe(true);
        expect(f!.status).toBe("fulfilled");

        const gone = await fresh();
        const [w2, d] = await Promise.allSettled([write(gone.u, gone.sectionId), workouts().deleteWorkout(gone.u, gone.workoutId)]);
        settledLegally(w2!, NotFoundError);
        expect(d!.status).toBe("fulfilled");
        await assertSectionsConsistent(db);
      }
    }, 300_000);
  });
});
