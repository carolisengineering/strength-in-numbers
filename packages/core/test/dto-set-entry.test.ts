import { describe, expect, it } from "vitest";
import {
  CreateSetSchema,
  forbiddenMeasuresFor,
  MEASURE_NAMES,
  MODALITY_VALUES,
  requiredMeasuresFor,
  SET_DISTANCE_MAX,
  SET_CALORIES_MAX,
  SET_DURATION_S_MAX,
  SET_REPS_MAX,
  SET_WEIGHT_MAX,
  SetEntrySchema,
  UpdateSetSchema,
  WorkoutDetailSchema,
  WorkoutExerciseDetailSchema,
  type MeasureName,
  type Modality,
} from "../src/index.js";

// Spec 05.3 §6.1's table (05.1's five rows plus calories, and three new rows),
// restated independently of MEASURE_RULES so a typo in the source table can't
// also be in the expectation.
const TABLE: Record<Modality, { required: MeasureName[]; forbidden: MeasureName[] }> = {
  weight_reps: { required: ["weight", "reps"], forbidden: ["durationS", "distance", "calories"] },
  bodyweight_reps: { required: ["reps"], forbidden: ["weight", "durationS", "distance", "calories"] },
  weighted_bodyweight: { required: ["reps", "weight"], forbidden: ["durationS", "distance", "calories"] },
  duration: { required: ["durationS"], forbidden: ["weight", "reps", "distance", "calories"] },
  distance_duration: { required: ["distance", "durationS"], forbidden: ["weight", "reps", "calories"] },
  calories: { required: ["calories"], forbidden: ["weight", "reps", "distance", "durationS"] },
  weight_distance: { required: ["weight", "distance"], forbidden: ["reps", "durationS", "calories"] },
  weight_duration: { required: ["weight", "durationS"], forbidden: ["reps", "distance", "calories"] },
};

describe("05.3 AC3 — measure rules: requiredMeasuresFor / forbiddenMeasuresFor match §6.1 for all eight", () => {
  it("MEASURE_NAMES is reps, weight, distance, durationS, calories", () => {
    expect([...MEASURE_NAMES]).toEqual(["reps", "weight", "distance", "durationS", "calories"]);
  });
  for (const modality of MODALITY_VALUES) {
    it(`${modality}: required`, () => {
      expect([...requiredMeasuresFor(modality)].sort()).toEqual([...TABLE[modality].required].sort());
    });
    it(`${modality}: forbidden`, () => {
      expect([...forbiddenMeasuresFor(modality)].sort()).toEqual([...TABLE[modality].forbidden].sort());
    });
    it(`${modality}: required ∪ forbidden covers every measure exactly once`, () => {
      const all = [...requiredMeasuresFor(modality), ...forbiddenMeasuresFor(modality)].sort();
      expect(all).toEqual([...MEASURE_NAMES].sort());
    });
  }
});

