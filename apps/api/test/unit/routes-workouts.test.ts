import { describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { UpdatedWorkoutSchema, WorkoutSummarySchema } from "@sin/core";
import { buildTestApp } from "../helpers/build-test-app.js";
import { FakeExerciseRepository, FakeRoutineRepository, FakeWorkoutRepository, makeExerciseRecord } from "../helpers/fakes.js";

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

describe("09.3 AC1 / AC4 — routineIsOneOff is on the workout detail only", () => {
  it("the detail and active carry it; the finish response, a History row and exercise writes do not", async () => {
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
    expect(created.json()).not.toHaveProperty("routineIsOneOff");
    const id = created.json().id as string;

    const active = await app.inject({ method: "GET", url: "/v1/workouts/active", headers: BEARER });
    expect(active.json().routineIsOneOff).toBe(false);
    const detail = await app.inject({ method: "GET", url: `/v1/workouts/${id}`, headers: BEARER });
    expect(detail.json().routineIsOneOff).toBe(false);

    const add = await app.inject({ method: "POST", url: `/v1/workouts/${id}/exercises`, headers: BEARER, payload: { exerciseId: exercise.id } });
    expect(add.json()).not.toHaveProperty("routineIsOneOff");
    const patch = await app.inject({ method: "PATCH", url: `/v1/workout-exercises/${add.json().id}`, headers: BEARER, payload: { position: 0 } });
    expect(patch.json()).not.toHaveProperty("routineIsOneOff");

    const finish = await app.inject({ method: "PATCH", url: `/v1/workouts/${id}`, headers: BEARER, payload: { endedAt: ENDED_AT } });
    expect(finish.statusCode).toBe(200);
    expect(Object.keys(finish.json()).sort()).toEqual(Object.keys(UpdatedWorkoutSchema.shape).sort());

    const history = await app.inject({ method: "GET", url: "/v1/workouts", headers: BEARER });
    expect(history.statusCode).toBe(200);
    const row = history.json().items[0] as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(Object.keys(WorkoutSummarySchema.shape).sort());
    expect(row).not.toHaveProperty("routineIsOneOff");
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
  it("finishes an in-progress workout; afterwards only a re-finish is 409 (amended by 07.4 AC3)", async () => {
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
      expect(res.statusCode).toBe(200);
      expect(res.json().endedAt).toBe(ENDED_AT);
    }
    const refinish = await app.inject({ method: "PATCH", url: `/v1/workouts/${id}`, headers: BEARER, payload: { endedAt: ENDED_AT } });
    expect(refinish.statusCode).toBe(409);
    expect(refinish.json().type).toContain("workout-finished");

    const invalidEvenWhenFinished = await app.inject({
      method: "PATCH",
      url: `/v1/workouts/${id}`,
      headers: BEARER,
      payload: { title: "" },
    });
    expect(invalidEvenWhenFinished.statusCode).toBe(422);
  });

  // Amended by 07.4 AC19: still 422, now because tzOffsetMinutes needs startedAt.
  it("tzOffsetMinutes without startedAt on PATCH -> 422", async () => {
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

  it("endedAt more than 5 minutes in the future is 422 (AC7 — the finish transition's own skew bound)", async () => {
    const { app } = await buildTestApp();
    const created = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: STARTED_AT },
    });
    const id = created.json().id;

    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workouts/${id}`,
      headers: BEARER,
      payload: { endedAt: farFuture },
    });
    expect(res.statusCode).toBe(422);
  });

  it("endedAt < startedAt is 422 (AC8)", async () => {
    const { app } = await buildTestApp();
    const created = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: STARTED_AT },
    });
    const id = created.json().id;

    const beforeStart = new Date(Date.parse(STARTED_AT) - 60 * 1000).toISOString();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workouts/${id}`,
      headers: BEARER,
      payload: { endedAt: beforeStart },
    });
    expect(res.statusCode).toBe(422);
  });

  it("endedAt === startedAt is 200 (AC8 — equal is accepted)", async () => {
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
      payload: { endedAt: STARTED_AT },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().endedAt).toBe(STARTED_AT);
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

describe("Spec 09 AC16–AC18 — POST /v1/workouts with routineId", () => {
  it("201 with routineName and the copied exercises on the detail; non-UUID routineId is 422 on routineId; unknown is 404; a replay ignores routineId", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    const ex = makeExerciseRecord({ name: "Bench" });
    exerciseRepo.byId.set(ex.id, ex);
    const routineRepo = new FakeRoutineRepository(exerciseRepo);
    const { app } = await buildTestApp({
      exerciseRepository: exerciseRepo,
      routineRepository: routineRepo,
      workoutRepository: new FakeWorkoutRepository(exerciseRepo, routineRepo),
    });
    const r = await app.inject({
      method: "POST",
      url: "/v1/routines",
      headers: BEARER,
      payload: { name: "Push A", items: [{ exerciseId: ex.id, targetRpe: 8.5 }, { exerciseId: ex.id }] },
    });
    expect(r.statusCode).toBe(201);

    const bad = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: STARTED_AT, routineId: "nope" },
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().errors[0].path).toBe("routineId");

    const unknown = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: STARTED_AT, routineId: uuidv7() },
    });
    expect(unknown.statusCode).toBe(404);

    const key = uuidv7();
    const started = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: key, startedAt: STARTED_AT, routineId: r.json().id },
    });
    expect(started.statusCode).toBe(201);
    expect(started.json().routineName).toBe("Push A");
    const detail = await app.inject({ method: "GET", url: `/v1/workouts/${started.json().id}`, headers: BEARER });
    expect(
      detail.json().exercises.map((e: { position: number; targetRpe: number | null }) => [e.position, e.targetRpe]),
    ).toEqual([
      [0, 8.5],
      [1, null],
    ]);

    const replay = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: key, startedAt: STARTED_AT, routineId: uuidv7() },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().id).toBe(started.json().id);
  });

  it("AC32 — the started workout's detail carries each item's notes by position", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    const ex = makeExerciseRecord({ name: "Bench" });
    exerciseRepo.byId.set(ex.id, ex);
    const routineRepo = new FakeRoutineRepository(exerciseRepo);
    const { app } = await buildTestApp({
      exerciseRepository: exerciseRepo,
      routineRepository: routineRepo,
      workoutRepository: new FakeWorkoutRepository(exerciseRepo, routineRepo),
    });
    const r = await app.inject({
      method: "POST",
      url: "/v1/routines",
      headers: BEARER,
      payload: { name: "Push A", items: [{ exerciseId: ex.id, notes: "Pause\nat the bottom" }, { exerciseId: ex.id }] },
    });
    const started = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: STARTED_AT, routineId: r.json().id },
    });
    expect(started.statusCode).toBe(201);
    const detail = await app.inject({ method: "GET", url: `/v1/workouts/${started.json().id}`, headers: BEARER });
    expect(detail.json().exercises.map((e: { notes: string | null }) => e.notes)).toEqual(["Pause\nat the bottom", null]);
  });

  it("AC17 — a retired item is 409 exercise-retired with errors[0].path = routineId", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    const ex = makeExerciseRecord({ name: "Bench" });
    exerciseRepo.byId.set(ex.id, ex);
    const routineRepo = new FakeRoutineRepository(exerciseRepo);
    const { app } = await buildTestApp({
      exerciseRepository: exerciseRepo,
      routineRepository: routineRepo,
      workoutRepository: new FakeWorkoutRepository(exerciseRepo, routineRepo),
    });
    const r = await app.inject({
      method: "POST",
      url: "/v1/routines",
      headers: BEARER,
      payload: { name: "Push A", items: [{ exerciseId: ex.id }] },
    });
    exerciseRepo.byId.set(ex.id, { ...ex, isActive: false });
    const res = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: STARTED_AT, routineId: r.json().id },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().type).toContain("exercise-retired");
    expect(res.json().errors[0].path).toBe("routineId");
  });
});

