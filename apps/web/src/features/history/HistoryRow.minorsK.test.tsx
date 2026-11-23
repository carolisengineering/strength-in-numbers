import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkoutSummary } from "@sin/core";
import { PaneContext } from "../../ui/paneContext";
import { makeWorkoutSummary } from "../../test/workoutFixtures";
import { HistoryRow } from "./HistoryRow";

const scrollIntoView = vi.fn();
afterEach(() => scrollIntoView.mockReset());

function renderRow(workout: WorkoutSummary, selectedId: string | null = null, path = "/app/history") {
  Element.prototype.scrollIntoView = scrollIntoView;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PaneContext.Provider value={{ slot: selectedId === null ? null : "list", selectedId }}>
        <HistoryRow workout={workout} unitPreference="kg" />
      </PaneContext.Provider>
    </MemoryRouter>,
  );
}

describe("minor 599 — a blank title falls back to the routine name", () => {
  it('title "   " with routine "Push" reads "· Push"', () => {
    renderRow(makeWorkoutSummary({ title: "   ", routineName: "Push" }));
    expect(screen.getByRole("link")).toHaveTextContent(/·\s*Push/);
  });

  it("a blank title with no routine draws no label", () => {
    const { container } = renderRow(makeWorkoutSummary({ title: "   ", routineName: null }));
    expect(container.textContent).not.toMatch(/·\s*$/m);
    expect(screen.getByRole("link").textContent).not.toContain(" · ");
  });
});

describe("minor 653 — the selected row scrolls into view", () => {
  it("a selected row asks once, with block: nearest", () => {
    const w = makeWorkoutSummary({});
    renderRow(w, w.id, `/app/history/${w.id}`);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("an unselected row never does", () => {
    renderRow(makeWorkoutSummary({}), "another-id");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe("minor 695 — only a route-given id scrolls its row", () => {
  it("a derived selection on bare /app/history never scrolls", () => {
    const w = makeWorkoutSummary({});
    renderRow(w, w.id, "/app/history");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("the row the route names scrolls once, with block: nearest", () => {
    const w = makeWorkoutSummary({});
    renderRow(w, w.id, `/app/history/${w.id}`);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });
});
