import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../../observability/track", () => ({ track: observability.track }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import { memoryStorageAdapter } from "../../../storage/storage";
import { createLogoutGuard } from "../logoutGuard";
import { unsavedNotes, unsavedSets, type OutboxOp } from "./ops";
import { createOutbox, OUTBOX_KEY, type OutboxDeps } from "./outbox";

const KEY = "30000000-0000-4000-8000-000000000001";
const KEY2 = "30000000-0000-4000-8000-000000000002";
const body = (key = KEY) => ({ clientGeneratedId: key, weight: 60, weightUnit: "kg" as const, reps: 8, isComplete: true });
// A REST stub that never settles, so no op leaves the queue through a send unless a test swaps it.
const parkedRest = () => ({
  createSet: vi.fn(() => new Promise<never>(() => {})),
  updateSet: vi.fn(() => new Promise<never>(() => {})),
  deleteSet: vi.fn(() => new Promise<never>(() => {})),
  setExerciseNote: vi.fn(() => new Promise<never>(() => {})),
});
const counter = () => {
  let i = 0;
  return () => `op-${++i}`;
};
const make = (over: Partial<OutboxDeps> = {}) =>
  createOutbox({ storage: memoryStorageAdapter(), rest: parkedRest(), userId: "u1", isOnline: () => false, newId: counter(), ...over });

beforeEach(() => vi.useFakeTimers({ now: Date.parse("2026-10-03T09:00:00Z") }));
afterEach(() => {
  vi.useRealTimers();
  observability.reportError.mockReset();
});

/** Today's create and note ops, written by today's outbox and read back from its file. */
function todaysOps(): { createOp: OutboxOp; noteOp: OutboxOp } {
  const scratch = memoryStorageAdapter();
  const outbox = make({ storage: scratch });
  outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: body() });
  outbox.enqueueNote({ workoutId: "w", workoutExerciseId: "we", body: { notes: "Pause" } });
  const [createOp, noteOp] = JSON.parse(scratch.get(OUTBOX_KEY)!).ops as OutboxOp[];
  return { createOp: createOp!, noteOp: noteOp! };
}
/** A later bundle's op (Phase C's `round`), which this bundle does not know. */
const roundOp = (base: OutboxOp) => ({ ...base, id: "op-round", kind: "round", sectionId: "s1", round: 2, body: { seconds: 515 } });

function fileWithUnknown() {
  const { createOp, noteOp } = todaysOps();
  const storage = memoryStorageAdapter();
  storage.set(OUTBOX_KEY, JSON.stringify({ v: 1, userId: "u1", ops: [createOp, roundOp(createOp), noteOp], idMap: {} }));
  return { storage, createOp, noteOp };
}

