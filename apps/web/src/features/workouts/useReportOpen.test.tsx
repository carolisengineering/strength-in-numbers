import { useEffect } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useReportOpen } from "./useReportOpen";

describe("minor 768 — a card's sheet is reported before the paint", () => {
  it("minor 768: the open report lands before any passive effect of that commit", () => {
    const spy = vi.fn();
    const seen: number[] = [];
    // A child's passive effect runs before its parent's passive effects, but after every layout effect of the commit:
    // the report has landed by then only if it is a layout effect.
    function Probe() {
      useEffect(() => {
        seen.push(spy.mock.calls.length);
      }, []);
      return null;
    }
    function Host({ open }: { open: boolean }) {
      useReportOpen(open, spy);
      return open ? <Probe /> : null;
    }
    const view = render(<Host open={false} />);
    view.rerender(<Host open />);
    expect(seen).toEqual([1]);
    expect(spy).toHaveBeenCalledWith(true);
    view.unmount();
    expect(spy).toHaveBeenLastCalledWith(false);
  });
});
