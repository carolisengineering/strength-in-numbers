// Spec 09.5 AC9 — the start copies each section's timer plan; nothing recorded; isolation both ways.
import { RoutineWriteSchema } from "@sin/core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser } from "./records-helpers.js";
import { TRUNCATE_ROUTINES } from "./routine-helpers.js";
import { assertSectionsConsistent } from "./section-helpers.js";

const PLAN = [
  { format: "set_timer", roundSeconds: 300, rounds: 5 },
  { format: "amrap", capSeconds: 720 },
  { format: "time_cap", capSeconds: null },
  null,
] as const;

describe.skipIf(!shouldRunIntegration())("Spec 09.5 — the start copies timers (real Postgres)", () => {
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
  const routines = () => createRoutineRepository(db.prisma);
  const workouts = () => createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
  const start = (u: string, routineId: string, key = uuidv7()) =>
    workouts().createWorkout(u, { clientGeneratedId: key, startedAt: new Date(Date.now() - 60_000), tzOffsetMinutes: 0, title: null, notes: null, routineId }, "UTC");
  const body = (ex: string, timers: readonly unknown[]) =>
    RoutineWriteSchema.parse({
      name: "Timed",
      sections: timers.map((timer, j) => ({ key: `s${j}`, name: `S${j}`, timer })),
      items: timers.map((_, j) => ({ exerciseId: ex, sectionKey: `s${j}` })),
    });

  async function fixture() {
    const u = await insertUser(db);
    const ex = await insertExercise(db, { ownerUserId: u });
    const routine = (await routines().create(u, body(ex, PLAN))).routine;
    return { u, ex, routine };
  }

  it("09.5 AC9 — the start copies the plan; result is empty and roundTimes []", async () => {
    const { u, routine } = await fixture();
    const started = await start(u, routine.id);
    expect(started.timedSectionCount).toBe(3);
    const d = await workouts().getWorkoutById(u, started.workout.id);
    expect(d.sections.map((s) => s.timer)).toEqual(routine.sections.map((s) => s.timer));
    expect(d.sections.map((s) => s.timer)).toEqual([...PLAN]);
    expect(d.sections.every((s) => s.result === null && s.roundTimes.length === 0)).toBe(true);
  });

  it("09.5 AC9 — a replay after the routine changes or is deleted never re-reads it", async () => {
    const { u, ex, routine } = await fixture();
    const key = uuidv7();
    const first = await start(u, routine.id, key);
    const before = (await workouts().getWorkoutById(u, first.workout.id)).sections;

    await routines().replace(u, routine.id, body(ex, [{ format: "amrap", capSeconds: 60 }, null, null, null]));
    const replay = await start(u, routine.id, key);
    expect(replay.created).toBe(false);
    expect(replay.timedSectionCount).toBe(0);
    expect((await workouts().getWorkoutById(u, first.workout.id)).sections).toEqual(before);

    await routines().delete(u, routine.id);
    expect((await workouts().getWorkoutById(u, first.workout.id)).sections).toEqual(before);
  });

  it("09.5 AC9 — a workout timer write never reaches the routine", async () => {
    const { u, routine } = await fixture();
    const started = await start(u, routine.id);
    await db.prisma.$executeRawUnsafe(
      `UPDATE "workout_section" SET timer_format = 'amrap', timer_round_s = NULL, timer_rounds = NULL, timer_cap_s = 99 WHERE workout_id = $1::uuid`,
      started.workout.id,
    );
    expect((await routines().getById(u, routine.id)).sections.map((s) => s.timer)).toEqual([...PLAN]);
  });
});
