// Spec 07.4 AC32 — `workout_edited` / `workout_edit_refused` log lines for finished-workout edits.
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { buildTestApp } from "../helpers/build-test-app.js";
import { FakeExerciseRepository, FakeWorkoutRepository, makeExerciseRecord } from "../helpers/fakes.js";

const BEARER = { authorization: "Bearer test-token" };
const STARTED_AT = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const ENDED_AT = new Date(Date.now() - 30 * 60 * 1000).toISOString();
const SECRET_TITLE = "Secret Title 4242";
const SECRET_NOTE = "private note 4242";

function capturingLogger(): { logger: FastifyBaseLogger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const logger: FastifyBaseLogger = pino({ level: "debug" }, { write: (s: string) => lines.push(JSON.parse(s)) });
  return { logger, lines };
}

/** A finished workout with one card holding one complete working set, plus the captured log lines. */
async function finishedSetup() {
  const { logger, lines } = capturingLogger();
  const exerciseRepo = new FakeExerciseRepository();
  const exercise = makeExerciseRecord({ modality: "weight_reps", isActive: true });
  exerciseRepo.byId.set(exercise.id, exercise);
  const { app } = await buildTestApp({ logger, exerciseRepository: exerciseRepo, workoutRepository: new FakeWorkoutRepository(exerciseRepo) });
  const call = (method: "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
    app.inject({ method, url, headers: BEARER, ...(payload ? { payload } : {}) });
  const workoutId = (await call("POST", "/v1/workouts", { clientGeneratedId: uuidv7(), startedAt: STARTED_AT })).json().id as string;
  const weId = (await call("POST", `/v1/workouts/${workoutId}/exercises`, { exerciseId: exercise.id })).json().id as string;
  const setId = (await call("POST", `/v1/workout-exercises/${weId}/sets`, { reps: 5, weight: 100, weightUnit: "kg", isComplete: true })).json().id as string;
  await call("PATCH", `/v1/workouts/${workoutId}`, { endedAt: ENDED_AT });
  return { app, call, lines, workoutId, weId, setId, exerciseId: exercise.id };
}

const edited = (lines: Record<string, unknown>[]) => lines.filter((l) => l.msg === "workout_edited");

describe("07.4 AC32 — workout_edited", () => {
  it.each([
    ["set_added", (c: Ctx) => c.call("POST", `/v1/workout-exercises/${c.weId}/sets`, { setType: "warmup", reps: 5, weight: 40, weightUnit: "kg", isComplete: true })],
    ["set_changed", (c: Ctx) => c.call("PATCH", `/v1/sets/${c.setId}`, { rpe: 8 })],
    ["exercise_added", (c: Ctx) => c.call("POST", `/v1/workouts/${c.workoutId}/exercises`, { exerciseId: c.exerciseId })],
    ["exercise_noted", (c: Ctx) => c.call("PATCH", `/v1/workout-exercises/${c.weId}`, { notes: SECRET_NOTE })],
    ["exercise_regrouped", (c: Ctx) => c.call("PATCH", `/v1/workout-exercises/${c.weId}`, { supersetGroup: 1 })],
    ["details_changed", (c: Ctx) => c.call("PATCH", `/v1/workouts/${c.workoutId}`, { title: SECRET_TITLE, notes: SECRET_NOTE })],
  ])("%s fires once with ids, enums and timings only", async (edit, act) => {
    const ctx = await finishedSetup();
    const res = await act(ctx);
    expect(res.statusCode).toBeLessThan(300);
    const line = edited(ctx.lines);
    expect(line).toHaveLength(1);
    expect(line[0]).toMatchObject({ workout_id: ctx.workoutId, edit, records_recomputed: false, root_count: 0, recompute_ms: 0 });
    expect(typeof line[0]!.user_id).toBe("string");
    expect(JSON.stringify(ctx.lines)).not.toContain(SECRET_TITLE);
    expect(JSON.stringify(ctx.lines)).not.toContain(SECRET_NOTE);
  });

  it("set_deleted and exercise_removed fire on deletes; exercise_moved on a reorder", async () => {
    const ctx = await finishedSetup();
    const extra = (await ctx.call("POST", `/v1/workouts/${ctx.workoutId}/exercises`, { exerciseId: ctx.exerciseId })).json().id as string;
    await ctx.call("PATCH", `/v1/workout-exercises/${extra}`, { position: 0 });
    await ctx.call("POST", `/v1/workout-exercises/${ctx.weId}/sets`, { setType: "warmup", reps: 5, weight: 40, weightUnit: "kg", isComplete: true });
    await ctx.call("DELETE", `/v1/sets/${ctx.setId}`);
    await ctx.call("DELETE", `/v1/workout-exercises/${extra}`);
    expect(edited(ctx.lines).map((l) => l.edit)).toEqual(["exercise_added", "exercise_moved", "set_added", "set_deleted", "exercise_removed"]);
  });

  it("09.4 AC9 — section_added, section_changed and section_removed on a finished workout; a no-op PATCH logs none", async () => {
    const ctx = await finishedSetup();
    const id = (await ctx.call("POST", `/v1/workouts/${ctx.workoutId}/sections`, { name: "Finisher" })).json().id as string;
    await ctx.call("PATCH", `/v1/workout-sections/${id}`, { name: "Finisher" });
    await ctx.call("PATCH", `/v1/workout-sections/${id}`, { notes: "EMOM" });
    await ctx.call("DELETE", `/v1/workout-sections/${id}`);
    const lines = edited(ctx.lines);
    expect(lines.map((l) => l.edit)).toEqual(["section_added", "section_changed", "section_removed"]);
    for (const l of lines) expect(l).toMatchObject({ workout_id: ctx.workoutId, records_recomputed: false, root_count: 0 });
  });

  it("a live workout's writes log no workout_edited", async () => {
    const { logger, lines } = capturingLogger();
    const exerciseRepo = new FakeExerciseRepository();
    const exercise = makeExerciseRecord({ modality: "weight_reps", isActive: true });
    exerciseRepo.byId.set(exercise.id, exercise);
    const { app } = await buildTestApp({ logger, exerciseRepository: exerciseRepo, workoutRepository: new FakeWorkoutRepository(exerciseRepo) });
    const workoutId = (await app.inject({ method: "POST", url: "/v1/workouts", headers: BEARER, payload: { clientGeneratedId: uuidv7(), startedAt: STARTED_AT } })).json().id;
    const weId = (await app.inject({ method: "POST", url: `/v1/workouts/${workoutId}/exercises`, headers: BEARER, payload: { exerciseId: exercise.id } })).json().id;
    await app.inject({ method: "POST", url: `/v1/workout-exercises/${weId}/sets`, headers: BEARER, payload: { reps: 5 } });
    await app.inject({ method: "PATCH", url: `/v1/workouts/${workoutId}`, headers: BEARER, payload: { title: "x" } });
    expect(edited(lines)).toHaveLength(0);
  });
});

describe("07.4 AC32 — workout_edit_refused", () => {
  it("a refused last-set delete logs the reason and the 409 still reaches the client", async () => {
    const ctx = await finishedSetup();
    const res = await ctx.call("DELETE", `/v1/sets/${ctx.setId}`);
    expect(res.statusCode).toBe(409);
    const refused = ctx.lines.filter((l) => l.msg === "workout_edit_refused");
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ workout_id: ctx.workoutId, reason: "would_be_empty" });
    expect(edited(ctx.lines)).toHaveLength(0);
  });

  it("the same for the last card's delete", async () => {
    const ctx = await finishedSetup();
    expect((await ctx.call("DELETE", `/v1/workout-exercises/${ctx.weId}`)).statusCode).toBe(409);
    expect(ctx.lines.filter((l) => l.msg === "workout_edit_refused")).toHaveLength(1);
  });
});

