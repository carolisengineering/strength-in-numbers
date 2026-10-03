import { describe, expect, it } from "vitest";
import { createWorkoutClient, type WorkoutClient } from "./workoutClient";

function recordingApi() {
  const paths: string[] = [];
  const make = () => async (path: string) => {
    paths.push(path);
    return undefined;
  };
  const api = { get: make(), post: make(), patch: make(), delete: make() };
  return { api: api as never, paths };
}

const OPERATIONS: [keyof WorkoutClient, (c: WorkoutClient, id: string) => Promise<unknown>, (seg: string) => string][] = [
  ["getById", (c, id) => c.getById(id), (s) => `/v1/workouts/${s}`],
  ["finish", (c, id) => c.finish(id, { endedAt: "2026-10-02T11:00:00.000Z" }), (s) => `/v1/workouts/${s}`],
  ["deleteWorkout", (c, id) => c.deleteWorkout(id), (s) => `/v1/workouts/${s}`],
  ["addExercise", (c, id) => c.addExercise(id, { exerciseId: "e1" }), (s) => `/v1/workouts/${s}/exercises`],
  ["moveExercise", (c, id) => c.moveExercise(id, 1), (s) => `/v1/workout-exercises/${s}`],
  ["removeExercise", (c, id) => c.removeExercise(id), (s) => `/v1/workout-exercises/${s}`],
  [
    "createSet",
    (c, id) => c.createSet(id, { isComplete: true, clientGeneratedId: "k" } as never),
    (s) => `/v1/workout-exercises/${s}/sets`,
  ],
  ["updateSet", (c, id) => c.updateSet(id, { reps: 5 }), (s) => `/v1/sets/${s}`],
  ["deleteSet", (c, id) => c.deleteSet(id), (s) => `/v1/sets/${s}`],
];

describe("06.4 AC5 — every id interpolated into a request path is encoded", () => {
  it.each(OPERATIONS)("%s encodes a hostile id into one path segment", async (_name, call, expected) => {
    const { api, paths } = recordingApi();
    await call(createWorkoutClient(api), "a/b?c#d");
    expect(paths).toEqual([expected("a%2Fb%3Fc%23d")]);
  });

  it.each(OPERATIONS)("%s leaves a lower-case GUID unchanged", async (_name, call, expected) => {
    const guid = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const { api, paths } = recordingApi();
    await call(createWorkoutClient(api), guid);
    expect(paths).toEqual([expected(guid)]);
  });
});
