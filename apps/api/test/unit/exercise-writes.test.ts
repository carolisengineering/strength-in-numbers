import { describe, it, expect } from "vitest";
import { mergeWritableFields, assertMergedFieldsValid } from "../../src/repositories/exercise-writes.js";
import { ValidationError } from "../../src/errors/app-error.js";
import type { ExerciseWriteFields } from "../../src/repositories/exercise.js";

const base: ExerciseWriteFields = {
  name: "Back Squat",
  modality: "weight_reps",
  primaryMuscleId: "quads",
  secondaryMuscleIds: ["glutes"],
  equipmentId: "barbell",
};

describe("mergeWritableFields", () => {
  it("overlays only the keys present in the patch", () => {
    expect(mergeWritableFields(base, { name: "Front Squat" })).toEqual({
      ...base,
      name: "Front Squat",
    });
  });

  it("applies an explicit null on a nullable field rather than falling back to base", () => {
    expect(mergeWritableFields(base, { primaryMuscleId: null }).primaryMuscleId).toBeNull();
  });

  it("returns the base fields unchanged for an empty patch", () => {
    expect(mergeWritableFields(base, {})).toEqual(base);
  });
});

describe("assertMergedFieldsValid", () => {
  it("does not throw for a conflict-free merge", () => {
    expect(() => assertMergedFieldsValid(base)).not.toThrow();
  });

  it("throws ValidationError naming secondaryMuscleIds when the merge restates primaryMuscleId", () => {
    const merged = { ...base, secondaryMuscleIds: ["quads"] };
    try {
      assertMergedFieldsValid(merged);
      expect.unreachable("expected ValidationError");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fieldErrors).toEqual([
        { path: "secondaryMuscleIds", message: "must not restate primaryMuscleId" },
      ]);
    }
  });
});
