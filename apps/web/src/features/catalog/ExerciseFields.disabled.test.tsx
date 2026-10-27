import type { Modality } from "@sin/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { markupOf } from "../../test/markup";
import { ExerciseFields, type ExerciseFieldsProps } from "./ExerciseFields";

const base: ExerciseFieldsProps = {
  values: { name: "Echo Bike", modality: "weight_reps", primaryMuscleId: "", secondaryMuscleIds: [], equipmentId: "" },
  onChange: () => {},
  muscleGroups: [{ id: "chest", name: "Chest", displayOrder: 1 }],
  equipment: [{ id: "barbell", name: "Barbell", displayOrder: 1 }],
  detailsOpen: true,
  onDetailsOpenChange: () => {},
};

describe("18.2 AC57 — disabled choice", () => {
  it("with no new props the markup is exactly what it was before Phase B", () => {
    const { container } = render(
      <div data-testid="root">
        <ExerciseFields {...base} />
      </div>,
    );
    // The snapshot was recorded from the component before the new props existed.
    expect(markupOf(container.firstElementChild!)).toMatchSnapshot();
  });

  it("a disabled type is disabled, keeps its label, and its label is muted", () => {
    const disabled = new Set<Modality>(["calories", "duration"]);
    render(<ExerciseFields {...base} disabledModalities={disabled} modalityNotice={<p>Locked note</p>} />);
    const calories = screen.getByRole("radio", { name: "Calories" });
    expect(calories).toBeDisabled();
    expect(calories.closest("label")!.className).toMatch(/choiceDisabled/);
    expect(screen.getByRole("radio", { name: "Weight × reps" })).toBeEnabled();
    expect(screen.getByRole("radio", { name: "Weight × reps" }).closest("label")!.className).not.toMatch(/choiceDisabled/);
    const note = screen.getByText("Locked note");
    expect(note.closest("fieldset")).toBe(calories.closest("fieldset"));
  });
});
