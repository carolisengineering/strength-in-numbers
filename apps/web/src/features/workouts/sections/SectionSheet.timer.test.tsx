import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeTimedSection } from "../../../test/workoutFixtures";
import { ROUNDS_RANGE_ERROR } from "../../sectionTimer/timerCopy";
import { SectionSheet, type SectionSheetProps } from "./SectionSheet";

const NO_ERRORS = { name: null, notes: null, form: null };

function renderSheet(props: Partial<SectionSheetProps> = {}) {
  const callbacks = { onSubmit: vi.fn(), onClose: vi.fn(), onRemove: vi.fn() };
  render(<SectionSheet open mode="add" busy={false} errors={NO_ERRORS} {...callbacks} {...props} />);
  return { user: userEvent.setup(), ...callbacks };
}
const dialog = (name: string) => within(screen.getByRole("dialog", { name }));

describe("10.7 AC15 — the Timer group in the workout sheet", () => {
  it("Add submits the parsed timer with the name and note", async () => {
    const { user, onSubmit } = renderSheet();
    const d = dialog("New section");
    await user.type(d.getByLabelText("Name"), "Finisher");
    await user.selectOptions(d.getByLabelText("Timer"), "amrap");
    await user.type(d.getByLabelText("Time limit"), "1200");
    await user.click(d.getByRole("button", { name: "Add section" }));
    expect(onSubmit).toHaveBeenCalledWith({ name: "Finisher", notes: "", timer: { format: "amrap", capSeconds: 720 } });
  });

  it("no timer submits timer: null", async () => {
    const { user, onSubmit } = renderSheet();
    await user.type(dialog("New section").getByLabelText("Name"), "Plain");
    await user.click(dialog("New section").getByRole("button", { name: "Add section" }));
    expect(onSubmit).toHaveBeenCalledWith({ name: "Plain", notes: "", timer: null });
  });

  it("an unparseable timer shows its own error and does not submit", async () => {
    const { user, onSubmit } = renderSheet();
    const d = dialog("New section");
    await user.type(d.getByLabelText("Name"), "Finisher");
    await user.selectOptions(d.getByLabelText("Timer"), "set_timer");
    await user.click(d.getByRole("button", { name: "Add section" }));
    expect(d.getByText("Enter the number of rounds.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("edit mode starts from the section's timer", () => {
    renderSheet({ mode: "edit", section: makeTimedSection({ name: "Main" }) });
    const d = dialog("Edit section");
    expect(d.getByLabelText("Timer")).toHaveValue("set_timer");
    expect(d.getByLabelText("Rounds")).toHaveValue("5");
    expect(d.getByLabelText("Round length")).toHaveValue("5:00");
  });

  it("server timer errors from the hook show under their field", () => {
    renderSheet({ mode: "edit", section: makeTimedSection({ name: "Main" }), errors: { ...NO_ERRORS, timer: { rounds: ROUNDS_RANGE_ERROR } } });
    expect(dialog("Edit section").getByLabelText("Rounds")).toHaveAccessibleDescription(ROUNDS_RANGE_ERROR);
  });

  it("saveRef receives the submit button", () => {
    const saveRef = vi.fn();
    renderSheet({ mode: "edit", section: makeTimedSection({ name: "Main" }), saveRef });
    expect(saveRef).toHaveBeenCalledWith(dialog("Edit section").getByRole("button", { name: "Save" }));
  });
});
