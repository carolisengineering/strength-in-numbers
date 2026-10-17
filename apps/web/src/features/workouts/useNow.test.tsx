import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useNow } from "./useNow";

let t = 0;
const now = () => t;
let renders = 0;
function Probe({ active }: { active: boolean }) {
  renders += 1;
  return <p>{useNow(1000, active, now)}</p>;
}
function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  act(() => document.dispatchEvent(new Event("visibilitychange")));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  t = 0;
  renders = 0;
  setVisibility("visible");
});
afterEach(() => vi.useRealTimers());

describe("17.1 AC43 — the tick runs at most once a second, only while active and visible", () => {
  it("re-renders once per second while active and returns the injected clock", () => {
    render(<Probe active />);
    const before = renders;
    t = 3000;
    for (let i = 0; i < 3; i += 1) act(() => vi.advanceTimersByTime(1000)); // one act per tick: React batches updates inside one act
    expect(renders - before).toBe(3);
    expect(screen.getByText("3000")).toBeInTheDocument();
  });

  it("does not tick when inactive", () => {
    render(<Probe active={false} />);
    const before = renders;
    act(() => vi.advanceTimersByTime(5000));
    expect(renders).toBe(before);
  });

  it("stops while hidden and recomputes at once when visible again (Review Focus 3)", () => {
    render(<Probe active />);
    setVisibility("hidden");
    const before = renders;
    act(() => vi.advanceTimersByTime(10_000));
    expect(renders).toBe(before);
    t = 95_000;
    setVisibility("visible");
    expect(screen.getByText("95000")).toBeInTheDocument();
  });

  it("clears its interval on unmount", () => {
    const { unmount } = render(<Probe active />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
