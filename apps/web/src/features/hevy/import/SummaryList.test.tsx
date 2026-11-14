import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SummaryList } from "./SummaryList";

describe("minor 528 — summary dates follow the device", () => {
  it("a row's date reads like every other date, with its year (an import spans years); a row with no date starts with its title", async () => {
    render(
      <SummaryList
        label="Duplicates"
        rows={[
          { id: "a", date: "2026-10-04", title: "Push day", reason: "Duplicate" },
          { id: "b", date: "", title: "Legs", reason: "Duplicate" },
        ]}
      />,
    );
    await userEvent.setup().click(screen.getByText("Duplicates"));
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["Sun, Oct 4, 2026 · Push day · Duplicate", "Legs · Duplicate"]);
  });
});
