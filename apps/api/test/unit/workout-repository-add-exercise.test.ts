// apps/api/test/unit/workout-repository-add-exercise.test.ts
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { uuidv7 } from "uuidv7";
import { NotFoundError, WorkoutFinishedError } from "../../src/errors/app-error.js";
import { ExerciseRetiredError } from "../../src/errors/app-error.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { FakeExerciseRepository, makeExerciseRecord } from "../helpers/fakes.js";

class ScriptedPrisma {
  calls: { sql: string }[] = [];
  private queryQueue: Array<() => unknown[]> = [];
  private execCount = 0;
  queueRows(rows: unknown[]): void {
    this.queryQueue.push(() => rows);
  }
  $queryRaw = (strings: TemplateStringsArray): Promise<unknown[]> => {
    this.calls.push({ sql: strings.join("?") });
    const next = this.queryQueue.shift();
    if (!next) throw new Error("ScriptedPrisma: no queued response for $queryRaw");
    return Promise.resolve(next());
  };
  $executeRaw = (strings: TemplateStringsArray): Promise<number> => {
    this.calls.push({ sql: strings.join("?") });
    this.execCount += 1;
    return Promise.resolve(this.execCount);
  };
  $transaction = async <T>(fn: (tx: this) => Promise<T>): Promise<T> => fn(this);
}

const workoutRow = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  user_id: uuidv7(),
  ended_at: null,
  ...overrides,
});

