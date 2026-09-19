import { describe, expect, it } from "vitest";
import {
  CatalogName,
  CatalogSinceQuery,
  CreateExerciseSchema,
  EquipmentSchema,
  ExerciseSchema,
  ExercisesResponse,
  isSyncToken,
  MAX_CUSTOM_EXERCISES_PER_USER,
  MuscleGroupSchema,
  muscleIdCrossFieldIssues,
  noControlChars,
  UpdateExerciseSchema,
} from "../../src/dto/exercise.js";

const curatedRow = {
  id: "018f9c8e-7b1a-7c2d-9e3f-4a5b6c7d8e9f",
  catalogKey: "barbell-back-squat",
  ownerUserId: null,
  name: "Barbell Back Squat",
  modality: "weight_reps",
  primaryMuscleId: "quads",
  secondaryMuscleIds: ["glutes", "hamstrings"],
  equipmentId: "barbell",
  isActive: true,
  forkedFromExerciseId: null,
  createdAt: "2026-09-08T12:00:00Z",
  updatedAt: "2026-09-08T12:00:00Z",
};

const NUL = String.fromCharCode(0);
const UNIT_SEP = String.fromCharCode(0x1f);
const DEL = String.fromCharCode(0x7f);

describe("catalog DTOs (Spec 03.1 §5)", () => {
  it("ExerciseSchema requires forkedFromExerciseId and accepts a fork's origin id", () => {
    expect(() =>
      ExerciseSchema.parse({ ...curatedRow, forkedFromExerciseId: undefined }),
    ).toThrow();
    expect(
      ExerciseSchema.parse({
        ...curatedRow,
        forkedFromExerciseId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      }).forkedFromExerciseId,
    ).toBe("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d");
  });

  it("ExerciseSchema accepts a well-formed curated row", () => {
    expect(ExerciseSchema.parse(curatedRow)).toMatchObject({
      catalogKey: "barbell-back-squat",
      modality: "weight_reps",
      secondaryMuscleIds: ["glutes", "hamstrings"],
    });
  });

  it("ExerciseSchema accepts a custom-row shape (null catalogKey, ownerUserId set)", () => {
    expect(() =>
      ExerciseSchema.parse({
        ...curatedRow,
        catalogKey: null,
        ownerUserId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      }),
    ).not.toThrow();
  });

  it("ExerciseSchema returns tombstone rows (isActive false)", () => {
    expect(
      ExerciseSchema.parse({ ...curatedRow, isActive: false }).isActive,
    ).toBe(false);
  });

  it("ExerciseSchema rejects an unknown modality", () => {
    expect(() =>
      ExerciseSchema.parse({ ...curatedRow, modality: "isometric_hold" }),
    ).toThrow();
  });

  it("ExerciseSchema rejects a non-datetime updatedAt and a malformed id", () => {
    expect(() =>
      ExerciseSchema.parse({ ...curatedRow, updatedAt: "last Tuesday" }),
    ).toThrow();
    expect(() => ExerciseSchema.parse({ ...curatedRow, id: "nope" })).toThrow();
  });

  it("ExerciseSchema rejects an empty catalogKey (min 1 when present)", () => {
    expect(() =>
      ExerciseSchema.parse({ ...curatedRow, catalogKey: "" }),
    ).toThrow();
  });

  describe("CatalogName — shared 1..120, no control characters", () => {
    it("accepts a 1-char and a 120-char name", () => {
      expect(CatalogName.parse("A")).toBe("A");
      expect(CatalogName.parse("x".repeat(120))).toHaveLength(120);
    });

    it("rejects empty and over-120", () => {
      expect(() => CatalogName.parse("")).toThrow();
      expect(() => CatalogName.parse("x".repeat(121))).toThrow();
    });

    it("rejects tab, newline, and DEL", () => {
      expect(() => CatalogName.parse("bad\tname")).toThrow();
      expect(() => CatalogName.parse("bad\nname")).toThrow();
      expect(() => CatalogName.parse(`bad${DEL}name`)).toThrow();
    });

    it("reports the shared message on a control-char failure", () => {
      const r = CatalogName.safeParse(`nul${NUL}here`);
      expect(r.success).toBe(false);
      expect(r.error!.issues[0]!.message).toBe("control characters not allowed");
    });
  });

  describe("noControlChars predicate", () => {
    it("is true for clean text incl. unicode and the empty string", () => {
      expect(noControlChars("Bench Press — incline")).toBe(true);
      expect(noControlChars("")).toBe(true);
    });

    it("is false for a NUL, a mid-range C0 char, or DEL", () => {
      expect(noControlChars(`a${NUL}b`)).toBe(false);
      expect(noControlChars(`a${UNIT_SEP}b`)).toBe(false);
      expect(noControlChars(`a${DEL}b`)).toBe(false);
    });
  });

  it("MuscleGroupSchema / EquipmentSchema accept a reference row", () => {
    expect(
      MuscleGroupSchema.parse({ id: "chest", name: "Chest", displayOrder: 1 }),
    ).toEqual({ id: "chest", name: "Chest", displayOrder: 1 });
    expect(
      EquipmentSchema.parse({ id: "barbell", name: "Barbell", displayOrder: 0 }),
    ).toEqual({ id: "barbell", name: "Barbell", displayOrder: 0 });
  });

  it("MuscleGroupSchema rejects a non-integer displayOrder", () => {
    expect(() =>
      MuscleGroupSchema.parse({ id: "chest", name: "Chest", displayOrder: 1.5 }),
    ).toThrow();
  });

  it("ExercisesResponse wraps the array plus the opaque syncToken", () => {
    expect(
      ExercisesResponse.parse({
        exercises: [curatedRow],
        syncToken: "1.736",
      }),
    ).toMatchObject({ exercises: [{ id: curatedRow.id }], syncToken: "1.736" });
  });

  it("ExercisesResponse requires syncToken (the old serverTime is gone)", () => {
    expect(() => ExercisesResponse.parse({ exercises: [] })).toThrow();
    expect(
      ExercisesResponse.parse({ exercises: [], syncToken: "1.0", serverTime: "x" }),
    ).not.toHaveProperty("serverTime");
  });
});

