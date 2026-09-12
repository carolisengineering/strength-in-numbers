import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Spinner } from "./Spinner";

/**
 * `Spinner` moved from `screens/` to `ui/` in Spec 04.1 §6.1 and gained
 * styling. Its contract for the 04.0 gates is unchanged: a polite live region
 * with `role="status"` whose text is the label.
 */
describe("Spinner (Spec 04.1 §6.1 — moved from screens/, contract unchanged)", () => {
  it("renders a polite status region with the default label", () => {
    render(<Spinner />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Loading…");
    expect(screen.getByTestId("spinner")).toBe(status);
  });

  it("renders a custom label and keeps the ring out of the accessibility tree", () => {
    const { container } = render(<Spinner label="Starting…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Starting…");
    const ring = container.querySelector('[aria-hidden="true"]');
    expect(ring).not.toBeNull();
  });
});
