import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../../observability/track", () => ({ track: observability.track }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import { ApiError } from "../../../api";
import { memoryStorageAdapter } from "../../../storage/storage";
import { makeSet, makeTimedSection } from "../../../test/workoutFixtures";
import { createOutbox, OUTBOX_KEY, type OutboxDeps } from "./outbox";

const api = (status: number, slug = "about:blank") =>
  new ApiError({ status, type: slug === "about:blank" ? slug : `https://strengthinnumbers.app/problems/${slug}`, title: "t", requestId: "req" });
const KEY = "30000000-0000-4000-8000-000000000001";

function setup(over: Partial<OutboxDeps> = {}, storage = memoryStorageAdapter()) {
  let online = true;
  const order: string[] = [];
  const rest = {
    createSet: vi.fn(async () => (order.push("create"), makeSet())),
    updateSet: vi.fn(async () => makeSet()),
    deleteSet: vi.fn(async (): Promise<void> => undefined),
    setExerciseNote: vi.fn(async () => (order.push("note"), {}) as never),
    putRoundTime: vi.fn(async (sectionId: string, round: number, seconds: number) => (order.push(`round ${round}=${seconds}`), makeTimedSection({ id: sectionId }))),
    deleteRoundTime: vi.fn(async (_s: string, round: number) => void order.push(`clear ${round}`)),
    putResult: vi.fn(async (sectionId: string) => (order.push("result"), makeTimedSection({ id: sectionId }))),
    deleteResult: vi.fn(async () => void order.push("clear result")),
  };
  const onSectionSynced = vi.fn();
  const onFailed = vi.fn();
  const onDiscarded = vi.fn();
  const outbox = createOutbox({ storage, rest, userId: "u1", isOnline: () => online, random: () => 0.5, onSectionSynced, onFailed, onDiscarded, ...over });
  const stop = outbox.start();
  return { outbox, rest, storage, order, onSectionSynced, onFailed, onDiscarded, stop, setOnline: (v: boolean) => (online = v) };
}
type Ctx = ReturnType<typeof setup>;
const S = "50000000-0000-4000-8000-000000000001";
const round = (c: Ctx, r: number, seconds: number | null, workoutId = "w", sectionId = S) => c.outbox.enqueueRound({ workoutId, sectionId, round: r, body: { seconds } });
const result = (c: Ctx, body: Parameters<Ctx["outbox"]["enqueueResult"]>[0]["body"], workoutId = "w") => c.outbox.enqueueResult({ workoutId, sectionId: S, body });
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers({ now: Date.parse("2026-10-03T09:00:00Z") }));
afterEach(() => {
  vi.useRealTimers();
  observability.track.mockReset();
  observability.reportError.mockReset();
});

