import { describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";

type Op = { parameters?: { name: string; in: string }[]; responses: Record<string, unknown> };
type Doc = { paths: Record<string, Record<string, Op>> };

describe("AC16 — GET /v1/workouts is in the published contract", () => {
  it("has a 200 schema and limit/cursor query parameters; POST is still there", async () => {
    const { app } = await buildTestApp();
    await app.ready();
    const doc = (await app.inject({ method: "GET", url: "/openapi.json" })).json() as Doc;
    const op = doc.paths["/v1/workouts"]!.get!;
    expect(op.responses["200"]).toBeDefined();
    expect(JSON.stringify(op.responses["200"])).toContain("totalVolume");
    expect(op.parameters?.filter((p) => p.in === "query").map((p) => p.name).sort()).toEqual(["cursor", "limit"]);
    expect(doc.paths["/v1/workouts"]!.post).toBeDefined();
  });
});

describe("09.5 AC25 — the History item schema", () => {
  type S = { properties?: Record<string, S>; items?: S; required?: string[]; anyOf?: S[]; oneOf?: S[] } & Record<string, unknown>;
  it("requires timedSections; score is a nullable union of four variants", async () => {
    const { app } = await buildTestApp();
    await app.ready();
    const doc = (await app.inject({ method: "GET", url: "/openapi.json" })).json() as {
      paths: Record<string, Record<string, { responses: Record<string, { content: Record<string, { schema: S }> }> }>>;
    };
    const item = doc.paths["/v1/workouts"]!.get!.responses["200"]!.content["application/json"]!.schema.properties!.items!.items!;
    expect(item.required!.at(-1)).toBe("timedSections");
    const timed = item.properties!.timedSections!.items!;
    expect(timed.required).toEqual(["id", "position", "name", "timer", "score"]);
    const score = timed.properties!.score!;
    expect(score.anyOf!.some((s) => s.type === "null")).toBe(true);
    expect(score.anyOf!.find((s) => s.oneOf)!.oneOf).toHaveLength(4);
  });
});
