// Spec 09.5 AC14–AC17, AC20, AC33 — the round-time and result routes over HTTP (fake repository).
import type { FastifyBaseLogger } from "fastify";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { WorkoutSectionSchema } from "@sin/core";
import { CORS_METHODS } from "../../src/plugins/cors-methods.js";
import { buildTestApp, GENEROUS_LIMITS, limitsWith, RATE_LIMITS } from "../helpers/build-test-app.js";
import { FakeExerciseRepository, FakeWorkoutRepository } from "../helpers/fakes.js";

const BEARER = { authorization: "Bearer test-token", "content-type": "application/json" };
const STARTED_AT = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const BASE_KEYS = new Set(["level", "time", "pid", "hostname", "msg", "reqId", "client_ip"]);
const fieldsOf = (line: Record<string, unknown>) => Object.keys(line).filter((k) => !BASE_KEYS.has(k)).sort();

/** CORS_METHODS at the branch base: Phase B adds no method (PUT and DELETE are already listed). */
const CORS_METHODS_BEFORE = ["DELETE", "GET", "OPTIONS", "PATCH", "POST", "PUT"];

async function setup(timer: unknown = { format: "amrap", capSeconds: 720 }) {
  const lines: Record<string, unknown>[] = [];
  const logger: FastifyBaseLogger = pino({ level: "debug" }, { write: (s: string) => lines.push(JSON.parse(s)) });
  const workoutRepo = new FakeWorkoutRepository(new FakeExerciseRepository());
  const { app } = await buildTestApp({ logger, workoutRepository: workoutRepo, rateLimits: GENEROUS_LIMITS });
  const call = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown) =>
    app.inject({
      method,
      url,
      headers: payload === undefined ? { authorization: BEARER.authorization } : BEARER,
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const workoutId = (await call("POST", "/v1/workouts", { clientGeneratedId: uuidv7(), startedAt: STARTED_AT })).json().id as string;
  const section = WorkoutSectionSchema.parse(
    (await call("POST", `/v1/workouts/${workoutId}/sections`, { name: "Zq7 Main", ...(timer === null ? {} : { timer }) })).json(),
  );
  return { call, lines, workoutRepo, workoutId, section, url: `/v1/workout-sections/${section.id}` };
}

/** `setup`, plus the in-memory section record to seed recorded data the routes alone cannot reach in one step. */
async function setupWithRecord(timer: unknown) {
  const s = await setup(timer);
  const record = () => s.workoutRepo.sectionsByWorkout.get(s.workoutId)!.sections.find((x) => x.id === s.section.id)!;
  return { ...s, record };
}

describe("09.5 AC14 — path and body validation", () => {
  it.each(["03", "0", "101", "3.0", "-1", "1e1"])("PUT …/round-times/%s → 422 on round (Review Focus 1)", async (round) => {
    const { call, url } = await setup();
    const res = await call("PUT", `${url}/round-times/${round}`, { seconds: 60 });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors[0].path).toBe("round");
  });

  it.each([[{ seconds: 0 }], [{ seconds: 10_801 }], [{ seconds: 210, extra: 1 }], [{}]])("body %j → 422", async (body) => {
    const { call, url } = await setup();
    expect((await call("PUT", `${url}/round-times/1`, body)).statusCode).toBe(422);
  });

  it("a valid write is 200 with the whole section; a rule break is 422 on seconds; untimed is 409 section-timer-mismatch", async () => {
    const { call, url } = await setup();
    const ok = await call("PUT", `${url}/round-times/2`, { seconds: 300 });
    expect(ok.statusCode).toBe(200);
    expect(WorkoutSectionSchema.parse(ok.json()).roundTimes).toEqual([{ round: 2, seconds: 300 }]);
    const late = await call("PUT", `${url}/round-times/3`, { seconds: 200 });
    expect([late.statusCode, late.json().errors[0].path]).toEqual([422, "seconds"]);

    const untimed = await setup(null);
    const res = await untimed.call("PUT", `${untimed.url}/round-times/1`, { seconds: 60 });
    expect(res.statusCode).toBe(409);
    expect(res.json().type).toMatch(/\/section-timer-mismatch$/);
  });
});