describe("10.7 AC37 — draining round and result ops", () => {
  it("a mixed queue goes FIFO, one in flight", async () => {
    const c = setup();
    c.setOnline(false);
    c.outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: { clientGeneratedId: KEY, weight: 60, weightUnit: "kg", reps: 8, isComplete: true } });
    round(c, 1, 250);
    c.outbox.enqueueNote({ workoutId: "w", workoutExerciseId: "we", body: { notes: "x" } });
    result(c, { rounds: 5, reps: 7 });
    c.setOnline(true);
    await c.outbox.drain();
    await settle();
    expect(c.order).toEqual(["create", "round 1=250", "note", "result"]);
    expect(c.outbox.getState().ops).toEqual([]);
  });

  it("a PUT success removes the op and reports the section; a DELETE reports null, not gone", async () => {
    const c = setup();
    round(c, 1, 250);
    await settle();
    expect(c.onSectionSynced).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "round", round: 1 }), expect.objectContaining({ id: S }), false);
    round(c, 1, null);
    await settle();
    expect(c.rest.deleteRoundTime).toHaveBeenCalledWith(S, 1);
    expect(c.onSectionSynced).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "round", body: { seconds: null } }), null, false);
    result(c, null);
    await settle();
    expect(c.rest.deleteResult).toHaveBeenCalledWith(S);
    expect(c.outbox.getState().ops).toEqual([]);
  });

  it("a 404 is done: the op leaves and the section is reported gone", async () => {
    const c = setup();
    c.rest.putRoundTime.mockRejectedValueOnce(api(404, "not-found"));
    round(c, 1, 250);
    await settle();
    expect(c.outbox.getState().ops).toEqual([]);
    expect(c.onSectionSynced).toHaveBeenCalledWith(expect.objectContaining({ kind: "round" }), null, true);
    expect(c.onFailed).not.toHaveBeenCalled();
  });

  it("a 500 re-queues with backoff", async () => {
    const c = setup();
    c.rest.putRoundTime.mockRejectedValueOnce(api(500));
    round(c, 1, 250);
    await settle();
    expect(c.outbox.getState().ops[0]).toMatchObject({ status: "queued", attempted: true, attempts: 1 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(c.outbox.getState().ops).toEqual([]);
  });

  it("a 422 fails the op; a later op of another key still goes", async () => {
    const c = setup();
    c.rest.putRoundTime.mockRejectedValueOnce(api(422, "validation-error"));
    round(c, 1, 250);
    result(c, { rounds: 5, reps: 7 });
    await settle();
    expect(c.outbox.getState().ops).toHaveLength(1);
    expect(c.outbox.getState().ops[0]).toMatchObject({ kind: "round", status: "failed", failure: { status: 422 } });
    expect(c.rest.putResult).toHaveBeenCalledTimes(1);
    expect(observability.track.mock.calls.filter(([e]) => e === "set_sync_failed")).toEqual([["set_sync_failed", { status: 422 }]]);
  });

  it("409 workout-finished cascades to the workout's later section ops", async () => {
    const c = setup();
    c.setOnline(false);
    round(c, 1, 250);
    result(c, { rounds: 5, reps: 7 });
    c.rest.putRoundTime.mockRejectedValueOnce(api(409, "workout-finished"));
    c.setOnline(true);
    await c.outbox.drain();
    expect(c.outbox.getState().ops.map((o) => o.status)).toEqual(["failed", "failed"]);
    expect(observability.track.mock.calls.filter(([e]) => e === "set_sync_failed")).toHaveLength(2);
  });

  it("discard of a failed round op removes only it, never throws, and tells the screen", async () => {
    const c = setup();
    c.rest.putRoundTime.mockRejectedValueOnce(api(409, "section-timer-mismatch"));
    round(c, 1, 250);
    await settle();
    c.setOnline(false);
    c.outbox.enqueueNote({ workoutId: "w", workoutExerciseId: "we", body: { notes: "x" } });
    const failed = c.outbox.getState().ops[0]!;
    expect(() => c.outbox.discard(failed.id)).not.toThrow();
    expect(c.outbox.getState().ops.map((o) => o.kind)).toEqual(["note"]);
    expect(c.onDiscarded).toHaveBeenCalledWith([expect.objectContaining({ id: failed.id })]);
  });

  it("settle keeps queued section ops of other workouts; dropWorkout removes them", () => {
    const c = setup();
    c.setOnline(false);
    round(c, 1, 250, "other");
    c.outbox.settle("w");
    expect(c.outbox.getState().ops).toHaveLength(1);
    c.outbox.dropWorkout("other");
    expect(c.outbox.getState().ops).toEqual([]);
  });

  it("record r2, clear r2, then record r1 offline: every op is sent, in that order (carried from 09.5 B review)", async () => {
    const c = setup();
    c.setOnline(false);
    round(c, 2, 515);
    round(c, 2, null);
    round(c, 1, 250);
    expect(c.outbox.getState().ops.map((o) => (o.kind === "round" ? `${o.round}=${o.body.seconds}` : o.kind))).toEqual(["2=null", "1=250"]);
    c.setOnline(true);
    await c.outbox.drain();
    expect(c.order).toEqual(["clear 2", "round 1=250"]);
  });
});

describe("10.7 AC41 — reload restores section ops", () => {
  it("a queued round op is there after a reload; a sending one comes back queued and attempted; another user's file is dropped", () => {
    const storage = memoryStorageAdapter();
    const first = setup({}, storage);
    first.setOnline(false);
    round(first, 2, 515);
    first.stop();
    const saved = JSON.parse(storage.get(OUTBOX_KEY)!);
    saved.ops[0].status = "sending";
    storage.set(OUTBOX_KEY, JSON.stringify(saved));
    const second = createOutbox({ storage, rest: first.rest, userId: "u1", isOnline: () => false });
    expect(second.getState().ops[0]).toMatchObject({ kind: "round", round: 2, body: { seconds: 515 }, status: "queued", attempted: true });
    const stranger = createOutbox({ storage, rest: first.rest, userId: "u2", isOnline: () => false });
    expect(stranger.getState().ops).toEqual([]);
  });
});
