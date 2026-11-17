import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { makeWorkoutSummary } from "../../test/workoutFixtures";
import { PaneContext } from "../../ui/paneContext";
import { HistoryRow } from "./HistoryRow";

const A = makeWorkoutSummary({ id: "10000000-0000-4000-8000-00000000000a", title: "Push A" });
const B = makeWorkoutSummary({ id: "10000000-0000-4000-8000-00000000000b", title: "Pull B" });

function renderRows(selectedId: string | null) {
  render(
    <MemoryRouter>
      <PaneContext.Provider value={{ slot: "list", selectedId }}>
        <HistoryRow workout={A} unitPreference="kg" />
        <HistoryRow workout={B} unitPreference="kg" />
      </PaneContext.Provider>
    </MemoryRouter>,
  );
  return { rowA: screen.getByRole("link", { name: /Push A/ }), rowB: screen.getByRole("link", { name: /Pull B/ }) };
}

describe("17.12 AC16 — the open workout's row is marked", () => {
  it("the selected row has aria-current and the selected look; the others don't", () => {
    const { rowA, rowB } = renderRows(B.id);
    expect(rowB).toHaveAttribute("aria-current", "page");
    expect(rowB.className).toMatch(/selected/);
    expect(rowA).not.toHaveAttribute("aria-current");
    expect(rowA.className).not.toMatch(/selected/);
  });

  it("the title line carries the hook the selected look makes bold", () => {
    const { rowB } = renderRows(B.id);
    expect(rowB.querySelector("[data-row-title]")).toHaveTextContent(/Pull B/);
  });

  it("with nothing selected (a phone), no row is marked", () => {
    const { rowA, rowB } = renderRows(null);
    expect(rowA).not.toHaveAttribute("aria-current");
    expect(rowB).not.toHaveAttribute("aria-current");
  });
});
