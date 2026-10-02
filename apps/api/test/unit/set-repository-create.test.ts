import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { uuidv7 } from "uuidv7";
import { NotFoundError, ValidationError, WorkoutFinishedError } from "../../src/errors/app-error.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { FakeExerciseRepository } from "../helpers/fakes.js";

/** Records every statement's SQL text and bound values in order; answers
 * from a queue. */
class ScriptedPrisma {
  calls: string[] = [];
  values: unknown[][] = [];
  private queue: unknown[] = [];
  queue_(v: unknown): this {
    this.queue.push(v);
    return this;
  }
  private next(strings: TemplateStringsArray, values: unknown[]): unknown {
    this.calls.push(strings.join("?"));
    this.values.push(values);
    if (this.queue.length === 0) throw new Error(`ScriptedPrisma: no queued response for: ${strings.join("?")}`);
    return this.queue.shift();
  }
  $queryRaw = (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> =>
    Promise.resolve(this.next(strings, values));
  $executeRaw = (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> =>
    Promise.resolve(this.next(strings, values));
  $transaction = async <T>(fn: (tx: this) => Promise<T>): Promise<T> => fn(this);
}

const repoOver = (stub: ScriptedPrisma) =>
  createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

const setRow = (o: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  workout_exercise_id: uuidv7(),
  client_generated_id: null,
  set_number: 1,
  set_type: "working",
  reps: 5,
  weight: 100,
  weight_unit: "kg",
  weight_kg: 100,
  distance: null,
  distance_unit: null,
  distance_m: null,
  duration_s: null,
  rpe: null,
  is_complete: false,
  completed_at: null,
  created_at: new Date("2026-09-27T10:00:00Z"),
  updated_at: new Date("2026-09-27T10:00:00Z"),
  ...o,
});

/** Queues the happy path: phase-1 read, advisory lock, workout FOR SHARE,
 * workout_exercise FOR SHARE, max read, INSERT RETURNING. */
function queueHappyPath(stub: ScriptedPrisma, max: number | null, inserted = setRow()) {
  const workoutId = uuidv7();
  stub
    .queue_([{ workout_id: workoutId, modality_snapshot: "weight_reps", ended_at: null }])
    .queue_(1)
    .queue_([{ ended_at: null }])
    .queue_([{ id: uuidv7() }])
    .queue_([{ max }])
    .queue_([inserted]);
}

describe("AC4 — createSet ownership (404, never 403)", () => {
  it("a malformed workout_exercise id is NotFoundError with no statement issued", async () => {
    const stub = new ScriptedPrisma();
    await expect(repoOver(stub).createSet(uuidv7(), "bad-id", {})).rejects.toBeInstanceOf(NotFoundError);
    expect(stub.calls).toHaveLength(0);
  });
  it("an absent or another user's workout_exercise is NotFoundError", async () => {
    const stub = new ScriptedPrisma().queue_([]);
    await expect(repoOver(stub).createSet(uuidv7(), uuidv7(), {})).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("AC5 — createSet on a finished workout", () => {
  it("phase 1 sees ended_at and throws WorkoutFinishedError before opening the transaction", async () => {
    const stub = new ScriptedPrisma().queue_([
      { workout_id: uuidv7(), modality_snapshot: "weight_reps", ended_at: new Date() },
    ]);
    await expect(repoOver(stub).createSet(uuidv7(), uuidv7(), {})).rejects.toBeInstanceOf(WorkoutFinishedError);
    expect(stub.calls).toHaveLength(1);
  });
});

describe("AC6/AC7 — createSet validates against the modality before any lock", () => {
  it("a forbidden measure is ValidationError and no lock is taken", async () => {
    const stub = new ScriptedPrisma().queue_([{ workout_id: uuidv7(), modality_snapshot: "weight_reps", ended_at: null }]);
    await expect(repoOver(stub).createSet(uuidv7(), uuidv7(), { durationS: 30 })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(stub.calls).toHaveLength(1);
  });
});

describe("AC3 — createSet appends max(set_number) + 1", () => {
  // The INSERT's bound values are (id, workout_exercise_id, set_number, …):
  // index 2 is the set_number the repository computed.
  it("no sets yet (max is NULL) ⇒ inserts set_number 1", async () => {
    const stub = new ScriptedPrisma();
    queueHappyPath(stub, null);
    await repoOver(stub).createSet(uuidv7(), uuidv7(), { reps: 5 });
    expect(stub.calls.at(-1)).toContain('INSERT INTO "set_entry"');
    expect(stub.values.at(-1)![2]).toBe(1);
  });
  it("max 3 ⇒ inserts set_number 4 and returns the row mapped to camelCase, plus the modality snapshot", async () => {
    const stub = new ScriptedPrisma();
    const inserted = setRow({ set_number: 4 });
    queueHappyPath(stub, 3, inserted);
    const result = await repoOver(stub).createSet(uuidv7(), uuidv7(), { reps: 5 });
    expect(stub.values.at(-1)![2]).toBe(4);
    expect(result.modalitySnapshot).toBe("weight_reps");
    expect(result.set).toMatchObject({ id: inserted.id, setNumber: 4, setType: "working", weightKg: 100, isComplete: false });
  });
});

describe("AC10/AC11 + Review Focus 5 — statement order inside the create transaction", () => {
  it("advisory lock → workout FOR SHARE → workout_exercise FOR SHARE → max read → INSERT, each its own statement", async () => {
    const stub = new ScriptedPrisma();
    queueHappyPath(stub, 0);
    const result = await repoOver(stub).createSet(uuidv7(), uuidv7(), {});
    expect(result.created).toBe(true);
    // No clientGeneratedId ⇒ no key lookup, before or under the lock (AC22).
    expect(stub.calls).toHaveLength(6);
    const [, lock, workoutShare, weShare, max, insert] = stub.calls;
    expect(lock).toContain("pg_advisory_xact_lock(hashtext(");
    expect(workoutShare).toMatch(/FROM "workout" WHERE .* FOR SHARE/s);
    expect(weShare).toMatch(/FROM "workout_exercise" WHERE .* FOR SHARE/s);
    expect(max).toContain("max(set_number)");
    expect(max).not.toContain("pg_advisory");
    expect(insert).toContain('INSERT INTO "set_entry"');
  });
  it("the workout finished between phase 1 and the lock ⇒ WorkoutFinishedError, nothing inserted", async () => {
    const stub = new ScriptedPrisma()
      .queue_([{ workout_id: uuidv7(), modality_snapshot: "weight_reps", ended_at: null }])
      .queue_(1)
      .queue_([{ ended_at: new Date() }]);
    await expect(repoOver(stub).createSet(uuidv7(), uuidv7(), {})).rejects.toBeInstanceOf(WorkoutFinishedError);
    expect(stub.calls.some((s) => s.includes("INSERT"))).toBe(false);
  });
  it("the workout_exercise was deleted between phase 1 and the lock ⇒ NotFoundError, not an FK 500", async () => {
    const stub = new ScriptedPrisma()
      .queue_([{ workout_id: uuidv7(), modality_snapshot: "weight_reps", ended_at: null }])
      .queue_(1)
      .queue_([{ ended_at: null }])
      .queue_([]);
    await expect(repoOver(stub).createSet(uuidv7(), uuidv7(), {})).rejects.toBeInstanceOf(NotFoundError);
    expect(stub.calls.some((s) => s.includes("INSERT"))).toBe(false);
  });
});

describe("AC22 — createSet with a clientGeneratedId is idempotent", () => {
  const phase1 = (endedAt: Date | null = null) => [
    { workout_id: uuidv7(), modality_snapshot: "weight_reps", ended_at: endedAt },
  ];

  it("a stored key is answered by the first lookup: created false, the stored row, no lock and no INSERT", async () => {
    const key = uuidv7();
    const storedRow = setRow({ client_generated_id: key, set_number: 2 });
    const stub = new ScriptedPrisma().queue_(phase1()).queue_([storedRow]);
    const result = await repoOver(stub).createSet(uuidv7(), uuidv7(), { clientGeneratedId: key, reps: 99 });
    expect(result.created).toBe(false);
    expect(result.set).toMatchObject({ id: storedRow.id, setNumber: 2, reps: 5, clientGeneratedId: key });
    expect(result.modalitySnapshot).toBe("weight_reps");
    expect(stub.calls).toHaveLength(2);
    expect(stub.calls[1]).toMatch(/FROM "set_entry"\s+WHERE .*client_generated_id = /s);
    expect(stub.values[1]).toContain(key);
  });

  it("the lookup runs before the finished check and before validation: a replay is never 409 or 422", async () => {
    const key = uuidv7();
    const stub = new ScriptedPrisma().queue_(phase1(new Date())).queue_([setRow({ client_generated_id: key })]);
    const result = await repoOver(stub).createSet(uuidv7(), uuidv7(), { clientGeneratedId: key, durationS: 30 });
    expect(result.created).toBe(false);
  });

  it("a new key on a finished workout is still WorkoutFinishedError", async () => {
    const stub = new ScriptedPrisma().queue_(phase1(new Date())).queue_([]);
    await expect(
      repoOver(stub).createSet(uuidv7(), uuidv7(), { clientGeneratedId: uuidv7() }),
    ).rejects.toBeInstanceOf(WorkoutFinishedError);
  });

  it("a new key is looked up again under the advisory lock, then inserted with the key: created true", async () => {
    const key = uuidv7();
    const inserted = setRow({ client_generated_id: key });
    const stub = new ScriptedPrisma()
      .queue_(phase1())
      .queue_([]) // lookup, no lock
      .queue_(1) // advisory lock
      .queue_([]) // lookup under the lock
      .queue_([{ ended_at: null }])
      .queue_([{ id: uuidv7() }])
      .queue_([{ max: null }])
      .queue_([inserted]);
    const result = await repoOver(stub).createSet(uuidv7(), uuidv7(), { clientGeneratedId: key });
    expect(result.created).toBe(true);
    expect(result.set.clientGeneratedId).toBe(key);
    const [, lookup, lock, lockedLookup, workoutShare, , , insert] = stub.calls;
    expect(lookup).toContain("client_generated_id");
    expect(lock).toContain("pg_advisory_xact_lock(hashtext(");
    expect(lockedLookup).toContain("client_generated_id");
    expect(workoutShare).toMatch(/FROM "workout" WHERE .* FOR SHARE/s);
    expect(insert).toContain('INSERT INTO "set_entry"');
    expect(insert).toContain("client_generated_id");
    expect(stub.values.at(-1)).toContain(key);
  });

  it("AC23 — the same key committed by a concurrent create while we waited for the lock: created false, no INSERT", async () => {
    const key = uuidv7();
    const storedRow = setRow({ client_generated_id: key });
    const stub = new ScriptedPrisma().queue_(phase1()).queue_([]).queue_(1).queue_([storedRow]);
    const result = await repoOver(stub).createSet(uuidv7(), uuidv7(), { clientGeneratedId: key });
    expect(result.created).toBe(false);
    expect(result.set.id).toBe(storedRow.id);
    expect(stub.calls.some((s) => s.includes("INSERT"))).toBe(false);
  });

  it("a keyless create binds NULL for client_generated_id", async () => {
    const stub = new ScriptedPrisma();
    queueHappyPath(stub, null);
    const result = await repoOver(stub).createSet(uuidv7(), uuidv7(), {});
    expect(stub.calls.at(-1)).toContain("client_generated_id");
    expect(stub.values.at(-1)).toContain(null);
    expect(result.set.clientGeneratedId).toBeNull();
  });
});