describe("Spec 09 AC23 — PATCH /v1/workout-exercises/{id} supersetGroup", () => {
  it("200 sets and clears; 0 / 100 / 2.5 / \"1\" are 422", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    const ex = makeExerciseRecord();
    exerciseRepo.byId.set(ex.id, ex);
    const { app } = await buildTestApp({
      exerciseRepository: exerciseRepo,
      workoutRepository: new FakeWorkoutRepository(exerciseRepo),
    });
    const w = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: STARTED_AT },
    });
    const we = await app.inject({
      method: "POST",
      url: `/v1/workouts/${w.json().id}/exercises`,
      headers: BEARER,
      payload: { exerciseId: ex.id },
    });
    expect(we.json().supersetGroup).toBeNull();
    const set = await app.inject({
      method: "PATCH",
      url: `/v1/workout-exercises/${we.json().id}`,
      headers: BEARER,
      payload: { supersetGroup: 3 },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().supersetGroup).toBe(3);
    const clear = await app.inject({
      method: "PATCH",
      url: `/v1/workout-exercises/${we.json().id}`,
      headers: BEARER,
      payload: { supersetGroup: null },
    });
    expect(clear.json().supersetGroup).toBeNull();
    for (const bad of [0, 100, 2.5, "1"]) {
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/workout-exercises/${we.json().id}`,
        headers: BEARER,
        payload: { supersetGroup: bad },
      });
      expect(res.statusCode, String(bad)).toBe(422);
    }
  });
});

describe("07.4 AC19 — PATCH /v1/workouts/{id} Change Time validation", () => {
  async function liveWorkout() {
    const { app } = await buildTestApp();
    const created = await app.inject({ method: "POST", url: "/v1/workouts", headers: BEARER, payload: { clientGeneratedId: uuidv7(), startedAt: STARTED_AT } });
    const patch = (payload: object) => app.inject({ method: "PATCH", url: `/v1/workouts/${created.json().id}`, headers: BEARER, payload });
    return { patch };
  }
  const paths = (res: { json: () => { errors?: { path: string; message: string }[] } }) => res.json().errors;

  it("tzOffsetMinutes alone names tzOffsetMinutes; endedAt with durationSeconds names durationSeconds", async () => {
    const { patch } = await liveWorkout();
    const a = await patch({ tzOffsetMinutes: 60 });
    expect(a.statusCode).toBe(422);
    expect(paths(a)).toEqual([expect.objectContaining({ path: "tzOffsetMinutes", message: "requires startedAt" })]);
    const b = await patch({ endedAt: ENDED_AT, durationSeconds: 60 });
    expect(b.statusCode).toBe(422);
    expect(paths(b)).toEqual([expect.objectContaining({ path: "durationSeconds", message: "cannot be combined with endedAt" })]);
  });

  it("a live start move and a plan are 200 and come back on the response", async () => {
    const { patch } = await liveWorkout();
    const earlier = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const moved = await patch({ startedAt: earlier, tzOffsetMinutes: 0 });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({ startedAt: earlier, plannedDurationSeconds: null });
    const planned = await patch({ durationSeconds: 3600 });
    expect(planned.statusCode).toBe(200);
    expect(planned.json().plannedDurationSeconds).toBe(3600);
  });

  it("a changed start before 2000-01-01 is 422 on startedAt", async () => {
    const { patch } = await liveWorkout();
    const res = await patch({ startedAt: "1999-12-31T23:59:59.000Z" });
    expect(res.statusCode).toBe(422);
    expect(paths(res)).toEqual([expect.objectContaining({ path: "startedAt", message: "must not be before 2000-01-01" })]);
  });
});

describe("09.3 AC11 — keepRoutine needs a finish", () => {
  it.each([{ keepRoutine: true }, { keepRoutine: false }, { title: "x", keepRoutine: true }])("%j is 422 on keepRoutine", async (payload) => {
    const { app } = await buildTestApp();
    const created = await app.inject({ method: "POST", url: "/v1/workouts", headers: BEARER, payload: { clientGeneratedId: uuidv7(), startedAt: STARTED_AT } });
    const res = await app.inject({ method: "PATCH", url: `/v1/workouts/${created.json().id}`, headers: BEARER, payload });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors).toEqual([{ path: "keepRoutine", message: "requires endedAt" }]);
  });

  it("a finish with keepRoutine: false behaves like one without it", async () => {
    const { app } = await buildTestApp();
    const created = await app.inject({ method: "POST", url: "/v1/workouts", headers: BEARER, payload: { clientGeneratedId: uuidv7(), startedAt: STARTED_AT } });
    const res = await app.inject({ method: "PATCH", url: `/v1/workouts/${created.json().id}`, headers: BEARER, payload: { endedAt: ENDED_AT, keepRoutine: false } });
    expect(res.statusCode).toBe(200);
    expect(res.json().endedAt).not.toBeNull();
  });
});
