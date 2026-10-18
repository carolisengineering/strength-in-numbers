import { describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { WORKOUT_NOTES_MAX, WorkoutDetailSchema, WorkoutExerciseSchema, WorkoutSummarySchema } from "@sin/core";
import { buildTestApp, GENEROUS_LIMITS } from "../helpers/build-test-app.js";
import { FakeExerciseRepository, FakeRoutineRepository, FakeWorkoutRepository, makeExerciseRecord } from "../helpers/fakes.js";

const BEARER = { authorization: "Bearer test-token", "content-type": "application/json" };
const EX = makeExerciseRecord({ name: "Bench" });
const STARTED_AT = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const ENDED_AT = new Date(Date.now() - 30 * 60 * 1000).toISOString();

async function setup() {
  const exerciseRepo = new FakeExerciseRepository();
  exerciseRepo.byId.set(EX.id, EX);
  const routineRepo = new FakeRoutineRepository(exerciseRepo);
  const workoutRepo = new FakeWorkoutRepository(exerciseRepo, routineRepo);
  const { app } = await buildTestApp({
    exerciseRepository: exerciseRepo, routineRepository: routineRepo, workoutRepository: workoutRepo, rateLimits: GENEROUS_LIMITS,
  });
  const json = (method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT", url: string, payload?: unknown) =>
    app.inject({ method, url, headers: BEARER, ...(payload === undefined ? {} : { payload: payload as object }) });
  return { app, json, workoutRepo };
}

/** A routine with a loose item and two items in "Main", started as a workout (the fake mirrors Task 6's copy). */
async function sectionedWorkout() {
  const s = await setup();
  const routine = (await s.json("POST", "/v1/routines", {
    name: "Push day", notes: "Routine note",
    sections: [{ key: "warm", name: "Warm-up", notes: "5 min rower" }, { key: "main", name: "Main" }],
    items: [{ exerciseId: EX.id }, { exerciseId: EX.id, sectionKey: "main" }, { exerciseId: EX.id, sectionKey: "main" }],
  })).json();
  const started = await s.json("POST", "/v1/workouts", { clientGeneratedId: uuidv7(), startedAt: STARTED_AT, routineId: routine.id });
  expect(started.statusCode).toBe(201);
  const detail = (await s.json("GET", "/v1/workouts/active")).json();
  return { ...s, workoutId: started.json().id as string, detail };
}

describe("AC3 — workout read shapes", () => {
  it("detail and active carry sections (by position), routineNotes and each exercise's sectionId; no-store", async () => {
    const { json, detail, workoutId } = await sectionedWorkout();
    expect(() => WorkoutDetailSchema.parse(detail)).not.toThrow();
    expect(detail.routineNotes).toBe("Routine note");
    expect(detail.sections.map((x: { position: number; name: string }) => [x.position, x.name])).toEqual([[0, "Warm-up"], [1, "Main"]]);
    const main = detail.sections[1].id;
    expect(detail.exercises.map((e: { sectionId: string | null }) => e.sectionId)).toEqual([null, main, main]);
    const byId = await json("GET", `/v1/workouts/${workoutId}`);
    expect(byId.json()).toEqual(detail);
    expect(byId.headers["cache-control"]).toBe("no-store");
  });
  it("a manual workout reads sections: [], routineNotes: null; a manual add is loose", async () => {
    const { json } = await setup();
    const w = (await json("POST", "/v1/workouts", { clientGeneratedId: uuidv7(), startedAt: STARTED_AT })).json();
    const add = await json("POST", `/v1/workouts/${w.id}/exercises`, { exerciseId: EX.id });
    expect(add.statusCode).toBe(201);
    expect(() => WorkoutExerciseSchema.parse(add.json())).not.toThrow();
    expect(add.json().sectionId).toBeNull();
    const detail = (await json("GET", `/v1/workouts/${w.id}`)).json();
    expect([detail.sections, detail.routineNotes]).toEqual([[], null]);
  });
});

describe("AC1 — the start response and a History list row are unchanged", () => {
  it("POST /v1/workouts and a finished list row have no sections / routineNotes", async () => {
    const { json, workoutId } = await sectionedWorkout();
    const finished = await json("PATCH", `/v1/workouts/${workoutId}`, { endedAt: ENDED_AT });
    expect(finished.statusCode).toBe(200);
    expect(Object.keys(finished.json())).not.toContain("sections");
    const list = (await json("GET", "/v1/workouts")).json();
    expect(Object.keys(list.items[0]).sort()).toEqual(Object.keys(WorkoutSummarySchema.shape).sort());
  });
});

describe("AC17 — running-workout writes never touch sections", () => {
  it("add is loose; reorder and regroup keep section_id; sectionId is an unknown key (422); remove leaves the sections", async () => {
    const { json, detail, workoutId } = await sectionedWorkout();
    const [first, second, third] = detail.exercises as { id: string; sectionId: string | null }[];
    const added = await json("POST", `/v1/workouts/${workoutId}/exercises`, { exerciseId: EX.id });
    expect(added.json().sectionId).toBeNull();
    const moved = await json("PATCH", `/v1/workout-exercises/${third!.id}`, { position: 0 });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().sectionId).toBe(third!.sectionId);
    const grouped = await json("PATCH", `/v1/workout-exercises/${second!.id}`, { supersetGroup: 5 });
    expect(grouped.json().sectionId).toBe(second!.sectionId);
    const bad = await json("PATCH", `/v1/workout-exercises/${first!.id}`, { sectionId: second!.sectionId });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().type).toMatch(/validation-error$/);
    const del = await json("DELETE", `/v1/workout-exercises/${second!.id}`);
    expect(del.statusCode).toBe(204);
    const after = (await json("GET", `/v1/workouts/${workoutId}`)).json();
    expect(after.sections).toHaveLength(2);
    const bySection = new Map(after.exercises.map((e: { id: string; sectionId: string | null }) => [e.id, e.sectionId]));
    expect(bySection.get(third!.id)).toBe(third!.sectionId);
  });
});

