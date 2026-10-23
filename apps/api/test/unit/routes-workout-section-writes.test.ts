// Spec 09.4 AC3–AC8, AC20, AC21 — POST /v1/workouts/{id}/sections, PATCH / DELETE /v1/workout-sections/{id}.
import type { FastifyBaseLogger } from "fastify";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { WorkoutSectionSchema } from "@sin/core";
import { RATE_LIMITS } from "../../src/plugins/rate-limit.js";
import { buildTestApp, GENEROUS_LIMITS } from "../helpers/build-test-app.js";
import { FakeExerciseRepository, FakeWorkoutRepository } from "../helpers/fakes.js";

const BEARER = { authorization: "Bearer test-token", "content-type": "application/json" };
const STARTED_AT = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const SECRET_NAME = "ZebraSectionQx";
const SECRET_NOTE = "NoteSecretQx";

async function setup() {
  const lines: Record<string, unknown>[] = [];
  const logger: FastifyBaseLogger = pino({ level: "debug" }, { write: (s: string) => lines.push(JSON.parse(s)) });
  const workoutRepo = new FakeWorkoutRepository(new FakeExerciseRepository());
  const { app } = await buildTestApp({ logger, workoutRepository: workoutRepo, rateLimits: GENEROUS_LIMITS });
  const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) =>
    app.inject({ method, url, headers: method === "DELETE" ? { authorization: BEARER.authorization } : BEARER, ...(payload === undefined ? {} : { payload: payload as object }) });
  const workoutId = (await call("POST", "/v1/workouts", { clientGeneratedId: uuidv7(), startedAt: STARTED_AT })).json().id as string;
  return { app, call, lines, workoutRepo, workoutId };
}

describe("09.4 AC3 / AC6 / AC7 — HTTP shapes", () => {
  it("POST 201 WorkoutSection (addedInWorkout true, no Location); PATCH 200; DELETE 204 empty; a repeat DELETE is 404", async () => {
    const { call, workoutId } = await setup();
    const created = await call("POST", `/v1/workouts/${workoutId}/sections`, { name: "  Warm-up ", notes: "5 min row" });
    expect(created.statusCode).toBe(201);
    const body = WorkoutSectionSchema.parse(created.json());
    expect(body).toMatchObject({ position: 0, name: "Warm-up", notes: "5 min row", addedInWorkout: true });
    expect(created.headers.location).toBeUndefined();

    const patched = await call("PATCH", `/v1/workout-sections/${body.id}`, { notes: null });
    expect(patched.statusCode).toBe(200);
    expect(WorkoutSectionSchema.parse(patched.json())).toEqual({ ...body, notes: null });

    const detail = (await call("GET", `/v1/workouts/${workoutId}`)).json();
    expect(detail.sections).toEqual([{ ...body, notes: null }]);

    const removed = await call("DELETE", `/v1/workout-sections/${body.id}`);
    expect([removed.statusCode, removed.body]).toEqual([204, ""]);
    const again = await call("DELETE", `/v1/workout-sections/${body.id}`);
    expect(again.statusCode).toBe(404);
    expect(again.headers["content-type"]).toContain("application/problem+json");
  });
});

describe("09.4 AC4 — 422 paths over HTTP", () => {
  it("collects every issue of a body into one 422; position is an unknown key; PATCH rejects addedInWorkout", async () => {
    const { call, workoutId } = await setup();
    const both = await call("POST", `/v1/workouts/${workoutId}/sections`, { name: "", notes: "" });
    expect(both.statusCode).toBe(422);
    const paths = (both.json().errors as { path: string }[]).map((e) => e.path).sort();
    expect(paths).toEqual(["name", "notes"]);
    expect((await call("POST", `/v1/workouts/${workoutId}/sections`, { name: "A", position: 0 })).statusCode).toBe(422);
    const id = (await call("POST", `/v1/workouts/${workoutId}/sections`, { name: "A" })).json().id;
    expect((await call("PATCH", `/v1/workout-sections/${id}`, { addedInWorkout: false })).statusCode).toBe(422);
  });
});

