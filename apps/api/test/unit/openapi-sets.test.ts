import { describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";

type Schema = { type?: unknown; properties?: Record<string, Schema>; items?: Schema; required?: string[] };
type Op = {
  requestBody?: { content: Record<string, { schema: Schema }> };
  responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
};
type Doc = { paths: Record<string, Record<string, Op>> };

const isCamelCase = (k: string) => /^[a-z][A-Za-z0-9]*$/.test(k);

async function doc(): Promise<Doc> {
  const { app } = await buildTestApp();
  await app.ready();
  return (await app.inject({ method: "GET", url: "/openapi.json" })).json() as Doc;
}

describe("AC18 — the three set routes are in the published contract", () => {
  it("lists POST /v1/workout-exercises/{id}/sets and PATCH + DELETE /v1/sets/{id}, DELETE declaring 204", async () => {
    const d = await doc();
    expect(Object.keys(d.paths["/v1/workout-exercises/{id}/sets"]!)).toEqual(["post"]);
    expect(Object.keys(d.paths["/v1/sets/{id}"]!).sort()).toEqual(["delete", "patch"]);
    expect(d.paths["/v1/sets/{id}"]!.delete!.responses["204"]).toBeDefined();
  });

  it("the SetEntry response schema is camelCase throughout", async () => {
    const d = await doc();
    const schema = d.paths["/v1/workout-exercises/{id}/sets"]!.post!.responses["201"]!.content!["application/json"]!.schema;
    const keys = Object.keys(schema.properties!);
    expect(keys).toEqual(
      expect.arrayContaining(["setNumber", "weightKg", "distanceM", "durationS", "isComplete", "completedAt"]),
    );
    for (const k of keys) expect(isCamelCase(k), k).toBe(true);
  });

  it("AC22 — POST declares 201 and the idempotent-replay 200; clientGeneratedId is a create field only", async () => {
    const d = await doc();
    const post = d.paths["/v1/workout-exercises/{id}/sets"]!.post!;
    for (const status of ["200", "201"]) {
      const schema = post.responses[status]!.content!["application/json"]!.schema;
      expect(Object.keys(schema.properties!), status).toContain("clientGeneratedId");
    }
    expect(Object.keys(post.requestBody!.content["application/json"]!.schema.properties!)).toContain(
      "clientGeneratedId",
    );
    const patch = d.paths["/v1/sets/{id}"]!.patch!;
    const patchKeys = Object.keys(patch.requestBody!.content["application/json"]!.schema.properties!);
    expect(patchKeys).toContain("reps");
    expect(patchKeys).not.toContain("clientGeneratedId");
  });

  it("both workout GET routes emit exercises[].sets (WorkoutExerciseDetailSchema)", async () => {
    const d = await doc();
    for (const path of ["/v1/workouts/{id}", "/v1/workouts/active"]) {
      const schema = d.paths[path]!.get!.responses["200"]!.content!["application/json"]!.schema;
      const exerciseItem = schema.properties!.exercises!.items!;
      expect(exerciseItem.properties!.sets, path).toBeDefined();
      expect(exerciseItem.required, path).toContain("sets");
      expect(exerciseItem.properties!.sets!.items!.properties!.setNumber, path).toBeDefined();
    }
  });

  it("PATCH/DELETE /v1/workout-exercises/{id} still return the plain WorkoutExercise (no sets)", async () => {
    const d = await doc();
    const patch = d.paths["/v1/workout-exercises/{id}"]!.patch!.responses["200"]!.content!["application/json"]!.schema;
    expect(patch.properties!.sets).toBeUndefined();
  });
});
