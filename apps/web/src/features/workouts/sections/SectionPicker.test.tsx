import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { WorkoutSection } from "@sin/core";
import { SectionPicker } from "./SectionPicker";

const sec = (id: string, name: string, position: number) =>
  ({ id: `00000000-0000-4000-8000-00000000000${id}`, position, name, notes: null, addedInWorkout: false }) as WorkoutSection;
const SECTIONS = [sec("2", "Strength", 1), sec("1", "Warm-up", 0)];

function renderPicker(props: Partial<Parameters<typeof SectionPicker>[0]> = {}) {
  const onChange = vi.fn();
  const result = render(<SectionPicker exerciseId="we1" value={null} sections={SECTIONS} linked={false} disabled={false} onChange={onChange} {...props} />);
  return { user: userEvent.setup(), onChange, ...result };
}

describe("10.6 AC9 / AC11 — the picker", () => {
  it("a labeled select: No section first, then the sections by position", () => {
    renderPicker();
    const select = screen.getByLabelText("Section");
    expect(select.tagName).toBe("SELECT");
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(["No section", "Warm-up", "Strength"]);
  });

  it("shows the current value", () => {
    renderPicker({ value: SECTIONS[0]!.id });
    expect(screen.getByLabelText("Section")).toHaveDisplayValue("Strength");
  });

  it("choosing another section or No section calls onChange; re-choosing the current one does not", async () => {
    const { user, onChange } = renderPicker({ value: SECTIONS[1]!.id });
    await user.selectOptions(screen.getByLabelText("Section"), "Strength");
    expect(onChange).toHaveBeenLastCalledWith(SECTIONS[0]!.id);
    await user.selectOptions(screen.getByLabelText("Section"), "No section");
    expect(onChange).toHaveBeenLastCalledWith(null);
    onChange.mockClear();
    await user.selectOptions(screen.getByLabelText("Section"), "Warm-up");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disabled when disabled", () => {
    renderPicker({ disabled: true });
    expect(screen.getByLabelText("Section")).toBeDisabled();
  });

  it("the superset hint only when linked, and linked to the select", () => {
    const { rerender } = renderPicker();
    expect(screen.queryByText("Changing the section takes it out of its superset.")).toBeNull();
    rerender(<SectionPicker exerciseId="we1" value={null} sections={SECTIONS} linked disabled={false} onChange={() => {}} />);
    expect(screen.getByLabelText("Section")).toHaveAccessibleDescription("Changing the section takes it out of its superset.");
  });

  it("renders nothing with no sections", () => {
    const { container } = renderPicker({ sections: [] });
    expect(container.innerHTML).toBe("");
  });
});
