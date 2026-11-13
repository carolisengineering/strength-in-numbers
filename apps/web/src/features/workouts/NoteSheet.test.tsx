import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { sheetBody, sheetError, sheetErrorRegion, sheetRow } from "../../test/sheetHelpers";
import { EXERCISE_NOTE_MAX } from "./exerciseNote";
import { NoteSheet } from "./NoteSheet";

function setup(props: Partial<Parameters<typeof NoteSheet>[0]> = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(<NoteSheet open exerciseName="Bench Press" initial={null} onSave={onSave} onClose={onClose} {...props} />);
  return { onSave, onClose, user: userEvent.setup() };
}

const rowNames = () => sheetRow().getAllByRole("button").map((b) => b.textContent);

describe("17.10 AC14, AC7 — the note sheet uses the action row", () => {
  it("the row reads Cancel then Save (D3), and the body holds neither; one Cancel in the dialog", () => {
    setup();
    expect(rowNames()).toEqual(["Cancel", "Save"]);
    for (const name of ["Cancel", "Save"]) expect(within(sheetBody()).queryByRole("button", { name })).toBeNull();
    expect(within(screen.getByRole("dialog")).getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
  });

  it("the row's Save saves the parsed note once", async () => {
    const { onSave, user } = setup();
    await user.type(screen.getByLabelText("Note"), "Pause at the chest");
    await user.click(sheetRow().getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("Pause at the chest");
  });

  it("Cancel discards: onClose, no save", async () => {
    const { onSave, onClose, user } = setup();
    await user.type(screen.getByLabelText("Note"), "x");
    await user.click(sheetRow().getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("a failed save shows in the row, so it stays in view (Review Focus 1, final review #1)", () => {
    setup({ saveError: "Couldn't save the note — try again" });
    expect(sheetErrorRegion()).toHaveTextContent("Couldn't save the note — try again");
    expect(within(sheetBody()).queryByRole("alert")).toBeNull();
  });

  it("a note that doesn't parse shows its error under the field, and the save error waits", async () => {
    const { user } = setup({ saveError: "Couldn't save the note — try again" });
    await user.click(screen.getByLabelText("Note"));
    await user.paste("x".repeat(EXERCISE_NOTE_MAX + 1));
    await user.click(sheetRow().getByRole("button", { name: "Save" }));
    expect(within(sheetBody()).getByRole("alert")).toBeInTheDocument();
    expect(sheetError()).toBe("");
  });
});

describe("17.10 AC16 — labels are unchanged", () => {
  it("one button named Save and one named Cancel in the dialog, as before the move", () => {
    setup();
    const dialog = within(screen.getByRole("dialog", { name: "Note for Bench Press" }));
    expect(dialog.getAllByRole("button", { name: "Save" })).toHaveLength(1);
    expect(dialog.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
  });
});

describe("17.10 AC6 — Enter in the note", () => {
  it("adds a line and saves nothing", async () => {
    const { onSave, user } = setup();
    const note = screen.getByLabelText("Note");
    await user.type(note, "one{Enter}two");
    expect(note).toHaveValue("one\ntwo");
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("17.10 AC3 — Cancel latches while a save is in flight", () => {
  it("Cancel is aria-disabled, not disabled, and does nothing", async () => {
    const { onClose, user } = setup({ saving: true, dismissible: false });
    const cancel = sheetRow().getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveAttribute("aria-disabled", "true");
    expect(cancel).not.toBeDisabled();
    await user.click(cancel);
    expect(onClose).not.toHaveBeenCalled();
  });
});
