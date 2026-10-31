import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./Button";

describe("Minor 249 — the variant is on the element", () => {
  it("primary by default; secondary and danger when passed", () => {
    render(
      <>
        <Button>Go</Button>
        <Button variant="secondary">Back</Button>
        <Button variant="danger">Delete</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Go" })).toHaveAttribute("data-variant", "primary");
    expect(screen.getByRole("button", { name: "Back" })).toHaveAttribute("data-variant", "secondary");
    expect(screen.getByRole("button", { name: "Delete" })).toHaveAttribute("data-variant", "danger");
  });
});
