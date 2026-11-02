// Spec 09.5 AC14–AC17, AC20, AC33 — the round-time and result routes over HTTP (fake repository).
import type { FastifyBaseLogger } from "fastify";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { WorkoutSectionSchema } from "@sin/core";
import { buildTestApp, GENEROUS_LIMITS } from "../helpers/build-test-app.js";
import { FakeExerciseRepository, FakeWorkoutRepository } from "../helpers/fakes.js";

const BEARER = { authorization: "Bearer test-token", "content-type": "application/json" };
const STARTED_AT = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const BASE_KEYS = new Set(["level", "time", "pid", "hostname", "msg", "reqId", "client_ip"]);
const fieldsOf = (line: Record<string, unknown>) => Object.keys(line).filter((k) => !BASE_KEYS.has(k)).sort();

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
