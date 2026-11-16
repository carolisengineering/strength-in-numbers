import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../observability/track", () => ({ track: vi.fn() }));
vi.mock("../observability/reportError", () => ({ reportError: vi.fn() }));

import type { UpdatedWorkout, WorkoutDetail } from "@sin/core";
import { ApiError } from "../api";
import { createOutbox, LEGACY_OUTBOX_KEY, outboxKey } from "../features/workouts/outbox/outbox";
import { clearUserData, isOutboxFile } from "../storage/clearUserData";
import { localStorageAdapter, memoryStorageAdapter } from "../storage/storage";
import { makeSet, makeWorkoutDetail } from "../test/workoutFixtures";
import { logoutAndClear } from "./logout";

const everyKind = () => ({
  [outboxKey("u1")]: "{}",
  [outboxKey("u2")]: "{}",
  [LEGACY_OUTBOX_KEY]: "{}",
  "sin:workout:drafts": "{}",
  "sin:workout:rest": "{}",
  "sin:catalog:v1:u1": "{}",
  "sin:recents:v1:u1": "{}",
  "sin:hevy:key:u1": "{}",
  "sin:pref:theme": "dark",
  other: "kept",
});
const KEPT_ALWAYS = ["other", "sin:pref:theme"];

describe("06.7 AC9 — clearUserData takes a keep predicate", () => {
  it("isOutboxFile matches the per-account files only", () => {
    expect(isOutboxFile(outboxKey("u1"))).toBe(true);
    expect(isOutboxFile(LEGACY_OUTBOX_KEY)).toBe(false);
    expect(isOutboxFile("sin:workout:drafts")).toBe(false);
    expect(isOutboxFile("sin:workout:outboxes")).toBe(false);
  });

  it("keeps what the predicate keeps and clears every other user-data key", () => {
    const storage = memoryStorageAdapter(everyKind());
    clearUserData(storage, { keep: isOutboxFile });
    expect(storage.keys().sort()).toEqual([outboxKey("u1"), outboxKey("u2"), ...KEPT_ALWAYS].sort());
  });

  it("with no predicate clears every user-data key, as before", () => {
    const storage = memoryStorageAdapter(everyKind());
    clearUserData(storage);
    expect(storage.keys().sort()).toEqual(KEPT_ALWAYS);
  });
});

describe("06.7 AC9 — a forced sign-out keeps unsent workout data; a deliberate one clears it", () => {
  it("forced: keeps every outbox file (per-account and legacy), clears drafts, rest, catalog, recents and the Hevy key, before Auth0", () => {
    const storage = memoryStorageAdapter(everyKind());
    let keysAtLogout: string[] = [];
    const auth0Logout = vi.fn(() => {
      keysAtLogout = storage.keys().sort();
      return Promise.resolve();
    });
    logoutAndClear(auth0Logout, storage, { kind: "forced" });
    expect(keysAtLogout).toEqual([outboxKey("u1"), outboxKey("u2"), LEGACY_OUTBOX_KEY, ...KEPT_ALWAYS].sort());
    expect(auth0Logout).toHaveBeenCalledWith({ logoutParams: { returnTo: window.location.origin } });
  });

  it("forced: keeps a legacy file not yet adopted (the session ended before the outbox loaded), so its sets aren't lost", () => {
    const storage = memoryStorageAdapter({ [LEGACY_OUTBOX_KEY]: "legacy", "sin:workout:drafts": "{}" });
    logoutAndClear(vi.fn(() => Promise.resolve()), storage, { kind: "forced" });
    expect(storage.get(LEGACY_OUTBOX_KEY)).toBe("legacy");
    expect(storage.get("sin:workout:drafts")).toBeNull();
  });

  it("deliberate: clears the signed-in user's file and the legacy file, keeps other users' files (O1)", () => {
    const storage = memoryStorageAdapter(everyKind());
    logoutAndClear(vi.fn(() => Promise.resolve()), storage, { kind: "deliberate", userId: "u1" });
    expect(storage.keys().sort()).toEqual([outboxKey("u2"), ...KEPT_ALWAYS].sort());
  });

  it("no mode: clears every outbox file, as today", () => {
    const storage = memoryStorageAdapter(everyKind());
    logoutAndClear(vi.fn(() => Promise.resolve()), storage);
    expect(storage.keys().sort()).toEqual(KEPT_ALWAYS);
  });

  it("blockUserDataWrites still runs first, in the forced mode too: a late write to a kept file is dropped", () => {
    window.localStorage.setItem(outboxKey("u1"), "before");
    const storage = localStorageAdapter();
    logoutAndClear(vi.fn(() => Promise.resolve()), storage, { kind: "forced" });
    storage.set(outboxKey("u1"), "late");
    expect(window.localStorage.getItem(outboxKey("u1"))).toBe("before");
    window.localStorage.clear();
  });
});

