import { describe, expect, it } from "vitest";
import { WorkoutSummarySchema } from "../src/dto/workout.js";

describe("07.6 AC8 — no shape change: the History row keeps its fields, and recordCount stays a non-negative integer", () => {
  it("the field list is unchanged", () => {
    expect(Object.keys(WorkoutSummarySchema.shape)).toEqual([
      "id", "title", "notes", "startedAt", "endedAt", "localDate", "tzOffsetMinutes", "clientGeneratedId", "source",
      "createdAt", "updatedAt", "routineName", "plannedDurationSeconds", "exerciseCount", "exerciseNames",
      "workingSetCount", "totalVolume", "recordCount", "timedSections",
    ]);
  });

  it("recordCount accepts 0 and whole counts, and refuses negatives and fractions", () => {
    const count = WorkoutSummarySchema.shape.recordCount;
    expect(count.safeParse(0).success).toBe(true);
    expect(count.safeParse(3).success).toBe(true);
    expect(count.safeParse(-1).success).toBe(false);
    expect(count.safeParse(1.5).success).toBe(false);
  });
});
