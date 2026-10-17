import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Misconfigured } from "./Misconfigured";

describe("17.3 AC17 — the setup-error screen says the product name", () => {
  it("names Strength in Numbers, not the repo slug", () => {
    render(<Misconfigured />);
    const main = screen.getByRole("main");
    expect(main).toHaveTextContent("Strength in Numbers is missing configuration it needs to start.");
    expect(main).not.toHaveTextContent("strength-in-numbers");
  });
});
