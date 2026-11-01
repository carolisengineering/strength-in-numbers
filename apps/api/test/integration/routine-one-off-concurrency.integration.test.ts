import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { NotFoundError, WorkoutFinishedError, WorkoutInProgressExistsError, type AppError } from "../../src/errors/app-error.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { sweepExpiredOneOffs } from "../../src/repositories/routine-one-off.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { ageOneOff } from "./one-off-helpers.js";
import { assertDerivedColumnsConsistent } from "./planned-set-helpers.js";
import { insertExercise, insertUser } from "./records-helpers.js";
import { routineFixture, TRUNCATE_ROUTINES } from "./routine-helpers.js";
import { assertSectionsConsistent } from "./section-helpers.js";

/**
 * Spec 09.3 AC23 / AC25 — the sweep and the finish raced against everything that touches a one-off. Each
 * iteration uses fresh rows, runs the pair with Promise.allSettled, and checks: every rejection is an expected
 * AppError (never a deadlock, 40P01, or anything a route would answer 500), and the end state is a row of §6.3.
 */
const ITERATIONS = 50;

/**
 * Minor 36: which legal outcome each round of a race hit. Every race only checks that each end state is legal; the
 * tallies show whether both interleavings were exercised, and a pair that reliably reaches all of its outcomes asserts it.
 */
const tallies = new Map<string, Map<string, number>>();
function seen(pair: string, outcome: string): void {
  const counts = tallies.get(pair) ?? new Map<string, number>();
  counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
  tallies.set(pair, counts);
}

type Outcome = PromiseSettledResult<unknown>;

