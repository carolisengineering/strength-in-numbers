// apps/api/test/unit/workout-repository-reads.test.ts
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { uuidv7 } from "uuidv7";
import { NotFoundError } from "../../src/errors/app-error.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { FakeExerciseRepository } from "../helpers/fakes.js";

class ScriptedPrisma {
  calls: { sql: string }[] = [];
  private queue: Array<() => unknown[]> = [];
  queueRows(rows: unknown[]): void {
    this.queue.push(() => rows);
  }
  $queryRaw = (strings: TemplateStringsArray): Promise<unknown[]> => {
    this.calls.push({ sql: strings.join("?") });
    const next = this.queue.shift();
    if (!next) throw new Error("ScriptedPrisma: no queued response");
    return Promise.resolve(next());
  };
}

const wRow = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  user_id: uuidv7(),
  title: null,
  notes: null,
  started_at: new Date("2026-09-15T10:00:00.000Z"),
  ended_at: null,
  local_date: new Date("2026-09-15T00:00:00.000Z"),
  tz_offset_minutes: 0,
  client_generated_id: uuidv7(),
  source: "manual",
  created_at: new Date("2026-09-15T10:00:00.000Z"),
  updated_at: new Date("2026-09-15T10:00:00.000Z"),
  ...overrides,
});

const weRow = (workoutId: string, position: number) => ({
  id: uuidv7(),
  workout_id: workoutId,
  position,
  exercise_id: uuidv7(),
  exercise_name_snapshot: `Exercise ${position}`,
  modality_snapshot: "weight_reps",
  notes: null,
  created_at: new Date("2026-09-15T10:05:00.000Z"),
  updated_at: new Date("2026-09-15T10:05:00.000Z"),
});

describe("AC15 — getWorkoutById", () => {
  it("a malformed id is NotFoundError with no query issued", async () => {
    const stub = new ScriptedPrisma();
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    await expect(repo.getWorkoutById(uuidv7(), "not-a-uuid")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(stub.calls).toHaveLength(0);
  });

  it("an absent or another user's row is NotFoundError", async () => {
    const stub = new ScriptedPrisma();
    stub.queueRows([]); // workout lookup: no match for this (id, user_id) pair
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    await expect(repo.getWorkoutById(uuidv7(), uuidv7())).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("returns the workout with its exercises ordered by position ascending", async () => {
    const stub = new ScriptedPrisma();
    const workout = wRow();
    stub.queueRows([workout]);
    stub.queueRows([weRow(workout.id, 0), weRow(workout.id, 1)]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    const detail = await repo.getWorkoutById(workout.user_id, workout.id);

    expect(detail.id).toBe(workout.id);
    expect(detail.exercises.map((e) => e.position)).toEqual([0, 1]);
  });
});

describe("AC4 — getActiveWorkout", () => {
  it("no in-progress workout is NotFoundError", async () => {
    const stub = new ScriptedPrisma();
    stub.queueRows([]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    await expect(repo.getActiveWorkout(uuidv7())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns the one in-progress workout with its exercises", async () => {
    const stub = new ScriptedPrisma();
    const workout = wRow();
    stub.queueRows([workout]);
    stub.queueRows([]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    const detail = await repo.getActiveWorkout(workout.user_id);

    expect(detail.id).toBe(workout.id);
    expect(detail.exercises).toEqual([]);
  });
});
