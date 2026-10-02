import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigCache } from "../config";
import { API_BASE_URL, stubWebEnv } from "./catalogHarness";
import { exerciseId, makeExercise } from "./catalogFixtures";
import { server } from "./msw/server";
import { catalogHandlers, createWorkoutFake, problemResponse } from "./workoutFake";

const bench = makeExercise({ id: exerciseId(1), name: "Bench Press", modality: "weight_reps" });
const squat = makeExercise({ id: exerciseId(2), name: "Back Squat", modality: "weight_reps" });
const retired = makeExercise({ id: exerciseId(3), name: "Retired Lift", isActive: false });

beforeEach(() => stubWebEnv());
afterEach(() => {
  resetConfigCache();
  vi.unstubAllEnvs();
});

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API_BASE_URL}/v1${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : undefined };
}

/** The problem slug of a response body (the last path segment of `type`). */
const slugOf = (json: Record<string, unknown> | undefined) => new URL(String(json!["type"])).pathname.split("/").pop();

function boot() {
  const fake = createWorkoutFake({ catalog: [bench, squat, retired] });
  server.use(...fake.handlers);
  return fake;
}

const start = (fake: ReturnType<typeof boot>, id = crypto.randomUUID()) =>
  call("POST", "/workouts", { clientGeneratedId: id, startedAt: new Date().toISOString(), tzOffsetMinutes: 0 });

async function withExercise() {
  const fake = boot();
  await start(fake);
  const added = await call("POST", `/workouts/${fake.state.active!.id}/exercises`, { exerciseId: bench.id });
  return { fake, weId: added.json!["id"] as string };
}

