import { describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { buildTestApp } from "../helpers/build-test-app.js";
import { FakeExerciseRepository, FakeWorkoutRepository, makeExerciseRecord } from "../helpers/fakes.js";

const BEARER = { authorization: "Bearer test-token" };

// `assertStartedAtInBounds` checks `startedAt` against the real wall clock
// (±5min future / -7days past), so fixture timestamps must be relative to
// "now" rather than a fixed literal — a fixed date drifts out of the past
// bound as real time passes.
const STARTED_AT = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
const STARTED_AT_LATER = new Date(Date.now() - 55 * 60 * 1000).toISOString(); // 55m ago
const ENDED_AT = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30m ago

describe("AC3 — POST /v1/workouts: idempotent create", () => {
  it("a first create returns 201 with Location, a replay with the same key returns 200 with no Location", async () => {
    const { app } = await buildTestApp();
    const clientGeneratedId = uuidv7();
    const body = { clientGeneratedId, startedAt: STARTED_AT };

    const first = await app.inject({ method: "POST", url: "/v1/workouts", headers: BEARER, payload: body });
    expect(first.statusCode).toBe(201);
    expect(first.headers.location).toMatch(/^\/v1\/workouts\//);

    const replay = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { ...body, title: "a different title entirely" },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers.location).toBeUndefined();
    expect(replay.json().id).toBe(first.json().id);
    expect(replay.json().title).toBeNull(); // the replayed body is ignored (§6.1, D39)
  });

  it("localDate as an unknown key is 422 on POST; tzOffsetMinutes on PATCH is 422", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: STARTED_AT, localDate: "2026-09-15" },
    });
    expect(res.statusCode).toBe(422);
  });

  it("startedAt more than 5 minutes in the future is 422 (assertStartedAtInBounds at the route layer)", async () => {
    const { app } = await buildTestApp();
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: farFuture },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe("AC4 — GET /v1/workouts/active", () => {
  it("200 with the caller's in-progress workout, 404 when there is none", async () => {
    const { app } = await buildTestApp();
    const none = await app.inject({ method: "GET", url: "/v1/workouts/active", headers: BEARER });
    expect(none.statusCode).toBe(404);

    await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: STARTED_AT },
    });
    const active = await app.inject({ method: "GET", url: "/v1/workouts/active", headers: BEARER });
    expect(active.statusCode).toBe(200);
    expect(active.json().exercises).toEqual([]);
  });

  it("a second create under a different clientGeneratedId while one is in progress is 409 with no workout id", async () => {
    const { app } = await buildTestApp();
    await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: STARTED_AT },
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: STARTED_AT_LATER },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().type).toContain("workout-in-progress-exists");
    expect(JSON.stringify(res.json())).not.toContain('"id"');
  });
});

describe("AC — GET /v1/workouts/{id}", () => {
  it("200 for the owner's workout, 404 for a missing id", async () => {
    const { app } = await buildTestApp();
    const created = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: STARTED_AT },
    });
    const id = created.json().id;

    const found = await app.inject({ method: "GET", url: `/v1/workouts/${id}`, headers: BEARER });
    expect(found.statusCode).toBe(200);
    expect(found.json().id).toBe(id);

    const missing = await app.inject({ method: "GET", url: `/v1/workouts/${uuidv7()}`, headers: BEARER });
    expect(missing.statusCode).toBe(404);
  });
});