describe("09.5 AC15 — DELETE is 204 present or absent", () => {
  it("204 with an empty body both times; 404 for a missing section", async () => {
    const { call, url } = await setup();
    await call("PUT", `${url}/round-times/1`, { seconds: 100 });
    for (let i = 0; i < 2; i++) {
      const res = await call("DELETE", `${url}/round-times/1`);
      expect([res.statusCode, res.body]).toEqual([204, ""]);
    }
    expect((await call("DELETE", `/v1/workout-sections/${uuidv7()}/round-times/1`)).statusCode).toBe(404);
  });
});

describe("09.5 AC33 — round log lines", () => {
  it("carry ids, the round number and booleans only", async () => {
    const { call, url, workoutId, section, lines } = await setup({ format: "time_cap", capSeconds: null });
    await call("PUT", `${url}/round-times/4`, { seconds: 2917 });
    await call("PUT", `${url}/round-times/4`, { seconds: 2917 });
    await call("DELETE", `${url}/round-times/4`);
    const set = lines.filter((l) => l.msg === "workout_section_round_set");
    expect(set.map(fieldsOf)).toEqual([
      ["changed", "round", "section_id", "user_id", "workout_id"],
      ["changed", "round", "section_id", "user_id", "workout_id"],
    ]);
    expect(set.map((l) => [l.workout_id, l.section_id, l.round, l.changed])).toEqual([
      [workoutId, section.id, 4, true],
      [workoutId, section.id, 4, false],
    ]);
    const cleared = lines.filter((l) => l.msg === "workout_section_round_cleared");
    expect(cleared.map(fieldsOf)).toEqual([["removed", "round", "section_id", "user_id", "workout_id"]]);
    expect(cleared[0]).toMatchObject({ round: 4, removed: true });
    const text = JSON.stringify(lines);
    expect(text).not.toMatch(/\b2917\b/);
    expect(text).not.toContain("Zq7");
  });

  it("09.5 AC20 — a finished round write logs workout_edited with section_result_changed", async () => {
    const { call, url, workoutId, workoutRepo, lines } = await setup();
    workoutRepo.workouts.get(workoutId)!.endedAt = new Date();
    await call("PUT", `${url}/round-times/1`, { seconds: 100 });
    expect(lines.filter((l) => l.msg === "workout_edited").at(-1)).toMatchObject({ edit: "section_result_changed", records_recomputed: false });
  });
});

describe("09.5 AC16 — 422 and 409 over HTTP", () => {
  it("rounds 1000 is 422 on rounds; a Set Timer result is 409 section-timer-mismatch; DELETE is 204 either way", async () => {
    const { call, url } = await setup();
    const big = await call("PUT", `${url}/result`, { rounds: 1000, reps: 1 });
    expect([big.statusCode, big.json().errors[0].path]).toEqual([422, "rounds"]);
    const ok = await call("PUT", `${url}/result`, { rounds: 5, reps: 7 });
    expect([ok.statusCode, WorkoutSectionSchema.parse(ok.json()).result]).toEqual([200, { rounds: 5, reps: 7, finishSeconds: null, capped: false }]);
    for (let i = 0; i < 2; i++) expect((await call("DELETE", `${url}/result`)).statusCode).toBe(204);

    const setTimer = await setup({ format: "set_timer", roundSeconds: 300, rounds: 5 });
    const res = await setTimer.call("PUT", `${setTimer.url}/result`, { rounds: 1, reps: 1 });
    expect(res.statusCode).toBe(409);
    expect(res.json().type).toMatch(/\/section-timer-mismatch$/);
  });
});

describe("09.5 AC33 — result log lines", () => {
  it("carry ids and booleans only; no rounds or reps", async () => {
    const { call, url, lines } = await setup();
    await call("PUT", `${url}/result`, { rounds: 613, reps: 8461 });
    await call("PUT", `${url}/result`, { rounds: 613, reps: 8461 });
    await call("DELETE", `${url}/result`);
    const set = lines.filter((l) => l.msg === "workout_section_result_set");
    expect(set.map(fieldsOf)).toEqual([
      ["changed", "section_id", "user_id", "workout_id"],
      ["changed", "section_id", "user_id", "workout_id"],
    ]);
    expect(set.map((l) => l.changed)).toEqual([true, false]);
    const cleared = lines.filter((l) => l.msg === "workout_section_result_cleared");
    expect(cleared.map(fieldsOf)).toEqual([["removed", "section_id", "user_id", "workout_id"]]);
    expect(JSON.stringify(lines)).not.toMatch(/\b613\b|\b8461\b/);
  });
});

