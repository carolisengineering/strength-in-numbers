import { describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";

type Doc = { paths: Record<string, Record<string, { responses: Record<string, unknown> }>> };

describe("AC21 — both routes are in the published OpenAPI contract", () => {
  it("lists GET /v1/personal-records and PATCH /v1/workouts/{id}'s 200 carries newRecords", async () => {
    const { app } = await buildTestApp();
    await app.ready();
    const doc = (await app.inject({ method: "GET", url: "/openapi.json" })).json() as Doc;
    expect(doc.paths["/v1/personal-records"]?.get?.responses["200"]).toBeDefined();
    const patch200 = JSON.stringify(doc.paths["/v1/workouts/{id}"]!.patch!.responses["200"]);
    expect(patch200).toContain("newRecords");
  });
});
