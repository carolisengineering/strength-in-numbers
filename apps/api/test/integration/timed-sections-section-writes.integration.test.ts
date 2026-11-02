// Spec 09.5 AC12, AC13, AC19 (create, PATCH) — workout sections take a timer; a change over recorded data needs discardResult.
import type { RoundTime, SectionResult, SectionTimer, SectionTimerInput } from "@sin/core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { NotFoundError, SectionResultExistsError } from "../../src/errors/app-error.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertUser, logWorkout } from "./records-helpers.js";
import { TRUNCATE_ROUTINES } from "./routine-helpers.js";
import { addTimedSection, assertSectionsConsistent, insertWorkoutSection, recordRounds, setResult } from "./section-helpers.js";

const SET_TIMER: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };
const AMRAP: SectionTimer = { format: "amrap", capSeconds: 720 };
const TIME_CAP: SectionTimer = { format: "time_cap", capSeconds: 900 };

describe.skipIf(!shouldRunIntegration())("Spec 09.5 — section create / PATCH with a timer (real Postgres)", () => {
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

  async function live() {
    const u = await insertUser(db);
    const { workoutId } = await logWorkout(db, u, { startedAt: new Date(Date.now() - 600_000), finish: "none", exercises: [] });
    return { u, workoutId };
  }
  /** The section row and its rounds as stored, for before/after equality. */
  async function snapshot(sectionId: string) {
    const rows = await db.prisma.$queryRawUnsafe<{ s: unknown; r: unknown }[]>(
      `SELECT to_jsonb(s) AS s,
              (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.round_no), '[]'::jsonb) FROM "workout_section_round" r WHERE r.workout_section_id = s.id) AS r
       FROM "workout_section" s WHERE s.id = $1::uuid`,
      sectionId,
    );
    return rows[0]!;
  }
  async function seeded(timer: SectionTimer, rounds: RoundTime[] = [], result: SectionResult | null = null) {
    const { u, workoutId } = await live();
    const id = await addTimedSection(db, workoutId, 0, "Main", timer);
    if (rounds.length > 0) await recordRounds(db, id, rounds);
    if (result) await setResult(db, id, result);
    return { u, workoutId, id };
  }

  describe("09.5 AC12 — create with a timer", () => {
    it.each<[SectionTimerInput, SectionTimer]>([
      [SET_TIMER, SET_TIMER],
      [AMRAP, AMRAP],
      [TIME_CAP, TIME_CAP],
      [{ format: "time_cap" }, { format: "time_cap", capSeconds: null }],
    ])("%j", async (timer, expected) => {
      const { u, workoutId } = await live();
      const created = await workouts().addWorkoutSection(u, workoutId, { name: "Main", notes: null, timer });
      expect([created.timer, created.result, created.roundTimes, created.addedInWorkout]).toEqual([expected, null, [], true]);
      expect((await workouts().getWorkoutById(u, workoutId)).sections[0]!.timer).toEqual(expected);
    });

    it("without a timer it is exactly Spec 09.4 AC3 with timer: null", async () => {
      const { u, workoutId } = await live();
      const created = await workouts().addWorkoutSection(u, workoutId, { name: "Warm-up", notes: "5 min", timer: null });
      expect(created).toMatchObject({ position: 0, name: "Warm-up", notes: "5 min", addedInWorkout: true, timer: null, result: null, roundTimes: [] });
    });
  });

  describe("09.5 AC13 — the timer change table", () => {
    it("an equal timer writes nothing", async () => {
      const { u, id } = await seeded(AMRAP, [{ round: 1, seconds: 250 }]);
      const before = await snapshot(id);
      const res = await workouts().updateWorkoutSection(u, id, { timer: AMRAP });
      expect([res.timerChanged, res.resultCleared, res.finishedEdit]).toEqual([false, false, null]);
      expect(await snapshot(id)).toEqual(before);
    });

    it("an equal timer with discardResult: true still writes nothing and keeps the rounds (Review Focus 2)", async () => {
      const { u, id } = await seeded(AMRAP, [{ round: 1, seconds: 250 }], { rounds: 3, reps: 1, finishSeconds: null, capped: false });
      const before = await snapshot(id);
      const res = await workouts().updateWorkoutSection(u, id, { timer: AMRAP, discardResult: true });
      expect([res.timerChanged, res.resultCleared]).toEqual([false, false]);
      expect(res.roundTimes).toEqual([{ round: 1, seconds: 250 }]);
      expect(await snapshot(id)).toEqual(before);
    });

    it("{ format: time_cap } against a stored For Time is equal (Review Focus 4)", async () => {
      const { u, id } = await seeded({ format: "time_cap", capSeconds: null });
      const before = await snapshot(id);
      const res = await workouts().updateWorkoutSection(u, id, { timer: { format: "time_cap" } });
      expect(res.timerChanged).toBe(false);
      expect(await snapshot(id)).toEqual(before);
    });

    it("nothing recorded: any change replaces; null removes", async () => {
      const { u, id } = await seeded(AMRAP);
      const replaced = await workouts().updateWorkoutSection(u, id, { timer: SET_TIMER });
      expect([replaced.timer, replaced.timerChanged, replaced.resultCleared]).toEqual([SET_TIMER, true, false]);
      const removed = await workouts().updateWorkoutSection(u, id, { timer: null });
      expect([removed.timer, removed.timerChanged]).toEqual([null, true]);
    });

    it("a same-format change that fits keeps the data; discardResult is ignored", async () => {
      const { u, id } = await seeded(SET_TIMER, [{ round: 1, seconds: 221 }, { round: 2, seconds: 218 }]);
      const res = await workouts().updateWorkoutSection(u, id, { timer: { ...SET_TIMER, rounds: 6 }, discardResult: true });
      expect([res.timer, res.timerChanged, res.resultCleared]).toEqual([{ ...SET_TIMER, rounds: 6 }, true, false]);
      expect(res.roundTimes).toEqual([{ round: 1, seconds: 221 }, { round: 2, seconds: 218 }]);
    });

    const wouldNotKeep: [string, SectionTimer, RoundTime[], SectionResult | null, SectionTimerInput | null][] = [
      ["Set Timer 5 → 2 rounds with round 3 recorded", SET_TIMER, [{ round: 3, seconds: 200 }], null, { ...SET_TIMER, rounds: 2 }],
      ["round length below a recorded time", SET_TIMER, [{ round: 1, seconds: 250 }], null, { ...SET_TIMER, roundSeconds: 240 }],
      ["AMRAP cap below a reading", AMRAP, [{ round: 1, seconds: 700 }], null, { format: "amrap", capSeconds: 600 }],
      ["Time Cap cap below the finish", TIME_CAP, [], { rounds: null, reps: null, finishSeconds: 860, capped: false }, { format: "time_cap", capSeconds: 800 }],
      ["cap removed from a capped result", TIME_CAP, [], { rounds: 4, reps: 7, finishSeconds: null, capped: true }, { format: "time_cap" }],
      ["AMRAP → Time Cap", AMRAP, [{ round: 1, seconds: 250 }], { rounds: 3, reps: 1, finishSeconds: null, capped: false }, TIME_CAP],
      ["Set Timer → null", SET_TIMER, [{ round: 1, seconds: 221 }], null, null],
    ];

    it.each(wouldNotKeep)("would not keep: %s → 409 without discardResult, cleared with it", async (_n, timer, rounds, result, next) => {
      const { u, id } = await seeded(timer, rounds, result);
      const before = await snapshot(id);
      await expect(workouts().updateWorkoutSection(u, id, { timer: next })).rejects.toBeInstanceOf(SectionResultExistsError);
      expect(await snapshot(id)).toEqual(before);

      const res = await workouts().updateWorkoutSection(u, id, { timer: next, discardResult: true });
      expect([res.timerChanged, res.resultCleared, res.result, res.roundTimes]).toEqual([true, true, null, []]);
      const rows = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "workout_section_round" WHERE workout_section_id = $1::uuid`, id);
      expect(Number(rows[0]!.n)).toBe(0);
    });

    it("a rename with a refused timer change renames nothing (Review Focus 3)", async () => {
      const { u, id } = await seeded(AMRAP, [{ round: 1, seconds: 250 }]);
      const before = await snapshot(id);
      await expect(workouts().updateWorkoutSection(u, id, { name: "Renamed", timer: SET_TIMER })).rejects.toBeInstanceOf(SectionResultExistsError);
      expect(await snapshot(id)).toEqual(before);
    });

    it("a body without timer leaves the timer and the recorded data alone", async () => {
      const { u, id } = await seeded(AMRAP, [{ round: 1, seconds: 250 }], { rounds: 3, reps: 1, finishSeconds: null, capped: false });
      const res = await workouts().updateWorkoutSection(u, id, { name: "Renamed" });
      expect([res.name, res.timer, res.timerChanged, res.roundTimes.length, res.result !== null]).toEqual(["Renamed", AMRAP, false, 1, true]);
    });

    it("a finished workout: the change is a finished edit", async () => {
      const u = await insertUser(db);
      const { workoutId } = await logWorkout(db, u, { startedAt: new Date(Date.now() - 7_200_000), finish: "raw", exercises: [] });
      const id = await insertWorkoutSection(db, workoutId, 0, "Main");
      const res = await workouts().updateWorkoutSection(u, id, { timer: AMRAP });
      expect(res.finishedEdit).toMatchObject({ workoutId, recordsRecomputed: false });
    });
  });

  describe("09.5 AC19 — authorization (create, PATCH)", () => {
    it("malformed, missing and another user's ids are NotFoundError", async () => {
      const { u, workoutId, id } = await seeded(AMRAP);
      const other = await insertUser(db);
      for (const [actor, w] of [[u, "x"], [u, uuidv7()], [other, workoutId]] as const) {
        await expect(workouts().addWorkoutSection(actor, w, { name: "N", notes: null, timer: AMRAP })).rejects.toBeInstanceOf(NotFoundError);
      }
      for (const [actor, s] of [[u, "x"], [u, uuidv7()], [other, id]] as const) {
        await expect(workouts().updateWorkoutSection(actor, s, { timer: SET_TIMER, discardResult: true })).rejects.toBeInstanceOf(NotFoundError);
      }
    });
  });
});
