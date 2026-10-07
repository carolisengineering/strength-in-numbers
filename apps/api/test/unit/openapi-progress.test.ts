import { describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";

type Op = { parameters?: { name: string; in: string }[]; responses: Record<string, unknown> };
type Doc = { paths: Record<string, Record<string, Op>> };

describe("AC16 — GET /v1/progress/exercises/{id} is in the published contract", () => {
  it("200 schema, id path param, from/to query params, 404 and 422 responses", async () => {
    const { app } = await buildTestApp();
    await app.ready();
    const doc = (await app.inject({ method: "GET", url: "/openapi.json" })).json() as Doc;
    const op = doc.paths["/v1/progress/exercises/{id}"]!.get!;
    expect(JSON.stringify(op.responses["200"])).toContain("bestE1rm");
    expect(op.responses["404"]).toBeDefined();
    expect(op.responses["422"]).toBeDefined();
    expect(op.parameters?.filter((p) => p.in === "query").map((p) => p.name).sort()).toEqual(["from", "to"]);
    expect(op.parameters?.some((p) => p.in === "path" && p.name === "id")).toBe(true);
  });
});