describe("06.7 AC9 — Review Focus 3: a sign-out during a drain leaves a file that replays safely", () => {
  const ENDED = "2026-11-08T10:15:00.000Z";
  const KEY = "30000000-0000-4000-8000-000000000001";
  const S1 = "40000000-0000-4000-8000-000000000001";
  const META = { startedAt: "2026-11-08T09:00:00.000Z", exerciseCount: 1, setCount: 1, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false };

  beforeEach(() => vi.useFakeTimers({ now: Date.parse("2026-11-08T10:15:00Z") }));
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  function recordingRest() {
    const calls: { method: string; args: unknown[] }[] = [];
    const settle: ((value: unknown) => void)[] = [];
    const fail: ((error: unknown) => void)[] = [];
    const hold =
      (method: string) =>
      (...args: unknown[]) =>
        new Promise<never>((resolve, reject) => {
          calls.push({ method, args: args.slice(0, -1) });
          settle.push(resolve as (value: unknown) => void);
          fail.push(reject);
        });
    const rest = {
      createSet: vi.fn(hold("createSet")),
      updateSet: vi.fn(hold("updateSet")),
      deleteSet: vi.fn(hold("deleteSet")),
      setExerciseNote: vi.fn(hold("setExerciseNote")),
      putRoundTime: vi.fn(hold("putRoundTime")),
      deleteRoundTime: vi.fn(hold("deleteRoundTime")),
      putResult: vi.fn(hold("putResult")),
      deleteResult: vi.fn(hold("deleteResult")),
      finish: vi.fn(hold("finish")),
      getById: vi.fn(hold("getById")),
    };
    return { rest, calls, settle, fail };
  }

  it("replays a create by its key, a note and a timer entry as keyed replaces, and a finish by its 409", async () => {
    const storage = localStorageAdapter();
    const first = recordingRest();
    const outbox = createOutbox({ storage, rest: first.rest, userId: "u1", isOnline: () => true });
    outbox.start();
    outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: { clientGeneratedId: KEY, reps: 5, isComplete: true } });
    outbox.enqueueNote({ workoutId: "w", workoutExerciseId: "we", body: { notes: "Pause" } });
    outbox.enqueueRound({ workoutId: "w", sectionId: "sec", round: 1, body: { seconds: 60 } });
    outbox.enqueueFinish({ workoutId: "w", body: { endedAt: ENDED }, meta: META });
    await vi.advanceTimersByTimeAsync(0);
    expect(first.calls.map((c) => c.method)).toEqual(["createSet"]);

    // The forced sign-out lands while the create is in flight; then the create's reply arrives.
    logoutAndClear(vi.fn(() => Promise.resolve()), storage, { kind: "forced" });
    first.settle[0]!(makeSet({ id: S1, clientGeneratedId: KEY }));
    await vi.advanceTimersByTimeAsync(0);
    const kept = JSON.parse(window.localStorage.getItem(outboxKey("u1"))!) as { ops: { kind: string }[] };
    expect(kept.ops.map((o) => o.kind)).toEqual(["create", "note", "round", "finish"]);

    // The same user signs back in on the same phone: a fresh store replays the kept file.
    const again = recordingRest();
    const replay = createOutbox({ storage: memoryStorageAdapter({ [outboxKey("u1")]: window.localStorage.getItem(outboxKey("u1"))! }), rest: again.rest, userId: "u1", isOnline: () => true });
    replay.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(again.calls[0]).toEqual({ method: "createSet", args: ["we", { clientGeneratedId: KEY, reps: 5, isComplete: true }] });
    again.settle[0]!(makeSet({ id: S1, clientGeneratedId: KEY }));
    await vi.advanceTimersByTimeAsync(0);
    expect(again.calls[1]).toEqual({ method: "setExerciseNote", args: ["we", "Pause"] });
    again.settle[1]!(makeWorkoutDetail().exercises[0] ?? null);
    await vi.advanceTimersByTimeAsync(0);
    expect(again.calls[2]).toEqual({ method: "putRoundTime", args: ["sec", 1, 60] });
    again.settle[2]!(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(again.calls[3]).toEqual({ method: "finish", args: ["w", { endedAt: ENDED }] });
    again.fail[3]!(new ApiError({ status: 409, type: "https://x/problems/workout-finished", title: "t", requestId: "r" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(again.calls[4]?.method).toBe("getById");
    again.settle[4]!(makeWorkoutDetail({ endedAt: ENDED }) satisfies WorkoutDetail);
    await vi.advanceTimersByTimeAsync(0);
    expect(replay.getState().ops).toEqual([]);
  });

  it("a forced sign-out after the last op landed leaves nothing to replay (the emptied file is removed)", async () => {
    const storage = localStorageAdapter();
    const r = recordingRest();
    const outbox = createOutbox({ storage, rest: r.rest, userId: "u1", isOnline: () => true });
    outbox.start();
    outbox.enqueueFinish({ workoutId: "w", body: { endedAt: ENDED }, meta: META });
    await vi.advanceTimersByTimeAsync(0);
    logoutAndClear(vi.fn(() => Promise.resolve()), storage, { kind: "forced" });
    r.settle[0]!({ ...makeWorkoutDetail({ endedAt: ENDED }), newRecords: [] } as unknown as UpdatedWorkout);
    await vi.advanceTimersByTimeAsync(0);
    expect(window.localStorage.getItem(outboxKey("u1"))).toBeNull();
  });
});
