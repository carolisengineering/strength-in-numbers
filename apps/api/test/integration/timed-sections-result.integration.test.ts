// Spec 09.5 AC16, AC17 (Review Focus 5) — whole-value result writes for AMRAP and Time Cap sections.
import { TIMER_ISSUE_MESSAGES, type SectionTimer, type SetSectionResult, type TimerIssueCode } from "@sin/core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { NotFoundError, SectionTimerMismatchError, ValidationError } from "../../src/errors/app-error.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertUser, logWorkout } from "./records-helpers.js";
import { TRUNCATE_ROUTINES } from "./routine-helpers.js";
import { addTimedSection, assertSectionsConsistent, insertWorkoutSection, recordRounds } from "./section-helpers.js";

const AMRAP: SectionTimer = { format: "amrap", capSeconds: 720 };
const TIME_CAP: SectionTimer = { format: "time_cap", capSeconds: 900 };
const FOR_TIME: SectionTimer = { format: "time_cap", capSeconds: null };
const SET_TIMER: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };

describe.skipIf(!shouldRunIntegration())("Spec 09.5 — result writes (real Postgres)", () => {
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

  async function section(timer: SectionTimer | null) {
    const u = await insertUser(db);
    const { workoutId } = await logWorkout(db, u, { startedAt: new Date(Date.now() - 600_000), finish: "none", exercises: [] });
    const id = timer === null ? await insertWorkoutSection(db, workoutId, 0, "Main") : await addTimedSection(db, workoutId, 0, "Main", timer);
    return { u, workoutId, id };
  }
  const updatedAt = async (id: string) =>
    (await db.prisma.$queryRawUnsafe<{ t: string }[]>(`SELECT updated_at::text AS t FROM "workout_section" WHERE id = $1::uuid`, id))[0]!.t;

  describe("09.5 AC16 — set the result", () => {
    const accepted: [string, SectionTimer, SetSectionResult, unknown][] = [
      ["AMRAP", AMRAP, { rounds: 5, reps: 7 }, { rounds: 5, reps: 7, finishSeconds: null, capped: false }],
      ["Time Cap finished", TIME_CAP, { finishSeconds: 860 }, { rounds: null, reps: null, finishSeconds: 860, capped: false }],
      ["Time Cap capped", TIME_CAP, { capped: true, rounds: 4, reps: 7 }, { rounds: 4, reps: 7, finishSeconds: null, capped: true }],
      ["For Time finished", FOR_TIME, { finishSeconds: 10_800 }, { rounds: null, reps: null, finishSeconds: 10_800, capped: false }],
    ];
    it.each(accepted)("%s → stored and returned", async (_n, timer, body, expected) => {
      const { u, id } = await section(timer);
      const res = await workouts().setSectionResult(u, id, body);
      expect([res.result, res.changed]).toEqual([expected, true]);
    });

    const refused: [string, SectionTimer, SetSectionResult, string, TimerIssueCode][] = [
      ["AMRAP without reps", AMRAP, { rounds: 5 }, "reps", "reps_required"],
      ["AMRAP with a finish time", AMRAP, { rounds: 5, reps: 7, finishSeconds: 600 }, "finishSeconds", "finish_not_allowed"],
      ["AMRAP capped", AMRAP, { rounds: 5, reps: 7, capped: true }, "capped", "capped_not_allowed"],
      ["Time Cap finish past the cap", TIME_CAP, { finishSeconds: 901 }, "finishSeconds", "finish_over_cap"],
      ["Time Cap capped with neither", TIME_CAP, { capped: true }, "rounds", "rounds_or_reps_required"],
      ["Time Cap finish with rounds", TIME_CAP, { finishSeconds: 860, rounds: 4 }, "rounds", "rounds_reps_not_allowed"],
      ["For Time capped", FOR_TIME, { capped: true, reps: 7 }, "capped", "capped_needs_cap"],
      ["all empty", AMRAP, {}, "rounds", "nothing_to_record"],
    ];
    it.each(refused)("%s → 422 on %s", async (_n, timer, body, path, code) => {
      const { u, id } = await section(timer);
      const err = await workouts().setSectionResult(u, id, body).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fieldErrors).toContainEqual({ path, message: TIMER_ISSUE_MESSAGES[code] });
    });

    it.each([["Set Timer", SET_TIMER], ["untimed", null]] as const)("%s → SectionTimerMismatchError", async (_n, timer) => {
      const { u, id } = await section(timer);
      await expect(workouts().setSectionResult(u, id, { rounds: 1, reps: 1 })).rejects.toBeInstanceOf(SectionTimerMismatchError);
    });

    it("a result replaces the whole value", async () => {
      const { u, id } = await section(TIME_CAP);
      await workouts().setSectionResult(u, id, { capped: true, rounds: 4, reps: 7 });
      const res = await workouts().setSectionResult(u, id, { finishSeconds: 860 });
      expect(res.result).toEqual({ rounds: null, reps: null, finishSeconds: 860, capped: false });
    });
  });

  it("09.5 AC16 — explicit defaults are a replay (Review Focus 5)", async () => {
    const { u, id } = await section(TIME_CAP);
    await workouts().setSectionResult(u, id, { finishSeconds: 600 });
    const before = await updatedAt(id);
    const again = await workouts().setSectionResult(u, id, { finishSeconds: 600, capped: false, rounds: null });
    expect([again.changed, again.finishedEdit, await updatedAt(id)]).toEqual([false, null, before]);
  });

  describe("09.5 AC17 — clear the result", () => {
    it("removes the result and keeps the round times; a second clear removes nothing", async () => {
      const { u, id } = await section(AMRAP);
      await recordRounds(db, id, [{ round: 1, seconds: 250 }]);
      await workouts().setSectionResult(u, id, { rounds: 5, reps: 7 });
      expect((await workouts().clearSectionResult(u, id)).removed).toBe(true);
      const read = (await workouts().getWorkoutById(u, (await db.prisma.$queryRawUnsafe<{ w: string }[]>(`SELECT workout_id::text AS w FROM "workout_section" WHERE id = $1::uuid`, id))[0]!.w)).sections[0]!;
      expect([read.result, read.roundTimes]).toEqual([null, [{ round: 1, seconds: 250 }]]);
      expect((await workouts().clearSectionResult(u, id)).removed).toBe(false);
    });

    it("an untimed section removes nothing; a foreign section is NotFoundError", async () => {
      const { u, id } = await section(null);
      expect((await workouts().clearSectionResult(u, id)).removed).toBe(false);
      const other = await insertUser(db);
      await expect(workouts().clearSectionResult(other, id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(workouts().setSectionResult(other, id, { rounds: 1, reps: 1 })).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
