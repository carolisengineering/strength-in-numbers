import { describe, expect, it } from "vitest";
import {
  CatalogName,
  EquipmentSchema,
  ExerciseSchema,
  ExercisesResponse,
  MuscleGroupSchema,
  noControlChars,
  UpdatedSinceQuery,
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
  createdAt: "2026-09-08T12:00:00Z",
  updatedAt: "2026-09-08T12:00:00Z",
};

const NUL = String.fromCharCode(0);
const UNIT_SEP = String.fromCharCode(0x1f);
const DEL = String.fromCharCode(0x7f);

describe("catalog DTOs (Spec 03.1 §5)", () => {
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

  it("ExercisesResponse wraps the array plus the serverTime cursor", () => {
    expect(
      ExercisesResponse.parse({
        exercises: [curatedRow],
        serverTime: "2026-09-08T12:00:00.123Z",
      }),
    ).toMatchObject({ exercises: [{ id: curatedRow.id }] });
  });

  it("ExercisesResponse rejects a non-datetime serverTime", () => {
    expect(() =>
      ExercisesResponse.parse({ exercises: [], serverTime: "soon" }),
    ).toThrow();
  });

  it("UpdatedSinceQuery treats updated_since as optional, rejects a non-datetime", () => {
    expect(UpdatedSinceQuery.parse({})).toEqual({});
    expect(
      UpdatedSinceQuery.parse({ updated_since: "2026-09-08T12:00:00Z" }),
    ).toEqual({ updated_since: "2026-09-08T12:00:00Z" });
    expect(() => UpdatedSinceQuery.parse({ updated_since: "nope" })).toThrow();
  });
});
