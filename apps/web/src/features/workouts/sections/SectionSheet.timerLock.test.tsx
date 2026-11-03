import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeTimedSection } from "../../../test/workoutFixtures";
import { RESULT_COPY } from "../result/resultCopy";
import { SectionSheet } from "./SectionSheet";

const NO_ERRORS = { name: null, notes: null, form: null };

describe("10.7 AC40 — the Timer group is locked under unsent entries", () => {
  it("timerLocked disables the select and its fields and shows the line; name and note stay editable", () => {
    render(
      <SectionSheet open mode="edit" section={makeTimedSection({ name: "Main" })} busy={false} errors={NO_ERRORS} onSubmit={vi.fn()} onClose={vi.fn()} timerLocked={RESULT_COPY.timerLocked} />,
    );
    const d = within(screen.getByRole("dialog", { name: "Edit section" }));
    expect(d.getByLabelText("Timer")).toBeDisabled();
    expect(d.getByLabelText("Rounds")).toBeDisabled();
    expect(d.getByLabelText("Round length")).toBeDisabled();
    expect(d.getByText("Wait for the logged times to save before changing the timer.")).toBeInTheDocument();
    expect(d.getByLabelText("Name")).toBeEnabled();
    expect(d.getByLabelText("Note")).toBeEnabled();
  });

  it("not locked: no line, the select is enabled", () => {
    render(<SectionSheet open mode="edit" section={makeTimedSection({ name: "Main" })} busy={false} errors={NO_ERRORS} onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText("Timer")).toBeEnabled();
    expect(screen.queryByText(/Wait for the logged times/)).toBeNull();
  });
});
