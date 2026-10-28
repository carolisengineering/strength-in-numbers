import { describe, expect, it } from "vitest";
import {
  HEVY_IMPORT_DROP_CODES,
  HEVY_IMPORT_NOTICE_CODES,
  HEVY_IMPORT_OUTCOME_VALUES,
  HEVY_ROUTINE_NOTICE_CODES,
  HevyImportBatchSchema,
  HevyImportFinishResponseSchema,
  HevyImportResponseSchema,
  HevyImportResultSchema,
} from "../src/index.js";

const set = (o: Record<string, unknown> = {}) => ({
  type: "normal",
  weightKg: 60,
  reps: 5,
  distanceMeters: null,
  durationSeconds: null,
  rpe: null,
  customMetric: null,
  ...o,
});
const exercise = (o: Record<string, unknown> = {}) => ({
  exerciseTemplateId: "D04AC939",
  notes: null,
  supersetId: null,
  sets: [set()],
  ...o,
});
const workout = (o: Record<string, unknown> = {}) => ({
  hevyWorkoutId: "b459cba5-cd6d-463c-abd6-54f8eafcadcb",
  title: "Push Day",
  description: null,
  startTime: "2026-10-01T10:00:00Z",
  endTime: "2026-10-01T11:00:00+00:00",
  tzOffsetMinutes: 0,
  exercises: [exercise()],
  ...o,
});
const batch = (o: Record<string, unknown> = {}) => ({ dryRun: false, workouts: [workout()], ...o });
const parses = (b: unknown) => HevyImportBatchSchema.safeParse(b).success;

const result = (o: Record<string, unknown> = {}) => ({
  hevyWorkoutId: "b459cba5",
  outcome: "create",
  workoutId: null,
  matchedWorkoutId: null,
  unpaired: [],
  drops: [{ code: "set_missing_measure", count: 2 }],
  notices: [{ code: "custom_metric_ignored", count: 1 }],
  exerciseCount: 6,
  setCount: 21,
  ...o,
});

