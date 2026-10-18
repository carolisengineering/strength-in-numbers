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

type Ctx = Awaited<ReturnType<typeof finishedSetup>> & { app: FastifyInstance };
