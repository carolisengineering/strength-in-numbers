import type { FastifyBaseLogger } from "fastify";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { AccountExportSchema } from "@sin/core";
import { buildTestApp, GENEROUS_LIMITS } from "../helpers/build-test-app.js";
import { FakeAccountExportRepository, FakeUserRepository, makeExerciseRecord, makeWorkoutRecord } from "../helpers/fakes.js";

const BEARER = { authorization: "Bearer test-token" };

function capturingLogger() {
  const lines: Record<string, unknown>[] = [];
  const logger: FastifyBaseLogger = pino({ level: "debug" }, { write: (s: string) => lines.push(JSON.parse(s)) });
  return { logger, lines };
}

describe("AC1 — GET /v1/account/export contract", () => {
  it("401 without a token; 200 body parses with AccountExportSchema", async () => {
    const { app } = await buildTestApp({ rateLimits: GENEROUS_LIMITS });
    expect((await app.inject({ method: "GET", url: "/v1/account/export" })).statusCode).toBe(401);
    const res = await app.inject({ method: "GET", url: "/v1/account/export", headers: BEARER });
    expect(res.statusCode).toBe(200);
    expect(() => AccountExportSchema.parse(res.json())).not.toThrow();
  });

  it("403 account-deleted after DELETE /v1/account (AC16 export line)", async () => {
    const { app } = await buildTestApp({ rateLimits: GENEROUS_LIMITS });
    await app.inject({ method: "DELETE", url: "/v1/account", headers: BEARER });
    const res = await app.inject({ method: "GET", url: "/v1/account/export", headers: BEARER });
    expect(res.statusCode).toBe(403);
    expect(res.json().type).toMatch(/account-deleted$/);
  });
});

describe("AC2 / AC9 — envelope and headers", () => {
  it("exact keys, formatVersion 1, attachment filename from exportedAt's UTC date, no-store", async () => {
    const users = new FakeUserRepository();
    const exportRepo = new FakeAccountExportRepository(users, { exportedAt: new Date("2026-10-11T23:59:59.000Z") });
    const { app } = await buildTestApp({ userRepository: users, accountExportRepository: exportRepo, rateLimits: GENEROUS_LIMITS });
    const res = await app.inject({ method: "GET", url: "/v1/account/export", headers: BEARER });
    expect(Object.keys(res.json()).sort()).toEqual(["exercises", "exportedAt", "formatVersion", "profile", "routines", "workouts"]);
    expect(res.json().formatVersion).toBe(1);
    expect(res.json().profile).not.toHaveProperty("isNewUser");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="strength-in-numbers-export-2026-10-11.json"');
    expect(String(res.headers["content-type"])).toMatch(/^application\/json/);
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("AC11 — export logging", () => {
  it("one account_exported line with the four counts; no body, email or note text", async () => {
    const { logger, lines } = capturingLogger();
    const users = new FakeUserRepository();
    const exportRepo = new FakeAccountExportRepository(users, {
      exercises: [makeExerciseRecord({ name: "distinctive-name-qzx" })],
      workouts: [{ ...makeWorkoutRecord({ notes: "distinctive-note-wvu" }), exercises: [], routineNotes: null, sections: [], routineIsOneOff: false }],
    });
    const { app } = await buildTestApp({ logger, userRepository: users, accountExportRepository: exportRepo, rateLimits: GENEROUS_LIMITS });
    await app.inject({ method: "GET", url: "/v1/account/export", headers: BEARER });
    const hits = lines.filter((l) => l.msg === "account_exported");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ exercise_count: 1, routine_count: 0, workout_count: 1, set_count: 0 });
    expect(typeof hits[0]!.user_id).toBe("string");
    expect(JSON.stringify(lines)).not.toMatch(/distinctive-|a@b\.com|test-token/);
  });
});
