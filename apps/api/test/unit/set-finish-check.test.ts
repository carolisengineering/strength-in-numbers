import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { uuidv7 } from "uuidv7";
import { IncompleteWorkingSetsError, ValidationError } from "../../src/errors/app-error.js";
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

const workoutRow = (o: Record<string, unknown> = {}) => ({
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
  ...o,
});
const ENDED = "2026-09-15T11:00:00.000Z";

describe("AC13 — the finish runs the integrity check after the lock, before the UPDATE", () => {
  it("a working set missing reps ⇒ IncompleteWorkingSetsError and no UPDATE", async () => {
    const w = workoutRow();
    const stub = new ScriptedPrisma()
      .queue_([w])
      .queue_([{ modality_snapshot: "weight_reps", reps: null, weight: 100, distance: null, duration_s: null }]);
    await expect(repoOver(stub).updateWorkout(w.user_id, w.id, { endedAt: ENDED })).rejects.toBeInstanceOf(
      IncompleteWorkingSetsError,
    );
    expect(stub.calls[0]).toContain("FOR UPDATE");
    expect(stub.calls[1]).toContain("se.set_type = 'working'");
    expect(stub.calls.some((s) => s.includes('UPDATE "workout"'))).toBe(false);
  });
  it("all working sets complete ⇒ the finish proceeds", async () => {
    const w = workoutRow();
    const stub = new ScriptedPrisma()
      .queue_([w])
      .queue_([{ modality_snapshot: "weight_reps", reps: 5, weight: 100, distance: null, duration_s: null }])
      .queue_([{ ...w, ended_at: new Date(ENDED) }])
      .queue_([{ n: 1 }])
      .queue_([]); // Spec 07.0: touched lineage roots — none
    const r = await repoOver(stub).updateWorkout(w.user_id, w.id, { endedAt: ENDED });
    expect(r.workout.endedAt).toEqual(new Date(ENDED));
  });
  it("05.0's own endedAt checks still run first: endedAt < startedAt is ValidationError with no set query", async () => {
    const w = workoutRow();
    const stub = new ScriptedPrisma().queue_([w]);
    await expect(
      repoOver(stub).updateWorkout(w.user_id, w.id, { endedAt: "2026-09-15T09:00:00.000Z" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(stub.calls).toHaveLength(1);
  });
  it("a title-only PATCH (not a finish) never runs the integrity query", async () => {
    const w = workoutRow();
    const stub = new ScriptedPrisma().queue_([w]).queue_([{ ...w, title: "x" }]).queue_([{ n: 0 }]);
    await repoOver(stub).updateWorkout(w.user_id, w.id, { title: "x" });
    expect(stub.calls.some((s) => s.includes("set_entry"))).toBe(false);
  });
});

describe("AC14 — non-working sets are never inspected", () => {
  it("the query filters to set_type = 'working'", async () => {
    const w = workoutRow();
    const stub = new ScriptedPrisma()
      .queue_([w])
      .queue_([])
      .queue_([{ ...w, ended_at: new Date(ENDED) }])
      .queue_([{ n: 0 }])
      .queue_([]); // Spec 07.0: touched lineage roots — none
    await repoOver(stub).updateWorkout(w.user_id, w.id, { endedAt: ENDED });
    expect(stub.calls[1]).toMatch(/WHERE .*se\.set_type = 'working'/s);
  });
});

describe("AC12 — detail reads attach each exercise's sets, ordered", () => {
  it("getWorkoutById groups sets under their exercise; an exercise with none gets []", async () => {
    const w = workoutRow();
    const we1 = uuidv7();
    const we2 = uuidv7();
    const we = (id: string, position: number) => ({
      id,
      workout_id: w.id,
      position,
      exercise_id: uuidv7(),
      exercise_name_snapshot: "X",
      modality_snapshot: "weight_reps",
      notes: null,
      created_at: w.created_at,
      updated_at: w.updated_at,
    });
    const set = (weId: string, n: number) => ({
      id: uuidv7(),
      workout_exercise_id: weId,
      client_generated_id: null,
      set_number: n,
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
      created_at: w.created_at,
      updated_at: w.updated_at,
    });
    const stub = new ScriptedPrisma()
      .queue_([w])
      .queue_([we(we1, 0), we(we2, 1)])
      .queue_([set(we1, 1), set(we1, 3)]);
    const detail = await repoOver(stub).getWorkoutById(w.user_id, w.id);
    expect(detail.exercises[0]!.sets.map((s) => s.setNumber)).toEqual([1, 3]);
    expect(detail.exercises[1]!.sets).toEqual([]);
    expect(stub.calls[2]).toContain("ORDER BY workout_exercise_id, set_number");
  });
});
