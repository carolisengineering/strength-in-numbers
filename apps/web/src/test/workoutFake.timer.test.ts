import { RoutineSectionSchema, WorkoutSummarySchema, type Routine, type SectionTimer } from "@sin/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigCache } from "../config";
import { draftFromRoutine } from "../features/routines/routineDraft";
import { toRoutineInput } from "../features/routines/validateDraft";
import { API_BASE_URL, stubWebEnv } from "./catalogHarness";
import { exerciseId, makeExercise } from "./catalogFixtures";
import { server } from "./msw/server";
import { createWorkoutFake, type WorkoutFakeOptions } from "./workoutFake";
import { makeSet, makeWorkoutDetail } from "./workoutFixtures";
import { sectioned } from "./sectionedDraft";
import { pushA, pushSectioned } from "./routineFixtures";

beforeEach(() => stubWebEnv());
afterEach(() => {
  resetConfigCache();
  vi.unstubAllEnvs();
});

async function put(id: string, body: unknown): Promise<Routine> {
  const res = await fetch(`${API_BASE_URL}/v1/routines/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  expect(res.status).toBe(200);
  return (await res.json()) as Routine;
}

describe("10.7 AC14 — round trip and rollout", () => {
  it.each<SectionTimer>([
    { format: "set_timer", roundSeconds: 300, rounds: 5 },
    { format: "amrap", capSeconds: 720 },
    { format: "time_cap", capSeconds: 900 },
    { format: "time_cap", capSeconds: null },
  ])("the fake echoes %j, and a reload gives the same timer", async (timer) => {
    const fake = createWorkoutFake({ routines: [pushA], catalog: [makeExercise({ id: exerciseId(1), name: "Bench" })] });
    server.use(...fake.handlers);
    const d = sectioned("", ["M", "a"]);
    const draft = { ...d, items: d.items.map((i) => ({ ...i, exerciseId: exerciseId(1) })), sections: d.sections.map((s) => ({ ...s, timer })) };
    const saved = await put(pushA.id, toRoutineInput(draft, { modalityOf: () => null }));
    expect(saved.sections[0]!.timer).toEqual(timer);
    expect(draftFromRoutine(saved).sections[0]!.timer).toEqual(timer);
  });

  it("the routine section response requires timer", () => {
    const noTimer = Object.fromEntries(Object.entries(pushSectioned.sections[0]!).filter(([key]) => key !== "timer"));
    expect(RoutineSectionSchema.safeParse(noTimer).success).toBe(false);
  });

  it("the fixtures carry timer: null", () => {
    expect(pushSectioned.sections.map((s) => s.timer)).toEqual([null, null]);
  });
});

describe("10.7 AC14 — no default on timer", () => {
  it("features/routines never defaults or catches timer", () => {
    const sources = import.meta.glob(["../features/routines/**/*.ts", "../features/routines/**/*.tsx", "!../features/routines/**/*.test.*"], {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const offenders = Object.entries(sources).filter(([, src]) => /timer[^\n]*\.(default|catch)\(/.test(src));
    expect(offenders.map(([p]) => p)).toEqual([]);
    expect(Object.keys(sources).length).toBeGreaterThan(20);
  });
});

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${API_BASE_URL}/v1${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : undefined };
};
const slugOf = (json: Record<string, unknown> | undefined) => new URL(String(json!["type"])).pathname.split("/").pop();
const SET5: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };
const TWO_ROUNDS = [
  { round: 1, seconds: 221 },
  { round: 2, seconds: 218 },
];

function bootTimed(options: Partial<WorkoutFakeOptions> = {}) {
  const active = makeWorkoutDetail({
    sections: [{ name: "Main", timer: SET5, roundTimes: TWO_ROUNDS }],
    exercises: [
      { modality: "weight_reps", name: "A", sectionIndex: 0 },
      { modality: "weight_reps", name: "B", sectionIndex: 0 },
    ],
  });
  const fake = createWorkoutFake({ active, ...options });
  server.use(...fake.handlers);
  return { fake, active, sectionId: active.sections[0]!.id };
}

describe("10.7 AC57 — the fake speaks 09.5's section timer", () => {
  it("POST stores the timer, a Time Cap with no cap as capSeconds: null", async () => {
    const { fake, active } = bootTimed();
    const res = await call("POST", `/workouts/${active.id}/sections`, { name: "Finisher", timer: { format: "time_cap" } });
    expect(res.status).toBe(201);
    expect(res.json!["timer"]).toEqual({ format: "time_cap", capSeconds: null });
    expect(fake.state.active!.sections[1]!.timer).toEqual({ format: "time_cap", capSeconds: null });
  });

  it("POST without a timer stores null", async () => {
    const { active } = bootTimed();
    const res = await call("POST", `/workouts/${active.id}/sections`, { name: "Plain" });
    expect(res.json!["timer"]).toBeNull();
  });

  it("PATCH to 6 rounds keeps the rounds", async () => {
    const { fake, sectionId } = bootTimed();
    const res = await call("PATCH", `/workout-sections/${sectionId}`, { timer: { ...SET5, rounds: 6 } });
    expect(res.status).toBe(200);
    expect(res.json!["roundTimes"]).toEqual(TWO_ROUNDS);
    expect(fake.state.active!.sections[0]!.timer).toEqual({ ...SET5, rounds: 6 });
  });

  it("PATCH to 1 round answers 409 section-result-exists and changes nothing", async () => {
    const { fake, active, sectionId } = bootTimed();
    const res = await call("PATCH", `/workout-sections/${sectionId}`, { timer: { ...SET5, rounds: 1 } });
    expect(res.status).toBe(409);
    expect(slugOf(res.json)).toBe("section-result-exists");
    expect(fake.state.active!.sections).toEqual(active.sections);
  });

  it("the same change with discardResult clears the times and result", async () => {
    const { fake, sectionId } = bootTimed();
    const res = await call("PATCH", `/workout-sections/${sectionId}`, { timer: { ...SET5, rounds: 1 }, discardResult: true });
    expect(res.status).toBe(200);
    expect(res.json!["roundTimes"]).toEqual([]);
    expect(res.json!["result"]).toBeNull();
    expect(fake.state.active!.sections[0]!.timer).toEqual({ ...SET5, rounds: 1 });
  });

  it("PATCH to AMRAP without the flag answers 409", async () => {
    const { sectionId } = bootTimed();
    const res = await call("PATCH", `/workout-sections/${sectionId}`, { timer: { format: "amrap", capSeconds: 720 } });
    expect(res.status).toBe(409);
    expect(slugOf(res.json)).toBe("section-result-exists");
  });

  it("removing the timer with discardResult clears it", async () => {
    const { fake, sectionId } = bootTimed();
    const res = await call("PATCH", `/workout-sections/${sectionId}`, { timer: null, discardResult: true });
    expect(res.status).toBe(200);
    expect(fake.state.active!.sections[0]).toMatchObject({ timer: null, roundTimes: [], result: null });
  });

  it("the same timer with discardResult writes nothing", async () => {
    const { fake, active, sectionId } = bootTimed();
    const res = await call("PATCH", `/workout-sections/${sectionId}`, { timer: { ...SET5 }, discardResult: true });
    expect(res.status).toBe(200);
    expect(res.json!["roundTimes"]).toEqual(TWO_ROUNDS);
    expect(fake.state.active!.sections).toEqual(active.sections);
  });

  it("a name-only PATCH leaves the timer and times alone", async () => {
    const { fake, sectionId } = bootTimed();
    const res = await call("PATCH", `/workout-sections/${sectionId}`, { name: "Renamed" });
    expect(res.status).toBe(200);
    expect(fake.state.active!.sections[0]).toMatchObject({ name: "Renamed", timer: SET5, roundTimes: TWO_ROUNDS });
  });

  it("History builds timedSections from the stored detail", async () => {
    const finished = makeWorkoutDetail({
      endedAt: "2026-10-02T11:00:00.000Z",
      sections: [
        { name: "Warm-up" },
        { name: "Main", timer: SET5, roundTimes: TWO_ROUNDS },
        { name: "Finisher", timer: { format: "amrap", capSeconds: 720 } },
      ],
      exercises: [{ modality: "weight_reps", name: "A", sectionIndex: 1, sets: [makeSet()] }],
    });
    const fake = createWorkoutFake({ finished: [finished] });
    server.use(...fake.handlers);
    const res = await call("GET", "/workouts");
    const items = (res.json!["items"] as unknown[]).map((i) => WorkoutSummarySchema.parse(i));
    expect(items[0]!.timedSections).toEqual([
      { id: finished.sections[1]!.id, position: 1, name: "Main", timer: SET5, score: { kind: "total_time", seconds: 439, rounds: 2 } },
      { id: finished.sections[2]!.id, position: 2, name: "Finisher", timer: { format: "amrap", capSeconds: 720 }, score: null },
    ]);
  });

  it("failRegroup fails the next N group PATCHes with 503", async () => {
    const { active } = bootTimed({ failRegroup: { times: 1 } });
    const [a, b] = active.exercises;
    const first = await call("PATCH", `/workout-exercises/${a!.id}`, { supersetGroup: 1 });
    expect(first.status).toBe(503);
    // A PATCH without supersetGroup is not counted.
    const moved = await call("PATCH", `/workout-exercises/${b!.id}`, { position: 0 });
    expect(moved.status).toBe(200);
    const second = await call("PATCH", `/workout-exercises/${a!.id}`, { supersetGroup: 1 });
    expect(second.status).toBe(200);
  });
});
