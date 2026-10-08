import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigCache } from "../config";
import { API_BASE_URL, stubWebEnv } from "./catalogHarness";
import { exerciseId, makeExercise } from "./catalogFixtures";
import { server } from "./msw/server";
import { makePersonalRecord, makeProgressPoint, makeSet, makeWorkoutDetail } from "./workoutFixtures";
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

describe("06.2 — the fake's offline switch and lost responses", () => {
  it("offline fails every request unrecorded; a lost response still applies the write", async () => {
    const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "X" }] }) });
    server.use(...fake.handlers);
    const we = fake.state.active!.exercises[0]!;
    fake.setOffline(true);
    await expect(call("GET", "/workouts/active")).rejects.toThrow();
    expect(fake.requests).toHaveLength(0);
    fake.setOffline(false);
    fake.loseNextResponse({ method: "POST", path: /\/sets$/ });
    await expect(
      call("POST", `/workout-exercises/${we.id}/sets`, {
        weight: 60,
        weightUnit: "kg",
        reps: 5,
        isComplete: true,
        clientGeneratedId: "30000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toThrow();
    expect(fake.state.active!.exercises[0]!.sets).toHaveLength(1);
  });
});

describe("Spec 08.1 — progress endpoint", () => {
  const ID = "10000000-0000-4000-8000-0000000000e1";

  it("serves a lineage's points, honours from/to inclusively, 404 unseen, 422 malformed", async () => {
    const fake = createWorkoutFake({
      progress: {
        [ID]: [
          makeProgressPoint({ localDate: "2026-07-01" }),
          makeProgressPoint({ localDate: "2026-07-08" }),
          makeProgressPoint({ localDate: "2026-09-01" }),
        ],
      },
    });
    server.use(...fake.handlers);

    const all = await call("GET", `/progress/exercises/${ID}`);
    expect((all.json!["points"] as unknown[]).length).toBe(3);
    const ranged = await call("GET", `/progress/exercises/${ID}?from=2026-07-08`);
    expect((ranged.json!["points"] as { localDate: string }[]).map((p) => p.localDate)).toEqual(["2026-07-08", "2026-09-01"]);
    expect((await call("GET", "/progress/exercises/10000000-0000-4000-8000-0000000000ff")).status).toBe(404);
    expect((await call("GET", "/progress/exercises/not-a-uuid")).status).toBe(422);
    expect(fake.requests.at(-1)).toMatchObject({ path: "/v1/progress/exercises/not-a-uuid" });
  });
});

describe("Spec 08.0 — history and records endpoints", () => {
  const done = (id: string, startedAt: string) =>
    makeWorkoutDetail({
      id,
      startedAt,
      endedAt: new Date(Date.parse(startedAt) + 3_600_000).toISOString(),
      exercises: [
        { modality: "weight_reps", name: "Bench Press", sets: [makeSet({ weight: 100, weightKg: 100, reps: 5 })] },
        { modality: "weight_reps", name: "Squat" },
        { modality: "bodyweight_reps", name: "Pull-up" },
        { modality: "bodyweight_reps", name: "Dip" },
      ],
    });

  it("GET /workouts pages finished workouts newest first with an opaque next", async () => {
    const ids = Array.from({ length: 3 }, (_, i) => `30000000-0000-4000-8000-00000000000${i + 1}`);
    const fake = createWorkoutFake({
      finished: [done(ids[0]!, "2026-10-01T10:00:00.000Z"), done(ids[1]!, "2026-10-03T10:00:00.000Z"), done(ids[2]!, "2026-10-02T10:00:00.000Z")],
      records: [makePersonalRecord({ workoutId: ids[1] }), makePersonalRecord({ workoutId: ids[1], recordType: "best_est_1rm" })],
    });
    server.use(...fake.handlers);

    const page1 = await call("GET", "/workouts?limit=2");
    expect(page1.status).toBe(200);
    const items = page1.json!["items"] as Record<string, unknown>[];
    expect(items.map((i) => i["id"])).toEqual([ids[1], ids[2]]);
    expect(items[0]).toMatchObject({ exerciseCount: 4, exerciseNames: ["Bench Press", "Squat", "Pull-up"], workingSetCount: 1, totalVolume: 500, recordCount: 2 });
    expect(typeof page1.json!["next"]).toBe("string");

    const page2 = await call("GET", `/workouts?limit=2&cursor=${encodeURIComponent(String(page1.json!["next"]))}`);
    expect((page2.json!["items"] as Record<string, unknown>[]).map((i) => i["id"])).toEqual([ids[0]]);
    expect(page2.json!["next"]).toBeNull();
    expect(fake.requests.at(-1)).toMatchObject({ method: "GET", path: "/v1/workouts", search: expect.stringContaining("cursor=") });
  });

  it("GET /personal-records filters by workoutId and exerciseId", async () => {
    const a = makePersonalRecord({ workoutId: "30000000-0000-4000-8000-00000000000a" });
    const b = makePersonalRecord({ workoutId: "30000000-0000-4000-8000-00000000000b" });
    const fake = createWorkoutFake({ records: [a, b] });
    server.use(...fake.handlers);

    const byWorkout = await call("GET", `/personal-records?workoutId=${a.workoutId}`);
    expect((byWorkout.json!["records"] as unknown[]).length).toBe(1);
    const byExercise = await call("GET", `/personal-records?exerciseId=${b.exerciseId}`);
    expect((byExercise.json!["records"] as Record<string, unknown>[])[0]!["workoutId"]).toBe(b.workoutId);
    const all = await call("GET", "/personal-records");
    expect((all.json!["records"] as unknown[]).length).toBe(2);
  });

  it("PATCH finish returns newRecords for the finished workout and stores them", async () => {
    const active = makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "Bench Press", sets: [makeSet()] }] });
    const fake = createWorkoutFake({ active, newRecordsOnFinish: [makePersonalRecord()] });
    server.use(...fake.handlers);

    const res = await call("PATCH", `/workouts/${active.id}`, { endedAt: new Date(Date.parse(active.startedAt) + 60_000).toISOString() });
    expect(res.status).toBe(200);
    const records = res.json!["newRecords"] as Record<string, unknown>[];
    expect(records).toHaveLength(1);
    expect(records[0]!["workoutId"]).toBe(active.id);
    expect(fake.state.records.map((r) => r.workoutId)).toEqual([active.id]);
  });

  it("a non-finish PATCH returns newRecords: []", async () => {
    const active = makeWorkoutDetail();
    const fake = createWorkoutFake({ active });
    server.use(...fake.handlers);

    const res = await call("PATCH", `/workouts/${active.id}`, { title: "Push" });
    expect(res.json!["newRecords"]).toEqual([]);
  });
});