describe.skipIf(!shouldRunIntegration())("Spec 09.3 — one-off races (real Postgres)", () => {
  let db: IntegrationDb;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(() => {
    for (const [pair, counts] of tallies) process.stdout.write(`race ${pair}: ${[...counts].map(([o, n]) => `${o}=${n}`).join(" ")}\n`);
  });
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    if (!db) return;
    await assertSectionsConsistent(db);
    await assertDerivedColumnsConsistent(db);
    await db.prisma.$executeRawUnsafe(TRUNCATE_ROUTINES);
  });
  const routines = () => createRoutineRepository(db.prisma);
  const workouts = () => createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
  const q = <T>(sql: string, ...args: unknown[]) => db.prisma.$queryRawUnsafe<T[]>(sql, ...args);

  /** A rejection must be one of `allowed` — any other error (a deadlock, a raw Prisma error) is a 500. */
  function rejectedWith(o: Outcome, ...allowed: (abstract new (...args: never[]) => AppError)[]): boolean {
    if (o.status === "fulfilled") return false;
    const err = o.reason as Error;
    expect(String(err?.message ?? err)).not.toMatch(/40P01|deadlock/i);
    expect(allowed.some((E) => err instanceof E), `unexpected rejection: ${String(err?.stack ?? err)}`).toBe(true);
    return true;
  }
  const ok = (o: Outcome) => o.status === "fulfilled";

  async function state(routineId: string, workoutId: string | null, userId: string) {
    const [r] = await q<{ n: number; one_off: boolean | null }>(
      `SELECT count(*)::int AS n, bool_and(one_off_until IS NOT NULL) AS one_off FROM "routine" WHERE id = $1::uuid`, routineId);
    const w = workoutId
      ? (await q<{ ended: boolean; routine_id: string | null }>(
          `SELECT ended_at IS NOT NULL AS ended, routine_id::text AS routine_id FROM "workout" WHERE id = $1::uuid`, workoutId))[0]
      : undefined;
    const [orphans] = await q<{ n: number }>(
      `SELECT ((SELECT count(*) FROM "routine_item" i WHERE NOT EXISTS (SELECT 1 FROM "routine" r WHERE r.id = i.routine_id))
             + (SELECT count(*) FROM "routine_section" s WHERE NOT EXISTS (SELECT 1 FROM "routine" r WHERE r.id = s.routine_id)))::int AS n`);
    // Never a live workout that was started from a routine and lost it beneath it.
    const [stranded] = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM "workout" WHERE user_id = $1::uuid AND ended_at IS NULL
         AND routine_name_snapshot IS NOT NULL AND routine_id IS NULL`, userId);
    const [live] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM "workout" WHERE user_id = $1::uuid AND ended_at IS NULL`, userId);
    expect(orphans!.n).toBe(0);
    expect(stranded!.n).toBe(0);
    expect(live!.n).toBeLessThanOrEqual(1);
    return { exists: r!.n === 1, oneOff: r!.one_off === true, workout: w, liveCount: live!.n };
  }

  async function fresh(oneOff = true) {
    const u = await insertUser(db);
    const ex = await insertExercise(db, { ownerUserId: u });
    const routine = (await routines().create(u, {
      ...routineFixture([ex, ex], { name: "Class", ...(oneOff ? { oneOff: true as const } : {}), sections: [{ key: "s", name: "Main" }], sectionKeys: ["s", "s"] }),
    })).routine;
    return { u, ex, routine };
  }
  const start = (u: string, routineId: string) =>
    workouts().createWorkout(
      u,
      { clientGeneratedId: uuidv7(), startedAt: new Date(Date.now() - 3_600_000), tzOffsetMinutes: 0, title: null, notes: null, routineId },
      "UTC",
    );
  const finish = (u: string, workoutId: string, keepRoutine?: boolean) =>
    workouts().updateWorkout(u, workoutId, { endedAt: new Date().toISOString(), ...(keepRoutine === undefined ? {} : { keepRoutine }) });
  const sweep = (u: string) => sweepExpiredOneOffs(db.prisma, u);
  const race = (a: () => Promise<unknown>, b: () => Promise<unknown>) => Promise.allSettled([a(), b()]);

  describe("09.3 AC23 — the sweep against concurrent routine work", () => {
    it("(a) a start from the same expired one-off: the start holds it, or 404s with no live workout", async () => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        const { u, routine } = await fresh();
        await ageOneOff(db, routine.id, 20);
        const [s, sw] = await race(() => start(u, routine.id), () => sweep(u));
        expect(ok(sw)).toBe(true);
        const after = await state(routine.id, null, u);
        seen("a start vs sweep", ok(s) ? "start held it" : "swept, start 404");
        if (ok(s)) {
          expect(after.exists).toBe(true);
          const wId = (s as PromiseFulfilledResult<{ workout: { id: string } }>).value.workout.id;
          expect((await state(routine.id, wId, u)).workout?.routine_id).toBe(routine.id);
        } else {
          rejectedWith(s, NotFoundError);
          expect(after.exists).toBe(false);
          expect(after.liveCount).toBe(0);
        }
      }
    }, 120_000);

    it("(b) a finish of its live workout: the workout is finished and the one-off removed by the finish", async () => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        const { u, routine } = await fresh();
        const { workout } = await start(u, routine.id);
        await ageOneOff(db, routine.id, 20);
        const [f, sw] = await race(() => finish(u, workout.id), () => sweep(u));
        expect(ok(f) && ok(sw)).toBe(true);
        const after = await state(routine.id, workout.id, u);
        expect(after.exists).toBe(false);
        expect(after.workout).toEqual({ ended: true, routine_id: null });
      }
    }, 120_000);

    it("(c) a PUT: the PUT lands on a surviving routine, or the routine is gone (and the PUT 404s or was then swept)", async () => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        const { u, ex, routine } = await fresh();
        await ageOneOff(db, routine.id, 20);
        const [p, sw] = await race(() => routines().replace(u, routine.id, routineFixture([ex], { name: "Edited" })), () => sweep(u));
        expect(ok(sw)).toBe(true);
        const after = await state(routine.id, null, u);
        seen("c PUT vs sweep", !ok(p) ? "swept, PUT 404" : after.exists ? "PUT landed" : "PUT then swept");
        if (!ok(p)) {
          rejectedWith(p, NotFoundError);
          expect(after.exists).toBe(false);
        }
        if (after.exists) expect(ok(p)).toBe(true);
      }
    }, 120_000);

    it("(d) a Keep: kept and ordinary, or swept and the Keep 404s", async () => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        const { u, routine } = await fresh();
        await ageOneOff(db, routine.id, 20);
        const [k, sw] = await race(() => routines().keep(u, routine.id), () => sweep(u));
        expect(ok(sw)).toBe(true);
        const after = await state(routine.id, null, u);
        seen("d Keep vs sweep", ok(k) ? "kept" : "swept, Keep 404");
        if (ok(k)) {
          expect(after).toMatchObject({ exists: true, oneOff: false });
        } else {
          rejectedWith(k, NotFoundError);
          expect(after.exists).toBe(false);
        }
      }
    }, 120_000);

    it("(e) a second sweep: removed exactly once", async () => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        const { u, routine } = await fresh();
        await ageOneOff(db, routine.id, 20);
        const [a, b] = await race(() => sweep(u), () => sweep(u));
        expect(ok(a) && ok(b)).toBe(true);
        const removed = [a, b].map((o) => (o as PromiseFulfilledResult<number>).value);
        expect(removed.reduce((x, y) => x + y, 0)).toBe(1);
        expect((await state(routine.id, null, u)).exists).toBe(false);
      }
    }, 120_000);
  });

  describe("09.3 AC25 — the finish of a one-off's workout against each concurrent write", () => {
    it("a routine PUT: the finish succeeds and the routine is gone", async () => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        const { u, ex, routine } = await fresh();
        const { workout } = await start(u, routine.id);
        const [f, p] = await race(() => finish(u, workout.id), () => routines().replace(u, routine.id, routineFixture([ex], { name: "Edited" })));
        expect(ok(f)).toBe(true);
        if (!ok(p)) rejectedWith(p, NotFoundError);
        const after = await state(routine.id, workout.id, u);
        expect(after.exists).toBe(false);
        expect(after.workout).toEqual({ ended: true, routine_id: null });
      }
    }, 120_000);

    it("a routine DELETE: the finish succeeds and the routine is gone either way", async () => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        const { u, routine } = await fresh();
        const { workout } = await start(u, routine.id);
        const [f, d] = await race(() => finish(u, workout.id), () => routines().delete(u, routine.id));
        expect(ok(f)).toBe(true);
        if (!ok(d)) rejectedWith(d, NotFoundError);
        const after = await state(routine.id, workout.id, u);
        expect(after.exists).toBe(false);
        expect(after.workout).toEqual({ ended: true, routine_id: null });
      }
    }, 120_000);

    it("a Keep: Keep first leaves an ordinary routine; finish first removes it and Keep 404s", async () => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        const { u, routine } = await fresh();
        const { workout } = await start(u, routine.id);
        const [f, k] = await race(() => finish(u, workout.id), () => routines().keep(u, routine.id));
        expect(ok(f)).toBe(true);
        const after = await state(routine.id, workout.id, u);
        expect(after.workout?.ended).toBe(true);
        seen("Keep vs finish", ok(k) ? "Keep first" : "finish first, Keep 404");
        if (ok(k)) {
          expect(after).toMatchObject({ exists: true, oneOff: false });
          expect((f as PromiseFulfilledResult<{ oneOff: string }>).value.oneOff).toBe("none");
        } else {
          rejectedWith(k, NotFoundError);
          expect(after.exists).toBe(false);
          expect((f as PromiseFulfilledResult<{ oneOff: string }>).value.oneOff).toBe("removed");
        }
      }
    }, 120_000);

    it("a second identical finish: one 200, one 409 workout-finished; the routine is gone", async () => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        const { u, routine } = await fresh();
        const { workout } = await start(u, routine.id);
        const results = await race(() => finish(u, workout.id), () => finish(u, workout.id));
        expect(results.filter(ok)).toHaveLength(1);
        rejectedWith(results.find((o) => !ok(o))!, WorkoutFinishedError);
        expect((await state(routine.id, workout.id, u)).exists).toBe(false);
      }
    }, 120_000);

    it("a discard: finished-then-deleted, or deleted with the one-off intact — never a removal without a finish", async () => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        const { u, routine } = await fresh();
        const { workout } = await start(u, routine.id);
        const [f, d] = await race(() => finish(u, workout.id), () => workouts().deleteWorkout(u, workout.id));
        expect(ok(d)).toBe(true);
        const after = await state(routine.id, workout.id, u);
        expect(after.workout).toBeUndefined();
        seen("finish vs discard", ok(f) ? "finished then deleted" : "deleted, finish 404");
        if (ok(f)) {
          expect(after.exists).toBe(false);
        } else {
          rejectedWith(f, NotFoundError);
          expect(after).toMatchObject({ exists: true, oneOff: true });
        }
      }
    }, 120_000);

    it("a sweep after the expiry: the held one-off is skipped and the finish removes it", async () => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        const { u, routine } = await fresh();
        const { workout } = await start(u, routine.id);
        await ageOneOff(db, routine.id, 20);
        const [f, sw] = await race(() => finish(u, workout.id), () => sweep(u));
        expect(ok(f) && ok(sw)).toBe(true);
        const after = await state(routine.id, workout.id, u);
        expect(after.exists).toBe(false);
        expect(after.workout).toEqual({ ended: true, routine_id: null });
      }
    }, 120_000);

    it("a start from the same routine loses: 409 workout-in-progress-exists or 404, never a second live workout", async () => {
      for (let i = 0; i < ITERATIONS; i += 1) {
        const { u, routine } = await fresh();
        const { workout } = await start(u, routine.id);
        const [f, s] = await race(() => finish(u, workout.id), () => start(u, routine.id));
        expect(ok(f)).toBe(true);
        expect(ok(s)).toBe(false);
        rejectedWith(s, WorkoutInProgressExistsError, NotFoundError);
        seen("start vs finish", (s as PromiseRejectedResult).reason instanceof NotFoundError ? "start 404" : "start 409 in progress");
        const after = await state(routine.id, workout.id, u);
        expect(after.exists).toBe(false);
        expect(after.liveCount).toBe(0);
      }
    }, 120_000);
  });
});
