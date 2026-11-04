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
import { settleCapture, startCapture } from "./one-off-helpers.js";

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
    /** The statements `run` sends that read the section's round times: only the section read selects `round_times`. */
    async function sectionReads(run: () => Promise<unknown>): Promise<{ reads: number; locks: number }> {
      const seen = await startCapture(db);
      await run();
      await settleCapture(db, seen);
      return {
        reads: seen.filter((s) => s.includes("round_times")).length,
        locks: seen.filter((s) => /"workout_section" WHERE id = .* FOR UPDATE/s.test(s)).length,
      };
    }
    async function finishedSection(timer: SectionTimer) {
      const u = await insertUser(db);
      const { workoutId } = await logWorkout(db, u, { startedAt: new Date(Date.now() - 7_200_000), exercises: [] });
      return { u, workoutId, id: await addTimedSection(db, workoutId, 0, "Main", timer) };
    }

    it("live: a round clear and a result clear take the section lock and read nothing", async () => {
      const { u, id } = await section(AMRAP, [{ round: 1, seconds: 250 }]);
      await workouts().setSectionResult(u, id, { rounds: 5, reps: 7 });
      let result: unknown;
      expect(await sectionReads(async () => (result = await workouts().clearSectionRoundTime(u, id, 1)))).toEqual({ reads: 0, locks: 1 });
      expect(result).toMatchObject({ removed: true, finishedEdit: null });
      expect(await sectionReads(async () => (result = await workouts().clearSectionResult(u, id)))).toEqual({ reads: 0, locks: 1 });
      expect(result).toMatchObject({ removed: true, finishedEdit: null });
      expect(await sectionReads(async () => (result = await workouts().clearSectionRoundTime(u, id, 1)))).toEqual({ reads: 0, locks: 1 });
      expect(result).toMatchObject({ removed: false });
    });

    describe("09.5 AC14 / AC18 — a round PUT answers without re-reading (#246)", () => {
      /** The write result without its three write-only keys: what a fresh read of the section returns. */
      const asSection = (r: object) => Object.fromEntries(Object.entries(r).filter(([k]) => !["workoutId", "changed", "finishedEdit"].includes(k)));
      const detailSection = async (u: string, workoutId: string, id: string) =>
        (await workouts().getWorkoutById(u, workoutId)).sections.find((s) => s.id === id);

      it("a changing PUT reads the section once (the lock-then-read); a replay reads it once and writes nothing", async () => {
        const { u, id } = await section(SET_TIMER, [{ round: 1, seconds: 221 }]);
        expect(await sectionReads(() => workouts().setSectionRoundTime(u, id, 2, 218))).toEqual({ reads: 1, locks: 1 });
        expect(await sectionReads(() => workouts().setSectionRoundTime(u, id, 2, 218))).toEqual({ reads: 1, locks: 1 });
      });

      it("rounds written 3, 1, 2: each response is in round order and equals a fresh read", async () => {
        const { u, workoutId, id } = await section(SET_TIMER);
        for (const [round, seconds] of [[3, 210], [1, 221], [2, 218]] as const) {
          const r = await workouts().setSectionRoundTime(u, id, round, seconds);
          expect(r.roundTimes.map((t) => t.round)).toEqual([...r.roundTimes.map((t) => t.round)].sort((a, b) => a - b));
          expect(asSection(r)).toEqual(await detailSection(u, workoutId, id));
        }
      });

      it("rewriting round 1 leaves one round-1 entry with the new seconds", async () => {
        const { u, workoutId, id } = await section(SET_TIMER, [{ round: 1, seconds: 221 }, { round: 2, seconds: 218 }]);
        const r = await workouts().setSectionRoundTime(u, id, 1, 230);
        expect(r.roundTimes).toEqual([{ round: 1, seconds: 230 }, { round: 2, seconds: 218 }]);
        expect(asSection(r)).toEqual(await detailSection(u, workoutId, id));
      });

      it("finished: the response equals a fresh read and carries finishedEdit", async () => {
        const fin = await finishedSection(SET_TIMER);
        const r = await workouts().setSectionRoundTime(fin.u, fin.id, 2, 218);
        expect(r.finishedEdit).not.toBeNull();
        expect(asSection(r)).toEqual(await detailSection(fin.u, fin.workoutId, fin.id));
      });
    });

    it("finished: the same, under the records lock", async () => {
      const { u, id } = await finishedSection(AMRAP);
      await workouts().setSectionRoundTime(u, id, 1, 250);
      await workouts().setSectionResult(u, id, { rounds: 5, reps: 7 });
      let result: unknown;
      expect(await sectionReads(async () => (result = await workouts().clearSectionRoundTime(u, id, 1)))).toEqual({ reads: 0, locks: 1 });
      expect(result).toMatchObject({ removed: true });
      expect(await sectionReads(async () => (result = await workouts().clearSectionResult(u, id)))).toEqual({ reads: 0, locks: 1 });
      expect(result).toMatchObject({ removed: true });
    });
  });
});
