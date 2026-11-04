// Spec 09.5 AC14, AC15 — keyed round-time writes under the section row lock.
import { TIMER_ISSUE_MESSAGES, type RoundTime, type SectionTimer } from "@sin/core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { NotFoundError, SectionTimerMismatchError, ValidationError } from "../../src/errors/app-error.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertUser, logWorkout } from "./records-helpers.js";
import { TRUNCATE_ROUTINES } from "./routine-helpers.js";
import { addTimedSection, assertSectionsConsistent, insertWorkoutSection, recordRounds } from "./section-helpers.js";
import { countingPrisma } from "./statement-counter.js";

const SET_TIMER: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };
const AMRAP: SectionTimer = { format: "amrap", capSeconds: 720 };
const FOR_TIME: SectionTimer = { format: "time_cap", capSeconds: null };

describe.skipIf(!shouldRunIntegration())("Spec 09.5 — round-time writes (real Postgres)", () => {
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

  async function section(timer: SectionTimer | null, rounds: RoundTime[] = []) {
    const u = await insertUser(db);
    const { workoutId } = await logWorkout(db, u, { startedAt: new Date(Date.now() - 600_000), finish: "none", exercises: [] });
    const id = timer === null ? await insertWorkoutSection(db, workoutId, 0, "Main") : await addTimedSection(db, workoutId, 0, "Main", timer);
    if (rounds.length > 0) await recordRounds(db, id, rounds);
    return { u, workoutId, id };
  }
  const issuesOf = async (p: Promise<unknown>) => {
    const err = await p.then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    return (err as ValidationError).fieldErrors;
  };
  const roundUpdatedAt = async (id: string, round: number) =>
    (
      await db.prisma.$queryRawUnsafe<{ t: string }[]>(
        `SELECT updated_at::text AS t FROM "workout_section_round" WHERE workout_section_id = $1::uuid AND round_no = $2`,
        id,
        round,
      )
    )[0]?.t;

  describe("09.5 AC14 — set a round time", () => {
    it("Set Timer: beyond the rounds is 422 on round; longer than the round is 422 on seconds", async () => {
      const { u, id } = await section(SET_TIMER);
      expect(await issuesOf(workouts().setSectionRoundTime(u, id, 6, 200))).toEqual([{ path: "round", message: TIMER_ISSUE_MESSAGES.round_beyond_rounds }]);
      expect(await issuesOf(workouts().setSectionRoundTime(u, id, 1, 301))).toEqual([{ path: "seconds", message: TIMER_ISSUE_MESSAGES.seconds_over_round }]);
    });

    it("Set Timer: any order, with gaps", async () => {
      const { u, id } = await section(SET_TIMER);
      const third = await workouts().setSectionRoundTime(u, id, 3, 210);
      expect([third.roundTimes, third.changed]).toEqual([[{ round: 3, seconds: 210 }], true]);
      const first = await workouts().setSectionRoundTime(u, id, 1, 221);
      expect(first.roundTimes).toEqual([{ round: 1, seconds: 221 }, { round: 3, seconds: 210 }]);
    });

    it.each([
      [2, 250, "seconds_not_after_previous"],
      [2, 770, "seconds_not_before_next"],
      [4, 721, "seconds_over_cap"],
    ] as const)("AMRAP readings {1:250, 3:700}: round %i = %i → %s", async (round, seconds, code) => {
      const { u, id } = await section(AMRAP, [{ round: 1, seconds: 250 }, { round: 3, seconds: 700 }]);
      expect(await issuesOf(workouts().setSectionRoundTime(u, id, round, seconds))).toContainEqual({ path: "seconds", message: TIMER_ISSUE_MESSAGES[code] });
    });

    it("AMRAP: a reading between its neighbors is accepted", async () => {
      const { u, id } = await section(AMRAP, [{ round: 1, seconds: 250 }, { round: 3, seconds: 700 }]);
      expect((await workouts().setSectionRoundTime(u, id, 2, 515)).roundTimes.map((r) => r.round)).toEqual([1, 2, 3]);
    });

    it("a Time Cap with no cap takes 10 800", async () => {
      const { u, id } = await section(FOR_TIME);
      expect((await workouts().setSectionRoundTime(u, id, 1, 10_800)).roundTimes).toEqual([{ round: 1, seconds: 10_800 }]);
    });

    it("changing a round upserts and moves that row's updated_at; the same value writes nothing", async () => {
      const { u, id } = await section(SET_TIMER, [{ round: 3, seconds: 210 }]);
      const before = await roundUpdatedAt(id, 3);
      const same = await workouts().setSectionRoundTime(u, id, 3, 210);
      expect([same.changed, await roundUpdatedAt(id, 3)]).toEqual([false, before]);
      const changed = await workouts().setSectionRoundTime(u, id, 3, 205);
      expect([changed.changed, changed.roundTimes]).toEqual([true, [{ round: 3, seconds: 205 }]]);
      expect(await roundUpdatedAt(id, 3)).not.toBe(before);
    });

    it("an untimed section is SectionTimerMismatchError", async () => {
      const { u, id } = await section(null);
      await expect(workouts().setSectionRoundTime(u, id, 1, 60)).rejects.toBeInstanceOf(SectionTimerMismatchError);
    });
  });

  describe("09.5 AC15 — clear a round time", () => {
    it("present → removed; absent → not removed; untimed → not removed, no error", async () => {
      const { u, id } = await section(AMRAP, [{ round: 1, seconds: 250 }]);
      expect((await workouts().clearSectionRoundTime(u, id, 1)).removed).toBe(true);
      expect(await roundUpdatedAt(id, 1)).toBeUndefined();
      expect((await workouts().clearSectionRoundTime(u, id, 1)).removed).toBe(false);
      const untimed = await section(null);
      expect((await workouts().clearSectionRoundTime(untimed.u, untimed.id, 1)).removed).toBe(false);
    });

    it("a foreign or missing section is NotFoundError", async () => {
      const { id } = await section(AMRAP, [{ round: 1, seconds: 250 }]);
      const other = await insertUser(db);
      await expect(workouts().clearSectionRoundTime(other, id, 1)).rejects.toBeInstanceOf(NotFoundError);
      await expect(workouts().clearSectionRoundTime(other, uuidv7(), 1)).rejects.toBeInstanceOf(NotFoundError);
      await expect(workouts().setSectionRoundTime(other, id, 1, 60)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("09.5 AC15 / AC17 — a clear locks the section without reading it (#245)", () => {
    const counted = () => {
      const counter = countingPrisma(db.prisma);
      return { counter, repo: createWorkoutRepository(counter.client, createExerciseRepository(counter.client)) };
    };
    async function finishedSection(timer: SectionTimer) {
      const u = await insertUser(db);
      const { workoutId } = await logWorkout(db, u, { startedAt: new Date(Date.now() - 7_200_000), exercises: [] });
      return { u, id: await addTimedSection(db, workoutId, 0, "Main", timer) };
    }

    it("live: a round clear and a result clear each run 3 statements (workout FOR SHARE, section FOR UPDATE, the write)", async () => {
      const { u, id } = await section(AMRAP, [{ round: 1, seconds: 250 }]);
      await workouts().setSectionResult(u, id, { rounds: 5, reps: 7 });
      const { counter, repo } = counted();
      expect(await repo.clearSectionRoundTime(u, id, 1)).toMatchObject({ removed: true, finishedEdit: null });
      expect(counter.statements()).toBe(3);
      counter.reset();
      expect(await repo.clearSectionResult(u, id)).toMatchObject({ removed: true, finishedEdit: null });
      expect(counter.statements()).toBe(3);
      counter.reset();
      expect(await repo.clearSectionRoundTime(u, id, 1)).toMatchObject({ removed: false });
      expect(counter.statements()).toBe(3);
    });

    it("finished: each runs 4, the records lock first", async () => {
      const { u, id } = await finishedSection(AMRAP);
      await workouts().setSectionRoundTime(u, id, 1, 250);
      await workouts().setSectionResult(u, id, { rounds: 5, reps: 7 });
      const { counter, repo } = counted();
      expect(await repo.clearSectionRoundTime(u, id, 1)).toMatchObject({ removed: true });
      expect(counter.statements()).toBe(4);
      counter.reset();
      expect(await repo.clearSectionResult(u, id)).toMatchObject({ removed: true });
      expect(counter.statements()).toBe(4);
    });
  });
});
