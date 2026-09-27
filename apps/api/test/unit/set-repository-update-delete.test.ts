import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { uuidv7 } from "uuidv7";
import { NotFoundError, ValidationError, WorkoutFinishedError } from "../../src/errors/app-error.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { FakeExerciseRepository } from "../helpers/fakes.js";

class ScriptedPrisma {
  calls: string[] = [];
  private queue: unknown[] = [];
  queue_(v: unknown): this {
    this.queue.push(v);
    return this;
  }
  private next(strings: TemplateStringsArray): unknown {
    this.calls.push(strings.join("?"));
    if (this.queue.length === 0) throw new Error(`ScriptedPrisma: no queued response for: ${strings.join("?")}`);
    return this.queue.shift();
  }
  $queryRaw = (strings: TemplateStringsArray): Promise<unknown> => Promise.resolve(this.next(strings));
  $executeRaw = (strings: TemplateStringsArray): Promise<unknown> => Promise.resolve(this.next(strings));
  $transaction = async <T>(fn: (tx: this) => Promise<T>): Promise<T> => fn(this);
}
const repoOver = (stub: ScriptedPrisma) =>
  createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

const setRow = (o: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  workout_exercise_id: uuidv7(),
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
const owner = (modality = "weight_reps") => [{ workout_id: uuidv7(), modality_snapshot: modality }];

describe("AC4 — updateSet / deleteSet ownership", () => {
  it("malformed id ⇒ NotFoundError, no statement", async () => {
    const stub = new ScriptedPrisma();
    await expect(repoOver(stub).updateSet(uuidv7(), "bad", {})).rejects.toBeInstanceOf(NotFoundError);
    await expect(repoOver(stub).deleteSet(uuidv7(), "bad")).rejects.toBeInstanceOf(NotFoundError);
    expect(stub.calls).toHaveLength(0);
  });
  it("absent / another user's set ⇒ NotFoundError", async () => {
    await expect(repoOver(new ScriptedPrisma().queue_([])).updateSet(uuidv7(), uuidv7(), {})).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(repoOver(new ScriptedPrisma().queue_([])).deleteSet(uuidv7(), uuidv7())).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("AC5 / D10 — finished parent, checked under FOR SHARE", () => {
  it("updateSet: workout FOR SHARE shows ended_at ⇒ WorkoutFinishedError, no UPDATE", async () => {
    const stub = new ScriptedPrisma().queue_(owner()).queue_([{ ended_at: new Date() }]);
    await expect(repoOver(stub).updateSet(uuidv7(), uuidv7(), { reps: 6 })).rejects.toBeInstanceOf(
      WorkoutFinishedError,
    );
    expect(stub.calls[1]).toMatch(/FROM "workout" WHERE .* FOR SHARE/s);
    expect(stub.calls.some((s) => s.includes('UPDATE "set_entry"'))).toBe(false);
  });
  it("deleteSet: same, no exemption (contrast 05.0's whole-workout DELETE)", async () => {
    const stub = new ScriptedPrisma().queue_(owner()).queue_([{ ended_at: new Date() }]);
    await expect(repoOver(stub).deleteSet(uuidv7(), uuidv7())).rejects.toBeInstanceOf(WorkoutFinishedError);
    expect(stub.calls.some((s) => s.includes("DELETE"))).toBe(false);
  });
});

describe("AC8 — updateSet merges then validates", () => {
  it("{ isComplete: true } against a stored complete-able row succeeds; lock order workout → set_entry", async () => {
    const stored = setRow();
    const updated = setRow({ ...stored, is_complete: true, completed_at: new Date() });
    const stub = new ScriptedPrisma()
      .queue_(owner())
      .queue_([{ ended_at: null }])
      .queue_([stored])
      .queue_([updated]);
    const result = await repoOver(stub).updateSet(uuidv7(), stored.id, { isComplete: true });
    expect(result.isComplete).toBe(true);
    expect(stub.calls[1]).toContain('FROM "workout"');
    expect(stub.calls[2]).toMatch(/FROM "set_entry" WHERE .* FOR UPDATE/s);
    expect(stub.calls[3]).toContain('UPDATE "set_entry"');
    expect(stub.calls[3]).toContain("COALESCE(completed_at, now())");
  });
  it("{ isComplete: true } against a row missing weight ⇒ ValidationError, no UPDATE", async () => {
    const stub = new ScriptedPrisma()
      .queue_(owner())
      .queue_([{ ended_at: null }])
      .queue_([setRow({ weight: null, weight_unit: null, weight_kg: null })]);
    await expect(repoOver(stub).updateSet(uuidv7(), uuidv7(), { isComplete: true })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(stub.calls.some((s) => s.includes('UPDATE "set_entry"'))).toBe(false);
  });
  it("the set vanished between resolve and lock ⇒ NotFoundError", async () => {
    const stub = new ScriptedPrisma().queue_(owner()).queue_([{ ended_at: null }]).queue_([]);
    await expect(repoOver(stub).updateSet(uuidv7(), uuidv7(), {})).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("AC9 — deleteSet is a plain hard delete with no renumbering", () => {
  it("issues exactly one DELETE and no UPDATE of siblings", async () => {
    const stub = new ScriptedPrisma().queue_(owner()).queue_([{ ended_at: null }]).queue_(1);
    await repoOver(stub).deleteSet(uuidv7(), uuidv7());
    expect(stub.calls[2]).toContain('DELETE FROM "set_entry"');
    expect(stub.calls.some((s) => s.includes("set_number - 1") || s.includes("UPDATE"))).toBe(false);
  });
  it("0 rows deleted (concurrently gone) ⇒ NotFoundError", async () => {
    const stub = new ScriptedPrisma().queue_(owner()).queue_([{ ended_at: null }]).queue_(0);
    await expect(repoOver(stub).deleteSet(uuidv7(), uuidv7())).rejects.toBeInstanceOf(NotFoundError);
  });
});
