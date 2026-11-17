import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { desktopListenerCount, resetDesktop, setDesktop } from "../test/desktop";
import { useIsDesktop } from "./breakpoints";

afterEach(() => resetDesktop());

describe("17.12 AC2 — useIsDesktop reads the desktop query", () => {
  it("is false where there is no matchMedia (jsdom), so every other test runs the phone layout", () => {
    expect(typeof window.matchMedia).not.toBe("function");
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(false);
  });

  it("is right on the first render, with no effect-then-update (no flash of the other layout)", () => {
    setDesktop(true);
    const seen: boolean[] = [];
    renderHook(() => {
      const wide = useIsDesktop();
      seen.push(wide);
      return wide;
    });
    expect(seen).toEqual([true]);
  });

  it("re-renders when the window crosses the breakpoint", () => {
    setDesktop(true);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(true);
    act(() => setDesktop(false));
    expect(result.current).toBe(false);
    act(() => setDesktop(true));
    expect(result.current).toBe(true);
  });

  it("removes its listener on unmount", () => {
    setDesktop(false);
    const { unmount } = renderHook(() => useIsDesktop());
    expect(desktopListenerCount()).toBe(1);
    unmount();
    expect(desktopListenerCount()).toBe(0);
  });
});
