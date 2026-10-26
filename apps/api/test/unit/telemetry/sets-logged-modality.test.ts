import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { metricPoints, startTestTelemetry, stopTestTelemetry, type TelemetryHarness } from "../../helpers/telemetry.js";
import { METRIC_NAMES } from "../../../src/telemetry/views.js";

// Global Constraints: SDK first, THEN load anything that imports Fastify.
let h: TelemetryHarness;
const BEARER = { authorization: "Bearer test-token" };

beforeAll(() => {
  h = startTestTelemetry();
});
afterAll(async () => {
  await stopTestTelemetry(h);
});

describe("05.3 AC20 — sin.sets.logged carries the new modality through the set route", () => {
  it("logging a calories set records modality: calories", async () => {
    const { buildTestApp } = await import("../../helpers/build-test-app.js");
    const { FakeExerciseRepository, FakeWorkoutRepository, makeExerciseRecord } = await import("../../helpers/fakes.js");
    const exerciseRepo = new FakeExerciseRepository();
    const exercise = makeExerciseRecord({ modality: "calories", isActive: true });
    exerciseRepo.byId.set(exercise.id, exercise);
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo, workoutRepository: new FakeWorkoutRepository(exerciseRepo) });
    const w = await app.inject({
      method: "POST", url: "/v1/workouts", headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: new Date(Date.now() - 600_000).toISOString() },
    });
    const we = await app.inject({ method: "POST", url: `/v1/workouts/${w.json().id}/exercises`, headers: BEARER, payload: { exerciseId: exercise.id } });
    const set = await app.inject({ method: "POST", url: `/v1/workout-exercises/${we.json().id}/sets`, headers: BEARER, payload: { calories: 20, isComplete: true } });
    expect(set.statusCode).toBe(201);
    const points = await metricPoints(h.reader, METRIC_NAMES.setsLogged);
    expect(points.map((p) => p.attributes)).toEqual([{ modality: "calories" }]);
    await app.close();
  });
});
