import { describe, expect, it } from "vitest";
import { ProgressPointSchema, ProgressQuerySchema, ProgressSeriesSchema } from "../src/index.js";

const point = {
  workoutId: "018fcb3e-3b8a-7d6e-9c1a-000000000010",
  localDate: "2026-09-01",
  startedAt: "2026-09-01T10:00:00.000Z",
  topSetWeight: 100,
  bestE1rm: 116.667,
  totalVolume: 1220,
  maxReps: null,
};

describe("AC17 — ProgressPointSchema / ProgressSeriesSchema", () => {
  it("parse a valid payload, all-null metrics included", () => {
    expect(ProgressPointSchema.parse(point)).toEqual(point);
    const allNull = { ...point, topSetWeight: null, bestE1rm: null, totalVolume: null, maxReps: null };
    expect(ProgressPointSchema.parse(allNull)).toEqual(allNull);
    expect(ProgressSeriesSchema.parse({ exerciseId: point.workoutId, points: [point] }).points).toHaveLength(1);
  });
  it("reject a missing field, a negative metric, zero volume and a non-integer maxReps", () => {
    const missing: Record<string, unknown> = { ...point };
    delete missing.bestE1rm;
    expect(ProgressPointSchema.safeParse(missing).success).toBe(false);
    expect(ProgressPointSchema.safeParse({ ...point, topSetWeight: -1 }).success).toBe(false);
    expect(ProgressPointSchema.safeParse({ ...point, totalVolume: 0 }).success).toBe(false);
    expect(ProgressPointSchema.safeParse({ ...point, maxReps: 10.5 }).success).toBe(false);
  });
});

describe("AC3/AC17 — ProgressQuerySchema", () => {
  it("both optional; from == to accepted", () => {
    expect(ProgressQuerySchema.parse({})).toEqual({});
    expect(ProgressQuerySchema.parse({ from: "2026-09-01", to: "2026-09-01" })).toEqual({ from: "2026-09-01", to: "2026-09-01" });
  });
  it.each([
    ["impossible date", { from: "2026-02-30" }],
    ["unpadded", { from: "2026-1-5" }],
    ["instant", { from: "2026-01-05T00:00:00Z" }],
    ["empty", { from: "" }],
    ["garbage to", { to: "abc" }],
    ["from > to", { from: "2026-09-02", to: "2026-09-01" }],
    ["Review Focus 1 — year 0000 from", { from: "0000-01-01" }],
    ["Review Focus 1 — year 0000 to", { to: "0000-12-31" }],
  ])("%s → rejected", (_l, q) => {
    expect(ProgressQuerySchema.safeParse(q).success).toBe(false);
  });
  it("from > to reports on `from`", () => {
    const r = ProgressQuerySchema.safeParse({ from: "2026-09-02", to: "2026-09-01" });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.path).toEqual(["from"]);
  });
});
