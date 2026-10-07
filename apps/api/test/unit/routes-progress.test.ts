import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { ProgressSeriesSchema } from "@sin/core";
import { toProgressPointDto } from "../../src/routes/progress.js";
import { buildTestApp } from "../helpers/build-test-app.js";
import { FakePersonalRecordRepository } from "../helpers/fakes.js";

const BEARER = { authorization: "Bearer test-token" };
const EX = "018fcb3e-3b8a-7d6e-9c1a-000000000001";
const point = (day: number) => ({
  workoutId: uuidv7(),
  localDate: `2026-09-0${day}`,
  startedAt: new Date(Date.UTC(2026, 8, day, 10)),
  topSetWeightMilli: 100_000 + day,
  bestE1rmMilli: 116_667,
  totalVolumeMilli: 1_220_000,
  maxRepsMilli: null,
});

async function setup(logger?: ReturnType<typeof pino>) {
  const prRepo = new FakePersonalRecordRepository();
  const { app } = await buildTestApp({ personalRecordRepository: prRepo, ...(logger ? { logger } : {}) });
  const userId = (await app.inject({ method: "GET", url: "/v1/me", headers: BEARER })).json().id as string;
  return { app, prRepo, userId };
}
const get = (app: Awaited<ReturnType<typeof setup>>["app"], path: string) =>
  app.inject({ method: "GET", url: path, headers: BEARER });

describe("AC1/AC8 — contract and serialization", () => {
  it("200 { exerciseId, points } that parses with ProgressSeriesSchema", async () => {
    const { app, prRepo, userId } = await setup();
    prRepo.progress.set(`${userId}:${EX}`, [point(1), point(2)]);
    const res = await get(app, `/v1/progress/exercises/${EX}`);
    expect(res.statusCode).toBe(200);
    const body = ProgressSeriesSchema.parse(res.json());
    expect(body.points[0]).toMatchObject({ topSetWeight: 100.001, bestE1rm: 116.667, totalVolume: 1220, maxReps: null, localDate: "2026-09-01", startedAt: "2026-09-01T10:00:00.000Z" });
  });
  it("toProgressPointDto converts milli without division; maxReps is an integer", () => {
    const dto = toProgressPointDto({ ...point(1), maxRepsMilli: 12_000, topSetWeightMilli: 61_235 });
    expect(dto.topSetWeight).toBe(Number("61.235"));
    expect(dto.maxReps).toBe(12);
    expect(Number.isInteger(dto.maxReps)).toBe(true);
  });
  it("AC4 — the response exerciseId is the repository's lineage root, not the requested id", async () => {
    const { app, prRepo, userId } = await setup();
    const ROOT = "018fcb3e-3b8a-7d6e-9c1a-0000000000aa";
    prRepo.progress.set(`${userId}:${EX}`, [point(1)]);
    prRepo.progressRoots.set(EX, ROOT);
    const res = await get(app, `/v1/progress/exercises/${EX}`);
    expect(res.json().exerciseId).toBe(ROOT);
  });
  it("401 without a token", async () => {
    const { app } = await setup();
    expect((await app.inject({ method: "GET", url: `/v1/progress/exercises/${EX}` })).statusCode).toBe(401);
  });
});

describe("AC2 — not found renders 404 not-found", () => {
  it("an unknown exercise → 404", async () => {
    const { app } = await setup();
    const res = await get(app, `/v1/progress/exercises/${EX}`);
    expect(res.statusCode).toBe(404);
    expect(res.json().type).toMatch(/not-found$/);
  });
});

describe("AC3 — 422 before any repository call", () => {
  it.each([
    ["malformed id", "/v1/progress/exercises/not-a-uuid"],
    ["impossible from", `/v1/progress/exercises/${EX}?from=2026-02-30`],
    ["unpadded from", `/v1/progress/exercises/${EX}?from=2026-1-5`],
    ["instant from", `/v1/progress/exercises/${EX}?from=2026-01-05T00:00:00Z`],
    ["empty from", `/v1/progress/exercises/${EX}?from=`],
    ["garbage to", `/v1/progress/exercises/${EX}?to=abc`],
    ["from > to", `/v1/progress/exercises/${EX}?from=2026-09-02&to=2026-09-01`],
    ["Review Focus 1 — year 0000", `/v1/progress/exercises/${EX}?from=0000-01-01`],
    ["Review Focus 2 — repeated from", `/v1/progress/exercises/${EX}?from=2026-09-01&from=2026-09-02`],
  ])("%s → 422", async (_l, path) => {
    const { app, prRepo } = await setup();
    const res = await get(app, path);
    expect(res.statusCode).toBe(422);
    expect(prRepo.lastProgressQuery).toBeUndefined();
  });
  it("from == to is accepted and passed through", async () => {
    const { app, prRepo, userId } = await setup();
    prRepo.progress.set(`${userId}:${EX}`, [point(1)]);
    expect((await get(app, `/v1/progress/exercises/${EX}?from=2026-09-01&to=2026-09-01`)).statusCode).toBe(200);
    expect(prRepo.lastProgressQuery).toEqual({ exerciseId: EX, range: { from: "2026-09-01", to: "2026-09-01" } });
  });
});

describe("AC16 — caching", () => {
  it("Cache-Control: no-store, no ETag", async () => {
    const { app, prRepo, userId } = await setup();
    prRepo.progress.set(`${userId}:${EX}`, []);
    const res = await get(app, `/v1/progress/exercises/${EX}`);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers.etag).toBeUndefined();
  });
});

describe("AC20 — logging", () => {
  it("no weight, e1RM or volume in any log line", async () => {
    const lines: string[] = [];
    const { app, prRepo, userId } = await setup(pino({ level: "debug" }, { write: (s: string) => lines.push(s) }));
    prRepo.progress.set(`${userId}:${EX}`, [point(1)]);
    await get(app, `/v1/progress/exercises/${EX}?from=2026-09-01`);
    const all = lines.join("\n");
    expect(all).not.toMatch(/topSetWeight|bestE1rm|totalVolume|116\.667/);
  });
});
