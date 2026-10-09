import { describe, expect, it } from "vitest";
import {
  WORKOUT_HISTORY_LIMIT_DEFAULT,
  WORKOUT_HISTORY_LIMIT_MAX,
  WORKOUT_SUMMARY_NAMES_MAX,
  WorkoutHistoryQuerySchema,
  WorkoutHistoryResponseSchema,
  WorkoutSummarySchema,
} from "../src/index.js";

const workout = {
  id: "018fcb3e-3b8a-7d6e-9c1a-000000000010",
  title: "Push day",
  notes: null,
  startedAt: "2026-09-01T10:00:00.000Z",
  endedAt: "2026-09-01T11:00:00.000Z",
  localDate: "2026-09-01",
  tzOffsetMinutes: 0,
  clientGeneratedId: "018fcb3e-3b8a-7d6e-9c1a-000000000011",
  source: "manual",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T11:00:00.000Z",
  routineName: null,
};
const summary = {
  ...workout,
  exerciseCount: 5,
  exerciseNames: ["Bench", "Row", "Dips"],
  workingSetCount: 15,
  totalVolume: 843.705,
  recordCount: 2,
};

describe("AC18 — history constants", () => {
  it("hold the §5 values", () => {
    expect([WORKOUT_HISTORY_LIMIT_DEFAULT, WORKOUT_HISTORY_LIMIT_MAX, WORKOUT_SUMMARY_NAMES_MAX]).toEqual([20, 50, 3]);
  });
});

describe("AC18 — WorkoutSummarySchema", () => {
  it("parses a valid summary, totalVolume null included", () => {
    expect(WorkoutSummarySchema.parse(summary)).toEqual(summary);
    expect(WorkoutSummarySchema.parse({ ...summary, totalVolume: null }).totalVolume).toBeNull();
  });
  it("rejects a missing summary field, a negative count, zero volume and a 4th name", () => {
    const missing: Record<string, unknown> = { ...summary };
    delete missing.recordCount;
    expect(WorkoutSummarySchema.safeParse(missing).success).toBe(false);
    expect(WorkoutSummarySchema.safeParse({ ...summary, exerciseCount: -1 }).success).toBe(false);
    expect(WorkoutSummarySchema.safeParse({ ...summary, totalVolume: 0 }).success).toBe(false);
    expect(WorkoutSummarySchema.safeParse({ ...summary, exerciseNames: ["a", "b", "c", "d"] }).success).toBe(false);
  });
});

describe("AC5/AC18 — WorkoutHistoryQuerySchema", () => {
  it("defaults limit to 20 and passes cursor through", () => {
    expect(WorkoutHistoryQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(WorkoutHistoryQuerySchema.parse({ limit: "50", cursor: "v1.x" })).toEqual({ limit: 50, cursor: "v1.x" });
    expect(WorkoutHistoryQuerySchema.parse({ limit: "1" }).limit).toBe(1);
  });
  it.each(["0", "51", "2.5", "-1", "abc", "", "1e1", " 5", "0x10", "1000"])("rejects limit=%j", (limit) => {
    expect(WorkoutHistoryQuerySchema.safeParse({ limit }).success).toBe(false);
  });
});

describe("AC18 — WorkoutHistoryResponseSchema", () => {
  it("wraps items and a nullable next", () => {
    expect(WorkoutHistoryResponseSchema.parse({ items: [summary], next: "v1.abc" }).items).toHaveLength(1);
    expect(WorkoutHistoryResponseSchema.parse({ items: [], next: null }).next).toBeNull();
  });
});
