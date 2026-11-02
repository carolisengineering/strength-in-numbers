import { describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";

type Doc = {
  paths: Record<
    string,
    Record<
      string,
      {
        responses: Record<
          string,
          { content?: Record<string, { schema: { allOf?: [unknown, { properties: { type: { enum: string[] } } }] } }> }
        >;
      }
    >
  >;
};

const slugs = (types: string[]) => types.map((t) => t.split("/").pop()).sort();

describe("AC1 / AC26 — the five routine operations are published with their problems", () => {
  it("lists both paths with the right methods, 201/200/204/304 responses and the routine problem types", async () => {
    const { app } = await buildTestApp();
    await app.ready();
    const doc = (await app.inject({ method: "GET", url: "/openapi.json" })).json() as Doc;

    expect(Object.keys(doc.paths["/v1/routines"]!).sort()).toEqual(["get", "post"]);
    expect(Object.keys(doc.paths["/v1/routines/{id}"]!).sort()).toEqual(["delete", "get", "put"]);
    expect(doc.paths["/v1/routines"]!.post!.responses["201"]).toBeDefined();
    expect(doc.paths["/v1/routines"]!.get!.responses["304"]).toBeDefined();
    expect(doc.paths["/v1/routines/{id}"]!.get!.responses["304"]).toBeDefined();
    expect(doc.paths["/v1/routines/{id}"]!.put!.responses["200"]).toBeDefined();
    expect(doc.paths["/v1/routines/{id}"]!.delete!.responses["204"]).toBeDefined();

    const problem409 = (path: string, method: string) =>
      doc.paths[path]![method]!.responses["409"]!.content!["application/problem+json"]!.schema.allOf![1].properties.type.enum;
    expect(slugs(problem409("/v1/routines", "post"))).toEqual(["exercise-retired", "routine-limit", "routine-name-taken"]);
    expect(slugs(problem409("/v1/routines/{id}", "put"))).toEqual(["exercise-retired", "routine-name-taken"]);
    expect(doc.paths["/v1/routines/{id}"]!.delete!.responses["404"]).toBeDefined();
  });
});

describe("09.3 AC10 — Keep is published", () => {
  it("POST /v1/routines/{id}/keep has 204 and a 404 not-found problem", async () => {
    const { app } = await buildTestApp();
    const doc = (await app.inject({ method: "GET", url: "/openapi.json" })).json();
    const keep = doc.paths["/v1/routines/{id}/keep"];
    expect(Object.keys(keep).sort()).toEqual(["post"]);
    expect(keep.post.responses["204"]).toBeDefined();
    expect(slugs(keep.post.responses["404"].content["application/problem+json"].schema.allOf[1].properties.type.enum)).toEqual(["not-found"]);
  });
});

type Schema = { properties?: Record<string, Schema>; items?: Schema; required?: string[]; anyOf?: Schema[]; oneOf?: Schema[] } & Record<string, unknown>;

describe("09.5 AC1 — OpenAPI", () => {
  it("routine sections carry a required, nullable timer union on responses and an optional one on requests", async () => {
    const { app } = await buildTestApp();
    await app.ready();
    const doc = (await app.inject({ method: "GET", url: "/openapi.json" })).json() as {
      paths: Record<string, Record<string, { responses: Record<string, { content: Record<string, { schema: Schema }> }>; requestBody?: { content: Record<string, { schema: Schema }> } }>>;
    };
    const response = doc.paths["/v1/routines"]!.post!.responses["201"]!.content["application/json"]!.schema;
    const section = response.properties!.sections!.items!;
    expect(section.required).toEqual(["id", "position", "name", "notes", "timer"]);
    const variants = section.properties!.timer!.anyOf!.find((s) => s.oneOf)!.oneOf!;
    expect(variants.map((v) => (v.properties!.format as { enum: string[] }).enum[0])).toEqual(["set_timer", "amrap", "time_cap"]);
    const timeCap = variants[2]!;
    expect(timeCap.required).toEqual(["format", "capSeconds"]);
    expect(timeCap.properties!.capSeconds!.anyOf!.some((s) => s.type === "null")).toBe(true);

    const request = doc.paths["/v1/routines"]!.post!.requestBody!.content["application/json"]!.schema;
    const input = request.properties!.sections!.items!;
    expect(input.required ?? []).not.toContain("timer");
    const inputTimeCap = input.properties!.timer!.anyOf!.find((s) => s.oneOf)!.oneOf![2]!;
    expect(inputTimeCap.required).toEqual(["format"]);
  });
});
