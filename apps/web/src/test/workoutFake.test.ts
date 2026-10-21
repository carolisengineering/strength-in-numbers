import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigCache } from "../config";
import { API_BASE_URL, stubWebEnv } from "./catalogHarness";
import { exerciseId, makeExercise } from "./catalogFixtures";
import { server } from "./msw/server";
import { RETIME_MESSAGES, RoutineSchema, type WorkoutDetail } from "@sin/core";
import { makePersonalRecord, makeProgressPoint, makeRoutine, makeSet, makeWorkoutDetail, routineId } from "./workoutFixtures";
import { catalogHandlers, createWorkoutFake, problemResponse, type WorkoutFakeOptions } from "./workoutFake";

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

  it("finish: blocked by an incomplete working set, allowed once fixed; then everything is workout-finished (amended by 18.0 §10: set writes on a finished workout succeed)", async () => {
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
    expect((await call("POST", `/workout-exercises/${weId}/sets`, { reps: 1, weight: 1, weightUnit: "kg", isComplete: true })).status).toBe(201);
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

describe("workoutFake — routines (Spec 10.0 test infra)", () => {
  const BASE = "https://api.example.test/v1";
  const json = (method: string, path: string, body?: unknown) =>
    fetch(`${BASE}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

  it("CRUD with normalised groups, case-insensitive names, the cap, retired, and start-from-routine", async () => {
    const bench = makeExercise({ id: exerciseId(1), name: "Bench Press" });
    const row = makeExercise({ id: exerciseId(2), name: "Barbell Row" });
    const old = makeExercise({ id: exerciseId(3), name: "Old Press", isActive: false });
    const fake = createWorkoutFake({ catalog: [bench, row, old] });
    server.use(...fake.handlers);

    const created = await json("POST", "/routines", {
      name: " Push A ",
      items: [
        { exerciseId: exerciseId(1), supersetGroup: 7, targetSets: 3 },
        { exerciseId: exerciseId(2), supersetGroup: 7 },
      ],
    });
    expect(created.status).toBe(201);
    const routine = RoutineSchema.parse(await created.json());
    expect(routine.name).toBe("Push A");
    expect(routine.items.map((i) => i.supersetGroup)).toEqual([1, 1]);

    expect((await json("POST", "/routines", { name: "push a", items: [{ exerciseId: exerciseId(1) }] })).status).toBe(409);
    const retired = await json("POST", "/routines", { name: "X", items: [{ exerciseId: exerciseId(1) }, { exerciseId: exerciseId(3) }] });
    expect(retired.status).toBe(409);
    expect((await retired.json()).errors).toEqual([{ path: "items.1.exerciseId", message: expect.any(String) }]);

    const renamed = await json("PUT", `/routines/${routine.id}`, { name: "PUSH A", items: [{ exerciseId: exerciseId(2) }] });
    expect(renamed.status).toBe(200);

    const started = await json("POST", "/workouts", {
      clientGeneratedId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      tzOffsetMinutes: 0,
      routineId: routine.id,
    });
    expect(started.status).toBe(201);
    expect(fake.state.active?.routineName).toBe("PUSH A");
    expect(fake.state.active?.exercises.map((e) => e.exerciseNameSnapshot)).toEqual(["Barbell Row"]);

    expect((await json("DELETE", `/routines/${routine.id}`)).status).toBe(204);
    expect((await json("GET", `/routines/${routine.id}`)).status).toBe(404);
    expect(((await (await json("GET", "/routines")).json()) as { routines: unknown[] }).routines).toEqual([]);
  });

  it("refuses the 51st routine", async () => {
    const routines = Array.from({ length: 50 }, (_, i) => makeRoutine({ id: routineId(i + 1), name: `R${i}` }));
    const fake = createWorkoutFake({ routines, catalog: [makeExercise()] });
    server.use(...fake.handlers);
    const res = await json("POST", "/routines", { name: "One more", items: [{ exerciseId: exerciseId(1) }] });
    expect(res.status).toBe(409);
    expect((await res.json()).type).toMatch(/routine-limit$/);
  });
});

describe("10.2 AC31 — the routine fake applies the API's plan rules", () => {
  const BASE = "https://api.example.test/v1";
  const send = (method: string, path: string, body?: unknown) =>
    fetch(`${BASE}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const bench = makeExercise({ id: exerciseId(1), name: "Bench Press", modality: "weight_reps" });
  const pushup = makeExercise({ id: exerciseId(2), name: "Push-up", modality: "bodyweight_reps" });
  const plank = makeExercise({ id: exerciseId(3), name: "Plank", modality: "duration" });
  const boot = () => {
    const fake = createWorkoutFake({ catalog: [bench, pushup, plank] });
    server.use(...fake.handlers);
    return fake;
  };
  const create = async (items: unknown[]) => {
    const res = await send("POST", "/routines", { name: `R${Math.random()}`, items });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };

  it("the row form is stored in order with the derived targets", async () => {
    boot();
    const { status, json } = await create([
      { exerciseId: exerciseId(1), sets: [{ setType: "warmup", repsLow: 10, repsHigh: 10, weight: 60, weightUnit: "kg" }, { repsLow: 6, repsHigh: 8, weight: 100, weightUnit: "kg" }] },
    ]);
    expect(status).toBe(201);
    const item = RoutineSchema.parse(json).items[0]!;
    expect(item.sets).toEqual([
      { setType: "warmup", repsLow: 10, repsHigh: 10, weight: 60, weightUnit: "kg" },
      { setType: "working", repsLow: 6, repsHigh: 8, weight: 100, weightUnit: "kg" },
    ]);
    expect([item.targetSets, item.targetRepsLow, item.targetRepsHigh]).toEqual([2, 6, 10]);
  });

  it.each([
    [{ targetSets: 3, targetRepsLow: 6, targetRepsHigh: 8 }, 3, [3, 6, 8]],
    [{ targetSets: 2 }, 2, [2, null, null]],
    [{ targetRepsLow: 8, targetRepsHigh: 10 }, 0, [null, 8, 10]], // O1: a rep range with no set count stays rowless
    [{}, 0, [null, null, null]],
  ])("the legacy form %j expands to %i identical working rows", async (legacy, count, targets) => {
    boot();
    const { json } = await create([{ exerciseId: exerciseId(1), ...legacy }]);
    const item = RoutineSchema.parse(json).items[0]!;
    expect(item.sets).toHaveLength(count);
    expect(item.sets.every((s) => s.setType === "working" && s.weight === null)).toBe(true);
    expect([item.targetSets, item.targetRepsLow, item.targetRepsHigh]).toEqual(targets);
  });

  it("422 at the row field for a measure the modality cannot carry; legacy input is exempt", async () => {
    boot();
    const bad = await create([{ exerciseId: exerciseId(2), sets: [{ repsLow: 5, repsHigh: 5, weight: 10, weightUnit: "kg" }] }, { exerciseId: exerciseId(3), sets: [{ setType: "warmup" }, { repsLow: 5, repsHigh: 5 }] }]);
    expect(bad.status).toBe(422);
    expect((bad.json["errors"] as { path: string }[]).map((e) => e.path)).toEqual(["items.0.sets.0.weight", "items.0.sets.0.weightUnit", "items.1.sets.1.repsLow", "items.1.sets.1.repsHigh"]);
    expect((await create([{ exerciseId: exerciseId(3), targetSets: 2, targetRepsLow: 5, targetRepsHigh: 5 }])).status).toBe(201);
  });

  it("starting from a routine copies each item's rows onto the workout exercise created from it", async () => {
    const fake = boot();
    const { json } = await create([
      { exerciseId: exerciseId(1), sets: [{ repsLow: 15, repsHigh: 15, weight: 20, weightUnit: "kg" }] },
      { exerciseId: exerciseId(1), sets: [{ setType: "warmup", repsLow: 10, repsHigh: 10, weight: 60, weightUnit: "kg" }, { repsLow: 5, repsHigh: 5, weight: 100, weightUnit: "kg" }] },
      { exerciseId: exerciseId(1) },
    ]);
    const started = await send("POST", "/workouts", { clientGeneratedId: crypto.randomUUID(), startedAt: new Date().toISOString(), tzOffsetMinutes: 0, routineId: json["id"] });
    expect(started.status).toBe(201);
    // The start response is the summary shape; the exercises live in the fake's active workout.
    expect(fake.state.active?.exercises.map((e) => e.plannedSets.length)).toEqual([1, 2, 0]);
  });

  it("the fake imports its expansion rules from @sin/core and adds no tolerant defaults", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "workoutFake.ts"), "utf8");
    expect(source).toMatch(/expandQuickLine[\s\S]*from "@sin\/core"|from "@sin\/core"[\s\S]*expandQuickLine/);
    expect(source).toMatch(/deriveTargets/);
    expect(source).not.toMatch(/\b(sets|plannedSets)\s*:\s*z\.[^,;\n]*\.(default|catch)\(/);
    expect(source).not.toMatch(/\.default\(\[\]\)|\.catch\(/);
  });
});

describe("10.1 — PATCH supersetGroup / notes, and failNext skip", () => {
  async function three() {
    const fake = boot();
    await start(fake);
    const wid = fake.state.active!.id;
    const ids: string[] = [];
    for (const ex of [bench, squat, bench]) ids.push(String((await call("POST", `/workouts/${wid}/exercises`, { exerciseId: ex.id })).json!["id"]));
    return { fake, ids: ids as [string, string, string] };
  }
  it("applies supersetGroup (1–99 or null) and notes; a non-adjacent position shifts the rest", async () => {
    const { fake, ids: [a, b, c] } = await three();
    const row = (id: string) => fake.state.active!.exercises.find((e) => e.id === id)!;
    expect((await call("PATCH", `/workout-exercises/${a}`, { supersetGroup: 41 })).status).toBe(200);
    expect(row(a).supersetGroup).toBe(41);
    expect((await call("PATCH", `/workout-exercises/${a}`, { notes: "Pause" })).status).toBe(200);
    expect(row(a).notes).toBe("Pause");
    expect(row(a).supersetGroup).toBe(41);
    expect((await call("PATCH", `/workout-exercises/${a}`, { supersetGroup: null })).status).toBe(200);
    expect(row(a).supersetGroup).toBeNull();
    expect((await call("PATCH", `/workout-exercises/${a}`, { position: 2 })).status).toBe(200);
    expect(fake.state.active!.exercises.map((e) => [e.id, e.position])).toEqual([[b, 0], [c, 1], [a, 2]]);
    expect((await call("PATCH", `/workout-exercises/${a}`, { supersetGroup: 100 })).status).toBe(422);
  });
  it("failNext(…, times, skip) lets the first `skip` matches through", async () => {
    const { fake, ids: [a, b, c] } = await three();
    fake.failNext({ method: "PATCH", path: /workout-exercises/ }, () => problemResponse(500, "about:blank"), 1, 1);
    expect((await call("PATCH", `/workout-exercises/${a}`, { supersetGroup: 1 })).status).toBe(200);
    expect((await call("PATCH", `/workout-exercises/${b}`, { supersetGroup: 1 })).status).toBe(500);
    expect((await call("PATCH", `/workout-exercises/${c}`, { supersetGroup: 1 })).status).toBe(200);
  });
});

describe("10.3 AC33 — the fake emits and copies the section fields", () => {
  const body = {
    name: "Push B",
    notes: "Keep it short",
    sections: [
      { key: "w", name: "Warm-up", notes: "5 min rower" },
      { key: "m", name: "Main" },
    ],
    items: [{ exerciseId: bench.id }, { exerciseId: squat.id, sectionKey: "m" }, { exerciseId: bench.id, sectionKey: "m" }],
  };

  it("a routine write stores sections with new ids and resolves each item's sectionKey", async () => {
    boot();
    const res = await call("POST", "/routines", body);
    expect(res.status).toBe(201);
    const routine = RoutineSchema.parse(res.json);
    expect(routine.sections.map((s) => [s.position, s.name, s.notes])).toEqual([
      [0, "Warm-up", "5 min rower"],
      [1, "Main", null],
    ]);
    expect(routine.items.map((i) => i.sectionId)).toEqual([null, routine.sections[1]!.id, routine.sections[1]!.id]);
  });

  it("an undeclared sectionKey is a 422 on items.<i>.sectionKey (the same RoutineWriteSchema the API runs)", async () => {
    boot();
    const res = await call("POST", "/routines", { ...body, items: [{ exerciseId: bench.id, sectionKey: "nope" }] });
    expect(res.status).toBe(422);
    expect((res.json!["errors"] as { path: string }[]).map((e) => e.path)).toContain("items.0.sectionKey");
  });

  it("a body without sections stores none: sections [] and every sectionId null", async () => {
    boot();
    const res = await call("POST", "/routines", { name: "Plain", items: [{ exerciseId: bench.id }] });
    const routine = RoutineSchema.parse(res.json);
    expect(routine.sections).toEqual([]);
    expect(routine.items[0]!.sectionId).toBeNull();
  });

  it("starting from a routine copies sections (new ids, same positions), each exercise's section by position, and the routine note", async () => {
    const fake = boot();
    const routine = RoutineSchema.parse((await call("POST", "/routines", body)).json);
    const started = await call("POST", "/workouts", {
      clientGeneratedId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      tzOffsetMinutes: 0,
      routineId: routine.id,
    });
    expect(started.status).toBe(201);
    const active = fake.state.active!;
    expect(active.routineNotes).toBe("Keep it short");
    expect(active.sections.map((s) => [s.position, s.name, s.notes])).toEqual([
      [0, "Warm-up", "5 min rower"],
      [1, "Main", null],
    ]);
    const main = active.sections[1]!.id;
    expect(main).not.toBe(routine.sections[1]!.id);
    expect(active.exercises.map((e) => e.sectionId)).toEqual([null, main, main]);
    const read = (await call("GET", "/workouts/active")).json!;
    expect((read["sections"] as unknown[]).length).toBe(2);
    expect(read["routineNotes"]).toBe("Keep it short");
  });

  it("a manual start has no sections and no routine note; an added exercise is loose", async () => {
    const { fake } = await withExercise();
    expect(fake.state.active!.sections).toEqual([]);
    expect(fake.state.active!.routineNotes).toBeNull();
    expect(fake.state.active!.exercises[0]!.sectionId).toBeNull();
  });
});

describe("18.0 §10 — the fake applies 07.4's finished-mode rules", () => {
  function bootFinished(opts: { sets?: number; extraEmpty?: boolean; recordsFor?: WorkoutFakeOptions["recordsFor"] } = {}) {
    const sets = Array.from({ length: opts.sets ?? 2 }, (_, i) => makeSet({ setNumber: i + 1 }));
    const detail = makeWorkoutDetail({
      endedAt: "2026-10-02T11:00:00.000Z",
      exercises: [
        { name: "Bench Press", modality: "weight_reps", sets },
        ...(opts.extraEmpty ? [{ name: "Back Squat", modality: "weight_reps" as const }] : []),
      ],
    });
    const fake = createWorkoutFake({ finished: [detail], catalog: [bench, squat], recordsFor: opts.recordsFor });
    server.use(...fake.handlers);
    return { fake, detail, weId: detail.exercises[0]!.id };
  }

  it("set create (201, key replay 200) and set PATCH (200) succeed on a finished workout", async () => {
    const { fake, detail, weId } = bootFinished();
    const body = { reps: 5, weight: 80, weightUnit: "kg", isComplete: true, clientGeneratedId: crypto.randomUUID() };
    const created = await call("POST", `/workout-exercises/${weId}/sets`, body);
    expect(created.status).toBe(201);
    expect((await call("POST", `/workout-exercises/${weId}/sets`, body)).status).toBe(200);
    expect((await call("PATCH", `/sets/${created.json!["id"]}`, { reps: 6 })).status).toBe(200);
    expect(fake.state.active).toBeNull();
    expect(fake.state.finished.get(detail.id)!.exercises[0]!.sets.map((s) => s.reps)).toEqual([8, 8, 6]);
  });

  it("set DELETE: one of two → 204; the last → 409 workout-would-be-empty and nothing changes", async () => {
    const { fake, detail } = bootFinished();
    const [first, second] = detail.exercises[0]!.sets;
    expect((await call("DELETE", `/sets/${first!.id}`)).status).toBe(204);
    const last = await call("DELETE", `/sets/${second!.id}`);
    expect([last.status, slugOf(last.json)]).toEqual([409, "workout-would-be-empty"]);
    expect(fake.state.finished.get(detail.id)!.exercises[0]!.sets.map((s) => s.id)).toEqual([second!.id]);
  });

  it("exercise add (201, stays finished), PATCH position / notes (200)", async () => {
    const { fake, detail, weId } = bootFinished();
    const added = await call("POST", `/workouts/${detail.id}/exercises`, { exerciseId: squat.id });
    expect(added.status).toBe(201);
    expect(fake.state.active).toBeNull();
    expect(fake.state.finished.get(detail.id)!.exercises).toHaveLength(2);
    expect((await call("PATCH", `/workout-exercises/${added.json!["id"]}`, { position: 0 })).status).toBe(200);
    expect((await call("PATCH", `/workout-exercises/${weId}`, { notes: "Slow" })).status).toBe(200);
    const stored = fake.state.finished.get(detail.id)!;
    expect(stored.exercises.map((e) => e.exerciseNameSnapshot)).toEqual(["Back Squat", "Bench Press"]);
    expect(stored.exercises[1]!.notes).toBe("Slow");
  });

  it("exercise DELETE: the only exercise with sets → 409 workout-would-be-empty; an empty one among others → 204", async () => {
    const { fake, detail, weId } = bootFinished({ extraEmpty: true });
    const refused = await call("DELETE", `/workout-exercises/${weId}`);
    expect([refused.status, slugOf(refused.json)]).toEqual([409, "workout-would-be-empty"]);
    expect((await call("DELETE", `/workout-exercises/${detail.exercises[1]!.id}`)).status).toBe(204);
    expect(fake.state.finished.get(detail.id)!.exercises.map((e) => e.id)).toEqual([weId]);
  });

  it("on a workout with zero sets, deleting an empty exercise → 204 (the guard is ≥ 1 → 0)", async () => {
    const { fake, detail, weId } = bootFinished({ sets: 0 });
    expect((await call("DELETE", `/workout-exercises/${weId}`)).status).toBe(204);
    expect(fake.state.finished.get(detail.id)!.exercises).toEqual([]);
  });

  it("PATCH /workouts/{id}: title / notes merge, null clears, {} unchanged, a new endedAt → 409 workout-finished", async () => {
    const { fake, detail } = bootFinished();
    const set = await call("PATCH", `/workouts/${detail.id}`, { title: "T", notes: "a\nb" });
    expect([set.status, set.json!["title"], set.json!["notes"]]).toEqual([200, "T", "a\nb"]);
    const cleared = await call("PATCH", `/workouts/${detail.id}`, { title: null });
    expect([cleared.status, cleared.json!["title"], cleared.json!["notes"]]).toEqual([200, null, "a\nb"]);
    const empty = await call("PATCH", `/workouts/${detail.id}`, {});
    expect([empty.status, empty.json!["title"], empty.json!["notes"]]).toEqual([200, null, "a\nb"]);
    const refinish = await call("PATCH", `/workouts/${detail.id}`, { endedAt: new Date().toISOString() });
    expect([refinish.status, slugOf(refinish.json)]).toEqual([409, "workout-finished"]);
    expect(fake.state.finished.get(detail.id)!.endedAt).toBe(detail.endedAt);
  });

  it("recordsFor: records are recomputed from the edited workout after a finished-mode write", async () => {
    const other = makePersonalRecord();
    const { fake, detail } = bootFinished({
      recordsFor: (w) => [makePersonalRecord({ workoutId: w.id, value: Math.max(...w.exercises[0]!.sets.map((s) => s.reps ?? 0)) })],
    });
    fake.state.records.push(other);
    expect((await call("PATCH", `/sets/${detail.exercises[0]!.sets[0]!.id}`, { reps: 12 })).status).toBe(200);
    const served = await call("GET", `/personal-records?workoutId=${detail.id}`);
    expect((served.json!["records"] as { value: number }[]).map((r) => r.value)).toEqual([12]);
    expect(fake.state.records).toContainEqual(other);
  });
});
describe("18.0 §10 — the fake applies Change Time through resolveRetime", () => {
  const NOW = new Date("2026-10-18T10:00:00Z");
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true, now: NOW });
  });
  afterEach(() => vi.useRealTimers());

  async function bootLive() {
    const fake = boot();
    await call("POST", "/workouts", { clientGeneratedId: crypto.randomUUID(), startedAt: "2026-10-18T09:05:00.000Z", tzOffsetMinutes: 60 });
    return { fake, id: fake.state.active!.id };
  }

  it("live, all three keys: start, offset, localDate and plan are written", async () => {
    const { fake, id } = await bootLive();
    const res = await call("PATCH", `/workouts/${id}`, { startedAt: "2026-10-16T17:00:00.000Z", tzOffsetMinutes: 60, durationSeconds: 3600 });
    expect(res.status).toBe(200);
    const picked = (w: Record<string, unknown>) => [w["startedAt"], w["tzOffsetMinutes"], w["localDate"], w["plannedDurationSeconds"]];
    const expected = ["2026-10-16T17:00:00.000Z", 60, "2026-10-16", 3600];
    expect(picked(res.json!)).toEqual(expected);
    expect(picked(fake.state.active as unknown as Record<string, unknown>)).toEqual(expected);
  });

  it("live, durationSeconds only: start, offset and localDate are unchanged", async () => {
    const { fake, id } = await bootLive();
    const res = await call("PATCH", `/workouts/${id}`, { durationSeconds: 1800 });
    expect(res.status).toBe(200);
    const a = fake.state.active!;
    expect([a.startedAt, a.tzOffsetMinutes, a.localDate, a.plannedDurationSeconds]).toEqual(["2026-10-18T09:05:00.000Z", 60, "2026-10-18", 1800]);
  });

  it("live, ends in the future → 422 on durationSeconds", async () => {
    const { id } = await bootLive();
    const res = await call("PATCH", `/workouts/${id}`, { startedAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(), durationSeconds: 3600 });
    expect(res.status).toBe(422);
    expect(res.json!["errors"]).toEqual([{ path: "durationSeconds", message: RETIME_MESSAGES.endsInFuture }]);
  });

  it("a start before the floor → 422 on startedAt", async () => {
    const { id } = await bootLive();
    const res = await call("PATCH", `/workouts/${id}`, { startedAt: "1999-12-31T12:00:00.000Z" });
    expect(res.status).toBe(422);
    expect(res.json!["errors"]).toEqual([{ path: "startedAt", message: RETIME_MESSAGES.floor }]);
  });

  it("the same start with a new offset is no change: offset and localDate stay", async () => {
    const { fake, id } = await bootLive();
    const res = await call("PATCH", `/workouts/${id}`, { startedAt: "2026-10-18T09:05:00.000Z", tzOffsetMinutes: -240 });
    expect(res.status).toBe(200);
    expect([fake.state.active!.tzOffsetMinutes, fake.state.active!.localDate]).toEqual([60, "2026-10-18"]);
  });

  it("finished, start only: endedAt moves by the same Δ; null duration → 422; records recomputed", async () => {
    const detail = makeWorkoutDetail({
      startedAt: "2026-10-14T17:05:00.000Z",
      endedAt: "2026-10-14T17:57:00.000Z",
      localDate: "2026-10-14",
      exercises: [{ name: "Bench Press", modality: "weight_reps", sets: [makeSet()] }],
    });
    const recordsFor = vi.fn((w: WorkoutDetail) => [makePersonalRecord({ workoutId: w.id })]);
    const fake = createWorkoutFake({ finished: [detail], recordsFor });
    server.use(...fake.handlers);
    const res = await call("PATCH", `/workouts/${detail.id}`, { startedAt: "2026-10-16T17:05:00.000Z", tzOffsetMinutes: 60 });
    expect(res.status).toBe(200);
    const stored = fake.state.finished.get(detail.id)!;
    expect([stored.startedAt, stored.endedAt, stored.localDate, stored.tzOffsetMinutes]).toEqual([
      "2026-10-16T17:05:00.000Z", "2026-10-16T17:57:00.000Z", "2026-10-16", 60,
    ]);
    expect(recordsFor).toHaveBeenCalled();
    expect(fake.state.records.map((r) => r.workoutId)).toEqual([detail.id]);
    const refused = await call("PATCH", `/workouts/${detail.id}`, { durationSeconds: null });
    expect(refused.status).toBe(422);
    expect(refused.json!["errors"]).toEqual([{ path: "durationSeconds", message: RETIME_MESSAGES.finishedDurationNull }]);
  });

  it("finishing a planned live workout stores plannedDurationSeconds: null", async () => {
    const { fake, id } = await bootLive();
    await call("PATCH", `/workouts/${id}`, { startedAt: "2026-10-16T17:00:00.000Z", tzOffsetMinutes: 60, durationSeconds: 3600 });
    const finished = await call("PATCH", `/workouts/${id}`, { endedAt: "2026-10-16T18:00:00.000Z" });
    expect(finished.status).toBe(200);
    expect(finished.json!["plannedDurationSeconds"]).toBeNull();
    expect(fake.state.finished.get(id)!.plannedDurationSeconds).toBeNull();
  });

  it("History lists a backdated finish in start order", async () => {
    const sat = makeWorkoutDetail({ startedAt: "2026-10-17T09:00:00.000Z", endedAt: "2026-10-17T10:00:00.000Z", localDate: "2026-10-17" });
    const thu = makeWorkoutDetail({ startedAt: "2026-10-15T09:00:00.000Z", endedAt: "2026-10-15T10:00:00.000Z", localDate: "2026-10-15" });
    const fake = createWorkoutFake({ finished: [sat, thu] });
    server.use(...fake.handlers);
    await call("POST", "/workouts", { clientGeneratedId: crypto.randomUUID(), startedAt: NOW.toISOString(), tzOffsetMinutes: 60 });
    const id = fake.state.active!.id;
    await call("PATCH", `/workouts/${id}`, { startedAt: "2026-10-16T17:00:00.000Z", tzOffsetMinutes: 60, durationSeconds: 3600 });
    await call("PATCH", `/workouts/${id}`, { endedAt: "2026-10-16T18:00:00.000Z" });
    const list = await call("GET", "/workouts");
    expect((list.json!["items"] as { localDate: string }[]).map((w) => w.localDate)).toEqual(["2026-10-17", "2026-10-16", "2026-10-15"]);
  });
});
