import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkoutSection } from "@sin/core";
import { SectionDialogs } from "./SectionDialogs";
import type { SectionActions } from "./useSectionActions";

const section = { id: "00000000-0000-4000-8000-000000000001", position: 0, name: "Main", notes: null, addedInWorkout: false, timer: null, result: null, roundTimes: [] } as unknown as WorkoutSection;

function actions(over: Partial<SectionActions> = {}): SectionActions {
  return {
    sheet: { mode: "edit", sectionId: section.id, session: 1 },
    sheetView: { mode: "edit", sectionId: section.id, session: 1 },
    errors: { name: null, notes: null, form: null, timer: null },
    busy: false,
    openAdd: vi.fn(),
    openEdit: vi.fn(),
    closeSheet: vi.fn(),
    submitSheet: vi.fn(),
    removeOpen: false,
    requestRemove: vi.fn(),
    cancelRemove: vi.fn(),
    confirmRemove: vi.fn(),
    setExerciseSection: vi.fn(),
    addSectionRef: { current: null },
    editRefFor: () => () => {},
    removeRef: vi.fn(),
    timerConfirm: null,
    confirmTimerChange: vi.fn(),
    cancelTimerChange: vi.fn(),
    saveRef: vi.fn(),
    ...over,
  } as SectionActions;
}

describe("10.7 AC16 / 10.6 AC12 — minor 324: a confirm's action waits while another structure write runs", () => {
  it("Remove section's confirm is disabled while another structure write runs, and enabled once it ends", () => {
    const { rerender } = render(<SectionDialogs actions={actions({ removeOpen: true })} sections={[section]} structureBusy />);
    const dialog = () => within(screen.getByRole("dialog", { name: /Remove Main/ }));
    expect(dialog().getByRole("button", { name: "Remove" })).toBeDisabled();
    rerender(<SectionDialogs actions={actions({ removeOpen: true })} sections={[section]} structureBusy={false} />);
    expect(dialog().getByRole("button", { name: "Remove" })).toBeEnabled();
  });

  it("the timer change confirm's Change and clear is disabled while another structure write runs", () => {
    render(<SectionDialogs actions={actions({ timerConfirm: { title: "Change Main's timer?" } })} sections={[section]} structureBusy />);
    expect(within(screen.getByRole("dialog", { name: "Change Main's timer?" })).getByRole("button", { name: "Change and clear" })).toBeDisabled();
  });

  it("the confirm's own write is not 'another' write: busy shows its own state, not a disabled action", () => {
    render(<SectionDialogs actions={actions({ removeOpen: true, busy: true })} sections={[section]} structureBusy />);
    const button = within(screen.getByRole("dialog", { name: /Remove Main/ })).getByRole("button", { name: "Remove" });
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});
