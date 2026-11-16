import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../../observability/track", () => ({ track: observability.track }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import type { UpdatedWorkout, WorkoutDetail } from "@sin/core";
import { ApiError } from "../../../api";
import { memoryStorageAdapter, type StorageAdapter } from "../../../storage/storage";
import { makeSet, makeWorkoutDetail } from "../../../test/workoutFixtures";
import { fakeClient } from "../../../test/workoutHarness";
import { createWorkoutClient, type WorkoutClient } from "../workoutClient";
import { FINISH_WAIT_MS } from "./finish";
import type { FinishMeta } from "./ops";
import { createOutbox, type OutboxDeps } from "./outbox";
import { createQueuedWorkoutClient } from "./queuedWorkoutClient";

const KEY = "30000000-0000-4000-8000-000000000001";
const ENDED = "2026-11-08T10:15:00.000Z";
const META: FinishMeta = { startedAt: "2026-11-08T09:00:00.000Z", exerciseCount: 1, setCount: 1, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false };
const network = () => ApiError.network("req-net", new TypeError("Failed to fetch"));
const apiError = (status: number) => new ApiError({ status, type: "about:blank", title: "t", requestId: `req-${status}` });

/** A REST method whose calls wait until the test settles them. */
function held<T>() {
  const calls: { resolve: (v: T) => void; reject: (e: unknown) => void }[] = [];
  const fn = vi.fn(() => new Promise<T>((resolve, reject) => calls.push({ resolve, reject })));
  return { fn, calls };
}

function setup(over: Partial<OutboxDeps> & { detail?: WorkoutDetail; active?: WorkoutDetail | null } = {}) {
  const workout = makeWorkoutDetail({
    startedAt: META.startedAt,
    exercises: [{ modality: "weight_reps", name: "Bench", sets: [makeSet({ setNumber: 1, completedAt: "2026-11-08T09:10:00.000Z" })] }],
  });
  const finish = held<UpdatedWorkout>();
  const getById = held<WorkoutDetail>();
  const createSet = held<ReturnType<typeof makeSet>>();
  const rest = fakeClient({ finish: finish.fn, getById: getById.fn, createSet: createSet.fn });
  const outbox = createOutbox({ storage: memoryStorageAdapter(), rest, userId: "u1", isOnline: () => true, random: () => 0.5, ...over });
  stops.push(outbox.start()); // as the provider does: drain only runs once started
  let active: WorkoutDetail | null = over.active === undefined ? workout : over.active;
  const details = new Map<string, WorkoutDetail>(over.detail ? [[over.detail.id, over.detail]] : []);
  const client = createQueuedWorkoutClient({
    rest,
    outbox,
    cached: () => active,
    cachedDetail: (id) => details.get(id),
  });
  return {
    workout,
    rest,
    outbox,
    client,
    finish,
    getById,
    createSet,
    setActive: (w: WorkoutDetail | null) => {
      active = w;
    },
  };
}
const updated = (workout: WorkoutDetail): UpdatedWorkout => ({ ...workout, endedAt: ENDED, newRecords: [] }) as unknown as UpdatedWorkout;

beforeEach(() => vi.useFakeTimers({ now: Date.parse("2026-11-08T10:15:00Z") }));
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
  observability.track.mockReset();
  observability.reportError.mockReset();
});