describe("AC17 — CreateSetSchema / UpdateSetSchema", () => {
  it("parses an empty body and a full body", () => {
    expect(CreateSetSchema.safeParse({}).success).toBe(true);
    expect(
      CreateSetSchema.safeParse({
        setType: "working",
        reps: 5,
        weight: 100,
        weightUnit: "kg",
        distance: null,
        distanceUnit: null,
        durationS: null,
        rpe: 8.5,
        isComplete: true,
      }).success,
    ).toBe(true);
  });
  it("rejects unknown keys, including setNumber and completedAt (AC3)", () => {
    for (const key of ["setNumber", "completedAt", "weightKg", "id", "bogus"]) {
      expect(CreateSetSchema.safeParse({ [key]: 1 }).success, key).toBe(false);
      expect(UpdateSetSchema.safeParse({ [key]: 1 }).success, key).toBe(false);
    }
  });
  it("rejects negatives and non-integers where integers are required", () => {
    expect(CreateSetSchema.safeParse({ reps: -1 }).success).toBe(false);
    expect(CreateSetSchema.safeParse({ reps: 2.5 }).success).toBe(false);
    expect(CreateSetSchema.safeParse({ weight: -0.5 }).success).toBe(false);
    expect(CreateSetSchema.safeParse({ durationS: 1.5 }).success).toBe(false);
  });
  it("RPE: 1–10 in 0.1 steps", () => {
    for (const rpe of [1, 7.5, 8.3, 9.9, 10]) expect(CreateSetSchema.safeParse({ rpe }).success, String(rpe)).toBe(true);
    for (const rpe of [0.9, 10.1, 7.25]) expect(CreateSetSchema.safeParse({ rpe }).success, String(rpe)).toBe(false);
  });
  it("Review Focus 1 / D11 — values above the column limits are rejected, the limits themselves accepted", () => {
    expect(CreateSetSchema.safeParse({ reps: SET_REPS_MAX }).success).toBe(true);
    expect(CreateSetSchema.safeParse({ reps: SET_REPS_MAX + 1 }).success).toBe(false);
    expect(CreateSetSchema.safeParse({ weight: SET_WEIGHT_MAX }).success).toBe(true);
    expect(CreateSetSchema.safeParse({ weight: 10_000 }).success).toBe(false);
    expect(CreateSetSchema.safeParse({ distance: SET_DISTANCE_MAX }).success).toBe(true);
    expect(CreateSetSchema.safeParse({ distance: 1_000_000 }).success).toBe(false);
    expect(CreateSetSchema.safeParse({ durationS: SET_DURATION_S_MAX }).success).toBe(true);
    expect(CreateSetSchema.safeParse({ durationS: SET_DURATION_S_MAX + 1 }).success).toBe(false);
  });
});

const validSet = {
  id: "018fcb3e-3b8a-7d6e-9c1a-000000000010",
  workoutExerciseId: "018fcb3e-3b8a-7d6e-9c1a-000000000005",
  clientGeneratedId: null,
  setNumber: 1,
  setType: "working",
  reps: 5,
  weight: 100,
  weightUnit: "lb",
  weightKg: 45.359,
  distance: null,
  distanceUnit: null,
  distanceM: null,
  durationS: null,
  calories: null,
  rpe: null,
  isComplete: true,
  completedAt: "2026-09-27T10:00:00.000Z",
  createdAt: "2026-09-27T10:00:00.000Z",
  updatedAt: "2026-09-27T10:00:00.000Z",
};

describe("AC22 — clientGeneratedId is a create-only idempotency key", () => {
  const key = "018fcb3e-3b8a-7d6e-9c1a-0000000000aa";
  it("CreateSetSchema accepts a GUID, or no key at all", () => {
    expect(CreateSetSchema.safeParse({ clientGeneratedId: key }).success).toBe(true);
    expect(CreateSetSchema.safeParse({}).success).toBe(true);
  });
  it("CreateSetSchema lower-cases the key, the form Postgres echoes a uuid in", () => {
    const parsed = CreateSetSchema.parse({ clientGeneratedId: key.toUpperCase() });
    expect(parsed.clientGeneratedId).toBe(key);
  });
  it("CreateSetSchema rejects a non-GUID and null", () => {
    expect(CreateSetSchema.safeParse({ clientGeneratedId: "not-a-uuid" }).success).toBe(false);
    expect(CreateSetSchema.safeParse({ clientGeneratedId: null }).success).toBe(false);
  });
  it("UpdateSetSchema treats it as an unknown key, and keeps every other create field", () => {
    expect(UpdateSetSchema.safeParse({ clientGeneratedId: key }).success).toBe(false);
    expect(Object.keys(UpdateSetSchema.shape).sort()).toEqual(
      Object.keys(CreateSetSchema.shape)
        .filter((k) => k !== "clientGeneratedId")
        .sort(),
    );
  });
  it("SetEntrySchema echoes it back: a GUID, or null for a set created without one", () => {
    expect(SetEntrySchema.safeParse({ ...validSet, clientGeneratedId: key }).success).toBe(true);
    expect(SetEntrySchema.safeParse({ ...validSet, clientGeneratedId: null }).success).toBe(true);
    expect(SetEntrySchema.safeParse({ ...validSet, clientGeneratedId: undefined }).success).toBe(false);
  });
});

