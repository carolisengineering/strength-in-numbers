import type { PlannedSet, WorkoutDetail } from "@sin/core";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { supersetRows } from "./supersetRows";
import { useCurrentExercise } from "./useCurrentExercise";

const planned = (n: number): PlannedSet[] => Array.from({ length: n }, () => ({ setType: "working", repsLow: 5, repsHigh: 5, weight: 100, weightUnit: "kg" }));
const ex = (name: string, plan = 0, logged = 0): ExerciseSpec => ({
  modality: "weight_reps",
  name,
  plannedSets: planned(plan),
  sets: Array.from({ length: logged }, (_, i) => makeSet({ setNumber: i + 1 })),
});
const idOf = (d: WorkoutDetail, name: string) => d.exercises.find((e) => e.exerciseNameSnapshot === name)!.id;
const withExercises = (d: WorkoutDetail, exercises: WorkoutDetail["exercises"]): WorkoutDetail => ({ ...d, exercises });
const addSet = (d: WorkoutDetail, name: string): WorkoutDetail =>
  withExercises(d, d.exercises.map((e) => (e.exerciseNameSnapshot === name ? { ...e, sets: [...e.sets, makeSet({ setNumber: e.sets.length + 1, workoutExerciseId: e.id })] } : e)));

function mount(detail: WorkoutDetail) {
  return renderHook(({ d }) => useCurrentExercise(supersetRows(d.exercises)), { initialProps: { d: detail } });
}

describe("17.1 AC12 — the hook initializes once and keeps the lifter's choice", () => {
  it("starts from chooseCurrent", () => {
    const d = makeWorkoutDetail({ exercises: [ex("A", 2, 2), ex("B", 2)] });
    expect(mount(d).result.current.currentId).toBe(idOf(d, "B"));
  });

  it("a refetch that would derive differently never moves a chosen exercise (another device logged)", () => {
    const d = makeWorkoutDetail({ exercises: [ex("A", 2), ex("B", 2)] });
    const hook = mount(d);
    act(() => hook.result.current.select(idOf(d, "B")));
    hook.rerender({ d: addSet(addSet(d, "B"), "B") });
    expect(hook.result.current.currentId).toBe(idOf(d, "B"));
  });

  it("re-derives when the chosen exercise disappears", () => {
    const d = makeWorkoutDetail({ exercises: [ex("A", 2), ex("B", 2)] });
    const hook = mount(d);
    act(() => hook.result.current.select(idOf(d, "B")));
    hook.rerender({ d: withExercises(d, d.exercises.filter((e) => e.exerciseNameSnapshot !== "B")) });
    expect(hook.result.current.currentId).toBe(idOf(d, "A"));
  });

  it("an empty workout has no current", () => {
    expect(mount(makeWorkoutDetail({ exercises: [] })).result.current.currentId).toBeNull();
  });
});

describe("17.1 AC13 — a newly added exercise becomes current once it appears", () => {
  it("selectWhenAdded waits for the refetch, then selects it", () => {
    const full = makeWorkoutDetail({ exercises: [ex("A"), ex("New")] });
    const before = withExercises(full, [full.exercises[0]!]);
    const hook = mount(before);
    act(() => hook.result.current.selectWhenAdded(idOf(full, "New")));
    expect(hook.result.current.currentId).toBe(idOf(full, "A"));
    hook.rerender({ d: full });
    expect(hook.result.current.currentId).toBe(idOf(full, "New"));
  });

  it("an exercise added elsewhere does not take current", () => {
    const full = makeWorkoutDetail({ exercises: [ex("A"), ex("Other")] });
    const hook = mount(withExercises(full, [full.exercises[0]!]));
    hook.rerender({ d: full });
    expect(hook.result.current.currentId).toBe(idOf(full, "A"));
  });
});

describe("17.1 AC14 — a late log never moves a lifter who has moved on", () => {
  it("advanceFrom moves only when the logged exercise is still current", () => {
    const d = makeWorkoutDetail({ exercises: [ex("A", 1), ex("B", 1), ex("C", 1)] });
    const hook = mount(d);
    act(() => hook.result.current.advanceFrom(idOf(d, "A"), idOf(d, "B")));
    expect(hook.result.current.currentId).toBe(idOf(d, "B"));
    act(() => hook.result.current.select(idOf(d, "C")));
    act(() => hook.result.current.advanceFrom(idOf(d, "B"), idOf(d, "A")));
    expect(hook.result.current.currentId).toBe(idOf(d, "C"));
  });
});