describe("09.4 AC5 — 409 workout-section-limit", () => {
  it("the ninth POST is problem+json with the new slug", async () => {
    const { call, workoutId } = await setup();
    for (let i = 0; i < 8; i++) expect((await call("POST", `/v1/workouts/${workoutId}/sections`, { name: `S${i}` })).statusCode).toBe(201);
    const ninth = await call("POST", `/v1/workouts/${workoutId}/sections`, { name: "S8" });
    expect(ninth.statusCode).toBe(409);
    expect(ninth.headers["content-type"]).toContain("application/problem+json");
    expect(ninth.json()).toMatchObject({ status: 409, title: "Workout section limit reached", detail: "A workout can have at most 8 sections." });
    expect(ninth.json().type).toMatch(/\/workout-section-limit$/);
  });
});

describe("09.4 AC8 — authorization", () => {
  it("a malformed id is 404 on all three routes; another user's workout or section is 404, never 403", async () => {
    const { call, workoutRepo } = await setup();
    expect((await call("POST", "/v1/workouts/nope/sections", { name: "A" })).statusCode).toBe(404);
    expect((await call("PATCH", "/v1/workout-sections/nope", { name: "A" })).statusCode).toBe(404);
    expect((await call("DELETE", "/v1/workout-sections/nope")).statusCode).toBe(404);

    const other = await workoutRepo.createWorkout("someone-else", { clientGeneratedId: uuidv7(), startedAt: new Date(STARTED_AT), tzOffsetMinutes: 0, title: null, notes: null }, "UTC");
    const theirs = await workoutRepo.addWorkoutSection("someone-else", other.workout.id, { name: "Theirs", notes: null });
    expect((await call("POST", `/v1/workouts/${other.workout.id}/sections`, { name: "A" })).statusCode).toBe(404);
    expect((await call("PATCH", `/v1/workout-sections/${theirs.id}`, { name: "Mine" })).statusCode).toBe(404);
    expect((await call("DELETE", `/v1/workout-sections/${theirs.id}`)).statusCode).toBe(404);
    expect(workoutRepo.sectionsByWorkout.get(other.workout.id)!.sections.map((s) => s.name)).toEqual(["Theirs"]);
  });
});

describe("09.4 AC20 — wiring", () => {
  it("the three routes are published in /openapi.json", async () => {
    const { app } = await setup();
    const doc = (await app.inject({ method: "GET", url: "/openapi.json" })).json();
    expect(Object.keys(doc.paths["/v1/workouts/{id}/sections"] ?? {})).toContain("post");
    expect(Object.keys(doc.paths["/v1/workout-sections/{id}"] ?? {}).sort()).toEqual(["delete", "patch"]);
  });
  it("RATE_LIMITS is unchanged", () => {
    expect(RATE_LIMITS).toEqual({
      windowMs: 60_000, ip: 600, docs: 30, exportPerUser: 3,
      groups: { sets: 120, workouts: 60, exercises: 20, routines: 30, me: 10 }, inflight: 4,
    });
  });
});

describe("09.4 AC21 — logging hygiene", () => {
  it("each line carries exactly its §9 fields; no section name or note in any line", async () => {
    const { call, lines, workoutId } = await setup();
    const id = (await call("POST", `/v1/workouts/${workoutId}/sections`, { name: SECRET_NAME, notes: SECRET_NOTE })).json().id;
    await call("PATCH", `/v1/workout-sections/${id}`, { name: `${SECRET_NAME}2` });
    await call("PATCH", `/v1/workout-sections/${id}`, { name: `${SECRET_NAME}2` }); // no-op: no line
    await call("DELETE", `/v1/workout-sections/${id}`);
    const by = (msg: string) => lines.filter((l) => l.msg === msg);
    const pick = (l: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, l[k]]));

    const added = by("workout_section_added");
    expect(added).toHaveLength(1);
    expect(pick(added[0]!, ["workout_id", "section_id", "section_count", "has_notes"])).toEqual({ workout_id: workoutId, section_id: id, section_count: 1, has_notes: true });
    const updated = by("workout_section_updated");
    expect(updated).toHaveLength(1);
    expect(pick(updated[0]!, ["workout_id", "section_id", "name_changed", "notes_changed"])).toEqual({ workout_id: workoutId, section_id: id, name_changed: true, notes_changed: false });
    const removed = by("workout_section_removed");
    expect(removed).toHaveLength(1);
    expect(pick(removed[0]!, ["workout_id", "section_id", "exercise_count"])).toEqual({ workout_id: workoutId, section_id: id, exercise_count: 0 });
    for (const l of [...added, ...updated, ...removed]) expect(typeof l.user_id).toBe("string");

    const text = JSON.stringify(lines);
    expect(text).not.toContain(SECRET_NAME);
    expect(text).not.toContain(SECRET_NOTE);
  });
});
