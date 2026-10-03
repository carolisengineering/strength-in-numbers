import { describe, expect, it, vi } from "vitest";
import type { WorkoutDetail } from "@sin/core";
import { memoryStorageAdapter } from "../../../storage/storage";
import { makeSet, makeWorkoutDetail } from "../../../test/workoutFixtures";
import { fakeClient } from "../../../test/workoutHarness";
import { createOutbox } from "./outbox";
import { createQueuedWorkoutClient } from "./queuedWorkoutClient";

const KEY = "30000000-0000-4000-8000-000000000001";
const OTHER_KEY = "30000000-0000-4000-8000-000000000009";

function setup() {
  const workout = makeWorkoutDetail({
    exercises: [{ modality: "weight_reps", name: "Bench", sets: [makeSet({ setNumber: 1 })] }],
  });
  const we = workout.exercises[0]!;
  const rest = fakeClient({
    getActive: vi.fn(async () => workout),
    start: vi.fn(async () => workout),
    createSet: vi.fn(async () => makeSet()),
    updateSet: vi.fn(async () => makeSet()),
    deleteSet: vi.fn(async () => undefined),
  });
  // Offline and never started: ops stay queued, so we see exactly what the client enqueued.
  const outbox = createOutbox({ storage: memoryStorageAdapter(), rest, userId: "u1", isOnline: () => false });
  let cache: WorkoutDetail | null = workout;
  const client = createQueuedWorkoutClient({ rest, outbox, cached: () => cache });
  return {
    workout,
    we,
    rest,
    outbox,
    client,
    setCache: (w: WorkoutDetail | null) => {
      cache = w;
    },
  };
}

describe("06.2 AC10 — QueuedWorkoutClient", () => {
  it("createSet enqueues and resolves at once with the projected row; no request", async () => {
    const { we, rest, outbox, client } = setup();
    const row = await client.createSet(we.id, { clientGeneratedId: KEY, weight: 60, weightUnit: "kg", reps: 8, isComplete: true });
    expect(row).toMatchObject({ id: KEY, setNumber: 2, reps: 8 });
    expect(rest.createSet).not.toHaveBeenCalled();
    expect(outbox.getState().ops).toHaveLength(1);
  });

  it("createSet without a key mints one", async () => {
    const { we, outbox, client } = setup();
    const row = await client.createSet(we.id, { reps: 5, isComplete: true });
    expect(row.clientGeneratedId).toMatch(/^[0-9a-f-]{36}$/);
    expect(outbox.getState().ops[0]).toMatchObject({ kind: "create", target: { clientGeneratedId: row.clientGeneratedId } });
  });

  it("updateSet on a pending set targets its key and returns the edited row (Review Focus 1)", async () => {
    const { we, outbox, client, workout, setCache } = setup();
    const created = await client.createSet(we.id, { clientGeneratedId: KEY, reps: 8, isComplete: true });
    setCache({ ...workout, exercises: [{ ...we, sets: [...we.sets, created] }] });
    const row = await client.updateSet(created.id, { reps: 9 });
    expect(row.reps).toBe(9);
    expect(outbox.getState().ops).toHaveLength(1); // merged into the never-sent create
  });

  it("updateSet on a synced set targets its id", async () => {
    const { we, outbox, client } = setup();
    await client.updateSet(we.sets[0]!.id, { reps: 3 });
    expect(outbox.getState().ops[0]).toMatchObject({ kind: "update", target: { setId: we.sets[0]!.id }, body: { reps: 3 } });
  });

  it("deleteSet enqueues a delete and resolves", async () => {
    const { we, outbox, client } = setup();
    await expect(client.deleteSet(we.sets[0]!.id)).resolves.toBeUndefined();
    expect(outbox.getState().ops[0]).toMatchObject({ kind: "delete", target: { setId: we.sets[0]!.id } });
  });

  it("with no cached workout holding the set, set writes go straight to REST (pessimistic fallback)", async () => {
    const { we, rest, client, setCache } = setup();
    setCache(null);
    await client.createSet(we.id, { reps: 1, isComplete: true });
    await client.updateSet(we.sets[0]!.id, { reps: 2 });
    await client.deleteSet(we.sets[0]!.id);
    expect(rest.createSet).toHaveBeenCalledTimes(1);
    expect(rest.updateSet).toHaveBeenCalledTimes(1);
    expect(rest.deleteSet).toHaveBeenCalledTimes(1);
  });

  it("getActive overlays pending ops and drops ops for any other workout", async () => {
    const { we, outbox, client } = setup();
    outbox.enqueueCreate({ workoutId: "other", workoutExerciseId: "x", body: { clientGeneratedId: OTHER_KEY, reps: 1, isComplete: true } });
    await client.createSet(we.id, { clientGeneratedId: KEY, reps: 8, isComplete: true });
    const active = await client.getActive();
    expect(active!.exercises[0]!.sets.map((s) => s.setNumber)).toEqual([1, 2]);
    expect(outbox.getState().ops.map((o) => o.workoutId)).toEqual([active!.id]);
  });

  it("getActive with no active workout drops every op and returns null", async () => {
    const { we, rest, outbox, client } = setup();
    await client.createSet(we.id, { clientGeneratedId: KEY, reps: 8, isComplete: true });
    vi.mocked(rest.getActive).mockResolvedValueOnce(null);
    await expect(client.getActive()).resolves.toBeNull();
    expect(outbox.getState().ops).toEqual([]);
  });

  it("every other method passes through", async () => {
    const { rest, client } = setup();
    await client.start({ clientGeneratedId: KEY, startedAt: new Date().toISOString() });
    expect(rest.start).toHaveBeenCalledTimes(1);
  });
});
