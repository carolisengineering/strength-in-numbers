import { describe, expect, it } from "vitest";
import { makeSet, makeWorkoutDetail } from "../../../test/workoutFixtures";
import type { NoteOp, OutboxOp } from "./ops";
import { project } from "./project";

const detail = () =>
  makeWorkoutDetail({
    exercises: [
      { modality: "weight_reps", name: "Bench", notes: "Pause", sets: [makeSet({ setNumber: 1 })] },
      { modality: "weight_reps", name: "Row", notes: null },
    ],
  });
const note = (workoutId: string, workoutExerciseId: string, notes: string | null, over: Partial<NoteOp> = {}): NoteOp => ({
  id: `op-${workoutExerciseId}-${String(notes)}`, kind: "note", workoutId, workoutExerciseId, userId: "u", status: "queued",
  attempted: false, attempts: 0, nextAttemptAt: 0, enqueuedAt: Date.parse("2026-10-03T09:00:00Z"), body: { notes }, ...over,
});
const run = (w: ReturnType<typeof detail>, ops: OutboxOp[]) => project(w, { ops, idMap: {} });

describe("10.3 AC13 — project overlays note ops", () => {
  it("a queued note shows at once and is marked pending under the exercise id", () => {
    const w = detail();
    const [bench, row] = w.exercises;
    const out = run(w, [note(w.id, row!.id, "left shoulder tight")]);
    expect(out.workout.exercises[1]!.notes).toBe("left shoulder tight");
    expect(out.workout.exercises[0]!.notes).toBe("Pause"); // other exercises untouched
    expect(out.sync.get(row!.id)).toEqual({ state: "pending" });
    expect(out.sync.has(bench!.id)).toBe(false);
  });

  it("queue order: the later edit wins; clearing shows null", () => {
    const w = detail();
    const id = w.exercises[0]!.id;
    expect(run(w, [note(w.id, id, "a"), note(w.id, id, "b")]).workout.exercises[0]!.notes).toBe("b");
    expect(run(w, [note(w.id, id, null)]).workout.exercises[0]!.notes).toBeNull();
  });

  it("a failed note op is still shown, marked failed with its op id and status", () => {
    const w = detail();
    const id = w.exercises[0]!.id;
    const failed = note(w.id, id, "kept", { status: "failed", failure: { status: 409, type: "workout-finished", requestId: null } });
    const out = run(w, [failed]);
    expect(out.workout.exercises[0]!.notes).toBe("kept");
    expect(out.sync.get(id)).toEqual({ state: "failed", opId: failed.id, status: 409 });
  });

  it("an op for another workout or for a missing exercise is ignored", () => {
    const w = detail();
    expect(run(w, [note("other", w.exercises[0]!.id, "x"), note(w.id, "gone", "y")]).workout).toBe(w);
  });

  it("is idempotent, and a note equal to the stored one returns the same workout", () => {
    const w = detail();
    const id = w.exercises[0]!.id;
    const once = run(w, [note(w.id, id, "new")]);
    expect(run(once.workout, [note(w.id, id, "new")]).workout).toBe(once.workout);
    expect(run(w, [note(w.id, id, "Pause")]).workout).toBe(w);
  });
});