describe("write DTOs (Spec 03.2 §5)", () => {
  const validCreate = {
    name: "Incline Dumbbell Press",
    modality: "weight_reps",
    primaryMuscleId: "chest",
    secondaryMuscleIds: ["triceps", "shoulders"],
    equipmentId: "dumbbell",
  };

  it("CreateExerciseSchema accepts a full valid body and applies field defaults", () => {
    expect(
      CreateExerciseSchema.parse({ name: "Push-up", modality: "bodyweight_reps" }),
    ).toEqual({
      name: "Push-up",
      modality: "bodyweight_reps",
      primaryMuscleId: null,
      secondaryMuscleIds: [],
      equipmentId: null,
    });
  });

  it("CreateExerciseSchema rejects an unknown key (.strict())", () => {
    expect(() =>
      CreateExerciseSchema.parse({ ...validCreate, extra: "nope" }),
    ).toThrow();
  });

  it("CreateExerciseSchema rejects a duplicate secondaryMuscleIds entry", () => {
    const r = CreateExerciseSchema.safeParse({
      ...validCreate,
      secondaryMuscleIds: ["triceps", "triceps"],
    });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]).toMatchObject({
      path: ["secondaryMuscleIds"],
      message: "duplicate muscle id",
    });
  });

  it("CreateExerciseSchema rejects secondaryMuscleIds restating primaryMuscleId", () => {
    const r = CreateExerciseSchema.safeParse({
      ...validCreate,
      primaryMuscleId: "chest",
      secondaryMuscleIds: ["chest"],
    });
    expect(r.success).toBe(false);
    expect(
      r.error!.issues.some((issue) => issue.message === "must not restate primaryMuscleId"),
    ).toBe(true);
  });

  it("CreateExerciseSchema caps secondaryMuscleIds at 4 entries", () => {
    expect(
      CreateExerciseSchema.safeParse({ ...validCreate, secondaryMuscleIds: ["a", "b", "c", "d"] })
        .success,
    ).toBe(true);
    expect(
      CreateExerciseSchema.safeParse({
        ...validCreate,
        secondaryMuscleIds: ["a", "b", "c", "d", "e"],
      }).success,
    ).toBe(false);
  });

  it("CreateExerciseSchema rejects a bad name and a bad modality", () => {
    expect(CreateExerciseSchema.safeParse({ ...validCreate, name: "" }).success).toBe(false);
    expect(
      CreateExerciseSchema.safeParse({ ...validCreate, modality: "isometric_hold" }).success,
    ).toBe(false);
  });

  it("UpdateExerciseSchema accepts an empty object and any single field", () => {
    expect(UpdateExerciseSchema.parse({})).toEqual({});
    expect(UpdateExerciseSchema.parse({ name: "New Name" })).toEqual({ name: "New Name" });
    expect(UpdateExerciseSchema.parse({ primaryMuscleId: null })).toEqual({
      primaryMuscleId: null,
    });
  });

  it("UpdateExerciseSchema rejects an unknown key and does not itself cross-check fields", () => {
    expect(() => UpdateExerciseSchema.parse({ nope: 1 })).toThrow();
    // A partial body restating nothing yet is not, by itself, a conflict — the
    // merge-then-validate rule (Spec 03.2 §6) lives server-side, not here.
    expect(
      UpdateExerciseSchema.safeParse({ secondaryMuscleIds: ["chest", "chest"] }).success,
    ).toBe(true); // UpdateExerciseSchema defers all cross-field checking (incl. intra-array
    // duplicates) to the server-side merge-then-validate step (Spec 03.2 §6) — a
    // partial body alone can't know if this is a real conflict or a no-op restate.
  });

  it("muscleIdCrossFieldIssues is the pure rule both schemas/merge-validation share", () => {
    expect(
      muscleIdCrossFieldIssues({ primaryMuscleId: null, secondaryMuscleIds: ["a", "b"] }),
    ).toEqual([]);
    expect(
      muscleIdCrossFieldIssues({ primaryMuscleId: null, secondaryMuscleIds: ["a", "a"] }),
    ).toEqual([{ path: ["secondaryMuscleIds"], message: "duplicate muscle id" }]);
    expect(
      muscleIdCrossFieldIssues({ primaryMuscleId: "chest", secondaryMuscleIds: ["chest"] }),
    ).toEqual([{ path: ["secondaryMuscleIds"], message: "must not restate primaryMuscleId" }]);
  });

  it("I2 — muscleIdCrossFieldIssues rejects a secondaryMuscleIds array over the 4-entry cap", () => {
    expect(
      muscleIdCrossFieldIssues({
        primaryMuscleId: null,
        secondaryMuscleIds: ["a", "b", "c", "d", "e"],
      }),
    ).toEqual([
      { path: ["secondaryMuscleIds"], message: "at most 4 secondary muscle ids" },
    ]);
    expect(
      muscleIdCrossFieldIssues({
        primaryMuscleId: null,
        secondaryMuscleIds: ["a", "b", "c", "d"],
      }),
    ).toEqual([]);
  });

  it("D22 — muscleIdCrossFieldIssues skips the length check when checkLength is false", () => {
    expect(
      muscleIdCrossFieldIssues(
        { primaryMuscleId: null, secondaryMuscleIds: ["a", "b", "c", "d", "e"] },
        { checkLength: false },
      ),
    ).toEqual([]);
    // checkLength: false is length-only — duplicate-id detection still fires.
    expect(
      muscleIdCrossFieldIssues(
        { primaryMuscleId: null, secondaryMuscleIds: ["a", "a", "b", "c", "d"] },
        { checkLength: false },
      ),
    ).toEqual([{ path: ["secondaryMuscleIds"], message: "duplicate muscle id" }]);
  });

  it("MAX_CUSTOM_EXERCISES_PER_USER is 500", () => {
    expect(MAX_CUSTOM_EXERCISES_PER_USER).toBe(500);
  });
});

describe("AC10 — isSyncToken / CatalogSinceQuery", () => {
  it("accepts 1.0, 1.736 and the 19-digit maximum", () => {
    for (const ok of ["1.0", "1.736", "1.9999999999999999999"]) {
      expect(isSyncToken(ok), ok).toBe(true);
    }
  });

  it("rejects bare numbers, negatives, non-digits, leading zeros, 20 digits, a wrong version, and empty", () => {
    for (const bad of [
      "736",
      "1.-1",
      "1.abc",
      "1.01",
      "1.99999999999999999999",
      "2.736",
      "",
    ]) {
      expect(isSyncToken(bad), bad).toBe(false);
    }
  });

  it("CatalogSinceQuery treats since as optional and validates it with the regex", () => {
    expect(CatalogSinceQuery.parse({})).toEqual({});
    expect(CatalogSinceQuery.parse({ since: "1.736" })).toEqual({ since: "1.736" });
    expect(CatalogSinceQuery.safeParse({ since: "2026-01-01T00:00:00Z" }).success).toBe(false);
    expect(CatalogSinceQuery.safeParse({ since: "1.01" }).success).toBe(false);
  });
});