describe("AC18 — PATCH /v1/workout-exercises/{id} notes (existing behavior, pinned)", () => {
  it("set, clear, absent key leaves it, position-only and supersetGroup-only never alter it", async () => {
    const { json, detail } = await sectionedWorkout();
    const id = detail.exercises[1].id as string;
    const set = await json("PATCH", `/v1/workout-exercises/${id}`, { notes: "felt heavy" });
    expect(set.json().notes).toBe("felt heavy");
    expect((await json("PATCH", `/v1/workout-exercises/${id}`, { supersetGroup: 4 })).json().notes).toBe("felt heavy");
    expect((await json("PATCH", `/v1/workout-exercises/${id}`, { position: 0 })).json().notes).toBe("felt heavy");
    expect((await json("PATCH", `/v1/workout-exercises/${id}`, {})).json().notes).toBe("felt heavy");
    expect((await json("PATCH", `/v1/workout-exercises/${id}`, { notes: null })).json().notes).toBeNull();
  });
  it.each([["empty string", ""], ["4 001 characters", "x".repeat(WORKOUT_NOTES_MAX + 1)]])("%s → 422 on `notes`", async (_l, notes) => {
    const { json, detail } = await sectionedWorkout();
    const res = await json("PATCH", `/v1/workout-exercises/${detail.exercises[0].id}`, { notes });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors.map((e: { path: string }) => e.path)).toEqual(["notes"]);
  });
  it("exactly 4 000 characters is accepted; a finished workout accepts a note too (amended by 07.4 AC2)", async () => {
    const { json, detail, workoutId } = await sectionedWorkout();
    const id = detail.exercises[0].id as string;
    expect((await json("PATCH", `/v1/workout-exercises/${id}`, { notes: "x".repeat(WORKOUT_NOTES_MAX) })).statusCode).toBe(200);
    await json("PATCH", `/v1/workouts/${workoutId}`, { endedAt: ENDED_AT });
    const res = await json("PATCH", `/v1/workout-exercises/${id}`, { notes: "late" });
    expect(res.statusCode).toBe(200);
    expect(res.json().notes).toBe("late");
  });
});
