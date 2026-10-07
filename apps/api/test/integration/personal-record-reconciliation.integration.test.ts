import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pino } from "pino";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { rebuildRecords } from "../../src/records/rebuild.js";
import { EXERCISES, SESSIONS, type ExerciseKey } from "../fixtures/pr-reconciliation/sessions.js";
import { EXPECTED, type Expected } from "../fixtures/pr-reconciliation/expected.js";
import { EXPECTED_PROGRESS } from "../fixtures/pr-reconciliation/expected-progress.js";
import { milliToDecimalString } from "@sin/core";
import { createPersonalRecordRepository } from "../../src/repositories/personal-record.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, logWorkout, recordsOf } from "./records-helpers.js";

const order = (xs: Expected[]) =>
  [...xs].sort((a, b) => (a.exercise + a.recordType).localeCompare(b.exercise + b.recordType));

describe.skipIf(!shouldRunIntegration())("AC26 — hand reconciliation over 10 sessions", () => {
  let db: IntegrationDb;
  let user: string;
  const idOf = {} as Record<ExerciseKey, string>;
  const sessionOf = new Map<string, string>(); // workoutId → "S1"…

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
    user = await insertUser(db);
    for (const key of ["bench", "squat", "dips", "pullup", "benchFork"] as const) {
      const { modality, forkOf } = EXERCISES[key];
      idOf[key] = await insertExercise(db, {
        modality,
        ...(forkOf ? { ownerUserId: user, forkedFrom: idOf[forkOf] } : {}),
      });
    }
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });

  const nameOf = (exerciseId: string) =>
    Object.entries(idOf).find(([, id]) => id === exerciseId)![0] as Expected["exercise"];
  const actual = async (): Promise<Expected[]> =>
    order(
      (await recordsOf(db, user)).map((r) => ({
        exercise: nameOf(r.exercise_id),
        recordType: r.record_type,
        value: r.value,
        previousValue: r.previous_value,
        session: sessionOf.get(r.workout_id)!,
      })),
    );

  it("the live finish path matches expected.ts", async () => {
    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
    for (const s of SESSIONS) {
      const startedAt = new Date(Date.UTC(2026, 8, s.day, 10));
      const { workoutId } = await logWorkout(db, user, {
        startedAt,
        finish: "none",
        exercises: s.exercises.map((e) => ({ exerciseId: idOf[e.key], modality: EXERCISES[e.key].modality, sets: e.sets })),
      });
      sessionOf.set(workoutId, s.id);
      await repo.updateWorkout(user, workoutId, { endedAt: new Date(startedAt.getTime() + 3_600_000).toISOString() });
    }
    expect(await actual()).toEqual(order(EXPECTED));
  });

  it("records:rebuild matches expected.ts", async () => {
    await db.prisma.$executeRawUnsafe(`DELETE FROM "personal_record"`);
    await rebuildRecords(db.prisma, pino({ level: "silent" }), {});
    expect(await actual()).toEqual(order(EXPECTED));
  });

  it("AC18 (Spec 07.2) — the progress series matches expected-progress.ts, and its max equals the PRs", async () => {
    const repo = createPersonalRecordRepository(db.prisma);
    const s = (m: number | null) => (m === null ? null : milliToDecimalString(m));
    for (const key of ["bench", "squat", "dips", "pullup"] as const) {
      const { points } = await repo.getProgressSeries(user, idOf[key], {});
      expect(
        points.map((p) => ({
          session: sessionOf.get(p.workoutId)!,
          localDate: p.localDate,
          topSetWeight: s(p.topSetWeightMilli),
          bestE1rm: s(p.bestE1rmMilli),
          totalVolume: s(p.totalVolumeMilli),
          maxReps: s(p.maxRepsMilli),
        })),
        key,
      ).toEqual(EXPECTED_PROGRESS[key]);
      for (const [metric, type] of [["topSetWeight", "heaviest_weight"], ["bestE1rm", "best_est_1rm"], ["maxReps", "max_reps"]] as const) {
        const pr = EXPECTED.find((e) => e.exercise === key && e.recordType === type);
        const values = EXPECTED_PROGRESS[key].map((p) => p[metric]).filter((v): v is string => v !== null).map(Number);
        expect(values.length ? Math.max(...values).toFixed(3) : null, `${key} ${type}`).toBe(pr ? pr.value : null);
      }
    }
  });
});