describe("06.7 AC13 — finishOrQueue always resolves, and says which", () => {
  it("lands within the budget → landed", async () => {
    const t = setup();
    const result = t.client.finishOrQueue(t.workout.id, { endedAt: ENDED }, META);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.finish.fn).toHaveBeenCalledWith(t.workout.id, { endedAt: ENDED }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    t.finish.calls[0]!.resolve(updated(t.workout));
    await expect(result).resolves.toEqual({ status: "landed" });
  });

  it("slow → queued/slow at FINISH_WAIT_MS, and the op keeps trying", async () => {
    const t = setup();
    let settled: unknown;
    void t.client.finishOrQueue(t.workout.id, { endedAt: ENDED }, META).then((r) => (settled = r));
    await vi.advanceTimersByTimeAsync(FINISH_WAIT_MS - 1);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toEqual({ status: "queued", reason: "slow", durable: true });
    expect(t.outbox.getState().ops).toEqual([expect.objectContaining({ kind: "finish", status: "sending" })]);
    // A late success still lands (the request was not canceled at the wait's end, §6.4).
    t.finish.calls[0]!.resolve(updated(t.workout));
    await vi.advanceTimersByTimeAsync(0);
    expect(t.outbox.getState().ops).toEqual([]);
  });

  it("offline → queued/offline at once, with no wait and no request", async () => {
    const t = setup({ isOnline: () => false });
    const wait = vi.spyOn(t.outbox, "whenFinishSettles");
    await expect(t.client.finishOrQueue(t.workout.id, { endedAt: ENDED }, META)).resolves.toEqual({
      status: "queued",
      reason: "offline",
      durable: true,
    });
    expect(wait).not.toHaveBeenCalled();
    expect(t.finish.fn).not.toHaveBeenCalled();
    expect(t.outbox.getState().ops).toEqual([expect.objectContaining({ kind: "finish", body: { endedAt: ENDED }, meta: META, status: "queued" })]);
  });

  it("reports durable: false when this phone couldn't save it", async () => {
    const base = memoryStorageAdapter();
    const refusing: StorageAdapter = { ...base, set: () => { throw new Error("QuotaExceededError"); } };
    const t = setup({ isOnline: () => false, storage: refusing });
    await expect(t.client.finishOrQueue(t.workout.id, { endedAt: ENDED }, META)).resolves.toEqual({
      status: "queued",
      reason: "offline",
      durable: false,
    });
  });

  it("behind unsent sets, it waits for them within the same budget, then lands", async () => {
    const online = setup(); // queue the set, then the finish
    await online.client.createSet(online.workout.exercises[0]!.id, { clientGeneratedId: KEY, reps: 5, isComplete: true });
    const result = online.client.finishOrQueue(online.workout.id, { endedAt: ENDED }, META);
    await vi.advanceTimersByTimeAsync(3000);
    expect(online.finish.fn).not.toHaveBeenCalled();
    online.createSet.calls[0]!.resolve(makeSet({ id: "40000000-0000-4000-8000-000000000001", clientGeneratedId: KEY }));
    await vi.advanceTimersByTimeAsync(0);
    expect(online.finish.fn).toHaveBeenCalledTimes(1);
    online.finish.calls[0]!.resolve(updated(online.workout));
    await expect(result).resolves.toEqual({ status: "landed" });
  });

  it.each([
    ["a network failure", network(), { status: "queued", reason: "slow", durable: true }],
    ["a 5xx", apiError(503), { status: "queued", reason: "slow", durable: true }],
    ["a refusal (422)", apiError(422), { status: "refused" }],
    ["a 404", apiError(404), { status: "refused" }],
  ])("never rejects for %s: it resolves, and the op owns the outcome", async (_name, error, outcome) => {
    const t = setup();
    let settled: unknown;
    void t.client.finishOrQueue(t.workout.id, { endedAt: ENDED }, META).then(
      (r) => (settled = r),
      (e: unknown) => (settled = { rejected: e }),
    );
    await vi.advanceTimersByTimeAsync(0);
    t.finish.calls[0]!.reject(error);
    await vi.advanceTimersByTimeAsync(FINISH_WAIT_MS);
    expect(settled).toEqual(outcome);
  });

  it("code review: a finish refused within the wait resolves refused at once, never 'saved on this phone' (AC29)", async () => {
    const t = setup();
    let settled: unknown;
    void t.client.finishOrQueue(t.workout.id, { endedAt: ENDED }, META).then((r) => (settled = r));
    await vi.advanceTimersByTimeAsync(0);
    t.finish.calls[0]!.reject(apiError(422));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toEqual({ status: "refused" });
  });

  it.each([true, false])("code review: a finish blocked at enqueue by a failed write resolves refused (online: %s)", async (online) => {
    const t = setup({ isOnline: () => online });
    t.outbox.enqueueCreate({ workoutId: t.workout.id, workoutExerciseId: t.workout.exercises[0]!.id, body: { clientGeneratedId: KEY, reps: 5, isComplete: true } });
    t.outbox.__setForTests(t.outbox.getState().ops.map((o) => ({ ...o, status: "failed" as const, failure: { status: 422, type: "about:blank", requestId: "r" } })));
    await expect(t.client.finishOrQueue(t.workout.id, { endedAt: ENDED }, META)).resolves.toEqual({ status: "refused" });
    expect(t.finish.fn).not.toHaveBeenCalled();
  });

  it("the REST client's finishOrQueue wraps finish and resolves landed", async () => {
    vi.useRealTimers();
    const patch = vi.fn(async () => updated(makeWorkoutDetail()));
    const api = { patch } as unknown as Parameters<typeof createWorkoutClient>[0];
    const rest: WorkoutClient = createWorkoutClient(api);
    await expect(rest.finishOrQueue("w-1", { endedAt: ENDED }, META)).resolves.toEqual({ status: "landed" });
    expect(patch).toHaveBeenCalledWith("/v1/workouts/w-1", { endedAt: ENDED }, expect.anything());
  });
});

