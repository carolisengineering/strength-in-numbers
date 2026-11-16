import { describe, expect, it, vi } from "vitest";
import { createLogoutGuard, type GuardOutbox } from "./logoutGuard";
import { unsavedMessage } from "./messages";

const outboxOf = (ops: { kind: string; status: string }[], online = false): GuardOutbox => ({
  getState: () => ({ ops, online, conflict: false }),
  subscribe: () => () => {},
  retryNow: vi.fn(),
});
const warned = (ops: { kind: string; status: string }[]) => {
  const guard = createLogoutGuard({ outbox: outboxOf(ops), proceed: vi.fn() });
  guard.request();
  expect(guard.getState().phase).toBe("warning");
  return guard.getState().unsaved;
};

describe("06.7 AC11 — the logout guard counts a waiting workout, as a workout", () => {
  it.each(["queued", "sending", "failed"])("a %s finish op counts in workouts and in no other bucket", (status) => {
    expect(warned([{ kind: "finish", status }])).toEqual({ sets: 0, notes: 0, workouts: 1 });
  });

  it("sets are counted by kind, never by subtraction; workouts is present only above zero", () => {
    expect(
      warned([
        { kind: "create", status: "queued" },
        { kind: "update", status: "failed" },
        { kind: "delete", status: "queued" },
        { kind: "note", status: "queued" },
        { kind: "round", status: "queued" },
        { kind: "finish", status: "queued" },
      ]),
    ).toEqual({ sets: 3, notes: 1, timerEntries: 1, workouts: 1 });
    expect(warned([{ kind: "create", status: "queued" }])).toEqual({ sets: 1, notes: 0 });
  });

  it.each([
    [{ sets: 0, notes: 0, workouts: 1 }, "1 finished workout hasn't sent. If you sign out now it'll be lost."],
    [{ sets: 0, notes: 0, workouts: 2 }, "2 finished workouts haven't sent. If you sign out now they'll be lost."],
    [{ sets: 2, notes: 0, workouts: 1 }, "1 finished workout and 2 sets haven't saved. If you sign out now they'll be lost."],
    [{ sets: 2, notes: 1, timerEntries: 1, workouts: 1 }, "1 finished workout, 2 sets, 1 note and 1 timer entry haven't saved. If you sign out now they'll be lost."],
  ])("unsavedMessage(%j)", (unsaved, expected) => {
    expect(unsavedMessage(unsaved)).toBe(expected);
  });

  it("the only digits are the counts", () => {
    expect(unsavedMessage({ sets: 2, notes: 0, workouts: 1 }).replace(/\D/g, "")).toBe("12");
  });
});