describe("10.7 AC66 — the outbox reads one op at a time", () => {
  it("an unknown kind is skipped; the ops around it load in order with their ids and bodies", () => {
    const { storage, createOp, noteOp } = fileWithUnknown();
    const ops = make({ storage }).getState().ops;
    expect(ops.map((o) => o.kind)).toEqual(["create", "note"]);
    expect(ops.map((o) => [o.id, o.body])).toEqual([
      [createOp.id, createOp.body],
      [noteOp.id, noteOp.body],
    ]);
  });

  it("sends only the known ops", async () => {
    const { storage } = fileWithUnknown();
    const rest = {
      createSet: vi.fn(async () => ({ id: "set-1" }) as never),
      updateSet: vi.fn(async () => ({}) as never),
      deleteSet: vi.fn(async () => undefined),
      setExerciseNote: vi.fn(async () => ({}) as never),
    };
    const outbox = make({ storage, rest, isOnline: () => true });
    const stop = outbox.start();
    await outbox.drain();
    await vi.waitFor(() => expect(outbox.getState().ops).toEqual([]));
    stop();
    expect(rest.createSet).toHaveBeenCalledTimes(1);
    expect(rest.setExerciseNote).toHaveBeenCalledTimes(1);
    expect(rest.updateSet).not.toHaveBeenCalled();
    expect(rest.deleteSet).not.toHaveBeenCalled();
  });

  it("the skipped op is not counted by unsavedSets, unsavedNotes or the logout guard", () => {
    const { storage } = fileWithUnknown();
    const outbox = make({ storage });
    const { ops, idMap } = outbox.getState();
    expect(unsavedSets(ops, "w", idMap)).toEqual({ pending: 1, failed: 0 });
    expect(unsavedNotes(ops, "w")).toEqual({ pending: 1, failed: 0 });
    const guard = createLogoutGuard({ outbox, proceed: vi.fn() });
    guard.request();
    expect(guard.getState()).toEqual({ phase: "warning", unsaved: { sets: 1, notes: 1 } });
  });

  it("is not written back: the next persist omits it", () => {
    const { storage } = fileWithUnknown();
    const outbox = make({ storage });
    outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: body(KEY2) });
    expect((JSON.parse(storage.get(OUTBOX_KEY)!) as { ops: OutboxOp[] }).ops.map((o) => o.kind)).toEqual(["create", "note", "create"]);
  });

  it("reports once per load, with a static message and the static tag only", () => {
    const { storage } = fileWithUnknown();
    make({ storage });
    expect(observability.reportError).toHaveBeenCalledTimes(1);
    expect(observability.reportError).toHaveBeenCalledWith(expect.objectContaining({ message: "outbox ops of an unknown kind skipped" }), { source: "workout-storage" });
    const calls = JSON.stringify(observability.reportError.mock.calls, (_k, v: unknown) => (v instanceof Error ? { message: v.message } : v));
    expect(calls).not.toContain("s1");
    expect(calls).not.toContain("515");
    expect(calls).not.toContain("round");
  });

  it("a reload before anything is written skips again, reports again, and never throws (Review Focus 6)", () => {
    const { storage } = fileWithUnknown();
    make({ storage });
    expect(() => make({ storage })).not.toThrow();
    expect(make({ storage }).getState().ops.map((o) => o.kind)).toEqual(["create", "note"]);
    expect(observability.reportError).toHaveBeenCalledTimes(3);
    expect(JSON.parse(storage.get(OUTBOX_KEY)!).ops.map((o: { kind: string }) => o.kind)).toEqual(["create", "round", "note"]);
  });

  describe("still unreadable as today", () => {
    it.each<[string, (f: { createOp: OutboxOp; noteOp: OutboxOp }) => string]>([
      ["a known kind failing its schema, beside an unknown one", ({ createOp, noteOp }) => JSON.stringify({ v: 1, userId: "u1", ops: [{ ...createOp, body: { reps: "x" } }, roundOp(createOp), noteOp], idMap: {} })],
      ["an op with no kind", ({ createOp }) => JSON.stringify({ v: 1, userId: "u1", ops: [createOp, { status: "queued" }], idMap: {} })],
      ["an op whose kind is not a string", ({ createOp }) => JSON.stringify({ v: 1, userId: "u1", ops: [{ ...createOp, kind: 7 }], idMap: {} })],
      ["not JSON", () => "{not json"],
      ["a bad envelope", ({ createOp }) => JSON.stringify({ v: 2, userId: "u1", ops: [createOp], idMap: {} })],
    ])("%s: loads nothing, removes the key, reports unreadable once", (_name, file) => {
      const storage = memoryStorageAdapter();
      storage.set(OUTBOX_KEY, file(todaysOps()));
      observability.reportError.mockReset();
      expect(make({ storage }).getState().ops).toEqual([]);
      expect(storage.get(OUTBOX_KEY)).toBeNull();
      expect(observability.reportError).toHaveBeenCalledTimes(1);
      expect(observability.reportError).toHaveBeenCalledWith(expect.objectContaining({ message: "unreadable outbox" }), { source: "workout-storage" });
    });
  });

  it("today's files load identically: create, update, delete and note ops, one sending, with the id map", () => {
    const scratch = memoryStorageAdapter();
    const writer = make({ storage: scratch });
    writer.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: body() });
    writer.enqueueUpdate({ workoutId: "w", workoutExerciseId: "we", target: { setId: "set-9" }, body: { reps: 9 } });
    writer.enqueueDelete({ workoutId: "w", workoutExerciseId: "we2", target: { setId: "set-8" } });
    writer.enqueueNote({ workoutId: "w", workoutExerciseId: "we", body: { notes: null } });
    const file = JSON.parse(scratch.get(OUTBOX_KEY)!) as { ops: OutboxOp[]; idMap: Record<string, unknown> };
    file.ops[0] = { ...file.ops[0]!, status: "sending" };
    file.idMap = { [KEY2]: { setId: "set-7", workoutId: "w" } };
    const storage = memoryStorageAdapter();
    storage.set(OUTBOX_KEY, JSON.stringify(file));
    observability.reportError.mockReset();
    const state = make({ storage }).getState();
    // The golden: what the pre-change load() produced (sending → queued + attempted; all else as saved).
    expect(state.ops).toEqual([{ ...file.ops[0], status: "queued", attempted: true }, ...file.ops.slice(1)]);
    expect(state.idMap).toEqual(file.idMap);
    expect(observability.reportError).not.toHaveBeenCalled();
  });
});
