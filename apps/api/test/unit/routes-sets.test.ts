import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import type { Modality } from "@sin/core";
import { InvalidTokenError } from "../../src/errors/app-error.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { fakeVerifier, FakeExerciseRepository, FakeWorkoutRepository, makeExerciseRecord } from "../helpers/fakes.js";

const BEARER = { authorization: "Bearer test-token" };
// Relative to the real clock: the route checks startedAt/endedAt skew bounds.
const STARTED_AT = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const ENDED_AT = new Date(Date.now() - 30 * 60 * 1000).toISOString();

function capturingLogger(): { logger: FastifyBaseLogger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const logger: FastifyBaseLogger = pino({ level: "debug" }, { write: (s: string) => lines.push(JSON.parse(s)) });
  return { logger, lines };
}

/** An app with an in-progress workout holding one exercise of `modality`. */
async function setup(modality: Modality = "weight_reps", logger?: FastifyBaseLogger) {
  const exerciseRepo = new FakeExerciseRepository();
  const exercise = makeExerciseRecord({ modality, isActive: true });
  exerciseRepo.byId.set(exercise.id, exercise);
  const { app } = await buildTestApp({
    logger,
    exerciseRepository: exerciseRepo,
    workoutRepository: new FakeWorkoutRepository(exerciseRepo),
  });
  const w = await app.inject({
    method: "POST",
    url: "/v1/workouts",
    headers: BEARER,
    payload: { clientGeneratedId: uuidv7(), startedAt: STARTED_AT },
  });
  const workoutId = w.json().id as string;
  const we = await app.inject({
    method: "POST",
    url: `/v1/workouts/${workoutId}/exercises`,
    headers: BEARER,
    payload: { exerciseId: exercise.id },
  });
  return { app, workoutId, weId: we.json().id as string };
}
const postSet = (app: FastifyInstance, weId: string, payload: object) =>
  app.inject({ method: "POST", url: `/v1/workout-exercises/${weId}/sets`, headers: BEARER, payload });
const patchSet = (app: FastifyInstance, id: string, payload: object) =>
  app.inject({ method: "PATCH", url: `/v1/sets/${id}`, headers: BEARER, payload });
const finishWorkout = (app: FastifyInstance, workoutId: string) =>
  app.inject({ method: "PATCH", url: `/v1/workouts/${workoutId}`, headers: BEARER, payload: { endedAt: ENDED_AT } });
const fieldPaths = (res: { json(): unknown }) =>
  ((res.json() as { errors?: { path: string }[] }).errors ?? []).map((f) => f.path).sort();

describe("AC3 — create appends, Location header, setNumber not client-settable", () => {
  it("201 with Location /v1/sets/{id}, setNumber 1 then 2; a second exercise restarts at 1", async () => {
    const { app, workoutId, weId } = await setup();
    const a = await postSet(app, weId, { reps: 5 });
    expect(a.statusCode).toBe(201);
    expect(a.headers.location).toBe(`/v1/sets/${a.json().id}`);
    expect(a.json().setNumber).toBe(1);
    expect((await postSet(app, weId, {})).json().setNumber).toBe(2);

    const detail = await app.inject({ method: "GET", url: `/v1/workouts/${workoutId}`, headers: BEARER });
    const exerciseId = detail.json().exercises[0].exerciseId;
    const we2 = await app.inject({
      method: "POST",
      url: `/v1/workouts/${workoutId}/exercises`,
      headers: BEARER,
      payload: { exerciseId },
    });
    expect((await postSet(app, we2.json().id, {})).json().setNumber).toBe(1);
  });
  it("setNumber in the body is 422 on create and patch", async () => {
    const { app, weId } = await setup();
    expect((await postSet(app, weId, { setNumber: 7 })).statusCode).toBe(422);
    const id = (await postSet(app, weId, {})).json().id;
    expect((await patchSet(app, id, { setNumber: 7 })).statusCode).toBe(422);
  });
});

