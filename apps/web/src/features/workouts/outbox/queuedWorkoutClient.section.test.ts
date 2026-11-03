import { describe, expect, it, vi } from "vitest";
import type { WorkoutDetail } from "@sin/core";
import { memoryStorageAdapter } from "../../../storage/storage";
import { makeTimedSection, makeWorkoutDetail } from "../../../test/workoutFixtures";
import { fakeClient } from "../../../test/workoutHarness";
import { createOutbox } from "./outbox";
import { createQueuedWorkoutClient } from "./queuedWorkoutClient";

function setup() {
  const workout = makeWorkoutDetail({
    sections: [{ name: "Finisher", timer: { format: "amrap", capSeconds: 720 }, roundTimes: [{ round: 1, seconds: 250 }] }],
    exercises: [{ modality: "weight_reps", name: "Burpee", sectionIndex: 0 }],
  });
  const section = workout.sections[0]!;
  const rest = fakeClient({
    putRoundTime: vi.fn(async () => makeTimedSection()),
    deleteRoundTime: vi.fn(async () => undefined),
    putResult: vi.fn(async () => makeTimedSection()),
    deleteResult: vi.fn(async () => undefined),
  });
  // Offline and never started: ops stay queued, so we see exactly what the client enqueued.
  const outbox = createOutbox({ storage: memoryStorageAdapter(), rest, userId: "u1", isOnline: () => false });
  let cache: WorkoutDetail | null = workout;
  const client = createQueuedWorkoutClient({ rest, outbox, cached: () => cache });
  return { workout, section, rest, outbox, client, setCache: (w: WorkoutDetail | null) => (cache = w) };
}

describe("10.7 AC34 — the queued client resolves at once", () => {
  it("putRoundTime on a cached section enqueues one round op and resolves with the projected section, no REST", async () => {
    const { section, rest, outbox, client } = setup();
    const out = await client.putRoundTime(section.id, 2, 515);
    expect(out.roundTimes).toEqual([{ round: 1, seconds: 250 }, { round: 2, seconds: 515 }]);
    expect(outbox.getState().ops).toEqual([expect.objectContaining({ kind: "round", sectionId: section.id, round: 2, body: { seconds: 515 } })]);
    expect(outbox.getState().ops[0]).not.toHaveProperty("workoutExerciseId");
    expect(rest.putRoundTime).not.toHaveBeenCalled();
  });

  it("deleteRoundTime, putResult and deleteResult enqueue their ops", async () => {
    const { section, outbox, client } = setup();
    await expect(client.deleteRoundTime(section.id, 1)).resolves.toBeUndefined();
    const withResult = await client.putResult(section.id, { rounds: 5, reps: 7 });
    expect(withResult.result).toEqual({ rounds: 5, reps: 7, finishSeconds: null, capped: false });
    await expect(client.deleteResult(section.id)).resolves.toBeUndefined();
    expect(outbox.getState().ops.map((o) => [o.kind, o.body])).toEqual([
      ["round", { seconds: null }],
      ["result", null],
    ]);
  });

  it("a section that is not in the cached workout falls back to REST", async () => {
    const { rest, client, setCache } = setup();
    setCache(null);
    await client.putRoundTime("elsewhere", 1, 200);
    await client.deleteRoundTime("elsewhere", 1);
    await client.putResult("elsewhere", { rounds: 1, reps: 1 });
    await client.deleteResult("elsewhere");
    expect(rest.putRoundTime).toHaveBeenCalledWith("elsewhere", 1, 200);
    expect(rest.deleteRoundTime).toHaveBeenCalledWith("elsewhere", 1);
    expect(rest.putResult).toHaveBeenCalledWith("elsewhere", { rounds: 1, reps: 1 });
    expect(rest.deleteResult).toHaveBeenCalledWith("elsewhere");
  });
});
