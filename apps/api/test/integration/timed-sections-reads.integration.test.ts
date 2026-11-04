// Spec 09.5 AC7, AC10 (Review Focus 1–3) — every read carries the section timer, result and round times.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { toWorkoutSectionDto } from "../../src/routes/mappers.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { settleCapture, startCapture } from "./one-off-helpers.js";
import { insertExercise, insertUser, logWorkout } from "./records-helpers.js";
import { TRUNCATE_ROUTINES } from "./routine-helpers.js";
import { addTimedSection, assertSectionsConsistent, insertWorkoutSection, recordRounds, setResult } from "./section-helpers.js";

/** Statements `getWorkoutById` issued before 0018 (measured on main 53fc203); the timer data adds none. */
const DETAIL_STATEMENTS = 4;

describe.skipIf(!shouldRunIntegration())("Spec 09.5 — timed reads (real Postgres)", () => {
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
  const routines = () => createRoutineRepository(db.prisma);

  async function timedWorkout() {
    const u = await insertUser(db);
    const ex = await insertExercise(db, { ownerUserId: u });
    const { workoutId } = await logWorkout(db, u, { startedAt: new Date(Date.now() - 600_000), finish: "none", exercises: [{ exerciseId: ex, sets: [] }] });
    const untimed = await insertWorkoutSection(db, workoutId, 0, "Warm-up");
    const setTimer = await addTimedSection(db, workoutId, 1, "Main", { format: "set_timer", roundSeconds: 300, rounds: 5 });
    await recordRounds(db, setTimer, [{ round: 3, seconds: 210 }, { round: 1, seconds: 221 }]);
    const amrap = await addTimedSection(db, workoutId, 2, "Finisher", { format: "amrap", capSeconds: 720 });
    await setResult(db, amrap, { rounds: 5, reps: 7, finishSeconds: null, capped: false });
    return { u, ex, workoutId, untimed, setTimer, amrap };
  }

  describe("09.5 AC10 — detail and active carry timer, result and round times", () => {
    it("untimed, Set Timer with rounds (ordered), AMRAP with a result", async () => {
      const { u, workoutId, untimed, setTimer, amrap } = await timedWorkout();
      const d = await workouts().getWorkoutById(u, workoutId);
      expect(d.sections.map((s) => [s.id, s.timer, s.result, s.roundTimes])).toEqual([
        [untimed, null, null, []],
        [setTimer, { format: "set_timer", roundSeconds: 300, rounds: 5 }, null, [{ round: 1, seconds: 221 }, { round: 3, seconds: 210 }]],
        [amrap, { format: "amrap", capSeconds: 720 }, { rounds: 5, reps: 7, finishSeconds: null, capped: false }, []],
      ]);
      expect((await workouts().getActiveWorkout(u)).sections).toEqual(d.sections);
      expect(Object.keys(toWorkoutSectionDto(d.sections[1]!))).toEqual(["id", "position", "name", "notes", "addedInWorkout", "timer", "result", "roundTimes"]);
    });

    it("a capped Time Cap with rounds null reads back as a result (Review Focus 1)", async () => {
      const u = await insertUser(db);
      const { workoutId } = await logWorkout(db, u, { startedAt: new Date(Date.now() - 600_000), finish: "none", exercises: [] });
      const s = await addTimedSection(db, workoutId, 0, "Cap", { format: "time_cap", capSeconds: 900 });
      await setResult(db, s, { rounds: null, reps: 7, finishSeconds: null, capped: true });
      const d = await workouts().getWorkoutById(u, workoutId);
      expect(d.sections[0]!.result).toEqual({ rounds: null, reps: 7, finishSeconds: null, capped: true });
    });

    it("a For Time section reads capSeconds: null", async () => {
      const u = await insertUser(db);
      const { workoutId } = await logWorkout(db, u, { startedAt: new Date(Date.now() - 600_000), finish: "none", exercises: [] });
      await addTimedSection(db, workoutId, 0, "Chipper", { format: "time_cap", capSeconds: null });
      expect((await workouts().getWorkoutById(u, workoutId)).sections[0]!.timer).toEqual({ format: "time_cap", capSeconds: null });
    });

    it("a manual workout has no sections", async () => {
      const u = await insertUser(db);
      const { workoutId } = await logWorkout(db, u, { startedAt: new Date(Date.now() - 600_000), finish: "none", exercises: [] });
      expect((await workouts().getWorkoutById(u, workoutId)).sections).toEqual([]);
    });

    it("a section inserted with the Hevy importer's column list reads untimed (Review Focus 3)", async () => {
      const u = await insertUser(db);
      const { workoutId } = await logWorkout(db, u, { startedAt: new Date(Date.now() - 600_000), finish: "none", exercises: [] });
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "workout_section" (id, workout_id, position, name, notes, added_in_workout, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, 0, 'Imported', NULL, false, now(), now())`,
        uuidv7(),
        workoutId,
      );
      const [s] = (await workouts().getWorkoutById(u, workoutId)).sections;
      expect([s!.timer, s!.result, s!.roundTimes]).toEqual([null, null, []]);
    });
  });

  it("09.5 AC10 — one statement: the detail read issues as many statements as before", async () => {
    const { u, workoutId } = await timedWorkout();
    const seen = await startCapture(db);
    await workouts().getWorkoutById(u, workoutId);
    await settleCapture(db, seen);
    expect(seen).toHaveLength(DETAIL_STATEMENTS);
  });

  it("09.5 AC10 — section RETURNING carries round times (Review Focus 2)", async () => {
    const { u, workoutId, setTimer } = await timedWorkout();
    const patched = await workouts().updateWorkoutSection(u, setTimer, { name: "Main set" });
    expect(patched.name).toBe("Main set");
    expect(patched.timer).toEqual({ format: "set_timer", roundSeconds: 300, rounds: 5 });
    expect(patched.roundTimes).toEqual([{ round: 1, seconds: 221 }, { round: 3, seconds: 210 }]);
    const unchanged = await workouts().updateWorkoutSection(u, setTimer, { name: "Main set" });
    expect(unchanged.roundTimes).toEqual([{ round: 1, seconds: 221 }, { round: 3, seconds: 210 }]);

    const added = await workouts().addWorkoutSection(u, workoutId, { name: "Extra", notes: null });
    expect([added.timer, added.result, added.roundTimes, added.addedInWorkout]).toEqual([null, null, [], true]);
  });

  it("09.5 AC7 — routine reads carry timer, in the same single statement", async () => {
    const u = await insertUser(db);
    const r = uuidv7();
    await db.prisma.$executeRawUnsafe(`INSERT INTO "routine" (id, user_id, name) VALUES ($1::uuid, $2::uuid, 'Timed')`, r, u);
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "routine_section" (id, routine_id, position, name, timer_format, timer_round_s, timer_rounds) VALUES ($1::uuid, $2::uuid, 0, 'Main', 'set_timer', 300, 5)`,
      uuidv7(),
      r,
    );
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "routine_section" (id, routine_id, position, name, timer_format) VALUES ($1::uuid, $2::uuid, 1, 'Chipper', 'time_cap')`,
      uuidv7(),
      r,
    );
    await db.prisma.$executeRawUnsafe(`INSERT INTO "routine_section" (id, routine_id, position, name) VALUES ($1::uuid, $2::uuid, 2, 'Cool')`, uuidv7(), r);
    const expected = [{ format: "set_timer", roundSeconds: 300, rounds: 5 }, { format: "time_cap", capSeconds: null }, null];

    const seen = await startCapture(db);
    const list = (await routines().list(u)).routines;
    await settleCapture(db, seen);
    expect(seen).toHaveLength(2); // the 09.3 sweep probe, then the one list statement (09.2 AC30)
    expect(list[0]!.sections.map((s) => s.timer)).toEqual(expected);
    expect((await routines().getById(u, r)).sections.map((s) => s.timer)).toEqual(expected);
  });

  describe("09.5 AC25 — History's timed sections agree with the detail (#247)", () => {
    it("each History entry is the detail's section (timed only, by position): id, position, name, timer, result, round times", async () => {
      const { u, workoutId, untimed } = await timedWorkout();
      await db.prisma.$executeRawUnsafe(`UPDATE "workout" SET ended_at = started_at + interval '1 hour' WHERE id = $1::uuid`, workoutId);
      const detail = await workouts().getWorkoutById(u, workoutId);
      const page = await workouts().listFinishedWorkouts(u, { limit: 10 });
      const row = page.items.find((w) => w.id === workoutId)!;
      const expected = detail.sections
        .filter((s) => s.timer !== null)
        .map((s) => ({ id: s.id, position: s.position, name: s.name, timer: s.timer, result: s.result, roundTimes: s.roundTimes }));
      expect(expected).toHaveLength(2);
      expect(row.timedSections).toEqual(expected);
      expect(row.timedSections.map((s) => s.id)).not.toContain(untimed);
    });
  });
});