describe("the workout fake mirrors the API rules the screen depends on", () => {
  it("answers 404 for /active when there is no workout", async () => {
    boot();
    expect((await call("GET", "/workouts/active")).status).toBe(404);
  });

  it("start: 201, a different key while one is active → 409, the same key → 200 replay", async () => {
    const fake = boot();
    const key = crypto.randomUUID();
    expect((await start(fake, key)).status).toBe(201);
    expect((await start(fake)).status).toBe(409);
    expect((await start(fake, key)).status).toBe(200);
  });

  it("add exercise: appends dense positions; unknown → 404; retired → 409", async () => {
    const fake = boot();
    await start(fake);
    const wid = fake.state.active!.id;
    expect((await call("POST", `/workouts/${wid}/exercises`, { exerciseId: bench.id })).json!["position"]).toBe(0);
    expect((await call("POST", `/workouts/${wid}/exercises`, { exerciseId: squat.id })).json!["position"]).toBe(1);
    expect((await call("POST", `/workouts/${wid}/exercises`, { exerciseId: exerciseId(99) })).status).toBe(404);
    const gone = await call("POST", `/workouts/${wid}/exercises`, { exerciseId: retired.id });
    expect([gone.status, slugOf(gone.json)]).toEqual([409, "exercise-retired"]);
  });

  it("move and remove keep positions dense; an out-of-range move is a 422", async () => {
    const fake = boot();
    await start(fake);
    const wid = fake.state.active!.id;
    const a = (await call("POST", `/workouts/${wid}/exercises`, { exerciseId: bench.id })).json!["id"];
    const b = (await call("POST", `/workouts/${wid}/exercises`, { exerciseId: squat.id })).json!["id"];
    expect((await call("PATCH", `/workout-exercises/${b}`, { position: 0 })).status).toBe(200);
    expect(fake.state.active!.exercises.map((e) => [e.id, e.position])).toEqual([[b, 0], [a, 1]]);
    expect((await call("PATCH", `/workout-exercises/${a}`, { position: 5 })).status).toBe(422);
    expect((await call("DELETE", `/workout-exercises/${b}`)).status).toBe(204);
    expect(fake.state.active!.exercises.map((e) => e.position)).toEqual([0]);
  });

  it("sets: numbers append; the strict gate and forbidden measures are 422; a key replay is 200", async () => {
    const { weId } = await withExercise();
    const key = crypto.randomUUID();
    const one = await call("POST", `/workout-exercises/${weId}/sets`, { reps: 8, weight: 60, weightUnit: "kg", isComplete: true, clientGeneratedId: key });
    expect([one.status, one.json!["setNumber"]]).toEqual([201, 1]);
    const replay = await call("POST", `/workout-exercises/${weId}/sets`, { reps: 9, weight: 61, weightUnit: "kg", isComplete: true, clientGeneratedId: key });
    expect([replay.status, replay.json!["id"], replay.json!["reps"]]).toEqual([200, one.json!["id"], 8]);
    const two = await call("POST", `/workout-exercises/${weId}/sets`, { reps: 0, weight: 60, weightUnit: "kg", isComplete: true });
    expect([two.status, two.json!["setNumber"], two.json!["reps"]]).toEqual([201, 2, 0]);

    const incompleteButComplete = await call("POST", `/workout-exercises/${weId}/sets`, { weight: 60, weightUnit: "kg", isComplete: true });
    expect(incompleteButComplete.status).toBe(422);
    expect(incompleteButComplete.json!["errors"]).toEqual([{ path: "reps", message: "Required" }]);
    const forbidden = await call("POST", `/workout-exercises/${weId}/sets`, { reps: 8, weight: 60, weightUnit: "kg", durationS: 30, isComplete: true });
    expect(forbidden.status).toBe(422);
  });

  it("finish: blocked by an incomplete working set, allowed once fixed; then everything is workout-finished", async () => {
    const { fake, weId } = await withExercise();
    const wid = fake.state.active!.id;
    const partial = await call("POST", `/workout-exercises/${weId}/sets`, { reps: 8, isComplete: false });
    expect(partial.status).toBe(201);
    const blocked = await call("PATCH", `/workouts/${wid}`, { endedAt: new Date().toISOString() });
    expect([blocked.status, slugOf(blocked.json)]).toEqual([409, "incomplete-working-sets"]);

    expect((await call("PATCH", `/sets/${partial.json!["id"]}`, { weight: 60, weightUnit: "kg" })).status).toBe(200);
    expect((await call("DELETE", `/sets/${partial.json!["id"]}`)).status).toBe(204);
    const done = await call("PATCH", `/workouts/${wid}`, { endedAt: new Date().toISOString() });
    expect(done.status).toBe(200);
    expect(fake.state.active).toBeNull();

    const again = await call("PATCH", `/workouts/${wid}`, { endedAt: new Date().toISOString() });
    expect([again.status, slugOf(again.json)]).toEqual([409, "workout-finished"]);
    expect((await call("POST", `/workout-exercises/${weId}/sets`, { reps: 1, weight: 1, weightUnit: "kg", isComplete: true })).status).toBe(409);
    const detail = await call("GET", `/workouts/${wid}`);
    expect([detail.status, detail.json!["endedAt"] !== null]).toEqual([200, true]);
    expect((await call("DELETE", `/workouts/${wid}`)).status).toBe(204);
    expect((await call("GET", `/workouts/${wid}`)).status).toBe(404);
  });

  it("failNext answers the next matching request with the scripted response, once, and records it", async () => {
    const fake = boot();
    fake.failNext({ method: "POST", path: /\/v1\/workouts$/ }, () => problemResponse(500, "about:blank"));
    expect((await start(fake)).status).toBe(500);
    expect((await start(fake)).status).toBe(201);
    expect(fake.requests.map((r) => [r.method, new URL(`http://x${r.path}`).pathname])).toEqual([
      ["POST", "/v1/workouts"],
      ["POST", "/v1/workouts"],
    ]);
  });

  it("catalogHandlers serves the three catalog reads", async () => {
    server.use(...catalogHandlers([bench]));
    expect((await call("GET", "/exercises")).json!["exercises"]).toHaveLength(1);
    expect((await call("GET", "/muscle-groups")).status).toBe(200);
    expect((await call("GET", "/equipment")).status).toBe(200);
  });
});
