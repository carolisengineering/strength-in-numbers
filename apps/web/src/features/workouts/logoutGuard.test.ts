import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogoutGuard, SYNC_WAIT_MS, type GuardOutbox } from "./logoutGuard";

type Op = { kind: string; status: string };
const op = (kind: string = "create", status: string = "queued"): Op => ({ kind, status });

function fakeOutbox(initial: { ops?: Op[]; online?: boolean; conflict?: boolean } = {}) {
  let state = { ops: [] as Op[], online: true, conflict: false, ...initial };
  const listeners = new Set<() => void>();
  const outbox = {
    getState: () => state,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    retryNow: vi.fn(),
  } satisfies GuardOutbox;
  return {
    outbox,
    listeners: () => listeners.size,
    set(next: Partial<typeof state>) {
      state = { ...state, ...next };
      for (const l of [...listeners]) l();
    },
  };
}
const make = (initial?: Parameters<typeof fakeOutbox>[0]) => {
  const fake = fakeOutbox(initial);
  const proceed = vi.fn();
  const guard = createLogoutGuard({ outbox: fake.outbox, proceed });
  return { ...fake, proceed, guard };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("06.5 AC12 — nothing unsaved: sign out at once", () => {
  it("calls proceed synchronously, stays idle, never opens a dialog", () => {
    const { guard, proceed, outbox } = make();
    guard.request();
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(guard.getState().phase).toBe("idle");
    expect(outbox.retryNow).not.toHaveBeenCalled();
  });
});

describe("06.5 AC13 — unsaved and online: sync first", () => {
  it("retries once, shows syncing, and signs out when the outbox empties", () => {
    const { guard, proceed, outbox, set } = make({ ops: [op(), op("update", "sending")] });
    guard.request();
    expect(outbox.retryNow).toHaveBeenCalledTimes(1);
    expect(guard.getState()).toEqual({ phase: "syncing", unsaved: { sets: 2, notes: 0 } });
    vi.advanceTimersByTime(3000);
    set({ ops: [] });
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(guard.getState().phase).toBe("idle");
  });
});

describe("06.5 AC14 — still unsaved after the wait: warn", () => {
  it("moves to warning at SYNC_WAIT_MS with the count; confirm signs out, Stay returns to idle", () => {
    const a = make({ ops: [op(), op(), op("note")] });
    a.guard.request();
    vi.advanceTimersByTime(SYNC_WAIT_MS - 1);
    expect(a.guard.getState().phase).toBe("syncing");
    vi.advanceTimersByTime(1);
    expect(a.guard.getState()).toEqual({ phase: "warning", unsaved: { sets: 2, notes: 1 } });
    a.guard.confirm();
    expect(a.proceed).toHaveBeenCalledTimes(1);

    const b = make({ ops: [op()] });
    b.guard.request();
    vi.advanceTimersByTime(SYNC_WAIT_MS);
    b.guard.cancel();
    expect(b.guard.getState().phase).toBe("idle");
    expect(b.proceed).not.toHaveBeenCalled();
  });
});

describe("06.5 AC15 — cases that skip the wait", () => {
  it.each([
    ["offline", { online: false, ops: [op()] }],
    ["a second-tab conflict", { conflict: true, ops: [op()] }],
    ["only failed ops", { ops: [op("create", "failed")] }],
  ])("%s goes straight to warning without retryNow", (_name, initial) => {
    const { guard, outbox, listeners } = make(initial);
    guard.request();
    expect(guard.getState().phase).toBe("warning");
    expect(outbox.retryNow).not.toHaveBeenCalled();
    expect(listeners()).toBe(1); // still watching, so AC18(b) can fire
  });
});

describe("06.5 AC16 — failed ops count", () => {
  it("a failed-only outbox never proceeds silently", () => {
    const { guard, proceed } = make({ ops: [op("create", "failed")] });
    guard.request();
    vi.advanceTimersByTime(SYNC_WAIT_MS * 2);
    expect(proceed).not.toHaveBeenCalled();
    expect(guard.getState().unsaved).toEqual({ sets: 1, notes: 0 });
  });
});

describe("06.5 AC17 — Cancel and Stay leave the outbox running", () => {
  it.each(["syncing", "warning"] as const)("cancel in %s returns to idle and never signs out later", (phase) => {
    const { guard, proceed, set, listeners } = make({ ops: [op()], online: phase === "syncing" });
    guard.request();
    expect(guard.getState().phase).toBe(phase);
    guard.cancel();
    expect(guard.getState().phase).toBe("idle");
    expect(listeners()).toBe(0);
    set({ ops: [] });
    vi.advanceTimersByTime(SYNC_WAIT_MS * 2);
    expect(proceed).not.toHaveBeenCalled();
  });

  it("is reusable: a second request starts from idle (Review Focus 4)", () => {
    const { guard, outbox } = make({ ops: [op()] });
    guard.request();
    guard.cancel();
    guard.request();
    expect(guard.getState().phase).toBe("syncing");
    expect(outbox.retryNow).toHaveBeenCalledTimes(2);
  });
});

describe("06.5 AC18 — races", () => {
  it("(a) taps while syncing or warning are ignored", () => {
    const { guard, outbox } = make({ ops: [op()] });
    guard.request();
    guard.request();
    expect(outbox.retryNow).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SYNC_WAIT_MS);
    guard.request();
    expect(guard.getState().phase).toBe("warning");
  });

  it("(b) the outbox emptying while the warning is up signs out without asking again", () => {
    const { guard, proceed, set } = make({ ops: [op()], online: false });
    guard.request();
    expect(guard.getState().phase).toBe("warning");
    set({ ops: [] });
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it("(c) an op that appears between the empty read and the redirect takes the warning path", () => {
    const fake = fakeOutbox({ ops: [op()] });
    const proceed = vi.fn();
    const guard = createLogoutGuard({ outbox: fake.outbox, proceed });
    guard.request(); // syncing
    const reads = vi.spyOn(fake.outbox, "getState");
    // first read: empty (the listener's check); second read, right before leaving: an op is back
    reads.mockReturnValueOnce({ ops: [], online: true, conflict: false }).mockReturnValue({ ops: [op("create", "failed")], online: true, conflict: false });
    fake.set({ ops: [] });
    expect(proceed).not.toHaveBeenCalled();
    expect(guard.getState().phase).toBe("warning");
  });

  it("(d) after proceed nothing it scheduled fires, and proceed is called once", () => {
    const { guard, proceed, set, listeners } = make({ ops: [op()] });
    guard.request();
    set({ ops: [] });
    vi.advanceTimersByTime(SYNC_WAIT_MS * 2);
    set({ ops: [op()] });
    guard.request();
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(listeners()).toBe(0);
  });

  it("the last unsaved op failing while the spinner is up goes to warning at once (Review Focus 5)", () => {
    const { guard, set } = make({ ops: [op()] });
    guard.request();
    expect(guard.getState().phase).toBe("syncing");
    set({ ops: [op("create", "failed")] });
    expect(guard.getState().phase).toBe("warning");
  });

  it("confirm is ignored unless the warning is showing", () => {
    const { guard, proceed } = make({ ops: [op()] });
    guard.confirm();
    guard.request(); // syncing
    guard.confirm();
    expect(proceed).not.toHaveBeenCalled();
  });
});

describe("06.5 AC24 — counting", () => {
  it("queued, sending and failed each count; note ops are counted apart", () => {
    const { guard } = make({ ops: [op("create", "queued"), op("update", "sending"), op("delete", "failed"), op("note", "queued")] });
    guard.request();
    expect(guard.getState().unsaved).toEqual({ sets: 3, notes: 1 });
  });
});