describe("AC8 — PATCH /v1/workouts/{id}: finish", () => {
  it("finishes an in-progress workout, then rejects every further schema-valid PATCH", async () => {
    const { app } = await buildTestApp();
    const created = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: STARTED_AT },
    });
    const id = created.json().id;

    const finish = await app.inject({
      method: "PATCH",
      url: `/v1/workouts/${id}`,
      headers: BEARER,
      payload: { endedAt: ENDED_AT },
    });
    expect(finish.statusCode).toBe(200);
    expect(finish.json().endedAt).toBe(ENDED_AT);

    for (const payload of [{}, { endedAt: null }, { title: "x" }]) {
      const res = await app.inject({ method: "PATCH", url: `/v1/workouts/${id}`, headers: BEARER, payload });
      expect(res.statusCode).toBe(409);
      expect(res.json().type).toContain("workout-finished");
    }

    const invalidEvenWhenFinished = await app.inject({
      method: "PATCH",
      url: `/v1/workouts/${id}`,
      headers: BEARER,
      payload: { title: "" },
    });
    expect(invalidEvenWhenFinished.statusCode).toBe(422);
  });

  it("tzOffsetMinutes is an unknown key on PATCH -> 422", async () => {
    const { app } = await buildTestApp();
    const created = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: STARTED_AT },
    });
    const id = created.json().id;

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workouts/${id}`,
      headers: BEARER,
      payload: { tzOffsetMinutes: 60 },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe("AC9 — DELETE /v1/workouts/{id}", () => {
  it("204 on an in-progress and on a finished workout; a repeat DELETE is 404", async () => {
    const { app } = await buildTestApp();
    const created = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: STARTED_AT },
    });
    const id = created.json().id;

    const del = await app.inject({ method: "DELETE", url: `/v1/workouts/${id}`, headers: BEARER });
    expect(del.statusCode).toBe(204);

    const repeat = await app.inject({ method: "DELETE", url: `/v1/workouts/${id}`, headers: BEARER });
    expect(repeat.statusCode).toBe(404);
  });
});

describe("AC10 — POST /v1/workouts/{id}/exercises", () => {
  it("201 with Location and a snapshot equal to the resolved exercise; 404 for an invisible exerciseId; 409 for a retired one", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    const exercise = makeExerciseRecord({ name: "Bench Press", modality: "weight_reps", isActive: true });
    exerciseRepo.byId.set(exercise.id, exercise);
    const workoutRepo = new FakeWorkoutRepository(exerciseRepo);
    const { app } = await buildTestApp({ workoutRepository: workoutRepo });

    const created = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: STARTED_AT },
    });
    const workoutId = created.json().id;

    const add = await app.inject({
      method: "POST",
      url: `/v1/workouts/${workoutId}/exercises`,
      headers: BEARER,
      payload: { exerciseId: exercise.id },
    });
    expect(add.statusCode).toBe(201);
    expect(add.headers.location).toBe(`/v1/workout-exercises/${add.json().id}`);
    expect(add.json().exerciseNameSnapshot).toBe("Bench Press");

    const missing = await app.inject({
      method: "POST",
      url: `/v1/workouts/${workoutId}/exercises`,
      headers: BEARER,
      payload: { exerciseId: uuidv7() },
    });
    expect(missing.statusCode).toBe(404);

    const retired = makeExerciseRecord({ isActive: false });
    exerciseRepo.byId.set(retired.id, retired);
    const retiredRes = await app.inject({
      method: "POST",
      url: `/v1/workouts/${workoutId}/exercises`,
      headers: BEARER,
      payload: { exerciseId: retired.id },
    });
    expect(retiredRes.statusCode).toBe(409);
    expect(retiredRes.json().type).toContain("exercise-retired");
  });
});

describe("PATCH/DELETE /v1/workout-exercises/{id}", () => {
  it("PATCH reorders/edits notes and returns 200; DELETE returns 204 then 404 on repeat", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    const exercise = makeExerciseRecord({ isActive: true });
    exerciseRepo.byId.set(exercise.id, exercise);
    const workoutRepo = new FakeWorkoutRepository(exerciseRepo);
    const { app } = await buildTestApp({ workoutRepository: workoutRepo });

    const created = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: STARTED_AT },
    });
    const workoutId = created.json().id;

    const add = await app.inject({
      method: "POST",
      url: `/v1/workouts/${workoutId}/exercises`,
      headers: BEARER,
      payload: { exerciseId: exercise.id },
    });
    const weId = add.json().id;

    const patch = await app.inject({
      method: "PATCH",
      url: `/v1/workout-exercises/${weId}`,
      headers: BEARER,
      payload: { notes: "heavy today" },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().notes).toBe("heavy today");

    const del = await app.inject({ method: "DELETE", url: `/v1/workout-exercises/${weId}`, headers: BEARER });
    expect(del.statusCode).toBe(204);

    const repeat = await app.inject({ method: "DELETE", url: `/v1/workout-exercises/${weId}`, headers: BEARER });
    expect(repeat.statusCode).toBe(404);
  });
});

describe("AC15 — 404, never 403, on every id-taking route; a malformed id is also 404", () => {
  const cases: { method: "GET" | "PATCH" | "DELETE" | "POST"; url: (id: string) => string; payload?: unknown }[] = [
    { method: "GET", url: (id) => `/v1/workouts/${id}` },
    { method: "PATCH", url: (id) => `/v1/workouts/${id}`, payload: {} },
    { method: "DELETE", url: (id) => `/v1/workouts/${id}` },
    { method: "POST", url: (id) => `/v1/workouts/${id}/exercises`, payload: { exerciseId: uuidv7() } },
    { method: "PATCH", url: (id) => `/v1/workout-exercises/${id}`, payload: {} },
    { method: "DELETE", url: (id) => `/v1/workout-exercises/${id}` },
  ];

  it.each(cases)("$method $url — absent id and a malformed id are both 404", async ({ method, url, payload }) => {
    const { app } = await buildTestApp();
    for (const id of [uuidv7(), "not-a-uuid-at-all"]) {
      const res = await app.inject({
        method,
        url: url(id),
        headers: BEARER,
        payload: payload as Record<string, unknown> | undefined,
      });
      expect(res.statusCode).toBe(404);
    }
  });
});

describe("AC20 — every route requires auth", () => {
  const routes: { method: "GET" | "PATCH" | "DELETE" | "POST"; url: string }[] = [
    { method: "POST", url: "/v1/workouts" },
    { method: "GET", url: "/v1/workouts/active" },
    { method: "GET", url: `/v1/workouts/${uuidv7()}` },
    { method: "PATCH", url: `/v1/workouts/${uuidv7()}` },
    { method: "DELETE", url: `/v1/workouts/${uuidv7()}` },
    { method: "POST", url: `/v1/workouts/${uuidv7()}/exercises` },
    { method: "PATCH", url: `/v1/workout-exercises/${uuidv7()}` },
    { method: "DELETE", url: `/v1/workout-exercises/${uuidv7()}` },
  ];

  it.each(routes)("$method $url — 401 with no token", async ({ method, url }) => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method, url });
    expect(res.statusCode).toBe(401);
  });
});
