import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../../observability/track", () => ({ track: observability.track }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import type { SetEntry } from "@sin/core";
import { ApiError } from "../../../api";
import { makeSet } from "../../../test/workoutFixtures";
import { memoryStorageAdapter } from "../../../storage/storage";
import { createWorkoutClient } from "../workoutClient";
import { createOutbox, SEND_TIMEOUT_MS, type OutboxDeps } from "./outbox";

const KEY = "30000000-0000-4000-8000-000000000001";
const S1 = "40000000-0000-4000-8000-000000000001";
const S_LATE = "40000000-0000-4000-8000-000000000009";
const body = () => ({ clientGeneratedId: KEY, weight: 60, weightUnit: "kg" as const, reps: 8, isComplete: true });
const counter = () => {
  let i = 0;
  return () => `op-${++i}`;
};

/** A createSet that hangs until released, and records the signal it was given. */
function hangingRest() {
  const signals: (AbortSignal | undefined)[] = [];
  const pending: { resolve: (row: SetEntry) => void; reject: (e: unknown) => void }[] = [];
  const createSet = vi.fn(
    (_we: string, _b: unknown, options?: { signal?: AbortSignal }) =>
      new Promise<SetEntry>((resolve, reject) => {
        signals.push(options?.signal);
        pending.push({ resolve, reject });
      }),
  );
  const never = () => new Promise<never>(() => {});
  return { rest: { createSet, updateSet: vi.fn(never), deleteSet: vi.fn(never), setExerciseNote: vi.fn(never) }, signals, pending, createSet };
}

const make = (over: Partial<OutboxDeps>) =>
  createOutbox({ storage: memoryStorageAdapter(), rest: hangingRest().rest, userId: "u1", isOnline: () => true, newId: counter(), random: () => 0.5, ...over });

beforeEach(() => vi.useFakeTimers({ now: Date.parse("2026-11-08T09:00:00Z") }));
afterEach(() => {
  vi.useRealTimers();
  observability.track.mockReset();
  observability.reportError.mockReset();
});

