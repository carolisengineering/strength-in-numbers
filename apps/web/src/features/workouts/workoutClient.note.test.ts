import { describe, expect, it, vi } from "vitest";
import { WorkoutExerciseSchema } from "@sin/core";
import { makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutClient, type WorkoutExercisePatch } from "./workoutClient";

const row = makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "X" }] }).exercises[0]!;
const api = () => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn<(path: string, body: unknown, schema: unknown) => Promise<typeof row>>(async () => row), delete: vi.fn() });
const client = (a: ReturnType<typeof api>) => createWorkoutClient(a as unknown as Parameters<typeof createWorkoutClient>[0]);

describe("10.3 AC28 — setExerciseNote on the wire", () => {
  it("PATCHes /v1/workout-exercises/{id} with exactly { notes }", async () => {
    const a = api();
    await client(a).setExerciseNote("we/1", "Pause every rep");
    expect(a.patch).toHaveBeenCalledWith("/v1/workout-exercises/we%2F1", { notes: "Pause every rep" }, WorkoutExerciseSchema);
  });
  it("clearing sends notes: null (never position or supersetGroup)", async () => {
    const a = api();
    await client(a).setExerciseNote("we", null);
    expect(a.patch.mock.calls[0]![1]).toEqual({ notes: null });
  });
  it("a regroup patch can still never carry notes (Spec 10.1 AC11)", async () => {
    // @ts-expect-error — WorkoutExercisePatch has no `notes` key, by design
    const bad: WorkoutExercisePatch = { notes: "x" };
    const a = api();
    await client(a).updateWorkoutExercise("we", { position: 2 });
    expect(a.patch.mock.calls[0]![1]).toEqual({ position: 2 });
    expect(bad).toBeDefined();
  });
});
