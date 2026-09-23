import type { FastifyBaseLogger } from "fastify";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { buildTestApp } from "../helpers/build-test-app.js";
import { FakeExerciseRepository, FakeWorkoutRepository, makeExerciseRecord } from "../helpers/fakes.js";

const BEARER = { authorization: "Bearer test-token" };

// `assertStartedAtInBounds` checks `startedAt` against the real wall clock
// (±5min future / -7days past), so fixture timestamps must be relative to
// "now" rather than a fixed literal — see routes-workouts.test.ts.
const STARTED_AT = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
const ENDED_AT = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30m ago

function capturingLogger(): { logger: FastifyBaseLogger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const logger: FastifyBaseLogger = pino({ level: "debug" }, { write: (s: string) => lines.push(JSON.parse(s)) });
  return { logger, lines };
}

describe("AC18 — the four business log lines, no free text", () => {
  it("workout_started fires on the 201 create and not on the 200 replay", async () => {
    const { logger, lines } = capturingLogger();
    const { app } = await buildTestApp({ logger });
    const clientGeneratedId = uuidv7();
    const payload = { clientGeneratedId, startedAt: STARTED_AT, title: "distinctive-title-xyz" };

    await app.inject({ method: "POST", url: "/v1/workouts", headers: BEARER, payload });
    expect(lines.filter((l) => l.msg === "workout_started")).toHaveLength(1);

    await app.inject({ method: "POST", url: "/v1/workouts", headers: BEARER, payload });
    expect(lines.filter((l) => l.msg === "workout_started")).toHaveLength(1); // still 1 — no second line on replay
  });

  it("workout_finished fires on the finish transition only, not on a title/notes edit or a {} no-op, with its §9 fields", async () => {
    const { logger, lines } = capturingLogger();
    const exerciseRepo = new FakeExerciseRepository();
    const exercise = makeExerciseRecord({ name: "Bench Press", modality: "weight_reps", isActive: true });
    exerciseRepo.byId.set(exercise.id, exercise);
    const workoutRepo = new FakeWorkoutRepository(exerciseRepo);
    const { app } = await buildTestApp({ logger, workoutRepository: workoutRepo });
    const created = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: STARTED_AT },
    });
    const id = created.json().id;

    // Two exercises added, so the finish log's exercise_count should be 2.
    await app.inject({
      method: "POST",
      url: `/v1/workouts/${id}/exercises`,
      headers: BEARER,
      payload: { exerciseId: exercise.id },
    });
    await app.inject({
      method: "POST",
      url: `/v1/workouts/${id}/exercises`,
      headers: BEARER,
      payload: { exerciseId: exercise.id },
    });

    await app.inject({ method: "PATCH", url: `/v1/workouts/${id}`, headers: BEARER, payload: { title: "renamed" } });
    await app.inject({ method: "PATCH", url: `/v1/workouts/${id}`, headers: BEARER, payload: {} });
    expect(lines.filter((l) => l.msg === "workout_finished")).toHaveLength(0);

    await app.inject({
      method: "PATCH",
      url: `/v1/workouts/${id}`,
      headers: BEARER,
      payload: { endedAt: ENDED_AT },
    });
    const finishedLines = lines.filter((l) => l.msg === "workout_finished");
    expect(finishedLines).toHaveLength(1);
    expect(finishedLines[0]).toMatchObject({
      workout_id: id,
      exercise_count: 2,
    });
    expect(typeof finishedLines[0]!.user_id).toBe("string");
    expect(typeof finishedLines[0]!.duration_seconds).toBe("number");
  });

  it("workout_deleted fires on success with its §9 fields", async () => {
    const { logger, lines } = capturingLogger();
    const exerciseRepo = new FakeExerciseRepository();
    const exercise = makeExerciseRecord({ name: "Bench Press", modality: "weight_reps", isActive: true });
    exerciseRepo.byId.set(exercise.id, exercise);
    const workoutRepo = new FakeWorkoutRepository(exerciseRepo);
    const { app } = await buildTestApp({ logger, workoutRepository: workoutRepo });
    const created = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: STARTED_AT },
    });
    const id = created.json().id;

    // One exercise added, then finished before deletion, so the delete log
    // should report was_finished: true, exercise_count: 1.
    await app.inject({
      method: "POST",
      url: `/v1/workouts/${id}/exercises`,
      headers: BEARER,
      payload: { exerciseId: exercise.id },
    });
    await app.inject({
      method: "PATCH",
      url: `/v1/workouts/${id}`,
      headers: BEARER,
      payload: { endedAt: ENDED_AT },
    });

    await app.inject({ method: "DELETE", url: `/v1/workouts/${id}`, headers: BEARER });
    const deletedLine = lines.find((l) => l.msg === "workout_deleted");
    expect(deletedLine).toMatchObject({
      workout_id: id,
      was_finished: true,
      exercise_count: 1,
    });
    expect(typeof deletedLine!.user_id).toBe("string");
  });

  it("workout_exercise_added fires on success with its §9 fields", async () => {
    const { logger, lines } = capturingLogger();
    const exerciseRepo = new FakeExerciseRepository();
    const exercise = makeExerciseRecord({ name: "Bench Press", modality: "weight_reps", isActive: true });
    exerciseRepo.byId.set(exercise.id, exercise);
    const workoutRepo = new FakeWorkoutRepository(exerciseRepo);
    const { app } = await buildTestApp({ logger, workoutRepository: workoutRepo });

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
    const addedLine = lines.find((l) => l.msg === "workout_exercise_added");
    expect(addedLine).toMatchObject({
      workout_id: workoutId,
      workout_exercise_id: add.json().id,
      exercise_id: exercise.id,
    });
  });

  it("no captured line, and no 422 problem+json detail, contains the request's title or notes text", async () => {
    const { logger, lines } = capturingLogger();
    const { app } = await buildTestApp({ logger });
    const secretTitle = "super-secret-workout-title-marker";
    const secretNotes = "super-secret-notes-marker";
    const created = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: {
        clientGeneratedId: uuidv7(),
        startedAt: STARTED_AT,
        title: secretTitle,
        notes: secretNotes,
      },
    });
    expect(created.statusCode).toBe(201);

    // A validation failure on the same title/notes-bearing payload must also
    // never echo the free text back in the problem+json `detail`.
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: {
        clientGeneratedId: "not-a-uuid",
        startedAt: STARTED_AT,
        title: secretTitle,
        notes: secretNotes,
      },
    });
    expect(invalid.statusCode).toBe(422);

    const allText = JSON.stringify(lines) + invalid.body;
    expect(allText).not.toContain(secretTitle);
    expect(allText).not.toContain(secretNotes);
  });
});
