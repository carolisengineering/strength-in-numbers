import type { Equipment, MuscleGroup } from "@sin/core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { EMPTY_EXERCISE_FIELDS, ExerciseFields, toCreateExerciseInput, type ExerciseFieldValues } from "./ExerciseFields";

const MUSCLES: MuscleGroup[] = [
  { id: "chest", name: "Chest", displayOrder: 1 },
  { id: "biceps", name: "Biceps", displayOrder: 2 },
];
const EQUIPMENT: Equipment[] = [{ id: "barbell", name: "Barbell", displayOrder: 1 }];

function Harness(props: {
  idPrefix?: string;
  modalityLabel?: string;
  muscleGroups?: readonly MuscleGroup[] | undefined;
  nameNotice?: ReactNode;
  onChange?: (next: ExerciseFieldValues) => void;
}) {
  const [values, setValues] = useState<ExerciseFieldValues>(EMPTY_EXERCISE_FIELDS);
  const [open, setOpen] = useState(false);
  return (
    <ExerciseFields
      values={values}
      onChange={(next) => {
        props.onChange?.(next);
        setValues(next);
      }}
      {...(props.idPrefix ? { idPrefix: props.idPrefix } : {})}
      {...(props.modalityLabel ? { modalityLabel: props.modalityLabel } : {})}
      muscleGroups={"muscleGroups" in props ? props.muscleGroups : MUSCLES}
      equipment={EQUIPMENT}
      detailsOpen={open}
      onDetailsOpenChange={setOpen}
      nameNotice={props.nameNotice}
    />
  );
}

describe("10.4 AC26 — ExerciseFields is the one set of create-exercise inputs", () => {
  it("defaults match CreateExerciseForm: ids, Modality legend, More details closed", () => {
    render(<Harness />);
    expect(screen.getByLabelText("Name")).toHaveAttribute("id", "exercise-name");
    expect(screen.getByRole("group", { name: "Modality" })).toBeInTheDocument();
    expect(screen.getByText("More details").closest("details")).not.toHaveAttribute("open");
  });

  it("idPrefix and modalityLabel: two instances never share ids or a radio group", async () => {
    render(
      <>
        <Harness idPrefix="import-card-0-new" modalityLabel="Type" />
        <Harness idPrefix="import-card-1-new" modalityLabel="Type" />
      </>,
    );
    const radios = screen.getAllByRole("radio", { name: "Duration" });
    expect(new Set(radios.map((r) => r.getAttribute("name")))).toEqual(new Set(["import-card-0-new-modality", "import-card-1-new-modality"]));
    await userEvent.click(radios[0]!);
    expect(radios[1]).not.toBeChecked();
    expect(screen.getAllByRole("group", { name: "Type" })).toHaveLength(2);
    const names = screen.getAllByLabelText("Name").map((el) => el.id);
    expect(new Set(names).size).toBe(2);
  });

  it("controlled: onChange receives the whole next value; choosing a primary drops it from the secondaries", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByText("More details"));
    const secondaries = screen.getByRole("group", { name: "Secondary muscles (up to 4)" });
    await userEvent.click(within(secondaries).getByRole("checkbox", { name: "Chest" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_EXERCISE_FIELDS, secondaryMuscleIds: ["chest"] });
    await userEvent.selectOptions(screen.getByLabelText("Primary muscle"), "chest");
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_EXERCISE_FIELDS, primaryMuscleId: "chest", secondaryMuscleIds: [] });
  });

  it("no reference data → no More details", () => {
    render(<Harness muscleGroups={undefined} />);
    expect(screen.queryByText("More details")).toBeNull();
  });

  it("nameNotice renders under the Name field", () => {
    render(<Harness nameNotice={<p>Notice here</p>} />);
    expect(screen.getByText("Notice here")).toBeInTheDocument();
  });

  it("toCreateExerciseInput trims and nulls", () =>
    expect(toCreateExerciseInput({ ...EMPTY_EXERCISE_FIELDS, name: "  Curl ", modality: "weight_reps" })).toEqual({
      name: "Curl",
      modality: "weight_reps",
      primaryMuscleId: null,
      secondaryMuscleIds: [],
      equipmentId: null,
    }));
});

describe("05.3 AC21 — the type choices are the legacy five", () => {
  it("renders exactly five modality radios, in order", () => {
    render(<Harness />);
    const radios = screen.getAllByRole("radio").map((r) => (r as HTMLInputElement).value);
    expect(radios).toEqual(["weight_reps", "bodyweight_reps", "weighted_bodyweight", "duration", "distance_duration"]);
  });
});
