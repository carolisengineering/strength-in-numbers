import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { createPersonalRecordRepository } from "../../src/repositories/personal-record.prisma.js";
import { WorkoutFinishedError } from "../../src/errors/app-error.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, logWorkout, recordsOf, TRUNCATE_ALL } from "./records-helpers.js";

const day = (d: number) => new Date(Date.UTC(2026, 8, d, 10));
const endOf = (d: number) => new Date(Date.UTC(2026, 8, d, 11)).toISOString();

const FAULT_FN = `CREATE OR REPLACE FUNCTION pr_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected PR fault'; END $$`;
const FAULT_TRIGGER = `CREATE TRIGGER pr_test_fault BEFORE INSERT ON "personal_record" FOR EACH ROW EXECUTE FUNCTION pr_test_fault()`;

describe.skipIf(!shouldRunIntegration())("Spec 07.0 — finish and delete write records (real Postgres)", () => {
  let db: IntegrationDb;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    if (db) await db.prisma.$executeRawUnsafe(TRUNCATE_ALL);
  });

  const repo = () => createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));

  /** An in-progress workout with sets, finished through the real repository. */
  async function finishVia(userId: string, d: number, exerciseId: string, sets: { reps: number; weight: number }[]) {
    const { workoutId } = await logWorkout(db, userId, { startedAt: day(d), finish: "none", exercises: [{ exerciseId, sets }] });
    const result = await repo().updateWorkout(userId, workoutId, { endedAt: endOf(d) });
    return { workoutId, result };
  }

  /** Runs `body` with every personal_record INSERT failing. */
  async function withInsertFault(body: () => Promise<void>): Promise<void> {
    await db.prisma.$executeRawUnsafe(FAULT_FN);
    await db.prisma.$executeRawUnsafe(FAULT_TRIGGER);
    try {
      await body();
    } finally {
      await db.prisma.$executeRawUnsafe(`DROP TRIGGER pr_test_fault ON "personal_record"`);
      await db.prisma.$executeRawUnsafe(`DROP FUNCTION pr_test_fault()`);
    }
  }

  describe("AC12 — finish writes the records and returns them", () => {
    it("first-ever finish: three load records, previousValue null, rows match newRecords", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      const { workoutId, result } = await finishVia(user, 1, bench, [{ reps: 5, weight: 100 }]);

      expect(result.newRecords.map((r) => r.recordType)).toEqual(["heaviest_weight", "best_est_1rm", "best_set_volume"]);
      expect(result.newRecords.every((r) => r.previousValue === null && r.workoutId === workoutId)).toBe(true);
      expect(await recordsOf(db, user)).toHaveLength(3);
    });

    it("a later better finish sets previousValue to the earlier best", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      await finishVia(user, 1, bench, [{ reps: 5, weight: 100 }]);
      const { result } = await finishVia(user, 2, bench, [{ reps: 5, weight: 105 }]);
      expect(result.newRecords.find((r) => r.recordType === "heaviest_weight")).toMatchObject({ value: 105, previousValue: 100 });
    });
  });

  describe("AC13 / Review Focus 3 — finishes that set nothing", () => {
    it("a finish with no exercises returns [] and leaves other rows untouched", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      await finishVia(user, 1, bench, [{ reps: 5, weight: 100 }]);
      const before = await recordsOf(db, user);
      const { workoutId } = await logWorkout(db, user, { startedAt: day(2), finish: "none", exercises: [] });
      const result = await repo().updateWorkout(user, workoutId, { endedAt: endOf(2) });
      expect(result.newRecords).toEqual([]);
      expect(await recordsOf(db, user)).toEqual(before);
    });

    it("a duration-only finish returns []", async () => {
      const user = await insertUser(db);
      const plank = await insertExercise(db, { modality: "duration" });
      const { workoutId } = await logWorkout(db, user, {
        startedAt: day(1),
        finish: "none",
        exercises: [{ exerciseId: plank, modality: "duration", sets: [{ durationS: 60 }] }],
      });
      const result = await repo().updateWorkout(user, workoutId, { endedAt: endOf(1) });
      expect(result.newRecords).toEqual([]);
    });

    it("a finish that beats nothing returns [] but keeps the holder's rows", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      await finishVia(user, 1, bench, [{ reps: 5, weight: 100 }]);
      const { result } = await finishVia(user, 2, bench, [{ reps: 5, weight: 90 }]);
      expect(result.newRecords).toEqual([]);
      expect(await recordsOf(db, user)).toHaveLength(3);
    });
  });

  describe("AC14 — a repeat finish is 409 and the records are recoverable", () => {
    it("second finish → WorkoutFinishedError; list({ workoutId }) equals the first newRecords", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      const { workoutId, result } = await finishVia(user, 1, bench, [{ reps: 5, weight: 100 }]);
      await expect(repo().updateWorkout(user, workoutId, { endedAt: endOf(1) })).rejects.toBeInstanceOf(WorkoutFinishedError);
      const listed = await createPersonalRecordRepository(db.prisma).list(user, { workoutId });
      const byType = (xs: { recordType: string }[]) => [...xs].sort((a, b) => a.recordType.localeCompare(b.recordType));
      expect(byType(listed)).toEqual(byType(result.newRecords));
    });
  });

  describe("AC15 — a backdated finish can take a record from a later workout", () => {
    it("tie goes to the earlier started_at; W2's rows are re-pointed to W1", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      const { workoutId: w2 } = await finishVia(user, 10, bench, [{ reps: 5, weight: 100 }]);
      const { workoutId: w1, result } = await finishVia(user, 5, bench, [{ reps: 5, weight: 100 }]);

      expect(result.newRecords.map((r) => r.workoutId)).toEqual([w1, w1, w1]);
      const rows = await recordsOf(db, user);
      expect(rows.every((r) => r.workout_id === w1)).toBe(true);
      expect(rows.some((r) => r.workout_id === w2)).toBe(false);
    });

    it("a backdated lower value lowers the later record's previousValue", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      await finishVia(user, 10, bench, [{ reps: 5, weight: 100 }]);
      await finishVia(user, 5, bench, [{ reps: 5, weight: 80 }]);
      const heaviest = (await recordsOf(db, user)).find((r) => r.record_type === "heaviest_weight")!;
      expect(heaviest.value).toBe("100.000");
      expect(heaviest.previous_value).toBe("80.000");
    });
  });

  describe("AC17 — a recompute failure rolls the finish back", () => {
    it("fault on INSERT → error, ended_at still NULL, rows unchanged; retry succeeds once the fault is gone", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      const { workoutId } = await logWorkout(db, user, {
        startedAt: day(1),
        finish: "none",
        exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 100 }] }],
      });
      await withInsertFault(async () => {
        await expect(repo().updateWorkout(user, workoutId, { endedAt: endOf(1) })).rejects.toThrow(/injected PR fault/);
        const w = await db.prisma.$queryRawUnsafe<{ ended_at: Date | null }[]>(`SELECT ended_at FROM "workout" WHERE id = $1::uuid`, workoutId);
        expect(w[0]!.ended_at).toBeNull();
        expect(await recordsOf(db, user)).toEqual([]);
      });
      const retry = await repo().updateWorkout(user, workoutId, { endedAt: endOf(1) });
      expect(retry.newRecords).toHaveLength(3);
    });
  });

  describe("AC16 — deleting a finished workout recomputes", () => {
    it("deleting the holder promotes the next best with a correct previousValue", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      await finishVia(user, 1, bench, [{ reps: 5, weight: 90 }]);
      const { workoutId: w2 } = await finishVia(user, 2, bench, [{ reps: 5, weight: 95 }]);
      const { workoutId: w3 } = await finishVia(user, 3, bench, [{ reps: 5, weight: 100 }]);

      await repo().deleteWorkout(user, w3);

      const heaviest = (await recordsOf(db, user)).find((r) => r.record_type === "heaviest_weight")!;
      expect(heaviest).toMatchObject({ workout_id: w2, value: "95.000", previous_value: "90.000" });
    });

    it("deleting the only source leaves no rows", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      const { workoutId } = await finishVia(user, 1, bench, [{ reps: 5, weight: 100 }]);
      await repo().deleteWorkout(user, workoutId);
      expect(await recordsOf(db, user)).toEqual([]);
    });

    it("Review Focus 4 — deleting an earlier non-holder drops the later record's previousValue", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      const { workoutId: w1 } = await finishVia(user, 1, bench, [{ reps: 5, weight: 90 }]);
      await finishVia(user, 2, bench, [{ reps: 5, weight: 100 }]);
      await repo().deleteWorkout(user, w1);
      const heaviest = (await recordsOf(db, user)).find((r) => r.record_type === "heaviest_weight")!;
      expect(heaviest.value).toBe("100.000");
      expect(heaviest.previous_value).toBeNull();
    });

    it("deleting an in-progress workout leaves personal_record untouched", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      await finishVia(user, 1, bench, [{ reps: 5, weight: 100 }]);
      const before = await recordsOf(db, user);
      const { workoutId } = await logWorkout(db, user, {
        startedAt: day(2),
        finish: "none",
        exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 200 }] }],
      });
      await repo().deleteWorkout(user, workoutId);
      expect(await recordsOf(db, user)).toEqual(before);
    });
  });

  describe("AC17 — a recompute failure rolls the delete back", () => {
    it("fault on INSERT → error, workout still exists, rows unchanged", async () => {
      const user = await insertUser(db);
      const bench = await insertExercise(db);
      await finishVia(user, 1, bench, [{ reps: 5, weight: 90 }]);
      const { workoutId: holder } = await finishVia(user, 2, bench, [{ reps: 5, weight: 100 }]);
      const before = await recordsOf(db, user);
      await withInsertFault(async () => {
        await expect(repo().deleteWorkout(user, holder)).rejects.toThrow(/injected PR fault/);
        const w = await db.prisma.$queryRawUnsafe<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM "workout" WHERE id = $1::uuid`,
          holder,
        );
        expect(w[0]!.n).toBe(1);
        expect(await recordsOf(db, user)).toEqual(before);
      });
    });
  });
});
