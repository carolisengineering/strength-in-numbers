import { describe, expect, it } from "vitest";
import { makeSet, makeWorkoutDetail } from "../../../test/workoutFixtures";
import type { CreateOp, DeleteOp, IdMap, OutboxOp, UpdateOp } from "./ops";
import { project } from "./project";

const KEY = "30000000-0000-4000-8000-000000000001";
const KEY2 = "30000000-0000-4000-8000-000000000002";
const workout = makeWorkoutDetail({
  exercises: [{ modality: "weight_reps", name: "Bench", sets: [makeSet({ setNumber: 1 })] }],
});
const we = workout.exercises[0]!;
const server1 = we.sets[0]!;
let n = 0;
const base = () => ({
  id: `op-${++n}`,
  workoutId: workout.id,
  workoutExerciseId: we.id,
  userId: "u",
  status: "queued" as const,
  attempted: false,
  attempts: 0,
  nextAttemptAt: 0,
  enqueuedAt: Date.parse("2026-10-02T10:05:00Z"),
});
const create = (over: Partial<CreateOp> = {}): CreateOp => ({
  ...base(),
  kind: "create",
  target: { clientGeneratedId: KEY },
  body: { clientGeneratedId: KEY, weight: 100, weightUnit: "lb", reps: 5, isComplete: true },
  ...over,
});
const update = (target: UpdateOp["target"], body: UpdateOp["body"], over: Partial<UpdateOp> = {}): UpdateOp => ({
  ...base(),
  kind: "update",
  target,
  body,
  ...over,
});
const del = (target: DeleteOp["target"], over: Partial<DeleteOp> = {}): DeleteOp => ({
  ...base(),
  kind: "delete",
  target,
  body: null,
  ...over,
});
const view = (ops: OutboxOp[], idMap: IdMap = {}) => project(workout, { ops, idMap });
const setsOf = (p: ReturnType<typeof view>) => p.workout.exercises[0]!.sets;

describe("06.2 AC1 — project() overlays pending ops", () => {
  it("no ops: the same object back and an empty sync map", () => {
    const p = view([]);
    expect(p.workout).toBe(workout);
    expect(p.sync.size).toBe(0);
  });

  it("a queued create appears with id = clientGeneratedId, the next set number and derived measures", () => {
    const p = view([create()]);
    const row = setsOf(p)[1]!;
    expect(row).toMatchObject({
      id: KEY,
      clientGeneratedId: KEY,
      setNumber: 2,
      weight: 100,
      weightUnit: "lb",
      reps: 5,
      isComplete: true,
      setType: "working",
    });
    expect(row.weightKg).toBeCloseTo(45.359237);
    expect(row.completedAt).toBe("2026-10-02T10:05:00.000Z");
    expect(p.sync.get(KEY)).toEqual({ state: "pending" });
  });

  it("two queued creates number 2 and 3", () => {
    const p = view([
      create(),
      create({ target: { clientGeneratedId: KEY2 }, body: { clientGeneratedId: KEY2, reps: 3, isComplete: true } }),
    ]);
    expect(setsOf(p).map((s) => s.setNumber)).toEqual([1, 2, 3]);
  });

  it("a create the server already holds (same clientGeneratedId) shows once — the server's row", () => {
    const landed = makeSet({ setNumber: 2, clientGeneratedId: KEY, workoutExerciseId: we.id });
    const withLanded = { ...workout, exercises: [{ ...we, sets: [server1, landed] }] };
    const p = project(withLanded, { ops: [create()], idMap: {} });
    expect(p.workout.exercises[0]!.sets.map((s) => s.id)).toEqual([server1.id, landed.id]);
    expect(p.sync.get(landed.id)).toEqual({ state: "pending" });
  });

  it("a local row already in the copy (a projected cache) takes the create's current, merged body", () => {
    const projected = view([create()]).workout;
    const merged = create({ body: { clientGeneratedId: KEY, weight: 100, weightUnit: "lb", reps: 9, isComplete: true } });
    const again = project(projected, { ops: [merged], idMap: {} });
    expect(again.workout.exercises[0]!.sets[1]).toMatchObject({ id: KEY, reps: 9, setNumber: 2 });
  });

  it("an update overwrites only its fields and recomputes weightKg", () => {
    const p = view([update({ setId: server1.id }, { weight: 70 })]);
    expect(setsOf(p)[0]).toMatchObject({ weight: 70, weightKg: 70, reps: 8 });
    expect(p.sync.get(server1.id)).toEqual({ state: "pending" });
  });

  it("an update addressed by server id also finds a row still shown under its client key (id map)", () => {
    const p = view([create(), update({ setId: "server-id" }, { reps: 9 })], {
      [KEY]: { setId: "server-id", workoutId: workout.id },
    });
    expect(setsOf(p)[1]).toMatchObject({ id: KEY, reps: 9 });
  });

  it("a queued delete removes the row; a failed delete keeps it, marked failed", () => {
    expect(setsOf(view([del({ setId: server1.id })]))).toHaveLength(0);
    const failed = del(
      { setId: server1.id },
      { status: "failed", failure: { status: 409, type: "workout-finished", requestId: null } },
    );
    const p = view([failed]);
    expect(setsOf(p)).toHaveLength(1);
    expect(p.sync.get(server1.id)).toEqual({ state: "failed", opId: failed.id, status: 409 });
  });

  it("failed wins over pending for the same row", () => {
    const failedCreate = create({ status: "failed", failure: { status: 422, type: "validation-error", requestId: "r" } });
    const p = view([failedCreate, update({ clientGeneratedId: KEY }, { reps: 1 })]);
    expect(p.sync.get(KEY)).toEqual({ state: "failed", opId: failedCreate.id, status: 422 });
  });

  it("ops for another workout or a missing workout-exercise are ignored", () => {
    expect(view([create({ workoutId: "other" })]).workout).toBe(workout);
    expect(view([create({ workoutExerciseId: "gone" })]).workout).toBe(workout);
  });

  it("projecting an already projected workout changes nothing (idempotent)", () => {
    const ops = [create(), update({ setId: server1.id }, { reps: 4 })];
    const once = view(ops);
    const twice = project(once.workout, { ops, idMap: {} });
    expect(twice.workout.exercises).toEqual(once.workout.exercises);
  });
});
