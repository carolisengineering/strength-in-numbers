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
