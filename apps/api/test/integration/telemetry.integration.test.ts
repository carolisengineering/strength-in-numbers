import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { uuidv7 } from "uuidv7";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise } from "./records-helpers.js";
import {
  startTestTelemetry,
  stopTestTelemetry,
  metricPoints,
  counterTotal,
  type TelemetryHarness,
} from "../helpers/telemetry.js";
import { METRIC_NAMES } from "../../src/telemetry/views.js";

/**
 * Spec 13.0 AC10 (counters count real events once) and AC6 (Prisma query spans
 * nest under the request span) against real Postgres. SDK first, then dynamic
 * imports of anything that loads Fastify (Global Constraints).
 */
describe.skipIf(!shouldRunIntegration())("Spec 13.0 telemetry against real Postgres", () => {
  let db: IntegrationDb;
  let h: TelemetryHarness;
  let app: FastifyInstance;
  let base: string;
  const BEARER = { authorization: "Bearer test-token", "content-type": "application/json" };

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    h = startTestTelemetry();
    db = await startIntegrationDb();
    // Same wiring as personal-record-http.integration.test.ts: every repository
    // real (the user is provisioned by the auth plugin on the first request),
    // GENEROUS_LIMITS because this test sends more writes than RATE_LIMITS allow.
    const { buildApp } = await import("../../src/app.js");
    const { checkDatabaseReady } = await import("../../src/db.js");
    const { GENEROUS_LIMITS, testConfig } = await import("../helpers/build-test-app.js");
    const { authContext, fakeVerifier } = await import("../helpers/fakes.js");
    const { createUserRepository } = await import("../../src/repositories/user.prisma.js");
    const { createExerciseRepository } = await import("../../src/repositories/exercise.prisma.js");
    const { createWorkoutRepository } = await import("../../src/repositories/workout.prisma.js");
    const { createPersonalRecordRepository } = await import("../../src/repositories/personal-record.prisma.js");
    const { createRoutineRepository } = await import("../../src/repositories/routine.prisma.js");
    const { createAccountExportRepository } = await import("../../src/repositories/account-export.prisma.js");
    const { createHevyRepository } = await import("../../src/repositories/hevy.prisma.js");

    app = await buildApp({
      config: testConfig(),
      logger: false,
      checkReadiness: () => checkDatabaseReady(db.prisma),
      tokenVerifier: fakeVerifier(() => authContext({ authSub: "auth0|telemetry", email: "t@ex.com" })),
      userRepository: createUserRepository(db.prisma),
      exerciseRepository: createExerciseRepository(db.prisma),
      workoutRepository: createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma)),
      personalRecordRepository: createPersonalRecordRepository(db.prisma),
      routineRepository: createRoutineRepository(db.prisma),
      accountExportRepository: createAccountExportRepository(db.prisma),
      hevyRepository: createHevyRepository(db.prisma),
      rateLimits: GENEROUS_LIMITS,
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    if (h) await stopTestTelemetry(h);
    await db?.stop();
  });

  const total = async (name: string, attrs?: Record<string, unknown>) =>
    counterTotal(await metricPoints(h.reader, name), attrs);
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, { method: "POST", headers: BEARER, body: JSON.stringify(body) });
  const patch = (path: string, body: unknown) =>
    fetch(`${base}${path}`, { method: "PATCH", headers: BEARER, body: JSON.stringify(body) });

  it("AC10 — started counts fresh creates only; finished once; sets by modality; replays and failures count 0", async () => {
    const clientGeneratedId = uuidv7();
    const body = { clientGeneratedId, startedAt: new Date().toISOString() };

    const created = await post("/v1/workouts", body);
    expect(created.status).toBe(201);
    const workout = (await created.json()) as { id: string };
    expect(await total(METRIC_NAMES.workoutsStarted)).toBe(1);

    const replay = await post("/v1/workouts", body); // Review Focus 4
    expect(replay.status).toBe(200);
    expect(await total(METRIC_NAMES.workoutsStarted)).toBe(1);

    const exerciseId = await insertExercise(db, { modality: "weight_reps" });
    const we = await post(`/v1/workouts/${workout.id}/exercises`, { exerciseId });
    expect(we.status).toBe(201);
    const weId = ((await we.json()) as { id: string }).id;

    // An incomplete working set → finish is rejected (409) → finished += 0.
    const setBody = { clientGeneratedId: uuidv7(), setType: "working", reps: 5 };
    const incomplete = await post(`/v1/workout-exercises/${weId}/sets`, setBody);
    expect(incomplete.status).toBe(201);
    expect(await total(METRIC_NAMES.setsLogged, { modality: "weight_reps" })).toBe(1);

    // A set replay (same clientGeneratedId, 05.1 D15) → 200, sets += 0 (Review Focus 4, departure 12).
    const setReplay = await post(`/v1/workout-exercises/${weId}/sets`, setBody);
    expect(setReplay.status).toBe(200);
    expect(await total(METRIC_NAMES.setsLogged)).toBe(1);

    const rejected = await patch(`/v1/workouts/${workout.id}`, { endedAt: new Date().toISOString() });
    expect(rejected.status).toBe(409);
    expect(await total(METRIC_NAMES.workoutsFinished)).toBe(0);

    // A 4xx set create → sets += 0.
    const bad = await post(`/v1/workout-exercises/${weId}/sets`, { reps: -1 });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);
    expect(await total(METRIC_NAMES.setsLogged)).toBe(1); // still the one fresh create

    // Complete it, then finish → finished += 1.
    const setId = ((await (await fetch(`${base}/v1/workouts/${workout.id}`, { headers: BEARER })).json()) as {
      exercises: { sets: { id: string }[] }[];
    }).exercises[0]!.sets[0]!.id;
    const fixed = await patch(`/v1/sets/${setId}`, { weight: 80, weightUnit: "kg", isComplete: true });
    expect(fixed.status).toBe(200);
    const finished = await patch(`/v1/workouts/${workout.id}`, { endedAt: new Date().toISOString() });
    expect(finished.status).toBe(200);
    expect(await total(METRIC_NAMES.workoutsFinished)).toBe(1);

    // A re-finish is 409 workout-finished → finished += 0.
    const refinish = await patch(`/v1/workouts/${workout.id}`, { endedAt: new Date().toISOString() });
    expect(refinish.status).toBe(409);
    expect(await total(METRIC_NAMES.workoutsFinished)).toBe(1);

    // A set added to the finished workout (Spec 07.4) logs set_created, so it counts (departure 13).
    // A finished-mode working set must be complete, or it's a 422.
    const editAdd = await post(`/v1/workout-exercises/${weId}/sets`, {
      clientGeneratedId: uuidv7(), setType: "working", reps: 5, weight: 80, weightUnit: "kg", isComplete: true,
    });
    expect(editAdd.status).toBe(201);
    expect(await total(METRIC_NAMES.setsLogged, { modality: "weight_reps" })).toBe(2);

    for (const name of [METRIC_NAMES.workoutsStarted, METRIC_NAMES.workoutsFinished]) {
      for (const p of await metricPoints(h.reader, name)) expect(p.attributes).toEqual({});
    }
    for (const p of await metricPoints(h.reader, METRIC_NAMES.setsLogged)) {
      expect(Object.keys(p.attributes)).toEqual(["modality"]);
    }
  });

  it("AC6 — Prisma query spans are descendants of the request's server span", async () => {
    h.spans.reset();
    const res = await fetch(`${base}/v1/workouts/active`, { headers: BEARER });
    expect([200, 404]).toContain(res.status);
    const spans = h.spans.getFinishedSpans();
    const server = spans.find((s) => s.name === "GET /v1/workouts/active");
    expect(server, spans.map((s) => s.name).join(", ")).toBeDefined();
    const traceId = server!.spanContext().traceId;
    const prisma = spans.filter((s) => s.name.startsWith("prisma:"));
    expect(prisma.length).toBeGreaterThan(0);
    expect(prisma.every((s) => s.spanContext().traceId === traceId)).toBe(true);
    const sql = prisma.find((s) => s.name === "prisma:engine:db_query");
    expect(sql).toBeDefined();
  });
});
