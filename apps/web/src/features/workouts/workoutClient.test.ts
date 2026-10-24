import { describe, expect, it, vi } from "vitest";
import {
  SetEntrySchema,
  UpdatedWorkoutSchema,
  WorkoutDetailSchema,
  WorkoutExerciseSchema,
  WorkoutSchema,
  WorkoutSectionSchema,
} from "@sin/core";
import { ApiError } from "../../api";
import { makePersonalRecord, makeWorkoutDetail } from "../../test/workoutFixtures";
import { memoryStorageAdapter } from "../../storage/storage";
import { fakeClient } from "../../test/workoutHarness";
import { createOutbox } from "./outbox/outbox";
import { createQueuedWorkoutClient } from "./outbox/queuedWorkoutClient";
import { createWorkoutClient, type WorkoutExercisePatch } from "./workoutClient";

describe("08.0 AC5 — finish keeps newRecords", () => {
  it("parses the PATCH response with UpdatedWorkoutSchema, so newRecords survives", async () => {
    const detail = makeWorkoutDetail({ endedAt: "2026-10-02T11:00:00.000Z" });
    const records = [
      makePersonalRecord({ workoutId: detail.id }),
      makePersonalRecord({ workoutId: detail.id, recordType: "best_est_1rm" }),
    ];
    const payload = { ...WorkoutSchema.parse(detail), newRecords: records };
    const { api } = recordingApi((call) => (call.schema as { parse: (x: unknown) => unknown }).parse(payload));

    const result = await createWorkoutClient(api).finish(detail.id, { endedAt: "2026-10-02T11:00:00.000Z" });

    expect(result.newRecords).toEqual(records);
  });
});

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
      schema: UpdatedWorkoutSchema,
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

describe("10.1 AC11 — updateWorkoutExercise", () => {
  it("sends exactly the keys passed; null supersetGroup is sent as null; the path is encoded", async () => {
    const { api, calls } = recordingApi();
    const client = createWorkoutClient(api);
    await client.updateWorkoutExercise("a/b?c#d", { supersetGroup: 3 });
    await client.updateWorkoutExercise("we1", { supersetGroup: null });
    await client.updateWorkoutExercise("we1", { position: 2 });
    await client.updateWorkoutExercise("we1", { position: 0, supersetGroup: 1 });
    expect(calls.map((c) => [c.method, c.path, c.body])).toStrictEqual([
      ["patch", "/v1/workout-exercises/a%2Fb%3Fc%23d", { supersetGroup: 3 }],
      ["patch", "/v1/workout-exercises/we1", { supersetGroup: null }],
      ["patch", "/v1/workout-exercises/we1", { position: 2 }],
      ["patch", "/v1/workout-exercises/we1", { position: 0, supersetGroup: 1 }],
    ]);
    for (const call of calls) expect(call.schema).toBe(WorkoutExerciseSchema);
  });
  it("moveExercise issues the byte-identical { position } request", async () => {
    const { api, calls } = recordingApi();
    await createWorkoutClient(api).moveExercise("we1", 2);
    expect(JSON.stringify(calls[0]!.body)).toBe('{"position":2}');
  });
  it("the method has no notes parameter (Spec 09 D22)", async () => {
    const { api } = recordingApi();
    // @ts-expect-error — notes is not part of WorkoutExercisePatch
    await createWorkoutClient(api).updateWorkoutExercise("we1", { notes: "x" });
  });
});

describe("18.0 AC54 — updateWorkout sends exactly the keys given", () => {
  it("PATCH /v1/workouts/{id} with only the given keys, parsed with UpdatedWorkoutSchema", async () => {
    const { api, calls } = recordingApi();
    const client = createWorkoutClient(api);
    await client.updateWorkout("w/1", { title: "T" });
    await client.updateWorkout("w/1", { title: null });
    await client.updateWorkout("w/1", { notes: "a\nb" });
    expect(calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ["patch", "/v1/workouts/w%2F1", { title: "T" }],
      ["patch", "/v1/workouts/w%2F1", { title: null }],
      ["patch", "/v1/workouts/w%2F1", { notes: "a\nb" }],
    ]);
    expect(calls.every((c) => c.schema === UpdatedWorkoutSchema)).toBe(true);
  });

  it("the queued client hands it to REST and never enqueues", async () => {
    const updateWorkout = vi.fn(async () => ({}) as never);
    const rest = fakeClient({ updateWorkout });
    const outbox = createOutbox({ storage: memoryStorageAdapter(), rest, userId: "u1", isOnline: () => false });
    const workout = makeWorkoutDetail();
    const queued = createQueuedWorkoutClient({ rest, outbox, cached: () => workout });
    await queued.updateWorkout(workout.id, { title: "T" });
    expect(updateWorkout).toHaveBeenCalledWith(workout.id, { title: "T" });
    expect(outbox.getState().ops).toEqual([]);
  });
});

