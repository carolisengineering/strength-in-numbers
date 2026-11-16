import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useViewingSummary, viewing } from "./summaryViewing";

function Summary({ id }: { id: string }) {
  useViewingSummary(id);
  return null;
}

describe("06.7 AC27 — the summary says while it is open (summaryViewing)", () => {
  it("is true only while a summary of that workout is mounted", () => {
    expect(viewing("w1")).toBe(false);
    const view = render(<Summary id="w1" />);
    expect(viewing("w1")).toBe(true);
    expect(viewing("w2")).toBe(false);
    view.unmount();
    expect(viewing("w1")).toBe(false);
  });

  it("two mounts of the same summary (a route change overlap) stay viewing until both leave", () => {
    const a = render(<Summary id="w1" />);
    const b = render(<Summary id="w1" />);
    a.unmount();
    expect(viewing("w1")).toBe(true);
    b.unmount();
    expect(viewing("w1")).toBe(false);
  });

  it("follows a change of id", () => {
    const view = render(<Summary id="w1" />);
    view.rerender(<Summary id="w2" />);
    expect(viewing("w1")).toBe(false);
    expect(viewing("w2")).toBe(true);
    view.unmount();
  });
});