describe("AC5 — workout-finished guards all three routes", () => {
  it("POST, PATCH and DELETE on a finished workout's set are 409 workout-finished", async () => {
    const { app, workoutId, weId } = await setup();
    const id = (await postSet(app, weId, { reps: 5, weight: 100, weightUnit: "kg", isComplete: true })).json().id;
    expect((await finishWorkout(app, workoutId)).statusCode).toBe(200);
    for (const res of [
      await postSet(app, weId, {}),
      await patchSet(app, id, { reps: 6 }),
      await app.inject({ method: "DELETE", url: `/v1/sets/${id}`, headers: BEARER }),
    ]) {
      expect(res.statusCode).toBe(409);
      expect(res.json().type).toMatch(/workout-finished$/);
    }
  });
});

describe("AC6 — isComplete: true needs the modality's required measures (route level)", () => {
  it("weight_reps: missing weight is 422 naming weight; with it, 201; with isComplete omitted, 201", async () => {
    const { app, weId } = await setup("weight_reps");
    const bad = await postSet(app, weId, { reps: 5, isComplete: true });
    expect(bad.statusCode).toBe(422);
    expect(fieldPaths(bad)).toEqual(["weight"]);
    expect((await postSet(app, weId, { reps: 5, weight: 60, weightUnit: "kg", isComplete: true })).statusCode).toBe(201);
    expect((await postSet(app, weId, { reps: 5 })).statusCode).toBe(201);
  });
  it("completedAt is stamped with isComplete: true and null otherwise", async () => {
    const { app, weId } = await setup("bodyweight_reps");
    expect((await postSet(app, weId, { reps: 10, isComplete: true })).json().completedAt).not.toBeNull();
    expect((await postSet(app, weId, { reps: 10 })).json().completedAt).toBeNull();
  });
});

describe("AC7 — forbidden measures (route level)", () => {
  it("distance on weight_reps is 422 with and without isComplete; rpe is accepted", async () => {
    const { app, weId } = await setup("weight_reps");
    expect(fieldPaths(await postSet(app, weId, { distance: 5, distanceUnit: "km" }))).toEqual(["distance"]);
    expect(fieldPaths(await postSet(app, weId, { distance: 5, distanceUnit: "km", isComplete: true }))).toContain(
      "distance",
    );
    expect((await postSet(app, weId, { rpe: 8.5 })).statusCode).toBe(201);
  });
});

describe("AC20 — unit accompanies value, against the merged row", () => {
  it("PATCH { weight } alone keeps the stored unit (200); without a stored unit it is 422 naming weightUnit", async () => {
    const { app, weId } = await setup("weight_reps");
    const withUnit = (await postSet(app, weId, { reps: 5, weight: 50, weightUnit: "kg" })).json().id;
    const ok = await patchSet(app, withUnit, { weight: 52.5 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ weight: 52.5, weightUnit: "kg" });
    const noUnit = (await postSet(app, weId, { reps: 5 })).json().id;
    const bad = await patchSet(app, noUnit, { weight: 52.5 });
    expect(bad.statusCode).toBe(422);
    expect(fieldPaths(bad)).toEqual(["weightUnit"]);
  });
  it("create with weight and no unit (and vice versa; same for distance) is 422", async () => {
    const { app, weId } = await setup("weight_reps");
    expect(fieldPaths(await postSet(app, weId, { weight: 50 }))).toEqual(["weightUnit"]);
    expect(fieldPaths(await postSet(app, weId, { weightUnit: "kg" }))).toEqual(["weight"]);
    const d = await setup("distance_duration");
    expect(fieldPaths(await postSet(d.app, d.weId, { distance: 5 }))).toEqual(["distanceUnit"]);
    expect(fieldPaths(await postSet(d.app, d.weId, { distanceUnit: "km" }))).toEqual(["distance"]);
  });
});

describe("AC9 — delete (route level)", () => {
  it("204, then 404 on repeat", async () => {
    const { app, weId } = await setup();
    const id = (await postSet(app, weId, {})).json().id;
    expect((await app.inject({ method: "DELETE", url: `/v1/sets/${id}`, headers: BEARER })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: `/v1/sets/${id}`, headers: BEARER })).statusCode).toBe(404);
  });
});

