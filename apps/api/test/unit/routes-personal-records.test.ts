import { describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { buildTestApp } from "../helpers/build-test-app.js";
import { FakePersonalRecordRepository } from "../helpers/fakes.js";

const BEARER = { authorization: "Bearer test-token" };

function record(userId: string) {
  return {
    userId,
    exerciseId: uuidv7(),
    sourceExerciseId: uuidv7(),
    exerciseName: "Bench Press",
    recordType: "heaviest_weight" as const,
    value: 100,
    unit: "kg" as const,
    previousValue: null,
    sourceSetId: uuidv7(),
    workoutId: uuidv7(),
    achievedAt: new Date("2026-10-01T10:00:00.000Z"),
    localDate: "2026-10-01",
  };
}

describe("AC19 — GET /v1/personal-records", () => {
  it("returns { records } with the §5 shape, scoped to the caller", async () => {
    const prRepo = new FakePersonalRecordRepository();
    const { app } = await buildTestApp({ personalRecordRepository: prRepo });
    const me = await app.inject({ method: "GET", url: "/v1/me", headers: BEARER });
    prRepo.rows.push(record(me.json().id), record(uuidv7()));

    const res = await app.inject({ method: "GET", url: "/v1/personal-records", headers: BEARER });

    expect(res.statusCode).toBe(200);
    const records = res.json().records;
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      recordType: "heaviest_weight",
      value: 100,
      unit: "kg",
      previousValue: null,
      achievedAt: "2026-10-01T10:00:00.000Z",
      localDate: "2026-10-01",
    });
    expect(records[0]).not.toHaveProperty("userId");
  });

  it("passes exerciseId and workoutId through to the repository", async () => {
    const prRepo = new FakePersonalRecordRepository();
    const { app } = await buildTestApp({ personalRecordRepository: prRepo });
    const exerciseId = uuidv7();
    const workoutId = uuidv7();
    await app.inject({ method: "GET", url: `/v1/personal-records?exerciseId=${exerciseId}&workoutId=${workoutId}`, headers: BEARER });
    expect(prRepo.lastFilter).toEqual({ exerciseId, workoutId });
  });
});

describe("AC20 — a malformed id is 422", () => {
  it.each(["exerciseId", "workoutId"])("%s=not-a-uuid → 422", async (param) => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: "GET", url: `/v1/personal-records?${param}=not-a-uuid`, headers: BEARER });
    expect(res.statusCode).toBe(422);
  });
});

describe("AC21 — contract and caching", () => {
  it("401 without a token", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/v1/personal-records" });
    expect(res.statusCode).toBe(401);
  });
  it("Cache-Control: no-store and no ETag", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/v1/personal-records", headers: BEARER });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers.etag).toBeUndefined();
  });
});