describe("07.4 AC32 — workout_retimed and had_planned_duration", () => {
  const retimed = (lines: Record<string, unknown>[]) => lines.filter((l) => l.msg === "workout_retimed");
  const DAY_MS = 86_400_000;

  async function liveSetup(startedAt: string) {
    const { logger, lines } = capturingLogger();
    const { app } = await buildTestApp({ logger });
    const patch = (payload: object) => app.inject({ method: "PATCH", url: `/v1/workouts/${workoutId}`, headers: BEARER, payload });
    const workoutId = (await app.inject({ method: "POST", url: "/v1/workouts", headers: BEARER, payload: { clientGeneratedId: uuidv7(), startedAt } })).json().id as string;
    return { lines, patch, workoutId };
  }

  it("a live plan logs workout_retimed once: was_finished false, no shift, the plan, no days_back", async () => {
    const ctx = await liveSetup(new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());
    expect((await ctx.patch({ durationSeconds: 3600 })).statusCode).toBe(200);
    const line = retimed(ctx.lines);
    expect(line).toHaveLength(1);
    expect(line[0]).toMatchObject({ workout_id: ctx.workoutId, was_finished: false, start_shift_seconds: null, duration_seconds: 3600, days_back: null });
    expect(typeof line[0]!.user_id).toBe("string");
  });

  it("a finished start moved back three days logs the shift and days_back", async () => {
    const ctx = await finishedSetup();
    const moved = new Date(Date.parse(STARTED_AT) - 3 * DAY_MS).toISOString();
    expect((await ctx.call("PATCH", `/v1/workouts/${ctx.workoutId}`, { startedAt: moved })).statusCode).toBe(200);
    const line = retimed(ctx.lines);
    expect(line).toHaveLength(1);
    expect(line[0]).toMatchObject({ workout_id: ctx.workoutId, was_finished: true, start_shift_seconds: -259_200, days_back: 3 });
    expect(edited(ctx.lines)).toHaveLength(0);
  });

  it("a finished start and title in one PATCH log both lines, and neither carries the title", async () => {
    const ctx = await finishedSetup();
    const moved = new Date(Date.parse(STARTED_AT) - DAY_MS).toISOString();
    expect((await ctx.call("PATCH", `/v1/workouts/${ctx.workoutId}`, { startedAt: moved, title: SECRET_TITLE })).statusCode).toBe(200);
    expect(retimed(ctx.lines)).toHaveLength(1);
    expect(edited(ctx.lines).map((l) => l.edit)).toEqual(["details_changed"]);
    expect(JSON.stringify(ctx.lines)).not.toContain(SECRET_TITLE);
  });

  it("workout_finished carries had_planned_duration", async () => {
    const started = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const planned = await liveSetup(started.toISOString());
    await planned.patch({ durationSeconds: 1800 });
    await planned.patch({ endedAt: new Date(started.getTime() + 1_800_000).toISOString() });
    expect(planned.lines.find((l) => l.msg === "workout_finished")).toMatchObject({ had_planned_duration: true, duration_seconds: 1800 });

    const plain = await liveSetup(started.toISOString());
    await plain.patch({ endedAt: new Date().toISOString() });
    expect(plain.lines.find((l) => l.msg === "workout_finished")).toMatchObject({ had_planned_duration: false });
  });
});

type Ctx = Awaited<ReturnType<typeof finishedSetup>> & { app: FastifyInstance };
