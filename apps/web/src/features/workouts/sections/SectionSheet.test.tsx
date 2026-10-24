import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { WorkoutSection } from "@sin/core";
import { SECTION_COPY } from "./sectionCopy";
import { SectionSheet, type SectionSheetProps } from "./SectionSheet";

const NO_ERRORS = { name: null, notes: null, form: null };
const stored = { id: "00000000-0000-4000-8000-000000000001", position: 0, name: "Warm-up", notes: "5 min", addedInWorkout: true } as WorkoutSection;

function renderSheet(props: Partial<SectionSheetProps> = {}) {
  const callbacks = { onSubmit: vi.fn(), onClose: vi.fn(), onRemove: vi.fn() };
  render(<SectionSheet open mode="add" busy={false} errors={NO_ERRORS} {...callbacks} {...props} />);
  return { user: userEvent.setup(), ...callbacks };
}
const dialog = (name: string) => within(screen.getByRole("dialog", { name }));

describe("10.6 AC5 — the sheet", () => {
  it("title, intro, labeled fields, the hint linked, Cancel and Add section", () => {
    renderSheet();
    const d = dialog("New section");
    expect(d.getByText("Exercises you add next go into this section.")).toBeInTheDocument();
    const name = d.getByLabelText("Name");
    expect(name.tagName).toBe("INPUT");
    expect(name).toHaveAttribute("autocomplete", "off");
    const note = d.getByLabelText("Note");
    expect(note.tagName).toBe("TEXTAREA");
    expect(note).toHaveAccessibleDescription("Anything beyond sets and reps.");
    expect(d.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(d.getByRole("button", { name: "Add section" })).toBeInTheDocument();
  });

  it("focuses no field on open", () => {
    renderSheet();
    expect(document.activeElement).toBe(document.body);
  });

  it("Cancel calls onClose; submitting calls onSubmit with the typed values", async () => {
    const { user, onClose, onSubmit } = renderSheet();
    const d = dialog("New section");
    await user.type(d.getByLabelText("Name"), "Strength");
    await user.type(d.getByLabelText("Note"), "EMOM");
    await user.click(d.getByRole("button", { name: "Add section" }));
    expect(onSubmit).toHaveBeenCalledWith({ name: "Strength", notes: "EMOM" });
    await user.click(d.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a name error shows under Name and is linked; a form error shows as a notice", () => {
    renderSheet({ errors: { name: SECTION_COPY.nameRequired, notes: SECTION_COPY.noteTooLong, form: SECTION_COPY.fieldsGeneric } });
    const d = dialog("New section");
    expect(d.getByLabelText("Name")).toHaveAccessibleDescription("Enter a name.");
    expect(d.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(d.getByLabelText("Note")).toHaveAccessibleDescription("Anything beyond sets and reps. Keep the note to 2000 characters.");
    expect(d.getByText(SECTION_COPY.fieldsGeneric)).toBeInTheDocument();
  });

  it("add mode has no Remove section", () => {
    renderSheet();
    expect(screen.queryByRole("button", { name: "Remove section" })).toBeNull();
  });

  it("busy disables the submit", () => {
    renderSheet({ busy: true });
    expect(dialog("New section").getByRole("button", { name: "Add section" })).toBeDisabled();
  });
});

describe("10.6 AC7 / AC8 — edit mode", () => {
  it("prefilled fields, Save, and Remove section under the divider with its line", async () => {
    const removeRef = vi.fn();
    const { user, onRemove, onSubmit } = renderSheet({ mode: "edit", section: stored, removeRef });
    const d = dialog("Edit section");
    expect(d.queryByText("Exercises you add next go into this section.")).toBeNull();
    expect(d.getByLabelText("Name")).toHaveValue("Warm-up");
    expect(d.getByLabelText("Note")).toHaveValue("5 min");
    const remove = d.getByRole("button", { name: "Remove section" });
    expect(removeRef).toHaveBeenCalledWith(remove);
    expect(d.getByText("Its exercises and sets stay in the workout, without a section.")).toBeInTheDocument();
    expect(remove.closest("[data-divider]")).not.toBeNull();
    await user.click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
    await user.click(d.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith({ name: "Warm-up", notes: "5 min" });
  });
});
