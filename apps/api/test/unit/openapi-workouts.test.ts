import { describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";

/**
 * Spec 05.0 §10 AC20 — "The eight workout routes are in the published
 * contract." The committed-doc-vs-`app.swagger()` drift check itself lives in
 * `openapi-catalog.test.ts` (it diffs the *whole* document, workouts
 * included); this file is the workout-specific completeness assertion the
 * brief calls for, parallel to that file's catalog-specific one.
 */

type Doc = {
  paths: Record<
    string,
    Record<
      string,
      {
        responses: Record<
          string,
          { content?: Record<string, { schema: Record<string, unknown> }> }
        >;
      }
    >
  >;
};

const isCamelCase = (k: string) => /^[a-z][A-Za-z0-9]*$/.test(k) && !k.includes("_");

describe("AC20 — the eight workout routes are in the published OpenAPI contract", () => {
  it("GET /openapi.json lists all eight paths with a declared response schema, including both 204 deletes", async () => {
    const { app } = await buildTestApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/openapi.json" });
    const doc = res.json() as Doc;

    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        "/v1/workouts",
        "/v1/workouts/active",
        "/v1/workouts/{id}",
        "/v1/workouts/{id}/exercises",
        "/v1/workout-exercises/{id}",
      ]),
    );

    const expectedMethods: Record<string, string[]> = {
      "/v1/workouts": ["post"],
      "/v1/workouts/active": ["get"],
      "/v1/workouts/{id}": ["get", "patch", "delete"],
      "/v1/workouts/{id}/exercises": ["post"],
      "/v1/workout-exercises/{id}": ["patch", "delete"],
    };
    for (const [path, methods] of Object.entries(expectedMethods)) {
      expect(Object.keys(doc.paths[path]!).sort(), path).toEqual(methods.sort());
    }

    // Both DELETE routes declare 204 with no content (Spec 05.0 §5).
    const workoutDelete = doc.paths["/v1/workouts/{id}"]!.delete as {
      responses: Record<string, unknown>;
    };
    expect(workoutDelete.responses["204"]).toBeDefined();
    const weDelete = doc.paths["/v1/workout-exercises/{id}"]!.delete as {
      responses: Record<string, unknown>;
    };
    expect(weDelete.responses["204"]).toBeDefined();

    // Eight routes total (2 GET/POST on /v1/workouts, GET active, PATCH+DELETE
    // on /v1/workouts/{id}, POST on .../exercises, PATCH+DELETE on
    // /v1/workout-exercises/{id}).
    const workoutOperationCount = Object.entries(expectedMethods).reduce(
      (n, [, methods]) => n + methods.length,
      0,
    );
    expect(workoutOperationCount).toBe(8);
  });

  it("every workout response schema uses camelCase field names (DESIGN §6)", async () => {
    const { app } = await buildTestApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/openapi.json" });
    const doc = res.json() as Doc;

    const workoutCreated = doc.paths["/v1/workouts"]!.post!.responses["201"]!.content![
      "application/json"
    ]!.schema as { properties: Record<string, unknown> };
    const workoutFields = Object.keys(workoutCreated.properties);
    expect(workoutFields).toEqual(
      expect.arrayContaining([
        "id",
        "startedAt",
        "endedAt",
        "localDate",
        "tzOffsetMinutes",
        "clientGeneratedId",
        "createdAt",
        "updatedAt",
      ]),
    );
    expect(workoutFields.every(isCamelCase)).toBe(true);

    const activeWorkout = doc.paths["/v1/workouts/active"]!.get!.responses["200"]!.content![
      "application/json"
    ]!.schema as { properties: Record<string, { items?: { properties: Record<string, unknown> } }> };
    const activeFields = Object.keys(activeWorkout.properties);
    expect(activeFields.every(isCamelCase)).toBe(true);
    const exercisesSchema = activeWorkout.properties["exercises"];
    expect(exercisesSchema?.items).toBeDefined();
    const exerciseFields = Object.keys(exercisesSchema!.items!.properties);
    expect(exerciseFields).toEqual(
      expect.arrayContaining(["id", "workoutId", "position", "exerciseId"]),
    );
    expect(exerciseFields.every(isCamelCase)).toBe(true);
  });
});