describe("09.5 AC31 — route config", () => {
  async function withLimits(groups: Record<string, number>) {
    const workoutRepo = new FakeWorkoutRepository(new FakeExerciseRepository());
    const { app } = await buildTestApp({ workoutRepository: workoutRepo, rateLimits: limitsWith({ groups }) });
    const call = (method: "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown) =>
      app.inject({ method, url, headers: payload === undefined ? { authorization: BEARER.authorization } : BEARER, ...(payload === undefined ? {} : { payload: payload as object }) });
    return { app, call };
  }
  const SECTION = "/v1/workout-sections/00000000-0000-4000-8000-000000000001";
  const RECORD_WRITES: [string, string, unknown][] = [
    ["PUT", `${SECTION}/round-times/3`, { seconds: 60 }],
    ["DELETE", `${SECTION}/round-times/3`, undefined],
    ["PUT", `${SECTION}/result`, { rounds: 1, reps: 1 }],
    ["DELETE", `${SECTION}/result`, undefined],
  ];

  it("the four record writes are in the sets write group; the section create and PATCH stay in workouts", async () => {
    const noSets = await withLimits({ sets: 0 });
    for (const [method, url, body] of RECORD_WRITES) {
      expect((await noSets.call(method as "PUT", url, body)).statusCode, `${method} ${url}`).toBe(429);
    }
    expect((await noSets.call("PATCH", SECTION, { name: "N" })).statusCode).toBe(404);

    const noWorkouts = await withLimits({ workouts: 0 });
    expect((await noWorkouts.call("PATCH", SECTION, { name: "N" })).statusCode).toBe(429);
    for (const [method, url, body] of RECORD_WRITES) {
      expect((await noWorkouts.call(method as "PUT", url, body)).statusCode, `${method} ${url}`).toBe(404);
    }
  });

  it("RATE_LIMITS and CORS_METHODS are unchanged", () => {
    expect(RATE_LIMITS.groups).toEqual({ sets: 120, workouts: 60, exercises: 20, routines: 30, me: 10, hevy: 60 });
    expect([...CORS_METHODS].sort()).toEqual(CORS_METHODS_BEFORE);
  });

  it("the four routes are published with their problems", async () => {
    const { app } = await withLimits({});
    await app.ready();
    const doc = (await app.inject({ method: "GET", url: "/openapi.json" })).json() as { paths: Record<string, Record<string, unknown>> };
    expect(Object.keys(doc.paths["/v1/workout-sections/{id}/round-times/{round}"]!).sort()).toEqual(["delete", "put"]);
    expect(Object.keys(doc.paths["/v1/workout-sections/{id}/result"]!).sort()).toEqual(["delete", "put"]);
  });
});

describe("09.5 AC31 — the two 409s render on /v1", () => {
  it.each([
    ["section-timer-mismatch", "PUT", "/round-times/1", { seconds: 60 }],
    ["section-result-exists", "PATCH", "", { timer: { format: "time_cap", capSeconds: 900 } }],
  ] as const)("%s", async (slug, method, suffix, body) => {
    const { call, url, record } = await setupWithRecord(slug === "section-timer-mismatch" ? null : { format: "amrap", capSeconds: 720 });
    if (slug === "section-result-exists") record().roundTimes = [{ round: 1, seconds: 100 }];
    const res = await call(method, `${url}${suffix}`, body);
    expect(res.statusCode).toBe(409);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json().type).toMatch(new RegExp(`/${slug}$`));
  });
});

describe("09.5 AC32 — no value in a 422", () => {
  it.each([
    ["PUT", "/round-times/7", { seconds: 98765 }, "98765"],
    ["PUT", "/result", { rounds: 61234 }, "61234"],
    ["PATCH", "", { timer: { format: "set_timer", roundSeconds: 54321, rounds: 4 } }, "54321"],
  ] as const)("%s …%s: the body never echoes %j", async (method, suffix, body, value) => {
    const { call, url } = await setup();
    const res = await call(method, `${url}${suffix}`, body);
    expect(res.statusCode).toBe(422);
    expect(res.body).not.toContain(value);
  });
});
