import type { Validator as ValidatorType } from "@seriousme/openapi-schema-validator";
import { Validator } from "@seriousme/openapi-schema-validator";
import { describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";

/**
 * #28 — the published contract documents every problem+json response each
 * `/v1` operation can return. This is the tripwire: changing what an operation
 * can raise means updating MATRIX on purpose. The declared (domain) errors are
 * the ones each route lists in `config.problems`; the auth / 500 /
 * shape-implied groups are added by `withCentral` exactly as
 * `problemGroupsFor` does. "body" means Fastify parses a request body for the
 * method (POST / PUT / PATCH / DELETE) — so a body-less DELETE still documents
 * 413 / 415 / 422, which it really returns for a bad or oversized body.
 */

type Slugs = Record<number, string[]>;
type Shape = "none" | "input" | "body";

const CENTRAL: Slugs = {
  401: ["unauthenticated", "invalid-token"],
  403: ["account-deleted"],
  500: ["internal"],
  503: ["auth-unavailable"],
};

function withCentral(shape: Shape, declared: Slugs = {}): Slugs {
  const out: Slugs = structuredClone(CENTRAL);
  if (shape !== "none") out[422] = ["validation-error"];
  if (shape === "body") {
    out[413] = ["payload-too-large"];
    out[415] = ["unsupported-media-type"];
  }
  for (const [status, slugs] of Object.entries(declared)) {
    out[Number(status)] = [...(out[Number(status)] ?? []), ...slugs];
  }
  return out;
}

const MATRIX: Record<string, Slugs> = {
  "GET /v1/me": withCentral("none"),
  "PATCH /v1/me": withCentral("body"),
  "GET /v1/muscle-groups": withCentral("none"),
  "GET /v1/equipment": withCentral("none"),
  "GET /v1/exercises": withCentral("input", { 410: ["sync-token-expired"] }),
  "POST /v1/exercises": withCentral("body", { 409: ["exercise-limit-reached"] }),
  "PATCH /v1/exercises/{id}": withCentral("body", {
    404: ["not-found"],
    409: ["exercise-immutable-use-fork", "exercise-retired"],
  }),
  "POST /v1/exercises/{id}/fork": withCentral("body", {
    404: ["not-found"],
    409: ["exercise-already-owned", "exercise-retired", "exercise-limit-reached"],
  }),
  "DELETE /v1/exercises/{id}": withCentral("body", {
    403: ["exercise-immutable"],
    404: ["not-found"],
  }),
  "POST /v1/workouts": withCentral("body", { 409: ["workout-in-progress-exists"] }),
  "GET /v1/workouts/active": withCentral("none", { 404: ["not-found"] }),
  "GET /v1/workouts/{id}": withCentral("input", { 404: ["not-found"] }),
  "PATCH /v1/workouts/{id}": withCentral("body", {
    404: ["not-found"],
    409: ["workout-finished", "incomplete-working-sets"],
  }),
  "DELETE /v1/workouts/{id}": withCentral("body", { 404: ["not-found"] }),
  "POST /v1/workouts/{id}/exercises": withCentral("body", {
    404: ["not-found"],
    409: ["workout-finished", "exercise-retired"],
  }),
  "PATCH /v1/workout-exercises/{id}": withCentral("body", {
    404: ["not-found"],
    409: ["workout-finished"],
  }),
  "DELETE /v1/workout-exercises/{id}": withCentral("body", {
    404: ["not-found"],
    409: ["workout-finished"],
  }),
  "POST /v1/workout-exercises/{id}/sets": withCentral("body", {
    404: ["not-found"],
    409: ["workout-finished"],
  }),
  "PATCH /v1/sets/{id}": withCentral("body", {
    404: ["not-found"],
    409: ["workout-finished"],
  }),
  "DELETE /v1/sets/{id}": withCentral("body", {
    404: ["not-found"],
    409: ["workout-finished"],
  }),
};

const BASE = "https://strengthinnumbers.app/problems/";

type Resp = {
  content?: Record<
    string,
    { schema: { allOf?: [{ $ref: string }, { properties: { type: { enum: string[] } } }] } }
  >;
};
type Doc = {
  paths: Record<string, Record<string, { responses: Record<string, Resp> }>>;
  components: { schemas: Record<string, unknown> };
};

async function servedDoc(): Promise<Doc> {
  const { app } = await buildTestApp();
  return (await app.inject({ method: "GET", url: "/openapi.json" })).json() as Doc;
}

/** Status → slugs for every 4xx/5xx response on one operation. */
function documentedProblems(responses: Record<string, Resp>): Slugs {
  const out: Slugs = {};
  for (const [status, resp] of Object.entries(responses)) {
    if (Number(status) < 400) continue;
    const schema = resp.content!["application/problem+json"]!.schema;
    expect(schema.allOf![0]).toEqual({ $ref: "#/components/schemas/Problem" });
    out[Number(status)] = schema.allOf![1].properties.type.enum.map((t) => {
      expect(t.startsWith(BASE), t).toBe(true);
      return t.slice(BASE.length);
    });
  }
  return out;
}

describe("#28 — every /v1 operation documents its problem+json responses", () => {
  it("documents exactly the operations in the matrix — none missing, none extra", async () => {
    const doc = await servedDoc();
    const operations = Object.entries(doc.paths).flatMap(([path, item]) =>
      Object.keys(item).map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(operations.sort()).toEqual(Object.keys(MATRIX).sort());
  });

  it.each(Object.entries(MATRIX))("%s documents the expected statuses and slugs", async (op, expected) => {
    const doc = await servedDoc();
    const [method, path] = op.split(" ") as [string, string];
    const responses = doc.paths[path]![method.toLowerCase()]!.responses;
    expect(documentedProblems(responses)).toEqual(expected);
  });

  it("publishes the shared Problem schema", async () => {
    const doc = await servedDoc();
    expect(doc.components.schemas).toHaveProperty("Problem");
  });

  it("leaves no x-sin-problems extension in the published document", async () => {
    const doc = await servedDoc();
    expect(JSON.stringify(doc)).not.toContain("x-sin-problems");
  });

  it("still validates against the OpenAPI 3.1 meta-schema", async () => {
    const doc = await servedDoc();
    const validator: ValidatorType = new Validator();
    const result = await validator.validate(doc as unknown as object);
    expect(result.valid, JSON.stringify(result.errors)).toBe(true);
  });
});
