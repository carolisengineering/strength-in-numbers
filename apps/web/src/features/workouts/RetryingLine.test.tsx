import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RetryingLine } from "./RetryingLine";

describe("minor 564 — the Trying again line", () => {
  it("is a polite live region, mounted empty from first paint, that says Trying again… only while retrying", () => {
    const { rerender, container } = render(<RetryingLine retrying={false} />);
    const region = container.querySelector("[data-retrying-line]")!;
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toBeEmptyDOMElement();
    rerender(<RetryingLine retrying />);
    expect(screen.getByText("Trying again…")).toBe(region);
    rerender(<RetryingLine retrying={false} />);
    expect(container.querySelector("[data-retrying-line]")).toBe(region);
    expect(region).toBeEmptyDOMElement();
  });
});
