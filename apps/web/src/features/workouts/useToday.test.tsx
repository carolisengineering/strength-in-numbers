import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatStartedAt } from "./format";
import { useToday } from "./useToday";

// Every time here is built and formatted in the device zone, so the test holds in any zone.
const START = new Date(2026, 9, 2, 23, 50).toISOString();

beforeEach(() => vi.useFakeTimers({ now: new Date(2026, 9, 2, 23, 55) }));
afterEach(() => vi.useRealTimers());

describe("deferred minor 11 — the live header's 'Started' label turns dated after midnight", () => {
  it("re-renders at the next local midnight, so a 23:50 start gains its day", () => {
    const { result } = renderHook(() => formatStartedAt(START, { today: useToday() }));
    expect(result.current).toMatch(/^\d{2}:\d{2}$/);
    act(() => vi.advanceTimersByTime(5 * 60_000 + 1000));
    expect(result.current).toMatch(/^Fri 2 Oct, /);
  });

  it("re-checks the day when the page becomes visible (a sleeping phone's timer may not fire on time)", () => {
    const { result } = renderHook(() => useToday());
    const before = result.current;
    vi.setSystemTime(new Date(2026, 9, 3, 7, 0));
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current.getDate()).toBe(3);
    expect(before.getDate()).toBe(2);
  });

  it("stays the same Date object within one day (no re-render churn)", () => {
    const { result, rerender } = renderHook(() => useToday());
    const first = result.current;
    act(() => vi.advanceTimersByTime(60_000));
    rerender();
    expect(result.current).toBe(first);
  });
});
