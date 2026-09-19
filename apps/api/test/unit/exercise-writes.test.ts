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
    expect(() => assertMergedFieldsValid(base, {})).not.toThrow();
  });

  it("throws ValidationError naming secondaryMuscleIds when the merge restates primaryMuscleId", () => {
    const merged = { ...base, secondaryMuscleIds: ["quads"] };
    try {
      assertMergedFieldsValid(merged, { secondaryMuscleIds: ["quads"] });
      expect.unreachable("expected ValidationError");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).fieldErrors).toEqual([
        { path: "secondaryMuscleIds", message: "must not restate primaryMuscleId" },
      ]);
    }
  });

  it("D22 — does not enforce the length cap on secondaryMuscleIds the patch didn't touch", () => {
    const merged = { ...base, secondaryMuscleIds: ["a", "b", "c", "d", "e"] };
    // patch didn't touch secondaryMuscleIds at all — e.g. inherited from a fork
    // origin or an untouched base row — so the length cap must not fire.
    expect(() => assertMergedFieldsValid(merged, { name: "Renamed" })).not.toThrow();
  });

  it("D22 — enforces the length cap on secondaryMuscleIds the patch explicitly touched", () => {
    const merged = { ...base, secondaryMuscleIds: ["a", "b", "c", "d", "e"] };
    expect(() =>
      assertMergedFieldsValid(merged, { secondaryMuscleIds: ["a", "b", "c", "d", "e"] }),
    ).toThrow(ValidationError);
  });
});
