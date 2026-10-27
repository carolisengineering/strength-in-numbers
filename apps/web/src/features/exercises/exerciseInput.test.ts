import { MODALITY_VALUES, canChangeModality, type Modality } from "@sin/core";
import { describe, expect, it } from "vitest";

import { makeExercise } from "../../test/catalogFixtures";
import type { ExerciseFieldValues } from "../catalog/ExerciseFields";
import { disabledModalitiesFor, modalityNotes, toUpdateExerciseInput, valuesFromExercise } from "./exerciseInput";

const initial: ExerciseFieldValues = {
  name: "Echo",
  modality: "weight_reps",
  primaryMuscleId: "chest",
  secondaryMuscleIds: ["triceps", "shoulders"],
  equipmentId: "barbell",
};

describe("18.2 AC36 — only changed fields", () => {
  it("valuesFromExercise turns null ids into empty strings", () => {
    expect(valuesFromExercise(makeExercise({ name: "X", primaryMuscleId: null, equipmentId: null, secondaryMuscleIds: [] }))).toEqual({
      name: "X",
      modality: "weight_reps",
      primaryMuscleId: "",
      secondaryMuscleIds: [],
      equipmentId: "",
    });
  });

  it.each<[string, Partial<ExerciseFieldValues>, object]>([
    ["name", { name: "Echo Bike" }, { name: "Echo Bike" }],
    ["modality", { modality: "weighted_bodyweight" }, { modality: "weighted_bodyweight" }],
    ["primary", { primaryMuscleId: "back" }, { primaryMuscleId: "back" }],
    ["equipment", { equipmentId: "dumbbell" }, { equipmentId: "dumbbell" }],
    ["cleared primary", { primaryMuscleId: "" }, { primaryMuscleId: null }],
    ["cleared equipment", { equipmentId: "" }, { equipmentId: null }],
    ["added secondary, sent in form order", { secondaryMuscleIds: ["shoulders", "triceps", "back"] }, { secondaryMuscleIds: ["shoulders", "triceps", "back"] }],
    ["name and type", { name: "Dip", modality: "weighted_bodyweight" }, { name: "Dip", modality: "weighted_bodyweight" }],
  ])("%s", (_label, change, expected) => {
    expect(toUpdateExerciseInput(initial, { ...initial, ...change })).toEqual(expected);
  });

  it("no change, a padded name or reordered secondaries send nothing", () => {
    expect(toUpdateExerciseInput(initial, initial)).toEqual({});
    expect(toUpdateExerciseInput(initial, { ...initial, name: "  Echo  " })).toEqual({});
    expect(toUpdateExerciseInput(initial, { ...initial, secondaryMuscleIds: ["shoulders", "triceps"] })).toEqual({});
  });

  it("a rename alone never carries the type", () => {
    expect(toUpdateExerciseInput(initial, { ...initial, name: "  Assault Bike " })).toEqual({ name: "Assault Bike" });
  });
});

describe("18.2 AC37 — type options follow canChangeModality", () => {
  it.each(MODALITY_VALUES.flatMap((current) => [true, false].map((hasLoggedSets) => [current, hasLoggedSets] as const)))(
    "%s, logged %s",
    (current, hasLoggedSets) => {
      const disabled = disabledModalitiesFor(current, { status: "known", hasLoggedSets });
      for (const to of MODALITY_VALUES) {
        expect(disabled.has(to)).toBe(!canChangeModality({ from: current, to, hasLoggedSets }));
      }
      expect(disabled.has(current)).toBe(false);
    },
  );

  it("names the partners when locked, says so when there are none, and is silent when nothing is logged", () => {
    expect(modalityNotes("weight_reps", "weight_reps", { status: "known", hasLoggedSets: true })).toEqual([
      "This exercise has logged sets, so its type can only change to Weighted bodyweight. To use another type, create a new exercise.",
    ]);
    expect(modalityNotes("calories", "calories", { status: "known", hasLoggedSets: true })).toEqual([
      "This exercise has logged sets, so its type can't change. To use another type, create a new exercise.",
    ]);
    expect(modalityNotes("weight_reps", "duration", { status: "known", hasLoggedSets: false })).toEqual([]);
  });
});

describe("18.2 AC38 — usage unknown", () => {
  it.each([["pending", "Checking whether this exercise has logged sets…"], ["failed", "Couldn't check whether this exercise has logged sets, so its type can't be changed right now. Everything else can."]] as const)(
    "%s: everything but the current type is disabled, with its note",
    (status, note) => {
      const disabled = disabledModalitiesFor("calories", { status });
      expect([...disabled].sort()).toEqual(MODALITY_VALUES.filter((m) => m !== "calories").sort());
      expect(modalityNotes("calories", "calories", { status })).toEqual([note]);
    },
  );
});

describe("18.2 AC39 — the weight-meaning note", () => {
  const NOTE =
    "Weight × reps counts the full weight and Weighted bodyweight counts only the added weight. Your history keeps its numbers, so this exercise's charts and records will compare the two.";
  const known = (hasLoggedSets: boolean) => ({ status: "known" as const, hasLoggedSets });

  it("shows for a switch between the two weighted types with logged sets", () => {
    expect(modalityNotes("weight_reps", "weighted_bodyweight", known(true))).toContain(NOTE);
    expect(modalityNotes("weighted_bodyweight", "weight_reps", known(true))).toContain(NOTE);
  });

  it("not without logged sets, and not once the selection is back on the current type", () => {
    expect(modalityNotes("weight_reps", "weighted_bodyweight", known(false))).not.toContain(NOTE);
    expect(modalityNotes("weight_reps", "weight_reps", known(true))).not.toContain(NOTE);
    expect(modalityNotes("weight_reps" as Modality, "duration", known(false))).not.toContain(NOTE);
  });
});
