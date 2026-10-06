import { describe, expect, it } from "vitest";
import {
  PersonalRecordSchema,
  PersonalRecordsQuerySchema,
  PersonalRecordsResponseSchema,
  UpdatedWorkoutSchema,
} from "../src/index.js";

const validRecord = {
  exerciseId: "018fcb3e-3b8a-7d6e-9c1a-000000000001",
  sourceExerciseId: "018fcb3e-3b8a-7d6e-9c1a-000000000002",
  exerciseName: "Bench Press",
  recordType: "best_est_1rm",
  value: 116.667,
  unit: "kg",
  previousValue: 110,
  sourceSetId: "018fcb3e-3b8a-7d6e-9c1a-000000000003",
  workoutId: "018fcb3e-3b8a-7d6e-9c1a-000000000004",
  achievedAt: "2026-10-01T10:00:00.000Z",
  localDate: "2026-10-01",
};

describe("AC25 — PersonalRecordSchema", () => {
  it("parses a valid payload, previousValue null included", () => {
    expect(PersonalRecordSchema.parse(validRecord)).toEqual(validRecord);
    expect(PersonalRecordSchema.parse({ ...validRecord, previousValue: null }).previousValue).toBeNull();
  });
  it("rejects a missing field and an unknown record type", () => {
    const { workoutId: _omit, ...missing } = validRecord;
    expect(PersonalRecordSchema.safeParse(missing).success).toBe(false);
    expect(PersonalRecordSchema.safeParse({ ...validRecord, recordType: "rep_pr_at_weight" }).success).toBe(false);
  });
  it("rejects a non-positive value", () => {
    expect(PersonalRecordSchema.safeParse({ ...validRecord, value: 0 }).success).toBe(false);
  });
});

describe("AC25 — PersonalRecordsQuerySchema / ResponseSchema", () => {
  it("both filters are optional ids; a malformed id fails", () => {
    expect(PersonalRecordsQuerySchema.parse({})).toEqual({});
    expect(PersonalRecordsQuerySchema.safeParse({ workoutId: "not-a-uuid" }).success).toBe(false);
    expect(PersonalRecordsQuerySchema.safeParse({ exerciseId: validRecord.exerciseId }).success).toBe(true);
  });
  it("wraps records in { records }", () => {
    expect(PersonalRecordsResponseSchema.parse({ records: [validRecord] }).records).toHaveLength(1);
  });
});

describe("AC25 — UpdatedWorkoutSchema = Workout + newRecords", () => {
  it("requires newRecords", () => {
    const workout = {
      id: "018fcb3e-3b8a-7d6e-9c1a-000000000010",
      title: null,
      notes: null,
      startedAt: "2026-09-01T10:00:00.000Z",
      endedAt: "2026-09-01T11:00:00.000Z",
      localDate: "2026-09-01",
      tzOffsetMinutes: 0,
      clientGeneratedId: "018fcb3e-3b8a-7d6e-9c1a-000000000011",
      source: "manual",
      createdAt: "2026-09-01T10:00:00.000Z",
      updatedAt: "2026-09-01T11:00:00.000Z",
    };
    expect(UpdatedWorkoutSchema.safeParse(workout).success).toBe(false);
    expect(UpdatedWorkoutSchema.parse({ ...workout, newRecords: [validRecord] }).newRecords).toHaveLength(1);
  });
});
