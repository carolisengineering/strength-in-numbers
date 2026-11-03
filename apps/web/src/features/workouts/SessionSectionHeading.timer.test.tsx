import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SectionTimer } from "@sin/core";
import { markupOf } from "../../test/markup";
import type { SectionTiming } from "./sectionSegments";
import { SessionSection } from "./SessionSectionHeading";

const SET5: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };
const timing: SectionTiming = {
  timer: SET5,
  result: null,
  roundTimes: [
    { round: 1, seconds: 221 },
    { round: 2, seconds: 218 },
    { round: 3, seconds: 210 },
  ],
};

describe("10.7 AC19 — the timed heading", () => {
  it("the plan with its score, then the times line, then the note, in DOM order", () => {
    render(
      <SessionSection heading="Main" notes="Sprints" timing={timing}>
        {[]}
      </SessionSection>,
    );
    const region = screen.getByRole("region", { name: "Main" });
    const plan = within(region).getByText("Set Timer 5 × 5:00 · total 10:49");
    const times = within(region).getByText("Rounds 3:41 · 3:38 · 3:30");
    const note = within(region).getByText("Sprints");
    expect(plan.compareDocumentPosition(times) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(times.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("nothing recorded: only the plan, no times line", () => {
    render(
      <SessionSection heading="Main" notes={null} timing={{ ...timing, roundTimes: [] }}>
        {[]}
      </SessionSection>,
    );
    expect(screen.getByText("Set Timer 5 × 5:00")).toBeInTheDocument();
    expect(screen.queryByText(/^Rounds /)).toBeNull();
  });

  it("an AMRAP result reads as its score", () => {
    render(
      <SessionSection heading="Finisher" notes={null} timing={{ timer: { format: "amrap", capSeconds: 720 }, result: { rounds: 5, reps: 7, capped: false, finishSeconds: null }, roundTimes: [] }}>
        {[]}
      </SessionSection>,
    );
    expect(screen.getByText("AMRAP 12:00 · 5 rounds + 7 reps")).toBeInTheDocument();
  });

  it("with onLogResult: a secondary Log result button named for the section, after the times line", async () => {
    const onLogResult = vi.fn();
    render(
      <SessionSection heading="Main" notes="Sprints" timing={timing} onLogResult={onLogResult}>
        {[]}
      </SessionSection>,
    );
    const button = screen.getByRole("button", { name: "Log result for Main" });
    expect(button).toHaveTextContent(/^Log result$/);
    expect(button).toHaveAttribute("data-variant", "secondary");
    const times = screen.getByText("Rounds 3:41 · 3:38 · 3:30");
    expect(times.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.compareDocumentPosition(screen.getByText("Sprints")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(button);
    expect(onLogResult).toHaveBeenCalledTimes(1);
  });

  it("without onLogResult there is no button", () => {
    render(
      <SessionSection heading="Main" notes={null} timing={timing}>
        {[]}
      </SessionSection>,
    );
    expect(screen.queryByRole("button", { name: /Log result/ })).toBeNull();
  });

  it("without timing the markup is the untimed heading's", () => {
    const { container: a } = render(
      <SessionSection heading="Main" notes="Sprints">
        {[]}
      </SessionSection>,
    );
    const untimed = markupOf(a);
    const { container: b } = render(
      <SessionSection heading="Main" notes="Sprints" capLine={false}>
        {[]}
      </SessionSection>,
    );
    expect(markupOf(b)).toBe(untimed);
    expect(untimed).not.toMatch(/Set Timer|Rounds|Log result/);
  });
});

describe("10.7 AC23 — the cap line (component)", () => {
  it("capLine draws the muted line after the cards", () => {
    render(
      <SessionSection heading="Main" notes={null} timing={timing} capLine>
        <p>card</p>
      </SessionSection>,
    );
    const line = screen.getByText("Only the first 8 exercises are grouped.");
    expect(screen.getByText("card").compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
