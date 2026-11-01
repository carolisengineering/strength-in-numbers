import type { FastifyBaseLogger } from "fastify";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { PLANNED_SETS_PER_ITEM_MAX, ROUTINE_ITEM_NOTES_MAX, ROUTINE_ITEMS_MAX, ROUTINE_NOTES_MAX, RoutineSchema, SET_WEIGHT_MAX } from "@sin/core";
import { buildTestApp, GENEROUS_LIMITS } from "../helpers/build-test-app.js";
import { FakeExerciseRepository, FakeRoutineRepository, makeExerciseRecord } from "../helpers/fakes.js";

const BEARER = { authorization: "Bearer test-token", "content-type": "application/json" };
const EX = makeExerciseRecord({ name: "Bench" });

async function setup(logger?: FastifyBaseLogger) {
  const exerciseRepo = new FakeExerciseRepository();
  exerciseRepo.byId.set(EX.id, EX);
  const { app } = await buildTestApp({ logger, exerciseRepository: exerciseRepo, routineRepository: new FakeRoutineRepository(exerciseRepo), rateLimits: GENEROUS_LIMITS });
  return app;
}

const maxRow = { setType: "warmup", repsLow: 100, repsHigh: 100, weight: SET_WEIGHT_MAX, weightUnit: "kg" };
const worstCase = () => ({
  name: "Worst case",
  notes: "n".repeat(ROUTINE_NOTES_MAX),
  items: Array.from({ length: ROUTINE_ITEMS_MAX }, () => ({
    exerciseId: EX.id,
    notes: "x".repeat(ROUTINE_ITEM_NOTES_MAX),
    sets: Array.from({ length: PLANNED_SETS_PER_ITEM_MAX }, () => maxRow),
  })),
});

describe("AC11 — routine writes take a 128 KiB body", () => {
  it("the legal worst case (~74 KB) is accepted", async () => {
    const app = await setup();
    const payload = JSON.stringify(worstCase());
    expect(payload.length).toBeGreaterThan(64 * 1024);
    const res = await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload });
    expect(res.statusCode).toBe(201);
    expect(() => RoutineSchema.parse(res.json())).not.toThrow();
  });

  it("a body over 128 KiB → 413 problem+json; another route still refuses 65 KiB", async () => {
    const app = await setup();
    const big = JSON.stringify({ ...worstCase(), notes: "n".repeat(130 * 1024) });
    const res = await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: big });
    expect(res.statusCode).toBe(413);
    expect(res.headers["content-type"]).toMatch(/problem\+json/);
    const other = await app.inject({ method: "PATCH", url: "/v1/me", headers: BEARER, payload: JSON.stringify({ displayName: "x".repeat(65 * 1024) }) });
    expect(other.statusCode).toBe(413);
  });
});

describe("AC2 — the ETag covers the rows", () => {
  it("changes when one row's weight changes; stays put otherwise", async () => {
    const app = await setup();
    const body = { name: "R", items: [{ exerciseId: EX.id, sets: [{ weight: 100, weightUnit: "kg" }] }] };
    const id = (await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: body })).json().id;
    const etag = async () => (await app.inject({ method: "GET", url: `/v1/routines/${id}`, headers: BEARER })).headers.etag;
    const first = await etag();
    expect(await etag()).toBe(first);
    await app.inject({ method: "PUT", url: `/v1/routines/${id}`, headers: BEARER, payload: { ...body, items: [{ exerciseId: EX.id, sets: [{ weight: 102.5, weightUnit: "kg" }] }] } });
    expect(await etag()).not.toBe(first);
  });
});

describe("AC26 — counts only in routine log lines", () => {
  it("routine_created / routine_updated carry planned_set_count; no weight, rep value or note text", async () => {
    const lines: Record<string, unknown>[] = [];
    const logger: FastifyBaseLogger = pino({ level: "debug" }, { write: (s: string) => lines.push(JSON.parse(s)) });
    const app = await setup(logger);
    const body = { name: "distinctive-name-qzx", items: [{ exerciseId: EX.id, notes: "distinctive-note-wvu", sets: [{ repsLow: 77, repsHigh: 77, weight: 4321.5, weightUnit: "kg" }, {}] }] };
    const id = (await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: body })).json().id;
    await app.inject({ method: "PUT", url: `/v1/routines/${id}`, headers: BEARER, payload: body });
    expect(lines.find((l) => l.msg === "routine_created")).toMatchObject({ planned_set_count: 2 });
    expect(lines.find((l) => l.msg === "routine_updated")).toMatchObject({ planned_set_count: 2 });
    // Minor 293: what varies per run isn't the payload: a random request id may contain 4321 ("f2c25be1-4785-4321-…"),
    // and the timing, pid and clock fields may hold 77 ("responseTime":77.31). Only the rest is matched.
    const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const payloadOnly = (ls: Record<string, unknown>[]) =>
      JSON.stringify(
        ls.map((line) => {
          const rest = { ...line };
          for (const key of ["responseTime", "pid", "time"]) delete rest[key];
          return rest;
        }),
      ).replace(UUID, "<uuid>");
    expect(payloadOnly([{ reqId: "f2c25be1-4785-4321-a6fb-fadddff9465c", responseTime: 77.31, pid: 77, time: 1793538787989 }])).not.toMatch(/4321|\b77\b/);
    expect(payloadOnly(lines)).not.toMatch(/distinctive-|4321|\b77\b/);
  });
});

describe("AC7 / AC25 — the two-forms conflict is a 422 validation-error at items.0.sets", () => {
  it("sets + targetSets: null", async () => {
    const app = await setup();
    const res = await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: { name: "R", items: [{ exerciseId: EX.id, targetSets: null, sets: [] }] } });
    expect(res.statusCode).toBe(422);
    expect(res.json().type).toMatch(/validation-error$/);
    expect(JSON.stringify(res.json().errors)).toContain("items.0.sets");
  });
});

describe("AC26 — workout_started_from_routine carries planned_set_count only", () => {
  it("counts the copied rows; no weights in any line", async () => {
    const lines: Record<string, unknown>[] = [];
    const logger: FastifyBaseLogger = pino({ level: "debug" }, { write: (s: string) => lines.push(JSON.parse(s)) });
    const app = await setup(logger);
    const r = (await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: { name: "R", items: [{ exerciseId: EX.id, sets: [{ weight: 4321.5, weightUnit: "kg" }, {}, {}] }] } })).json();
    const started = await app.inject({ method: "POST", url: "/v1/workouts", headers: BEARER, payload: { clientGeneratedId: crypto.randomUUID(), startedAt: new Date().toISOString(), routineId: r.id } });
    expect(started.statusCode).toBe(201);
    expect(lines.find((l) => l.msg === "workout_started_from_routine")).toMatchObject({ planned_set_count: 3, item_count: 1 });
    expect(JSON.stringify(lines)).not.toMatch(/4321/);
  });
});