describe("AC17 — SetEntrySchema and the WorkoutDetail extension (D12)", () => {
  it("parses a valid set; rejects setNumber 0", () => {
    expect(SetEntrySchema.safeParse(validSet).success).toBe(true);
    expect(SetEntrySchema.safeParse({ ...validSet, setNumber: 0 }).success).toBe(false);
  });
  it("WorkoutExerciseDetailSchema requires a sets array; WorkoutDetailSchema.exercises uses it", () => {
    const we = {
      id: "018fcb3e-3b8a-7d6e-9c1a-000000000005",
      workoutId: "018fcb3e-3b8a-7d6e-9c1a-000000000001",
      position: 0,
      exerciseId: "018fcb3e-3b8a-7d6e-9c1a-000000000006",
      exerciseNameSnapshot: "Bench Press",
      modalitySnapshot: "weight_reps",
      notes: null,
      createdAt: validSet.createdAt,
      updatedAt: validSet.updatedAt,
      targetSets: null,
      targetRepsLow: null,
      targetRepsHigh: null,
      targetRpe: null,
      restSeconds: null,
      supersetGroup: null,
      plannedSets: [],
      sectionId: null,
    };
    expect(WorkoutExerciseDetailSchema.safeParse({ ...we, sets: [validSet] }).success).toBe(true);
    expect(WorkoutExerciseDetailSchema.safeParse(we).success).toBe(false);
    expect(WorkoutDetailSchema.shape.exercises.element).toBe(WorkoutExerciseDetailSchema);
  });
});

describe("05.3 AC4 — calories on the wire", () => {
  const base = { isComplete: true };
  it.each([20, 0, SET_CALORIES_MAX, null])("CreateSetSchema accepts calories: %s", (calories) => {
    expect(CreateSetSchema.safeParse({ ...base, calories }).success).toBe(true);
  });
  it("CreateSetSchema accepts an absent calories key", () => {
    expect(CreateSetSchema.safeParse(base).success).toBe(true);
  });
  it.each([20.5, -1, SET_CALORIES_MAX + 1, "20"])("CreateSetSchema rejects calories: %s", (calories) => {
    expect(CreateSetSchema.safeParse({ ...base, calories }).success).toBe(false);
  });
  it("SetEntrySchema requires the key: null passes, absent fails", () => {
    expect(SetEntrySchema.safeParse({ ...validSet, calories: null }).success).toBe(true);
    expect(SetEntrySchema.safeParse({ ...validSet, calories: 20 }).success).toBe(true);
    const without: Record<string, unknown> = { ...validSet };
    delete without.calories;
    expect(SetEntrySchema.safeParse(without).success).toBe(false);
  });
  it("SET_CALORIES_MAX is the SMALLINT ceiling", () => expect(SET_CALORIES_MAX).toBe(32_767));
  it("UpdateSetSchema accepts calories", () => {
    expect(UpdateSetSchema.safeParse({ calories: 25 }).success).toBe(true);
    expect(UpdateSetSchema.safeParse({ calories: null }).success).toBe(true);
  });
  it("an unknown key is still rejected", () => {
    expect(CreateSetSchema.safeParse({ calorie: 20 }).success).toBe(false);
  });
});

describe("05.3 AC39 — feet on the wire", () => {
  it("CreateSetSchema accepts distanceUnit ft with a distance", () => {
    expect(CreateSetSchema.safeParse({ distance: 40, distanceUnit: "ft" }).success).toBe(true);
    expect(UpdateSetSchema.safeParse({ distance: 40, distanceUnit: "ft" }).success).toBe(true);
  });
  it("rejects yd with a static message", () => {
    const r = CreateSetSchema.safeParse({ distance: 40, distanceUnit: "yd" });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).not.toContain("yd\"");
  });
});
