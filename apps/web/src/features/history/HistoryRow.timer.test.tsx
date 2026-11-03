import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { SectionTimer, WorkoutSummary } from "@sin/core";
import { markupOf } from "../../test/markup";
import { makeTimedSectionSummary, makeWorkoutSummary } from "../../test/workoutFixtures";
import { HistoryRow } from "./HistoryRow";

const SET5: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };
const AMRAP12: SectionTimer = { format: "amrap", capSeconds: 720 };
const FIVE = [221, 218, 210, 205, 208].map((seconds, i) => ({ round: i + 1, seconds }));
const AMRAP_RESULT = { rounds: 5, reps: 7, capped: false, finishSeconds: null };

function renderRow(workout: WorkoutSummary) {
  return render(
    <MemoryRouter>
      <HistoryRow workout={workout} unitPreference="kg" />
    </MemoryRouter>,
  );
}

describe("10.7 AC21 — History rows", () => {
  it("scored sections in position order, at most two, then +n more; unscored ones never show", () => {
    const workout = makeWorkoutSummary({
      timedSections: [
        makeTimedSectionSummary({ position: 3, name: "Late", timer: AMRAP12, result: AMRAP_RESULT }),
        makeTimedSectionSummary({ position: 0, name: "Main", timer: SET5, roundTimes: FIVE }),
        makeTimedSectionSummary({ position: 1, name: "Unscored", timer: SET5 }),
        makeTimedSectionSummary({ position: 2, name: "Finisher", timer: AMRAP12, result: AMRAP_RESULT }),
      ],
    });
    renderRow(workout);
    const link = screen.getByRole("link");
    expect(within(link).getByText("Main · Set Timer 5 × 5:00 · total 17:42")).toBeInTheDocument();
    expect(within(link).getByText("Finisher · AMRAP 12:00 · 5 rounds + 7 reps")).toBeInTheDocument();
    expect(within(link).getByText("+1 more")).toBeInTheDocument();
    expect(within(link).queryByText(/Late|Unscored/)).toBeNull();
    const main = within(link).getByText(/^Main · /);
    expect(main.compareDocumentPosition(within(link).getByText(/^Finisher · /)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The lines sit below the meta line.
    expect(within(link).getByText("3 sets · 1,500 kg").compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("two scored sections: no +n more", () => {
    renderRow(
      makeWorkoutSummary({
        timedSections: [makeTimedSectionSummary({ position: 0, name: "Main", roundTimes: FIVE }), makeTimedSectionSummary({ position: 1, name: "B", timer: AMRAP12, result: AMRAP_RESULT })],
      }),
    );
    expect(screen.queryByText(/more$/)).toBeNull();
  });

  it("a row with only unscored timed sections renders exactly like a row with none", () => {
    const base = makeWorkoutSummary({ id: "10000000-0000-4000-8000-0000000000aa", clientGeneratedId: "10000000-0000-4000-8000-0000000000ab" });
    const { container: plain } = renderRow(base);
    const plainMarkup = markupOf(plain);
    const { container: unscored } = renderRow({ ...base, timedSections: [makeTimedSectionSummary({ position: 0, name: "Main" })] });
    expect(markupOf(unscored)).toBe(plainMarkup);
  });

  it("a section name is text, never markup", () => {
    renderRow(makeWorkoutSummary({ timedSections: [makeTimedSectionSummary({ name: "<img src=x onerror=alert(1)>", roundTimes: FIVE })] }));
    expect(screen.getByText("<img src=x onerror=alert(1)> · Set Timer 5 × 5:00 · total 17:42")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});
