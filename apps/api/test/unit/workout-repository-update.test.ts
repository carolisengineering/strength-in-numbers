// apps/api/test/unit/workout-repository-update.test.ts
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { uuidv7 } from "uuidv7";
import { NotFoundError, ValidationError, WorkoutFinishedError } from "../../src/errors/app-error.js";
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
  $transaction = async <T>(fn: (tx: this) => Promise<T>): Promise<T> => fn(this);
}

const baseRow = (overrides: Record<string, unknown> = {}) => ({
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

describe("AC15 — updateWorkout ownership", () => {
  it("a malformed id is NotFoundError with no lock statement issued", async () => {
    const stub = new ScriptedPrisma();
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());
    await expect(
      repo.updateWorkout(uuidv7(), "bad-id", {}),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(stub.calls).toHaveLength(0);
  });

  it("an absent or another user's row is NotFoundError", async () => {
    const stub = new ScriptedPrisma();
    stub.queueRows([]); // FOR UPDATE lock read: no match
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());
    await expect(
      repo.updateWorkout(uuidv7(), uuidv7(), {}),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("AC8 — finish transition and immutability", () => {
  it("setting endedAt on an in-progress workout stores it and returns 200-shaped with the exercise count", async () => {
    const stub = new ScriptedPrisma();
    const inProgress = baseRow();
    const finished = { ...inProgress, ended_at: new Date("2026-09-15T11:00:00.000Z") };
    stub.queueRows([inProgress]); // FOR UPDATE lock read
    stub.queueRows([finished]); // UPDATE ... RETURNING
    stub.queueRows([{ n: 3 }]); // exercise count (§9)
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    const result = await repo.updateWorkout(inProgress.user_id, inProgress.id, {
      endedAt: "2026-09-15T11:00:00.000Z",
    });

    expect(result.workout.endedAt).toEqual(finished.ended_at);
    expect(result.exerciseCount).toBe(3);
  });

  it("title/notes-only edit on an in-progress workout succeeds and leaves localDate unchanged", async () => {
    const stub = new ScriptedPrisma();
    const inProgress = baseRow();
    const updated = { ...inProgress, title: "Push day", notes: "felt strong" };
    stub.queueRows([inProgress]); // FOR UPDATE lock read
    stub.queueRows([updated]); // UPDATE ... RETURNING
    stub.queueRows([{ n: 0 }]); // exercise count (§9)
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    const result = await repo.updateWorkout(inProgress.user_id, inProgress.id, {
      title: "Push day",
      notes: "felt strong",
    });

    expect(result.workout.title).toBe("Push day");
    expect(result.workout.notes).toBe("felt strong");
    expect(result.workout.localDate).toBe(inProgress.local_date.toISOString().slice(0, 10));
  });

  it("endedAt < startedAt is a ValidationError", async () => {
    const stub = new ScriptedPrisma();
    const inProgress = baseRow();
    stub.queueRows([inProgress]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    await expect(
      repo.updateWorkout(inProgress.user_id, inProgress.id, {
        endedAt: "2026-09-15T09:00:00.000Z", // before started_at (10:00)
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("endedAt === startedAt is accepted", async () => {
    const stub = new ScriptedPrisma();
    const inProgress = baseRow();
    const finished = { ...inProgress, ended_at: inProgress.started_at };
    stub.queueRows([inProgress]);
    stub.queueRows([finished]);
    stub.queueRows([{ n: 0 }]); // exercise count (§9)
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    const result = await repo.updateWorkout(inProgress.user_id, inProgress.id, {
      endedAt: inProgress.started_at.toISOString(),
    });
    expect(result.workout.endedAt).toEqual(inProgress.started_at);
  });

  it("endedAt beyond the future-skew bound is a ValidationError", async () => {
    const stub = new ScriptedPrisma();
    const inProgress = baseRow({ started_at: new Date() });
    stub.queueRows([inProgress]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // +1h
    await expect(
      repo.updateWorkout(inProgress.user_id, inProgress.id, { endedAt: farFuture }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("every schema-valid PATCH against a finished workout is 409 workout-finished, including {} and endedAt: null", async () => {
    const finishedRow = baseRow({ ended_at: new Date("2026-09-15T11:00:00.000Z") });

    for (const patch of [{}, { endedAt: null }, { title: "new title" }]) {
      const stub = new ScriptedPrisma();
      stub.queueRows([finishedRow]); // FOR UPDATE lock read
      const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());
      await expect(
        repo.updateWorkout(finishedRow.user_id, finishedRow.id, patch),
      ).rejects.toBeInstanceOf(WorkoutFinishedError);
    }
  });

  it("{} and endedAt: null against an in-progress workout are 200 no-ops returning the row unchanged", async () => {
    for (const patch of [{}, { endedAt: null }]) {
      const stub = new ScriptedPrisma();
      const inProgress = baseRow();
      stub.queueRows([inProgress]); // FOR UPDATE lock read
      stub.queueRows([inProgress]); // UPDATE ... RETURNING (no-op update)
      stub.queueRows([{ n: 0 }]); // exercise count (§9)
      const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

      const result = await repo.updateWorkout(inProgress.user_id, inProgress.id, patch);
      expect(result.workout.endedAt).toBeNull();
      expect(result.workout.title).toBe(inProgress.title);
    }
  });

  it("the lock read is the first statement, ahead of any other check (AC13-style ordering)", async () => {
    const stub = new ScriptedPrisma();
    const inProgress = baseRow();
    const updated = { ...inProgress, title: "x" };
    stub.queueRows([inProgress]);
    stub.queueRows([updated]);
    stub.queueRows([{ n: 0 }]); // exercise count (§9)
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    await repo.updateWorkout(inProgress.user_id, inProgress.id, { title: "x" });

    expect(stub.calls[0]!.sql).toContain("FOR UPDATE");
  });
});