describe("19.1 AC1 — request and result schemas", () => {
  it("a valid one-workout batch parses", () => {
    expect(parses(batch())).toBe(true);
  });

  it("rejects 0 and 26 workouts", () => {
    expect(parses(batch({ workouts: [] }))).toBe(false);
    expect(parses(batch({ workouts: Array.from({ length: 25 }, () => workout()) }))).toBe(true);
    expect(parses(batch({ workouts: Array.from({ length: 26 }, () => workout()) }))).toBe(false);
  });

  it("rejects a 201st exercise and a 201st set", () => {
    expect(parses(batch({ workouts: [workout({ exercises: Array.from({ length: 200 }, () => exercise()) })] }))).toBe(true);
    expect(parses(batch({ workouts: [workout({ exercises: Array.from({ length: 201 }, () => exercise()) })] }))).toBe(false);
    expect(parses(batch({ workouts: [workout({ exercises: [exercise({ sets: Array.from({ length: 200 }, () => set()) })] })] }))).toBe(true);
    expect(parses(batch({ workouts: [workout({ exercises: [exercise({ sets: Array.from({ length: 201 }, () => set()) })] })] }))).toBe(false);
  });

  it("rejects an unknown key at batch, workout, exercise and set level", () => {
    expect(parses({ ...batch(), extra: 1 })).toBe(false);
    expect(parses(batch({ workouts: [{ ...workout(), extra: 1 }] }))).toBe(false);
    expect(parses(batch({ workouts: [workout({ exercises: [{ ...exercise(), extra: 1 }] })] }))).toBe(false);
    expect(parses(batch({ workouts: [workout({ exercises: [exercise({ sets: [{ ...set(), extra: 1 }] })] })] }))).toBe(false);
  });

  it("bounds tzOffsetMinutes to −720 … 840", () => {
    expect(parses(batch({ workouts: [workout({ tzOffsetMinutes: -721 })] }))).toBe(false);
    expect(parses(batch({ workouts: [workout({ tzOffsetMinutes: 841 })] }))).toBe(false);
    expect(parses(batch({ workouts: [workout({ tzOffsetMinutes: -720 })] }))).toBe(true);
    expect(parses(batch({ workouts: [workout({ tzOffsetMinutes: 840 })] }))).toBe(true);
    expect(parses(batch({ workouts: [workout({ tzOffsetMinutes: 1.5 })] }))).toBe(false);
  });

  it("bounds hevyWorkoutId to 1–64 characters", () => {
    expect(parses(batch({ workouts: [workout({ hevyWorkoutId: "" })] }))).toBe(false);
    expect(parses(batch({ workouts: [workout({ hevyWorkoutId: "x".repeat(64) })] }))).toBe(true);
    expect(parses(batch({ workouts: [workout({ hevyWorkoutId: "x".repeat(65) })] }))).toBe(false);
  });

  it("bounds the title to 200 and the description to 20 000; both nullable", () => {
    expect(parses(batch({ workouts: [workout({ title: "t".repeat(200), description: "d".repeat(20_000) })] }))).toBe(true);
    expect(parses(batch({ workouts: [workout({ title: "t".repeat(201) })] }))).toBe(false);
    expect(parses(batch({ workouts: [workout({ description: "d".repeat(20_001) })] }))).toBe(false);
    expect(parses(batch({ workouts: [workout({ title: null, description: null })] }))).toBe(true);
  });

  it("rejects a startTime without an offset", () => {
    expect(parses(batch({ workouts: [workout({ startTime: "2026-10-01T10:00:00" })] }))).toBe(false);
    expect(parses(batch({ workouts: [workout({ startTime: "2026-10-01T10:00:00+02:00" })] }))).toBe(true);
  });

  it("supersetId is an integer ≥ 0 or null", () => {
    expect(parses(batch({ workouts: [workout({ exercises: [exercise({ supersetId: -1 })] })] }))).toBe(false);
    expect(parses(batch({ workouts: [workout({ exercises: [exercise({ supersetId: 1.5 })] })] }))).toBe(false);
    expect(parses(batch({ workouts: [workout({ exercises: [exercise({ supersetId: 0 })] })] }))).toBe(true);
  });

  it("bounds exerciseTemplateId to 1–64 characters", () => {
    expect(parses(batch({ workouts: [workout({ exercises: [exercise({ exerciseTemplateId: "" })] })] }))).toBe(false);
    expect(parses(batch({ workouts: [workout({ exercises: [exercise({ exerciseTemplateId: "x".repeat(65) })] })] }))).toBe(false);
  });

  it("takes only Hevy's set types", () => {
    expect(parses(batch({ workouts: [workout({ exercises: [exercise({ sets: [set({ type: "working" })] })] })] }))).toBe(false);
    for (const type of ["warmup", "normal", "failure", "dropset"]) {
      expect(parses(batch({ workouts: [workout({ exercises: [exercise({ sets: [set({ type })] })] })] }))).toBe(true);
    }
  });

  it("numbers are finite or null; ranges are the translator's", () => {
    expect(parses(batch({ workouts: [workout({ exercises: [exercise({ sets: [set({ weightKg: Infinity })] })] })] }))).toBe(false);
    expect(parses(batch({ workouts: [workout({ exercises: [exercise({ sets: [set({ weightKg: null })] })] })] }))).toBe(true);
    expect(parses(batch({ workouts: [workout({ exercises: [exercise({ sets: [set({ reps: -3, weightKg: 99_999 })] })] })] }))).toBe(true);
  });

  it("the result schema takes a valid result and rejects an unknown outcome or code", () => {
    expect(HevyImportResultSchema.safeParse(result()).success).toBe(true);
    expect(HevyImportResultSchema.safeParse(result({ outcome: "imported" })).success).toBe(false);
    expect(HevyImportResultSchema.safeParse(result({ drops: [{ code: "custom_metric_ignored", count: 1 }] })).success).toBe(false);
    expect(HevyImportResultSchema.safeParse(result({ notices: [{ code: "set_out_of_range", count: 1 }] })).success).toBe(false);
  });

  it("the response and finish-response schemas parse their shapes", () => {
    expect(HevyImportResponseSchema.safeParse({ dryRun: true, results: [result()] }).success).toBe(true);
    expect(HevyImportFinishResponseSchema.safeParse({ recomputed: true, rootCount: 41 }).success).toBe(true);
    expect(HevyImportFinishResponseSchema.safeParse({ recomputed: true }).success).toBe(false);
  });

  it("every code list holds unique values, and the outcome list is the spec's", () => {
    for (const list of [HEVY_IMPORT_OUTCOME_VALUES, HEVY_IMPORT_DROP_CODES, HEVY_IMPORT_NOTICE_CODES, HEVY_ROUTINE_NOTICE_CODES]) {
      expect(new Set(list).size).toBe(list.length);
    }
    expect(HEVY_IMPORT_OUTCOME_VALUES).toEqual([
      "create",
      "already_imported",
      "sent_from_sin",
      "already_matched",
      "deleted_in_sin",
      "duplicate",
      "unpaired",
      "no_usable_sets",
      "time_invalid",
      "rejected",
    ]);
  });
});