describe("AC4 — malformed ids are 404 on all three routes", () => {
  it("never 422", async () => {
    const { app } = await setup();
    expect((await postSet(app, "not-a-uuid", {})).statusCode).toBe(404);
    expect((await patchSet(app, "not-a-uuid", {})).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: "/v1/sets/not-a-uuid", headers: BEARER })).statusCode).toBe(404);
  });
});

describe("AC12 — sets ride along in GET /v1/workouts/{id} and /active", () => {
  it("ordered by setNumber; a deleted set disappears and nothing else shifts", async () => {
    const { app, workoutId, weId } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) ids.push((await postSet(app, weId, {})).json().id);
    await app.inject({ method: "DELETE", url: `/v1/sets/${ids[1]}`, headers: BEARER });
    for (const url of [`/v1/workouts/${workoutId}`, "/v1/workouts/active"]) {
      const sets = (await app.inject({ method: "GET", url, headers: BEARER })).json().exercises[0].sets;
      expect(sets.map((s: { setNumber: number }) => s.setNumber)).toEqual([1, 3]);
    }
  });
});

describe("AC13 — finish blocked by an incomplete working set (route level)", () => {
  it("409 incomplete-working-sets with no id in the body; fix the set, retry ⇒ 200", async () => {
    const { app, workoutId, weId } = await setup("weight_reps");
    const id = (await postSet(app, weId, { weight: 100, weightUnit: "kg" })).json().id;
    const blocked = await finishWorkout(app, workoutId);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().type).toMatch(/incomplete-working-sets$/);
    expect(JSON.stringify(blocked.json())).not.toContain(id);
    expect(JSON.stringify(blocked.json())).not.toContain(weId);
    await patchSet(app, id, { reps: 5 });
    expect((await finishWorkout(app, workoutId)).statusCode).toBe(200);
  });
});

describe("AC16 — set_created is the only set log line, and carries no measure values", () => {
  it("fires once on 201 with id / workout_exercise_id / set_type / modality_snapshot; nothing on PATCH/DELETE", async () => {
    const { logger, lines } = capturingLogger();
    const { app, weId } = await setup("weight_reps", logger);
    const res = await postSet(app, weId, { reps: 7, weight: 123.456, weightUnit: "kg", rpe: 9.5 });
    const created = lines.filter((l) => l.msg === "set_created");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      set_id: res.json().id,
      workout_exercise_id: weId,
      set_type: "working",
      modality_snapshot: "weight_reps",
    });
    const serialized = JSON.stringify(created[0]);
    for (const v of ["123.456", "9.5", '"reps"', '"weight"']) expect(serialized).not.toContain(v);

    const before = lines.length;
    await patchSet(app, res.json().id, { reps: 8 });
    await app.inject({ method: "DELETE", url: `/v1/sets/${res.json().id}`, headers: BEARER });
    const after = lines.slice(before).map((l) => l.msg);
    expect(after.filter((m) => typeof m === "string" && m.startsWith("set_"))).toEqual([]);
  });
});

describe("AC18 — all three routes are authenticated", () => {
  it("401 with no token and with an invalid token", async () => {
    const { app } = await buildTestApp({
      tokenVerifier: fakeVerifier(() => {
        throw new InvalidTokenError("bad signature");
      }),
    });
    const id = uuidv7();
    const routes = [
      { method: "POST" as const, url: `/v1/workout-exercises/${id}/sets`, payload: {} },
      { method: "PATCH" as const, url: `/v1/sets/${id}`, payload: {} },
      { method: "DELETE" as const, url: `/v1/sets/${id}` },
    ];
    for (const r of routes) {
      expect((await app.inject({ ...r })).statusCode, `${r.method} ${r.url} no token`).toBe(401);
      expect((await app.inject({ ...r, headers: BEARER })).statusCode, `${r.method} ${r.url} invalid`).toBe(401);
    }
  });
});
