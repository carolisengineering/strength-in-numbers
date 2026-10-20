import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../../observability/track", () => ({ track: observability.track }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import type { WorkoutExercise } from "@sin/core";
import { ApiError } from "../../../api";
import { memoryStorageAdapter } from "../../../storage/storage";
import { makeSet, makeWorkoutDetail } from "../../../test/workoutFixtures";
import { createOutbox, OUTBOX_KEY, type OutboxDeps } from "./outbox";

const KEY = "30000000-0000-4000-8000-000000000001";
const exerciseRow = (id: string, notes: string | null): WorkoutExercise =>
  ({ ...makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "X" }] }).exercises[0]!, id, notes }) as unknown as WorkoutExercise;
const api = (status: number, slug = "about:blank") =>
  new ApiError({ status, type: slug === "about:blank" ? slug : `https://x/problems/${slug}`, title: "t", requestId: "req" });

function setup(over: Partial<OutboxDeps> = {}, storage = memoryStorageAdapter()) {
  let online = true;
  const rest = {
    createSet: vi.fn(async () => makeSet()),
    updateSet: vi.fn(async () => makeSet()),
    deleteSet: vi.fn(async (): Promise<void> => undefined),
    setExerciseNote: vi.fn(async (id: string, notes: string | null) => exerciseRow(id, notes)),
  };
  const onSynced = vi.fn();
  const onNoteSynced = vi.fn();
  const onFailed = vi.fn();
  const onDiscarded = vi.fn();
  const outbox = createOutbox({ storage, rest, userId: "u1", isOnline: () => online, random: () => 0.5, onSynced, onNoteSynced, onFailed, onDiscarded, ...over });
  const stop = outbox.start();
  return { outbox, rest, storage, onSynced, onNoteSynced, onFailed, onDiscarded, stop, setOnline: (v: boolean) => (online = v) };
}
type Ctx = ReturnType<typeof setup>;
const note = (outbox: Ctx["outbox"], notes: string | null, we = "we") => outbox.enqueueNote({ workoutId: "w", workoutExerciseId: we, body: { notes } });
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers({ now: Date.parse("2026-10-03T09:00:00Z") }));
afterEach(() => {
  vi.useRealTimers();
  observability.track.mockReset();
  observability.reportError.mockReset();
});

