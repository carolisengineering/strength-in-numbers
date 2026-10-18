// apps/api/test/unit/set-repository-finished.test.ts — Spec 07.4 Phase A, set writes in finished mode.
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { uuidv7 } from "uuidv7";
import { NotFoundError, ValidationError, WorkoutWouldBeEmptyError } from "../../src/errors/app-error.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { FakeExerciseRepository } from "../helpers/fakes.js";

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
  $queryRaw = (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> => Promise.resolve(this.next(strings, values));
  $executeRaw = (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> => Promise.resolve(this.next(strings, values));
  $transaction = async <T>(fn: (tx: this) => Promise<T>): Promise<T> => fn(this);
}
const repoOver = (stub: ScriptedPrisma) => createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

const STARTED = new Date("2026-10-14T18:00:00Z");
const ENDED = new Date("2026-10-14T19:00:00Z");
const PR_LOCK = /pg_advisory_xact_lock\(hashtext\(\?\)\)/;
const isPrLock = (sql: string, values: unknown[]) => PR_LOCK.test(sql) && String(values[0]).startsWith("pr:");

const setRow = (o: Record<string, unknown> = {}) => ({
  id: uuidv7(), workout_exercise_id: uuidv7(), client_generated_id: null, set_number: 1, set_type: "warmup",
  reps: 5, weight: 40, weight_unit: "kg", weight_kg: 40, distance: null, distance_unit: null, distance_m: null,
  duration_s: null, rpe: null, is_complete: true, completed_at: ENDED, created_at: new Date(), updated_at: new Date(), ...o,
});
const finishedParent = () => [{ workout_id: uuidv7(), modality_snapshot: "weight_reps", ended_at: ENDED }];
const lockedFinished = () => [{ ended_at: ENDED, started_at: STARTED }];

describe("07.4 AC4 — createSet in finished mode takes the PR lock first", () => {
  it("phase 1 → PR lock → advisory lock → workout FOR SHARE → workout_exercise FOR SHARE → max → INSERT (a warm-up: no recompute)", async () => {
    const stub = new ScriptedPrisma()
      .queue_(finishedParent())
      .queue_(1) // PR lock
      .queue_(1) // per-parent advisory lock
      .queue_(lockedFinished())
      .queue_([{ id: uuidv7() }])
      .queue_([{ max: 2 }])
      .queue_([setRow()]);
    const result = await repoOver(stub).createSet(uuidv7(), uuidv7(), { setType: "warmup", reps: 5, weight: 40, weightUnit: "kg", isComplete: true });
    expect(result.created).toBe(true);
    expect(isPrLock(stub.calls[1]!, stub.values[1]!)).toBe(true);
    expect(stub.calls[2]).toContain("pg_advisory_xact_lock(hashtext(");
    expect(stub.calls[3]).toMatch(/FROM "workout" WHERE .* FOR SHARE/s);
    expect(stub.calls.at(-1)).toContain('INSERT INTO "set_entry"');
    expect(result.finishedEdit).toMatchObject({ recordsRecomputed: false, rootCount: 0 });
  });
});

describe("07.4 AC13 — a finished-mode create clamps completed_at into the span", () => {
  it("binds the workout's started_at and ended_at as the LEAST/GREATEST bounds", async () => {
    const stub = new ScriptedPrisma()
      .queue_(finishedParent()).queue_(1).queue_(1).queue_(lockedFinished())
      .queue_([{ id: uuidv7() }]).queue_([{ max: null }]).queue_([setRow()]);
    await repoOver(stub).createSet(uuidv7(), uuidv7(), { setType: "warmup", reps: 5, weight: 40, weightUnit: "kg", isComplete: true });
    expect(stub.calls.at(-1)).toContain("LEAST(GREATEST(now(), ");
    expect(stub.values.at(-1)).toEqual(expect.arrayContaining([STARTED, ENDED]));
  });
});

describe("07.4 AC17 — live mode takes no PR lock and binds no span", () => {
  it("a live create's statements carry no pr: lock and NULL span bounds (so completed_at is now())", async () => {
    const stub = new ScriptedPrisma()
      .queue_([{ workout_id: uuidv7(), modality_snapshot: "weight_reps", ended_at: null }])
      .queue_(1).queue_([{ ended_at: null, started_at: STARTED }]).queue_([{ id: uuidv7() }]).queue_([{ max: null }]).queue_([setRow()]);
    const result = await repoOver(stub).createSet(uuidv7(), uuidv7(), { reps: 5 });
    expect(stub.calls.some((s, i) => isPrLock(s, stub.values[i]!))).toBe(false);
    expect(stub.calls).toHaveLength(6);
    const insertValues = stub.values.at(-1)!;
    expect(insertValues).not.toContain(STARTED);
    expect(result.finishedEdit).toBeNull();
  });
});

describe("07.4 AC14 — a keyed replay on a finished workout takes no lock", () => {
  it("answers the stored row from the first lookup: created false, two statements, no PR lock", async () => {
    const key = uuidv7();
    const stub = new ScriptedPrisma().queue_(finishedParent()).queue_([setRow({ client_generated_id: key })]);
    const result = await repoOver(stub).createSet(uuidv7(), uuidv7(), { clientGeneratedId: key });
    expect(result.created).toBe(false);
    expect(result.finishedEdit).toBeNull();
    expect(stub.calls).toHaveLength(2);
  });
});

describe("07.4 AC5 — a finish landing between phase 1 and the lock restarts once in finished mode", () => {
  it("live attempt sees ended_at under FOR SHARE, rolls back, and the retry starts with the PR lock", async () => {
    const stub = new ScriptedPrisma()
      .queue_([{ workout_id: uuidv7(), modality_snapshot: "weight_reps", ended_at: null }])
      .queue_(1) // live: advisory lock
      .queue_(lockedFinished()) // live: FOR SHARE finds it finished → restart
      .queue_(1) // finished: PR lock
      .queue_(1) // advisory lock
      .queue_(lockedFinished())
      .queue_([{ id: uuidv7() }])
      .queue_([{ max: 1 }])
      .queue_([setRow()]);
    const result = await repoOver(stub).createSet(uuidv7(), uuidv7(), { setType: "warmup", reps: 5, weight: 40, weightUnit: "kg", isComplete: true });
    expect(result.created).toBe(true);
    const prLocks = stub.calls.map((s, i) => isPrLock(s, stub.values[i]!)).filter(Boolean);
    expect(prLocks).toHaveLength(1);
    expect(isPrLock(stub.calls[3]!, stub.values[3]!)).toBe(true);
  });
});

describe("07.4 AC9 — a finished-mode working set must be complete", () => {
  it("a working set without reps is a ValidationError naming reps, nothing inserted", async () => {
    const stub = new ScriptedPrisma().queue_(finishedParent()).queue_(1).queue_(1).queue_(lockedFinished());
    await expect(repoOver(stub).createSet(uuidv7(), uuidv7(), { setType: "working", weight: 100, weightUnit: "kg" })).rejects.toBeInstanceOf(ValidationError);
    expect(stub.calls.some((s) => s.includes("INSERT"))).toBe(false);
  });
});

describe("07.4 AC4 — updateSet / deleteSet in finished mode", () => {
  const owned = () => [{ workout_id: uuidv7(), modality_snapshot: "weight_reps", ended_at: ENDED }];

  it("updateSet: ownership preflight → PR lock → workout FOR SHARE → set FOR UPDATE → UPDATE", async () => {
    const stored = setRow();
    const stub = new ScriptedPrisma().queue_(owned()).queue_(1).queue_(lockedFinished()).queue_([stored]).queue_([{ ...stored, rpe: 8 }]);
    const result = await repoOver(stub).updateSet(uuidv7(), stored.id, { rpe: 8 });
    expect(result.set.rpe).toBe(8);
    expect(isPrLock(stub.calls[1]!, stub.values[1]!)).toBe(true);
    expect(stub.calls[2]).toMatch(/FROM "workout" WHERE .* FOR SHARE/s);
    expect(stub.calls[3]).toMatch(/FROM "set_entry" WHERE .* FOR UPDATE/s);
    expect(stub.calls[4]).toContain('UPDATE "set_entry"');
    expect(result.finishedEdit).toMatchObject({ recordsRecomputed: false });
  });

  it("deleteSet: PR lock → workout FOR SHARE → set count → DELETE … RETURNING (a warm-up: no recompute)", async () => {
    const stub = new ScriptedPrisma().queue_(owned()).queue_(1).queue_(lockedFinished()).queue_([{ id: uuidv7() }]).queue_([{ n: 2 }]).queue_([{ set_type: "warmup", workout_exercise_id: uuidv7() }]);
    const result = await repoOver(stub).deleteSet(uuidv7(), uuidv7());
    expect(isPrLock(stub.calls[1]!, stub.values[1]!)).toBe(true);
    expect(stub.calls[3]).toMatch(/FROM "set_entry" WHERE .* FOR UPDATE/s);
    expect(stub.calls[4]).toContain("count(*)");
    expect(stub.calls[5]).toContain('DELETE FROM "set_entry"');
    expect(result.finishedEdit).toMatchObject({ recordsRecomputed: false });
  });

  it("07.4 AC10 — deleteSet of the last set is WorkoutWouldBeEmptyError, nothing deleted", async () => {
    const stub = new ScriptedPrisma().queue_(owned()).queue_(1).queue_(lockedFinished()).queue_([{ id: uuidv7() }]).queue_([{ n: 1 }]);
    await expect(repoOver(stub).deleteSet(uuidv7(), uuidv7())).rejects.toBeInstanceOf(WorkoutWouldBeEmptyError);
    expect(stub.calls.some((s) => s.includes("DELETE"))).toBe(false);
  });

  it("final review #1 — a set already deleted by a concurrent duplicate request is 404, never would-be-empty", async () => {
    const stub = new ScriptedPrisma().queue_(owned()).queue_(1).queue_(lockedFinished()).queue_([]);
    await expect(repoOver(stub).deleteSet(uuidv7(), uuidv7())).rejects.toBeInstanceOf(NotFoundError);
    expect(stub.calls.some((s) => s.includes("count(*)"))).toBe(false);
  });
});
