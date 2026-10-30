import { afterEach, describe, expect, it, vi } from "vitest";

import { __resetFinishListeners, emitWorkoutFinished, onWorkoutFinished } from "./finishEvents";

afterEach(() => __resetFinishListeners());

describe("20.2 AC24 — the bus", () => {
  it("two listeners both receive one event", () => {
    const a = vi.fn();
    const b = vi.fn();
    onWorkoutFinished(a);
    onWorkoutFinished(b);
    emitWorkoutFinished({ workoutId: "w1" });
    expect(a.mock.calls).toEqual([[{ workoutId: "w1" }]]);
    expect(b.mock.calls).toEqual([[{ workoutId: "w1" }]]);
  });

  it("unsubscribe stops one", () => {
    const a = vi.fn();
    const b = vi.fn();
    const off = onWorkoutFinished(a);
    onWorkoutFinished(b);
    off();
    emitWorkoutFinished({ workoutId: "w1" });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });

  it("a throwing listener does not stop the next, and emit does not throw", () => {
    const next = vi.fn();
    onWorkoutFinished(() => {
      throw new Error("boom");
    });
    onWorkoutFinished(next);
    expect(() => emitWorkoutFinished({ workoutId: "w1" })).not.toThrow();
    expect(next).toHaveBeenCalledOnce();
  });

  it("emit with no listener is a no-op", () => {
    expect(() => emitWorkoutFinished({ workoutId: "w1" })).not.toThrow();
  });
});