describe("10.3 AC12 — draining note ops", () => {
  it("sends one PATCH with the text, removes the op, reports the row to onNoteSynced and never onSynced or a set_* event", async () => {
    const { outbox, rest, onSynced, onNoteSynced } = setup();
    note(outbox, "left shoulder tight");
    await settle();
    expect(rest.setExerciseNote).toHaveBeenCalledTimes(1);
    expect(rest.setExerciseNote).toHaveBeenCalledWith("we", "left shoulder tight");
    expect(outbox.getState().ops).toEqual([]);
    expect(onNoteSynced).toHaveBeenCalledWith(expect.objectContaining({ kind: "note" }), expect.objectContaining({ id: "we", notes: "left shoulder tight" }));
    expect(onSynced).not.toHaveBeenCalled();
    expect(observability.track).not.toHaveBeenCalled();
  });

  it("two quick edits offline are one op; coming online sends one PATCH with the newer text", async () => {
    const ctx = setup();
    ctx.setOnline(false);
    note(ctx.outbox, "a");
    note(ctx.outbox, "b");
    expect(ctx.outbox.getState().ops).toHaveLength(1);
    await settle();
    expect(ctx.rest.setExerciseNote).not.toHaveBeenCalled();
    ctx.setOnline(true);
    await ctx.outbox.drain();
    expect(ctx.rest.setExerciseNote.mock.calls).toEqual([["we", "b"]]);
  });

  it("a network failure keeps the op queued and retries with backoff", async () => {
    const { outbox, rest } = setup();
    rest.setExerciseNote.mockRejectedValueOnce(ApiError.network("r", new TypeError("Failed to fetch")));
    note(outbox, "a");
    await settle();
    expect(outbox.getState().ops).toHaveLength(1);
    expect(outbox.getState().ops[0]).toMatchObject({ status: "queued", attempted: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(rest.setExerciseNote).toHaveBeenCalledTimes(2);
    expect(outbox.getState().ops).toEqual([]);
  });

  it("404 (the exercise or workout is gone) is done: removed silently, onNoteSynced(op, null), no failure", async () => {
    const { outbox, rest, onNoteSynced, onFailed } = setup();
    rest.setExerciseNote.mockRejectedValueOnce(api(404));
    note(outbox, "a");
    await settle();
    expect(outbox.getState().ops).toEqual([]);
    expect(onNoteSynced).toHaveBeenCalledWith(expect.objectContaining({ kind: "note" }), null);
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("a failed set create does not fail a note op of the same exercise", async () => {
    const ctx = setup();
    ctx.setOnline(false);
    ctx.outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: { clientGeneratedId: KEY, reps: 8, isComplete: false } });
    note(ctx.outbox, "a");
    ctx.rest.createSet.mockRejectedValueOnce(api(422));
    ctx.setOnline(true);
    await ctx.outbox.drain();
    expect(ctx.rest.setExerciseNote).toHaveBeenCalledWith("we", "a");
    expect(ctx.outbox.getState().ops.map((o) => [o.kind, o.status])).toEqual([["create", "failed"]]);
  });

  it("after a 422 the next edit replaces the failed op and is sent", async () => {
    const ctx = setup();
    ctx.rest.setExerciseNote.mockRejectedValueOnce(api(422, "validation-error"));
    note(ctx.outbox, "bad");
    await settle();
    expect(ctx.outbox.getState().ops[0]).toMatchObject({ status: "failed" });
    note(ctx.outbox, "good");
    await settle();
    expect(ctx.rest.setExerciseNote).toHaveBeenLastCalledWith("we", "good");
    expect(ctx.outbox.getState().ops).toEqual([]);
  });

  it("discard removes a note op and tells the screen; discardFailed removes failed note ops only", async () => {
    const ctx = setup();
    ctx.setOnline(false);
    note(ctx.outbox, "a", "e1");
    note(ctx.outbox, "b", "e2");
    const [first, second] = ctx.outbox.getState().ops;
    ctx.outbox.__setForTests([first!, { ...second!, status: "failed", failure: { status: 409, type: "workout-finished", requestId: null } }]);
    ctx.outbox.discardFailed("w");
    expect(ctx.outbox.getState().ops.map((o) => o.id)).toEqual([first!.id]);
    ctx.outbox.discard(first!.id);
    expect(ctx.outbox.getState().ops).toEqual([]);
    expect(ctx.onDiscarded).toHaveBeenCalledTimes(2);
  });
});

describe("10.3 AC30 — persistence", () => {
  it("a note queued offline survives a reload (a new outbox over the same storage) and is sent when online", async () => {
    const first = setup();
    first.setOnline(false);
    note(first.outbox, "kept");
    first.stop();
    const second = setup({}, first.storage);
    expect(second.outbox.getState().ops).toHaveLength(1);
    await settle();
    expect(second.rest.setExerciseNote.mock.calls).toEqual([["we", "kept"]]);
  });

  it("another user's file is ignored", () => {
    const storage = memoryStorageAdapter();
    const stored = { v: 1, userId: "someone-else", idMap: {}, ops: [{ id: "x", kind: "note", workoutId: "w", workoutExerciseId: "we", userId: "someone-else", status: "queued", attempted: false, attempts: 0, nextAttemptAt: 0, enqueuedAt: 0, body: { notes: "theirs" } }] };
    storage.set(OUTBOX_KEY, JSON.stringify(stored));
    const { outbox, rest } = setup({}, storage);
    expect(outbox.getState().ops).toEqual([]);
    expect(rest.setExerciseNote).not.toHaveBeenCalled();
  });
});

describe("18.0 AC26 — workout-finished handling is rollback-only", () => {
  it("10.3 AC12 — 409 workout-finished fails the note and every later op of that workout; only the set op is a set_sync_failed", async () => {
    const ctx = setup();
    ctx.setOnline(false);
    note(ctx.outbox, "a");
    ctx.outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: { clientGeneratedId: KEY, reps: 8, isComplete: false } });
    ctx.rest.setExerciseNote.mockRejectedValueOnce(api(409, "workout-finished"));
    ctx.setOnline(true);
    await ctx.outbox.drain();
    expect(ctx.outbox.getState().ops.map((o) => o.status)).toEqual(["failed", "failed"]);
    expect(observability.track.mock.calls.filter(([name]) => name === "set_sync_failed")).toHaveLength(1);
    expect(observability.track.mock.calls.some(([name]) => name === "set_sync_delayed")).toBe(false);
  });
});
