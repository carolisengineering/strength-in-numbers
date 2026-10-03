import { describe, expect, it } from "vitest";
import {
  SetEntrySchema,
  WorkoutDetailSchema,
  WorkoutExerciseSchema,
  WorkoutSchema,
} from "@sin/core";
import { ApiError } from "../../api";
import { createWorkoutClient } from "./workoutClient";

interface Call {
  method: "get" | "post" | "patch" | "delete";
  path: string;
  body?: unknown;
  schema?: unknown;
}

function recordingApi(respond: (call: Call) => unknown = () => undefined) {
  const calls: Call[] = [];
  const make =
    (method: Call["method"]) =>
    async (path: string, ...rest: unknown[]) => {
      const call: Call =
        method === "post" || method === "patch"
          ? { method, path, body: rest[0], schema: rest[1] }
          : { method, path, schema: rest[0] };
      calls.push(call);
      return respond(call);
    };
  const api = { get: make("get"), post: make("post"), patch: make("patch"), delete: make("delete") };
  return { api: api as never, calls };
}

describe("AC1 — createWorkoutClient maps each operation to its exact request", () => {
  it("getById / start / finish", async () => {
    const { api, calls } = recordingApi();
    const client = createWorkoutClient(api);
    await client.getById("w1");
    await client.start({ clientGeneratedId: "c", startedAt: "2026-10-02T10:00:00.000Z", tzOffsetMinutes: 0 });
    await client.finish("w1", { endedAt: "2026-10-02T11:00:00.000Z" });
    expect(calls[0]).toMatchObject({ method: "get", path: "/v1/workouts/w1", schema: WorkoutDetailSchema });
    expect(calls[1]).toMatchObject({
      method: "post",
      path: "/v1/workouts",
      body: { clientGeneratedId: "c", startedAt: "2026-10-02T10:00:00.000Z", tzOffsetMinutes: 0 },
      schema: WorkoutSchema,
    });
    expect(calls[2]).toMatchObject({
      method: "patch",
      path: "/v1/workouts/w1",
      body: { endedAt: "2026-10-02T11:00:00.000Z" },
      schema: WorkoutSchema,
    });
  });

  it("addExercise sends only { exerciseId } (no position — append); moveExercise only { position }", async () => {
    const { api, calls } = recordingApi();
    const client = createWorkoutClient(api);
    await client.addExercise("w1", { exerciseId: "e1" });
    await client.moveExercise("we1", 2);
    expect(calls[0]).toMatchObject({ method: "post", path: "/v1/workouts/w1/exercises", schema: WorkoutExerciseSchema });
    expect(calls[0]!.body).toStrictEqual({ exerciseId: "e1" });
    expect(calls[1]).toMatchObject({ method: "patch", path: "/v1/workout-exercises/we1", schema: WorkoutExerciseSchema });
    expect(calls[1]!.body).toStrictEqual({ position: 2 });
  });

  it("set operations", async () => {
    const { api, calls } = recordingApi();
    const client = createWorkoutClient(api);
    await client.createSet("we1", { reps: 8, isComplete: true, clientGeneratedId: "k" });
    await client.updateSet("s1", { weight: 61 });
    expect(calls[0]).toMatchObject({
      method: "post",
      path: "/v1/workout-exercises/we1/sets",
      body: { reps: 8, isComplete: true, clientGeneratedId: "k" },
      schema: SetEntrySchema,
    });
    expect(calls[1]).toMatchObject({ method: "patch", path: "/v1/sets/s1", body: { weight: 61 }, schema: SetEntrySchema });
  });

  it("deletes hit the right path, pass no response schema, and resolve undefined", async () => {
    const { api, calls } = recordingApi();
    const client = createWorkoutClient(api);
    await expect(client.deleteWorkout("w1")).resolves.toBeUndefined();
    await expect(client.removeExercise("we1")).resolves.toBeUndefined();
    await expect(client.deleteSet("s1")).resolves.toBeUndefined();
    expect(calls.map((c) => [c.method, c.path, c.schema])).toEqual([
      ["delete", "/v1/workouts/w1", undefined],
      ["delete", "/v1/workout-exercises/we1", undefined],
      ["delete", "/v1/sets/s1", undefined],
    ]);
  });

  describe("getActive", () => {
    it("requests /v1/workouts/active with the detail schema", async () => {
      const { api, calls } = recordingApi(() => "detail");
      await expect(createWorkoutClient(api).getActive()).resolves.toBe("detail");
      expect(calls[0]).toMatchObject({ method: "get", path: "/v1/workouts/active", schema: WorkoutDetailSchema });
    });

    it("turns a 404 into null", async () => {
      const { api } = recordingApi(() => {
        throw new ApiError({ status: 404, type: "https://x/problems/not-found", title: "Not found", requestId: "r" });
      });
      await expect(createWorkoutClient(api).getActive()).resolves.toBeNull();
    });

    it("rethrows a 500 and any non-ApiError", async () => {
      const server = new ApiError({ status: 500, type: "about:blank", title: "Boom", requestId: "r" });
      await expect(
        createWorkoutClient(
          recordingApi(() => {
            throw server;
          }).api,
        ).getActive(),
      ).rejects.toBe(server);
      const plain = new Error("x");
      await expect(
        createWorkoutClient(
          recordingApi(() => {
            throw plain;
          }).api,
        ).getActive(),
      ).rejects.toBe(plain);
    });
  });
});