describe("06.7 AC5 — every outbox send has a deadline and an abort signal", () => {
  it("SEND_TIMEOUT_MS is 20 s", () => {
    expect(SEND_TIMEOUT_MS).toBe(20_000);
  });

  it("a hung send aborts at 20 s, the signal reached the REST client, and the op goes back to queued with the backoff", async () => {
    const h = hangingRest();
    const outbox = make({ rest: h.rest });
    outbox.start();
    outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: body() });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.createSet).toHaveBeenCalledTimes(1);
    expect(h.signals[0]).toBeInstanceOf(AbortSignal);
    expect(h.signals[0]!.aborted).toBe(false);
    expect(outbox.getState().ops[0]).toMatchObject({ status: "sending" });

    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS - 1);
    expect(outbox.getState().ops[0]).toMatchObject({ status: "sending" });
    await vi.advanceTimersByTimeAsync(1);
    expect(h.signals[0]!.aborted).toBe(true);
    // backoffMs(1, 0.5) = 1000
    expect(outbox.getState().ops[0]).toMatchObject({ status: "queued", attempted: true, attempts: 1, nextAttemptAt: Date.now() + 1000 });
  });

  it("a hung token fetch (a promise that ignores the signal) still ends as a retryable network error, and draining is released", async () => {
    const createSet = vi.fn(() => new Promise<SetEntry>(() => {}));
    const h = hangingRest();
    const outbox = make({ rest: { ...h.rest, createSet } });
    outbox.start();
    outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: body() });
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    expect(outbox.getState().ops[0]).toMatchObject({ status: "queued", attempts: 1 });
    // The backoff elapses and the next attempt goes: the drain was not left stuck behind the hung one.
    await vi.advanceTimersByTimeAsync(1000);
    expect(createSet).toHaveBeenCalledTimes(2);
  });

  it("Retry now after a hung send sends again at once", async () => {
    const h = hangingRest();
    const outbox = make({ rest: h.rest });
    outbox.start();
    outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: body() });
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    expect(h.createSet).toHaveBeenCalledTimes(1);
    outbox.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.createSet).toHaveBeenCalledTimes(2);
  });

  it("Review Focus 1: a reply that arrives after its deadline changes nothing: one onSynced, the retry unaffected", async () => {
    const h = hangingRest();
    const onSynced = vi.fn();
    const outbox = make({ rest: h.rest, onSynced });
    outbox.start();
    outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: body() });
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    const afterDeadline = outbox.getState().ops[0];
    expect(afterDeadline).toMatchObject({ status: "queued", attempts: 1 });

    // The first request's late reply.
    h.pending[0]!.resolve(makeSet({ id: S_LATE, clientGeneratedId: KEY }));
    await vi.advanceTimersByTimeAsync(0);
    expect(onSynced).not.toHaveBeenCalled();
    expect(outbox.getState().ops).toEqual([afterDeadline]);
    expect(outbox.getState().idMap).toEqual({});

    // The retry goes and succeeds once.
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.createSet).toHaveBeenCalledTimes(2);
    h.pending[1]!.resolve(makeSet({ id: S1, clientGeneratedId: KEY }));
    await vi.advanceTimersByTimeAsync(0);
    expect(onSynced).toHaveBeenCalledTimes(1);
    expect(outbox.getState().ops).toEqual([]);
    expect(outbox.getState().idMap).toEqual({ [KEY]: { setId: S1, workoutId: "w" } });
  });

  it("a late rejection after the deadline changes nothing either", async () => {
    const h = hangingRest();
    const onFailed = vi.fn();
    const outbox = make({ rest: h.rest, onFailed });
    outbox.start();
    outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: body() });
    await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
    h.pending[0]!.reject(new ApiError({ status: 400, type: "about:blank", title: "t", requestId: "r" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(onFailed).not.toHaveBeenCalled();
    expect(outbox.getState().ops[0]).toMatchObject({ status: "queued" });
  });

  it("a reply inside the deadline clears the timer: nothing fires at 20 s", async () => {
    const h = hangingRest();
    const outbox = make({ rest: h.rest });
    outbox.start();
    outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: body() });
    await vi.advanceTimersByTimeAsync(0);
    h.pending[0]!.resolve(makeSet({ id: S1, clientGeneratedId: KEY }));
    await vi.advanceTimersByTimeAsync(0);
    expect(outbox.getState().ops).toEqual([]);
    expect(h.signals[0]!.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("06.7 AC5 — the REST write methods forward an optional signal to api.request", () => {
  const recording = () => {
    const calls: { path: string; options: { method?: string; body?: unknown; signal?: AbortSignal } }[] = [];
    const request = vi.fn(async (path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}) => {
      calls.push({ path, options });
      return undefined;
    });
    const unused = vi.fn(async () => undefined);
    return { api: { request, get: unused, post: unused, patch: unused, delete: unused } as never, calls, unused };
  };

  it("each outbox method sends through request with the signal, method and body", async () => {
    const { api, calls, unused } = recording();
    const client = createWorkoutClient(api);
    const signal = new AbortController().signal;
    await client.createSet("we1", { reps: 8, isComplete: true, clientGeneratedId: "k" }, { signal });
    await client.updateSet("s1", { weight: 61 }, { signal });
    await client.deleteSet("s1", { signal });
    await client.setExerciseNote("we1", "Pause", { signal });
    await client.putRoundTime("sec1", 2, 515, { signal });
    await client.deleteRoundTime("sec1", 2, { signal });
    await client.putResult("sec1", { rounds: 5 } as never, { signal });
    await client.deleteResult("sec1", { signal });
    await client.finish("w1", { endedAt: "2026-11-08T10:00:00.000Z" }, { signal });
    await client.getById("w1", { signal });
    expect(unused).not.toHaveBeenCalled();
    expect(calls.map((c) => [c.options.method ?? "GET", c.path, c.options.signal === signal])).toEqual([
      ["POST", "/v1/workout-exercises/we1/sets", true],
      ["PATCH", "/v1/sets/s1", true],
      ["DELETE", "/v1/sets/s1", true],
      ["PATCH", "/v1/workout-exercises/we1", true],
      ["PUT", "/v1/workout-sections/sec1/round-times/2", true],
      ["DELETE", "/v1/workout-sections/sec1/round-times/2", true],
      ["PUT", "/v1/workout-sections/sec1/result", true],
      ["DELETE", "/v1/workout-sections/sec1/result", true],
      ["PATCH", "/v1/workouts/w1", true],
      ["GET", "/v1/workouts/w1", true],
    ]);
    expect(calls[0]!.options.body).toStrictEqual({ reps: 8, isComplete: true, clientGeneratedId: "k" });
    expect(calls[3]!.options.body).toStrictEqual({ notes: "Pause" });
    expect(calls[8]!.options.body).toStrictEqual({ endedAt: "2026-11-08T10:00:00.000Z" });
  });
});