describe("18.0 AC29 — updateWorkout carries the Change Time keys", () => {
  it("sends exactly the given time keys, null included", async () => {
    const { api, calls } = recordingApi();
    const client = createWorkoutClient(api);
    await client.updateWorkout("w1", { startedAt: "2026-10-16T17:00:00.000Z", tzOffsetMinutes: 60 });
    await client.updateWorkout("w1", { durationSeconds: null });
    await client.updateWorkout("w1", { durationSeconds: 3600 });
    expect(calls.map((c) => c.body)).toEqual([
      { startedAt: "2026-10-16T17:00:00.000Z", tzOffsetMinutes: 60 },
      { durationSeconds: null },
      { durationSeconds: 3600 },
    ]);
    expect(calls.every((c) => c.schema === UpdatedWorkoutSchema)).toBe(true);
  });

  it("the queued client hands a time change to REST and never enqueues", async () => {
    const updateWorkout = vi.fn(async () => ({}) as never);
    const rest = fakeClient({ updateWorkout });
    const outbox = createOutbox({ storage: memoryStorageAdapter(), rest, userId: "u1", isOnline: () => false });
    const workout = makeWorkoutDetail();
    const queued = createQueuedWorkoutClient({ rest, outbox, cached: () => workout });
    await queued.updateWorkout(workout.id, { durationSeconds: 1800 });
    expect(updateWorkout).toHaveBeenCalledWith(workout.id, { durationSeconds: 1800 });
    expect(outbox.getState().ops).toEqual([]);
  });

  it("finish still sends endedAt only", async () => {
    const { api, calls } = recordingApi();
    await createWorkoutClient(api).finish("w1", { endedAt: "2026-10-16T18:00:00.000Z" });
    expect(Object.keys(calls[0]!.body as object)).toEqual(["endedAt"]);
  });
});

describe("10.5 AC13 — finish forwards the body as given", () => {
  it("{ endedAt } and { endedAt, keepRoutine: true } go to the wire unchanged", async () => {
    const { api, calls } = recordingApi();
    const client = createWorkoutClient(api);
    await client.finish("w1", { endedAt: "2026-10-16T18:00:00.000Z" });
    await client.finish("w1", { endedAt: "2026-10-16T18:00:00.000Z", keepRoutine: true });
    expect(calls.map((c) => c.body)).toStrictEqual([
      { endedAt: "2026-10-16T18:00:00.000Z" },
      { endedAt: "2026-10-16T18:00:00.000Z", keepRoutine: true },
    ]);
  });
});

describe("10.6 AC9 — the wire", () => {
  it("each section method sends its method, path and exact body", async () => {
    const { api, calls } = recordingApi();
    const client = createWorkoutClient(api);
    await client.addSection("w/1", { name: "Warm-up" });
    await client.addSection("w1", { name: "Strength", notes: "EMOM" });
    await client.updateSection("s/1", { notes: null });
    await client.removeSection("s1");
    await client.setExerciseSection("we/1", "s1");
    await client.setExerciseSection("we1", null);
    expect(calls.map(({ method, path, body }) => ({ method, path, body }))).toStrictEqual([
      { method: "post", path: "/v1/workouts/w%2F1/sections", body: { name: "Warm-up" } },
      { method: "post", path: "/v1/workouts/w1/sections", body: { name: "Strength", notes: "EMOM" } },
      { method: "patch", path: "/v1/workout-sections/s%2F1", body: { notes: null } },
      { method: "delete", path: "/v1/workout-sections/s1", body: undefined },
      { method: "patch", path: "/v1/workout-exercises/we%2F1", body: { sectionId: "s1" } },
      { method: "patch", path: "/v1/workout-exercises/we1", body: { sectionId: null } },
    ]);
    expect(JSON.stringify(calls[5]!.body)).toBe('{"sectionId":null}');
    expect(calls[0]!.schema).toBe(WorkoutSectionSchema);
    expect(calls[4]!.schema).toBe(WorkoutExerciseSchema);
  });

  it("updateSection sends only the keys given", async () => {
    const { api, calls } = recordingApi();
    await createWorkoutClient(api).updateSection("s1", { name: "A" });
    expect(Object.keys(calls[0]!.body as object)).toEqual(["name"]);
  });

  it("WorkoutExercisePatch has no sectionId", () => {
    // @ts-expect-error — a regroup can never write a section (Spec 10.1 AC11 pattern).
    const p: WorkoutExercisePatch = { sectionId: null };
    expect(p).toBeDefined();
  });

  it("the queued client passes the four methods through and never enqueues", async () => {
    const addSection = vi.fn(async () => ({}) as never);
    const setExerciseSection = vi.fn(async () => ({}) as never);
    const rest = fakeClient({ addSection, setExerciseSection });
    const outbox = createOutbox({ storage: memoryStorageAdapter(), rest, userId: "u1", isOnline: () => true });
    const workout = makeWorkoutDetail();
    const queued = createQueuedWorkoutClient({ rest, outbox, cached: () => workout });
    await queued.addSection(workout.id, { name: "A" });
    await queued.setExerciseSection("we1", null);
    expect(addSection).toHaveBeenCalledWith(workout.id, { name: "A" });
    expect(setExerciseSection).toHaveBeenCalledWith("we1", null);
    expect(outbox.getState().ops).toEqual([]);
  });
});
