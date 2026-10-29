import { describe, expect, it } from "vitest";
import {
  HevyImportBatchSchema,
  HevyWorkoutPageSchema,
  type HevyImportWorkout,
  type HevySet,
  type HevyWorkout,
  type HevyWorkoutExercise,
} from "@sin/core";

import { hevyFixtures } from "../../../test/hevyFixtures";
import { inTimeZone } from "../../../test/timeZone";
import { chunkBatches, sortNewestFirst, toImportWorkout } from "./importRequest";

const set = (over: Partial<HevySet> = {}): HevySet => ({ type: "normal", weight_kg: 60, reps: 5, ...over });
const exercise = (over: Partial<HevyWorkoutExercise> = {}): HevyWorkoutExercise => ({
  index: 0,
  title: "Bench Press (Barbell)",
  exercise_template_id: "T1",
  sets: [set()],
  ...over,
});
const workout = (over: Partial<HevyWorkout> = {}): HevyWorkout => ({
  id: "w1",
  title: "Push",
  start_time: "2026-07-01T09:00:00Z",
  end_time: "2026-07-01T10:00:00Z",
  exercises: [exercise()],
  ...over,
});

const ok = (w: HevyWorkout, zone = "UTC"): HevyImportWorkout => {
  const result = toImportWorkout(w, { zone });
  if (!result.ok) throw new Error("expected ok");
  return result.workout;
};

describe("20.1 AC6 — toImportWorkout", () => {
  it("maps snake_case to the strict camelCase request", () => {
    const w = workout({
      description: "Heavy day",
      exercises: [
        exercise({
          notes: "Pause reps",
          superset_id: 2,
          sets: [set({ index: 0, weight_kg: 100, reps: 3, distance_meters: 5, duration_seconds: 30, custom_metric: 4, rpe: 8.5 })],
        }),
      ],
    });
    expect(ok(w)).toEqual({
      hevyWorkoutId: "w1",
      title: "Push",
      description: "Heavy day",
      startTime: "2026-07-01T09:00:00Z",
      endTime: "2026-07-01T10:00:00Z",
      tzOffsetMinutes: 0,
      exercises: [
        {
          exerciseTemplateId: "T1",
          notes: "Pause reps",
          supersetId: 2,
          sets: [{ type: "normal", weightKg: 100, reps: 3, distanceMeters: 5, durationSeconds: 30, rpe: 8.5, customMetric: 4 }],
        },
      ],
    });
  });

  it("turns an absent or null optional into null, never undefined", () => {
    const w = workout({ description: null, exercises: [exercise({ sets: [{ type: "warmup" }] })] });
    const result = ok(w);
    expect(result.description).toBeNull();
    expect(result.exercises[0]!.notes).toBeNull();
    expect(result.exercises[0]!.supersetId).toBeNull();
    expect(result.exercises[0]!.sets[0]).toEqual({
      type: "warmup",
      weightKg: null,
      reps: null,
      distanceMeters: null,
      durationSeconds: null,
      rpe: null,
      customMetric: null,
    });
    expect(JSON.stringify(result)).not.toContain("index");
    expect(Object.keys(result.exercises[0]!)).not.toContain("title");
  });

  it("orders exercises and sets by Hevy index; a set without index keeps its place", () => {
    const w = workout({
      exercises: [
        exercise({ index: 1, exercise_template_id: "B", sets: [set({ index: 1, reps: 2 }), set({ index: 0, reps: 1 })] }),
        exercise({ index: 0, exercise_template_id: "A", sets: [set({ reps: 7 }), set({ reps: 8 })] }),
      ],
    });
    const result = ok(w);
    expect(result.exercises.map((e) => e.exerciseTemplateId)).toEqual(["A", "B"]);
    expect(result.exercises[1]!.sets.map((s) => s.reps)).toEqual([1, 2]);
    expect(result.exercises[0]!.sets.map((s) => s.reps)).toEqual([7, 8]);
  });

  it.each([
    ["Europe/London", "2026-07-01T09:00:00Z", 60],
    ["Europe/London", "2026-01-15T09:00:00Z", 0],
    ["America/New_York", "2026-07-01T09:00:00Z", -240],
    ["America/New_York", "2026-01-15T09:00:00Z", -300],
  ])("in %s a start of %s has offset %i (each workout's own instant)", (zone, start, offset) => {
    inTimeZone(zone, () => {
      expect(ok(workout({ start_time: start, end_time: start }), zone).tzOffsetMinutes).toBe(offset);
    });
  });

  it("an unknown set type makes the workout unreadable (D9)", () => {
    expect(toImportWorkout(workout({ exercises: [exercise({ sets: [set({ type: "superset" })] })] }), { zone: "UTC" })).toEqual({
      ok: false,
      reason: "unreadable",
    });
  });

  it("a workout the request schema can't carry is unreadable (O2, Carol 2026-10-29)", () => {
    expect(toImportWorkout(workout({ title: "x".repeat(201) }), { zone: "UTC" })).toEqual({ ok: false, reason: "unreadable" });
    const many = Array.from({ length: 201 }, (_, i) => exercise({ index: i }));
    expect(toImportWorkout(workout({ exercises: many }), { zone: "UTC" })).toEqual({ ok: false, reason: "unreadable" });
    expect(toImportWorkout(workout({ start_time: "2026-07-01T09:00:00" }), { zone: "UTC" })).toEqual({ ok: false, reason: "unreadable" });
  });

  it("every ok result passes HevyImportBatchSchema, including the fixture page", () => {
    const page = HevyWorkoutPageSchema.parse(hevyFixtures.workoutsPage());
    const all = [...page.workouts, workout(), workout({ id: "w2", description: null })];
    for (const w of all) {
      expect(() => HevyImportBatchSchema.parse({ dryRun: true, workouts: [ok(w)] })).not.toThrow();
    }
  });
});