describe("06.7 AC16 — the summary reads a projected copy while a finish waits", () => {
  it("with a waiting op and a cached detail: the projection, and no request", async () => {
    const t = setup({ isOnline: () => false });
    await t.client.finishOrQueue(t.workout.id, { endedAt: ENDED }, META);
    const detail = { ...t.workout, title: "From the detail cache" };
    const withDetail = createQueuedWorkoutClient({ rest: t.rest, outbox: t.outbox, cached: () => null, cachedDetail: () => detail });
    const read = await withDetail.getById(t.workout.id);
    expect(read).toMatchObject({ id: t.workout.id, title: "From the detail cache", endedAt: ENDED, plannedDurationSeconds: null });
    expect(t.getById.fn).not.toHaveBeenCalled();
  });

  it("with a waiting op and only the active cache holding it: the projection, and no request", async () => {
    const t = setup({ isOnline: () => false });
    await t.client.createSet(t.workout.exercises[0]!.id, { clientGeneratedId: KEY, reps: 5, isComplete: true });
    await t.client.finishOrQueue(t.workout.id, { endedAt: ENDED }, META);
    const read = await t.client.getById(t.workout.id);
    expect(read.endedAt).toBe(ENDED);
    // The outbox projection is applied too: the unsent set shows on the summary.
    expect(read.exercises[0]!.sets.map((s) => s.id)).toEqual([t.workout.exercises[0]!.sets[0]!.id, KEY]);
    expect(t.getById.fn).not.toHaveBeenCalled();
  });

  it("with a waiting op and nothing cached: one REST read, projected", async () => {
    const t = setup({ isOnline: () => false });
    await t.client.finishOrQueue(t.workout.id, { endedAt: ENDED }, META);
    t.setActive(null);
    const read = t.client.getById(t.workout.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.getById.fn).toHaveBeenCalledTimes(1);
    t.getById.calls[0]!.resolve(t.workout);
    await expect(read).resolves.toMatchObject({ id: t.workout.id, endedAt: ENDED });
  });

  it("Review Focus 2: with nothing cached and the network down, it rejects as a network error (no half-built workout)", async () => {
    const t = setup({ isOnline: () => false });
    await t.client.finishOrQueue(t.workout.id, { endedAt: ENDED }, META);
    t.setActive(null);
    const read = t.client.getById(t.workout.id);
    await vi.advanceTimersByTimeAsync(0);
    t.getById.calls[0]!.reject(network());
    await expect(read).rejects.toMatchObject({ status: 0 });
  });

  it("Review Focus 3: with no finish op (landed in another tab, or after a reload), it is the plain REST read", async () => {
    const t = setup();
    const server = { ...t.workout, endedAt: ENDED };
    const read = t.client.getById(t.workout.id);
    await vi.advanceTimersByTimeAsync(0);
    t.getById.calls[0]!.resolve(server);
    await expect(read).resolves.toBe(server);
  });

  it("with a failed finish op, it is the plain REST read", async () => {
    const t = setup({ isOnline: () => false });
    t.outbox.enqueueFinish({ workoutId: t.workout.id, body: { endedAt: ENDED }, meta: META });
    (t.outbox as ReturnType<typeof createOutbox>).__setForTests(
      t.outbox.getState().ops.map((o) => ({ ...o, status: "failed" as const, failure: { status: 422, type: "about:blank", requestId: null } })),
    );
    const read = t.client.getById(t.workout.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.getById.fn).toHaveBeenCalledTimes(1);
    t.getById.calls[0]!.resolve(t.workout);
    await expect(read).resolves.toBe(t.workout);
  });

  it("getActive never returns endedAt from an unsent finish", async () => {
    const t = setup({ isOnline: () => false });
    const rest = fakeClient({ getActive: vi.fn(async () => t.workout) });
    const client = createQueuedWorkoutClient({ rest, outbox: t.outbox, cached: () => t.workout });
    await client.finishOrQueue(t.workout.id, { endedAt: ENDED }, META);
    const active = await client.getActive();
    expect(active?.endedAt).toBeNull();
  });
});
