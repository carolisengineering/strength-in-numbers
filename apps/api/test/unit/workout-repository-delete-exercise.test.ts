// apps/api/test/unit/workout-repository-delete-exercise.test.ts
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { uuidv7 } from "uuidv7";
import { NotFoundError, WorkoutFinishedError } from "../../src/errors/app-error.js";
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
  $executeRaw = (strings: TemplateStringsArray): Promise<number> => {
    this.calls.push({ sql: strings.join("?") });
    return Promise.resolve(0);
  };
  $transaction = async <T>(fn: (tx: this) => Promise<T>): Promise<T> => fn(this);
}

const ownedRow = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  workout_id: uuidv7(),
  position: 1,
  user_id: uuidv7(),
  ended_at: null,
  ...overrides,
});

describe("AC15 — deleteWorkoutExercise ownership", () => {
  it("a malformed id is NotFoundError with no query issued", async () => {
    const stub = new ScriptedPrisma();
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());
    await expect(repo.deleteWorkoutExercise(uuidv7(), "bad-id")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(stub.calls).toHaveLength(0);
  });

  it("an absent row or another user's parent workout is NotFoundError", async () => {
    const stub = new ScriptedPrisma();
    stub.queueRows([]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());
    await expect(repo.deleteWorkoutExercise(uuidv7(), uuidv7())).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("AC9 — deleteWorkoutExercise: 409 on a finished parent", () => {
  it("phase-1 check", async () => {
    const stub = new ScriptedPrisma();
    const row = ownedRow({ ended_at: new Date("2026-09-15T11:00:00.000Z") });
    stub.queueRows([row]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());
    await expect(repo.deleteWorkoutExercise(row.user_id, row.id)).rejects.toBeInstanceOf(
      WorkoutFinishedError,
    );
    // A single ownership+finished query; the transaction never opens.
    expect(stub.calls).toHaveLength(1);
  });

  it("FOR SHARE re-check: parent finished after phase 1", async () => {
    // Phase-1 read shows in-progress, but the in-transaction FOR SHARE
    // re-check shows the workout was finished concurrently (e.g. a
    // finishWorkout that committed between phase 1 and the lock).
    const stub = new ScriptedPrisma();
    const row = ownedRow();
    stub.queueRows([row]); // phase 1: in progress
    stub.queueRows([{ ended_at: new Date("2026-09-15T11:00:00.000Z") }]); // FOR SHARE: now finished
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());
    await expect(repo.deleteWorkoutExercise(row.user_id, row.id)).rejects.toBeInstanceOf(
      WorkoutFinishedError,
    );
    // The lock/FOR SHARE statements were actually issued (not skipped).
    expect(stub.calls.some((c) => c.sql.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(stub.calls.some((c) => c.sql.includes("FOR SHARE"))).toBe(true);
  });
});

describe("AC11 — deleteWorkoutExercise closes the gap", () => {
  it("deletes the row and shifts every row above it down by one", async () => {
    const stub = new ScriptedPrisma();
    const row = ownedRow({ position: 1 });
    stub.queueRows([row]); // phase 1
    stub.queueRows([{ ended_at: null }]); // FOR SHARE
    stub.queueRows([{ position: 1 }]); // FOR UPDATE target re-fetch
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    await repo.deleteWorkoutExercise(row.user_id, row.id);

    const sqls = stub.calls.map((c) => c.sql).join("\n");
    expect(sqls).toContain("DELETE FROM \"workout_exercise\"");
    expect(sqls).toContain("position = position - 1");
  });

  it("a row already vanished by the time the lock is held is NotFoundError, not a 500", async () => {
    const stub = new ScriptedPrisma();
    const row = ownedRow({ position: 1 });
    stub.queueRows([row]);
    stub.queueRows([{ ended_at: null }]);
    stub.queueRows([]); // FOR UPDATE target re-fetch: gone
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    await expect(repo.deleteWorkoutExercise(row.user_id, row.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("AC13 — statement order: lock is its own statement, FOR SHARE is separate", () => {
  it("orders SET CONSTRAINTS, lock, FOR SHARE, FOR UPDATE target, then delete, then the shift", async () => {
    const stub = new ScriptedPrisma();
    const row = ownedRow({ position: 1 });
    stub.queueRows([row]); // phase 1
    stub.queueRows([{ ended_at: null }]); // FOR SHARE
    stub.queueRows([{ position: 1 }]); // FOR UPDATE target re-fetch
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    await repo.deleteWorkoutExercise(row.user_id, row.id);

    // calls[0] is the phase-1 ownership/finished SELECT (no transaction yet).
    const txCalls = stub.calls.slice(1);
    expect(txCalls[0]!.sql).toContain("SET CONSTRAINTS");
    expect(txCalls[1]!.sql).toContain("pg_advisory_xact_lock");
    expect(txCalls[2]!.sql).toContain("FOR SHARE");
    expect(txCalls[3]!.sql).toContain("FOR UPDATE");
    expect(txCalls[4]!.sql).toContain("DELETE FROM \"workout_exercise\"");
    expect(txCalls[5]!.sql).toContain("position = position - 1");
  });
});