const sized = (id: string, bytes: number): HevyImportWorkout => ({
  hevyWorkoutId: id,
  title: "t",
  description: "x".repeat(bytes),
  startTime: "2026-07-01T09:00:00Z",
  endTime: "2026-07-01T10:00:00Z",
  tzOffsetMinutes: 0,
  exercises: [],
});

describe("20.1 AC6 — chunkBatches", () => {
  it("makes batches of at most 25, in input order", () => {
    const list = Array.from({ length: 60 }, (_, i) => sized(`w${i}`, 10));
    const batches = chunkBatches(list);
    expect(batches.map((b) => b.length)).toEqual([25, 25, 10]);
    expect(batches.flat().map((w) => w.hevyWorkoutId)).toEqual(list.map((w) => w.hevyWorkoutId));
  });

  it("keeps each batch under about 400 KiB", () => {
    const list = Array.from({ length: 5 }, (_, i) => sized(`w${i}`, 150 * 1024));
    expect(chunkBatches(list).map((b) => b.length)).toEqual([2, 2, 1]);
  });

  it("sends a single workout over the byte bound alone", () => {
    const big = sized("big", 450 * 1024);
    expect(chunkBatches([sized("a", 10), big, sized("b", 10)]).map((b) => b.map((w) => w.hevyWorkoutId))).toEqual([
      ["a"],
      ["big"],
      ["b"],
    ]);
  });

  it("gives [] for [] and never loses or repeats a workout", () => {
    expect(chunkBatches([])).toEqual([]);
    const list = Array.from({ length: 40 }, (_, i) => sized(`w${i}`, (i % 7) * 30 * 1024));
    const ids = chunkBatches(list).flat().map((w) => w.hevyWorkoutId);
    expect(new Set(ids).size).toBe(40);
    expect(ids).toHaveLength(40);
  });
});

describe("20.1 AC11 — newest first", () => {
  it("sorts by start time descending, ties by id ascending", () => {
    const list = [
      { id: "b", start_time: "2026-01-01T09:00:00Z" },
      { id: "c", start_time: "2026-03-01T09:00:00Z" },
      { id: "a", start_time: "2026-01-01T09:00:00Z" },
    ];
    expect(sortNewestFirst(list).map((w) => w.id)).toEqual(["c", "a", "b"]);
    expect(list.map((w) => w.id)).toEqual(["b", "c", "a"]);
  });

  it("compares instants, not strings (an offset start)", () => {
    const list = [
      { id: "a", start_time: "2026-01-01T10:00:00+02:00" },
      { id: "b", start_time: "2026-01-01T09:00:00Z" },
    ];
    expect(sortNewestFirst(list).map((w) => w.id)).toEqual(["b", "a"]);
  });
});
