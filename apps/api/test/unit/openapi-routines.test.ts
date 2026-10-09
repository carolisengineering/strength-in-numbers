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
