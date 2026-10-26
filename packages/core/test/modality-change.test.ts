import { describe, expect, it } from "vitest";
import { MODALITY_VALUES } from "../src/enums.js";
import { forbiddenMeasuresFor, requiredMeasuresFor } from "../src/dto/set-entry.js";
import { canChangeModality, compatibleModalities, lineageRootId, modalitiesCompatible } from "../src/modality-change.js";

describe("03.4 AC1 — compatibility is derived and pinned", () => {
  const pairs = MODALITY_VALUES.flatMap((a) => MODALITY_VALUES.map((b) => [a, b] as const));
  it("over all 64 ordered pairs, the true ones are the eight self-pairs plus weight_reps ↔ weighted_bodyweight", () => {
    const truePairs = pairs.filter(([a, b]) => modalitiesCompatible(a, b)).map(([a, b]) => `${a}|${b}`).sort();
    const expected = [...MODALITY_VALUES.map((m) => `${m}|${m}`), "weight_reps|weighted_bodyweight", "weighted_bodyweight|weight_reps"].sort();
    expect(pairs).toHaveLength(64);
    expect(truePairs).toEqual(expected);
  });
  it("is symmetric", () => {
    for (const [a, b] of pairs) expect(modalitiesCompatible(a, b)).toBe(modalitiesCompatible(b, a));
  });
  it("every true pair has equal required and forbidden sets", () => {
    for (const [a, b] of pairs.filter(([x, y]) => modalitiesCompatible(x, y))) {
      expect(new Set(requiredMeasuresFor(a))).toEqual(new Set(requiredMeasuresFor(b)));
      expect(new Set(forbiddenMeasuresFor(a))).toEqual(new Set(forbiddenMeasuresFor(b)));
    }
  });
});

describe("03.4 AC2 — UI helpers", () => {
  it("compatibleModalities lists m and its partners in MODALITY_VALUES order", () => {
    expect(compatibleModalities("weight_reps")).toEqual(["weight_reps", "weighted_bodyweight"]);
    expect(compatibleModalities("weighted_bodyweight")).toEqual(["weight_reps", "weighted_bodyweight"]);
    expect(compatibleModalities("calories")).toEqual(["calories"]);
    for (const m of MODALITY_VALUES) expect(compatibleModalities(m)).toContain(m);
  });
  it.each([
    [{ from: "duration", to: "calories", hasLoggedSets: false }, true],
    [{ from: "duration", to: "calories", hasLoggedSets: true }, false],
    [{ from: "weight_reps", to: "weighted_bodyweight", hasLoggedSets: true }, true],
    [{ from: "calories", to: "calories", hasLoggedSets: true }, true],
  ] as const)("canChangeModality(%j) is %s", (input, expected) => {
    expect(canChangeModality(input)).toBe(expected);
  });
});

describe("03.4 AC3 — lineageRootId", () => {
  it("is forkedFromExerciseId ?? id", () => {
    expect(lineageRootId({ id: "a", forkedFromExerciseId: null })).toBe("a");
    expect(lineageRootId({ id: "a", forkedFromExerciseId: "b" })).toBe("b");
  });
});
