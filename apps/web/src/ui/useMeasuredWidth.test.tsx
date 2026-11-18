import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMeasuredWidth } from "./useMeasuredWidth";

type Callback = (entries: { contentRect: { width: number } }[]) => void;

let observers: { callback: Callback; observed: Element[]; disconnected: boolean }[] = [];

class FakeResizeObserver {
  private readonly record: (typeof observers)[number];
  constructor(callback: Callback) {
    this.record = { callback, observed: [], disconnected: false };
    observers.push(this.record);
  }
  observe(el: Element) {
    this.record.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.record.disconnected = true;
  }
}

const report = (width: number) =>
  act(() => {
    for (const o of observers) if (!o.disconnected) o.callback([{ contentRect: { width } }]);
  });

function Probe({ seen }: { seen: number[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useMeasuredWidth(ref);
  seen.push(width);
  return <div ref={ref} data-testid="box" data-width={width} />;
}

afterEach(() => {
  vi.unstubAllGlobals();
  observers = [];
});

describe("17.12 AC23 — useMeasuredWidth", () => {
  it("is 360 where there is no ResizeObserver (jsdom), so today's chart is unchanged", () => {
    expect(typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver).toBe("undefined");
    const seen: number[] = [];
    const { getByTestId } = render(<Probe seen={seen} />);
    expect(getByTestId("box").dataset.width).toBe("360");
  });

  it("follows the observed width, rounded down, and observes the ref's element", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const seen: number[] = [];
    const { getByTestId } = render(<Probe seen={seen} />);
    expect(observers[0]!.observed).toEqual([getByTestId("box")]);
    report(612.7);
    expect(getByTestId("box").dataset.width).toBe("612");
  });

  it("keeps its last width when the container measures 0 (laid out or display: none), never NaN", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const seen: number[] = [];
    const { getByTestId } = render(<Probe seen={seen} />);
    report(612.7);
    report(0);
    expect(getByTestId("box").dataset.width).toBe("612");
    report(Number.NaN);
    expect(getByTestId("box").dataset.width).toBe("612");
    expect(seen.every((w) => Number.isFinite(w) && w > 0)).toBe(true);
  });

  it("measures the box on mount, before paint, so a wide chart never shows a frame at 360 (final review)", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 612.7 } as DOMRect);
    try {
      const { getByTestId } = render(<Probe seen={[]} />);
      // No observer callback has run: the layout effect's own read set it, in the same commit.
      expect(getByTestId("box").dataset.width).toBe("612");
    } finally {
      rect.mockRestore();
    }
  });

  it("stops observing on unmount", () => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { unmount } = render(<Probe seen={[]} />);
    unmount();
    expect(observers[0]!.disconnected).toBe(true);
  });
});
