import { describe, expect, it, vi } from "vitest";
import type { WorkoutDetail } from "@sin/core";
import { memoryStorageAdapter } from "../../../storage/storage";
import { makeWorkoutDetail } from "../../../test/workoutFixtures";
import { fakeClient } from "../../../test/workoutHarness";
import { createOutbox } from "./outbox";
import { createQueuedWorkoutClient } from "./queuedWorkoutClient";

function setup() {
  const workout = makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "Bench", notes: "old" }] });
  const rest = fakeClient({ setExerciseNote: vi.fn(async () => workout.exercises[0]!) });
  // Offline and never started: ops stay queued, so we see exactly what the client enqueued.
  const outbox = createOutbox({ storage: memoryStorageAdapter(), rest, userId: "u1", isOnline: () => false });
  let cache: WorkoutDetail | null = workout;
  const client = createQueuedWorkoutClient({ rest, outbox, cached: () => cache });
  return { workout, rest, outbox, client, setCache: (w: WorkoutDetail | null) => (cache = w) };
}

describe("10.3 AC28 — QueuedWorkoutClient.setExerciseNote", () => {
  it("enqueues one note op, resolves at once with the projected exercise, and does not touch REST", async () => {
    const { workout, rest, outbox, client } = setup();
    const out = await client.setExerciseNote(workout.exercises[0]!.id, "new text");
    expect(out.notes).toBe("new text");
    expect(outbox.getState().ops).toEqual([expect.objectContaining({ kind: "note", workoutExerciseId: workout.exercises[0]!.id, body: { notes: "new text" } })]);
    expect(rest.setExerciseNote).not.toHaveBeenCalled();
  });
  it("two edits leave one op carrying the newer text", async () => {
    const { workout, outbox, client } = setup();
    await client.setExerciseNote(workout.exercises[0]!.id, "a");
    await client.setExerciseNote(workout.exercises[0]!.id, null);
    expect(outbox.getState().ops).toHaveLength(1);
    expect(outbox.getState().ops[0]).toMatchObject({ body: { notes: null } });
  });
  it("an exercise that is not in the cached workout falls back to REST", async () => {
    const { rest, client, setCache } = setup();
    setCache(null);
    await client.setExerciseNote("elsewhere", "x");
    expect(rest.setExerciseNote).toHaveBeenCalledWith("elsewhere", "x");
  });
});