describe("AC15 — addWorkoutExercise: workout ownership / malformed id", () => {
  it("a malformed workoutId is NotFoundError with no query issued", async () => {
    const stub = new ScriptedPrisma();
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());
    await expect(
      repo.addWorkoutExercise(uuidv7(), "bad-id", { exerciseId: uuidv7() }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(stub.calls).toHaveLength(0);
  });

  it("an absent or another user's workout is NotFoundError before the exercise is even resolved", async () => {
    const stub = new ScriptedPrisma();
    stub.queueRows([]); // phase-1 workout load: no match
    const exerciseRepo = new FakeExerciseRepository();
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, exerciseRepo);
    await expect(
      repo.addWorkoutExercise(uuidv7(), uuidv7(), { exerciseId: uuidv7() }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(exerciseRepo.byId.size).toBe(0); // never called findVisibleById
  });
});

describe("AC9 — addWorkoutExercise: finished-workout rejection at both checks", () => {
  it("phase 1 (root-client) check: a workout already finished is 409 before opening the transaction", async () => {
    const stub = new ScriptedPrisma();
    const w = workoutRow({ ended_at: new Date("2026-09-15T11:00:00.000Z") });
    stub.queueRows([w]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());
    await expect(
      repo.addWorkoutExercise(w.user_id, w.id, { exerciseId: uuidv7() }),
    ).rejects.toBeInstanceOf(WorkoutFinishedError);
    expect(stub.calls.some((c) => c.sql.includes("pg_advisory_xact_lock"))).toBe(false);
  });

  it("phase 3 (FOR SHARE re-check) catches a finish that committed after phase 1", async () => {
    const stub = new ScriptedPrisma();
    const w = workoutRow();
    const exerciseRepo = new FakeExerciseRepository();
    const exercise = makeExerciseRecord({ isActive: true });
    exerciseRepo.byId.set(exercise.id, exercise);
    stub.queueRows([w]); // phase 1: still in progress
    stub.queueRows([{ ended_at: new Date("2026-09-15T11:00:00.000Z") }]); // FOR SHARE re-check: now finished
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, exerciseRepo);
    await expect(
      repo.addWorkoutExercise(w.user_id, w.id, { exerciseId: exercise.id }),
    ).rejects.toBeInstanceOf(WorkoutFinishedError);
  });

  it("a workout deleted between phase 1 and the lock is 404, not 500 (vanished-row rule, §6.7)", async () => {
    const stub = new ScriptedPrisma();
    const w = workoutRow();
    const exerciseRepo = new FakeExerciseRepository();
    const exercise = makeExerciseRecord({ isActive: true });
    exerciseRepo.byId.set(exercise.id, exercise);
    stub.queueRows([w]);
    stub.queueRows([]); // FOR SHARE re-check: no row — deleted meanwhile
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, exerciseRepo);
    await expect(
      repo.addWorkoutExercise(w.user_id, w.id, { exerciseId: exercise.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("AC10 — exercise resolution and snapshotting", () => {
  it("an exerciseId findVisibleById misses is 404", async () => {
    const stub = new ScriptedPrisma();
    const w = workoutRow();
    stub.queueRows([w]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());
    await expect(
      repo.addWorkoutExercise(w.user_id, w.id, { exerciseId: uuidv7() }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("an isActive=false exercise is 409 exercise-retired", async () => {
    const stub = new ScriptedPrisma();
    const w = workoutRow();
    const exerciseRepo = new FakeExerciseRepository();
    const retired = makeExerciseRecord({ isActive: false });
    exerciseRepo.byId.set(retired.id, retired);
    stub.queueRows([w]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, exerciseRepo);
    await expect(
      repo.addWorkoutExercise(w.user_id, w.id, { exerciseId: retired.id }),
    ).rejects.toBeInstanceOf(ExerciseRetiredError);
  });

  it("snapshots the resolved exercise's name/modality and appends at n when position is absent", async () => {
    const stub = new ScriptedPrisma();
    const w = workoutRow();
    const exerciseRepo = new FakeExerciseRepository();
    const exercise = makeExerciseRecord({ name: "Bench Press", modality: "weight_reps", isActive: true });
    exerciseRepo.byId.set(exercise.id, exercise);
    stub.queueRows([w]); // phase 1
    stub.queueRows([{ ended_at: null }]); // FOR SHARE re-check
    stub.queueRows([{ n: 2 }]); // count read: 2 existing rows -> append at position 2
    stub.queueRows([
      {
        id: uuidv7(),
        workout_id: w.id,
        position: 2,
        exercise_id: exercise.id,
        exercise_name_snapshot: exercise.name,
        modality_snapshot: exercise.modality,
        notes: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]); // INSERT ... RETURNING
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, exerciseRepo);

    const created = await repo.addWorkoutExercise(w.user_id, w.id, { exerciseId: exercise.id });

    expect(created.position).toBe(2);
    expect(created.exerciseNameSnapshot).toBe("Bench Press");
    expect(created.modalitySnapshot).toBe("weight_reps");
  });
});

describe("AC13 — statement order: the advisory lock is the first statement other than SET CONSTRAINTS, the count read is later and separate", () => {
  it("orders SET CONSTRAINTS, lock, FOR SHARE, count, insert", async () => {
    const stub = new ScriptedPrisma();
    const w = workoutRow();
    const exerciseRepo = new FakeExerciseRepository();
    const exercise = makeExerciseRecord({ isActive: true });
    exerciseRepo.byId.set(exercise.id, exercise);
    stub.queueRows([w]);
    stub.queueRows([{ ended_at: null }]);
    stub.queueRows([{ n: 0 }]);
    stub.queueRows([
      {
        id: uuidv7(),
        workout_id: w.id,
        position: 0,
        exercise_id: exercise.id,
        exercise_name_snapshot: exercise.name,
        modality_snapshot: exercise.modality,
        notes: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, exerciseRepo);

    await repo.addWorkoutExercise(w.user_id, w.id, { exerciseId: exercise.id });

    // calls[0] is phase-1's plain workout SELECT (no transaction yet).
    const txCalls = stub.calls.slice(1);
    expect(txCalls[0]!.sql).toContain("SET CONSTRAINTS");
    expect(txCalls[1]!.sql).toContain("pg_advisory_xact_lock");
    expect(txCalls[2]!.sql).toContain("FOR SHARE");
    expect(txCalls[3]!.sql).toContain("count(*)");
    expect(txCalls[4]!.sql).toContain("INSERT INTO");
  });
});
