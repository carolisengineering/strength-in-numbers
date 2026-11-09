import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { segmentChoice, segmented } from "../../../test/controls";
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
    const radios = within(segmented("Timer", d)).getAllByRole("radio");
    expect(radios).toHaveLength(4);
    for (const radio of radios) expect(radio).toBeDisabled();
    expect(d.getByLabelText("Rounds")).toBeDisabled();
    expect(d.getByLabelText("Round length")).toBeDisabled();
    expect(d.getByText("Wait for the logged times to save before changing the timer.")).toBeInTheDocument();
    expect(d.getByLabelText("Name")).toBeEnabled();
    expect(d.getByLabelText("Note")).toBeEnabled();
  });

  it("17.7 AC6 — a click on a locked format changes nothing", async () => {
    render(
      <SectionSheet open mode="edit" section={makeTimedSection({ name: "Main" })} busy={false} errors={NO_ERRORS} onSubmit={vi.fn()} onClose={vi.fn()} timerLocked={RESULT_COPY.timerLocked} />,
    );
    const before = segmentChoice("Timer");
    expect(before).not.toBeNull();
    await userEvent.click(within(segmented("Timer")).getByRole("radio", { name: "AMRAP" }));
    expect(segmentChoice("Timer")).toBe(before);
    expect(screen.getByLabelText("Rounds")).toBeInTheDocument();
  });

  it("not locked: no line, the format is enabled", () => {
    render(<SectionSheet open mode="edit" section={makeTimedSection({ name: "Main" })} busy={false} errors={NO_ERRORS} onSubmit={vi.fn()} onClose={vi.fn()} />);
    for (const radio of within(segmented("Timer")).getAllByRole("radio")) expect(radio).toBeEnabled();
    expect(screen.queryByText(/Wait for the logged times/)).toBeNull();
  });
});
