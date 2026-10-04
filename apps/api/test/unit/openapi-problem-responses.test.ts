import { describe, expect, it } from "vitest";
import {
  ExerciseImmutableError,
  ExerciseRetiredError,
  InternalError,
  NotFoundError,
} from "../../src/errors/app-error.js";
import {
  addProblemResponses,
  PROBLEMS_EXTENSION,
  problemGroupsFor,
  type ProblemGroup,
} from "../../src/openapi/problem-responses.js";
import type { OpenApiDocument } from "../../src/openapi/optional-body.js";

/**
 * #28 — `openapi.json` documented only success responses. These tests exercise
 * the pure pieces of `openapi/problem-responses.ts` in isolation from the
 * swagger plugin: grouping a route's problems (`problemGroupsFor`) and
 * rewriting the emitted document (`addProblemResponses`). The whole-app matrix
 * lives in `openapi-problem-matrix.test.ts`.
 */

const P = (slug: string) => `https://strengthinnumbers.app/problems/${slug}`;

const byStatus = (groups: ProblemGroup[] | undefined) =>
  Object.fromEntries((groups ?? []).map((g) => [g.status, g.types]));

describe("#28 — problemGroupsFor: which errors a route documents", () => {
  it("gives every /v1 operation 401 / 403 / 429 / 500 / 503, and nothing else for a bare GET", () => {
    const groups = problemGroupsFor({
      method: "GET",
      url: "/v1/me",
      schema: { response: {} },
      config: { problems: [] },
    });
    expect(byStatus(groups)).toEqual({
      401: [P("unauthenticated"), P("invalid-token")],
      403: [P("account-deleted")],
      429: [P("rate-limited")],
      500: [P("internal")],
      503: [P("auth-unavailable")],
    });
  });

  it("adds 413 / 415 / 422 to a body-less DELETE — Fastify parses bodies by method, not schema", () => {
    const del = byStatus(
      problemGroupsFor({ method: "DELETE", url: "/v1/x/:id", schema: { params: {} }, config: { problems: [] } }),
    );
    expect(del[422]).toEqual([P("validation-error")]);
    expect(del[413]).toEqual([P("payload-too-large")]);
    expect(del[415]).toEqual([P("unsupported-media-type")]);
  });

  it("adds 422 for params or querystring, and 413 / 415 only when there is a body", () => {
    const params = byStatus(
      problemGroupsFor({ method: "GET", url: "/v1/x/:id", schema: { params: {} }, config: { problems: [] } }),
    );
    expect(params[422]).toEqual([P("validation-error")]);
    expect(params[413]).toBeUndefined();
    expect(params[415]).toBeUndefined();

    const query = byStatus(
      problemGroupsFor({ method: "GET", url: "/v1/x", schema: { querystring: {} }, config: { problems: [] } }),
    );
    expect(query[422]).toEqual([P("validation-error")]);

    const body = byStatus(
      problemGroupsFor({ method: "POST", url: "/v1/x", schema: { body: {} }, config: { problems: [] } }),
    );
    expect(body[422]).toEqual([P("validation-error")]);
    expect(body[413]).toEqual([P("payload-too-large")]);
    expect(body[415]).toEqual([P("unsupported-media-type")]);
  });

  it("merges declared errors into the central groups by status, central first", () => {
    const groups = problemGroupsFor({
      method: "DELETE",
      url: "/v1/exercises/:id",
      schema: { params: {} },
      config: { problems: [NotFoundError, ExerciseImmutableError] },
    });
    const forbidden = groups!.find((g) => g.status === 403)!;
    expect(forbidden.types).toEqual([P("account-deleted"), P("exercise-immutable")]);
    expect(forbidden.titles).toEqual(["Account deleted", "Exercise immutable"]);
    expect(byStatus(groups)[404]).toEqual([P("not-found")]);
  });

  it("returns groups sorted by status", () => {
    const groups = problemGroupsFor({
      method: "PATCH",
      url: "/v1/x/:id",
      schema: { params: {}, body: {} },
      config: { problems: [ExerciseRetiredError, NotFoundError] },
    })!;
    const statuses = groups.map((g) => g.status);
    expect(statuses).toEqual([...statuses].sort((a, b) => a - b));
  });

  it("never repeats a slug when a route re-declares a central error or lists a class twice", () => {
    const groups = problemGroupsFor({
      method: "GET",
      url: "/v1/x",
      schema: {},
      config: { problems: [InternalError, NotFoundError, NotFoundError] },
    })!;
    const internal = groups.find((g) => g.status === 500)!;
    expect(internal.types).toEqual([P("internal")]);
    expect(internal.titles).toEqual(["Internal server error"]);
    expect(byStatus(groups)[404]).toEqual([P("not-found")]);
  });

  it("returns undefined for hidden routes, even ones with no config.problems", () => {
    expect(
      problemGroupsFor({ method: "GET", url: "/v1/_authcheck", schema: { hide: true } }),
    ).toBeUndefined();
  });

  it("returns undefined for HEAD-only / OPTIONS-only routes (Fastify's auto HEAD twins)", () => {
    expect(problemGroupsFor({ method: "HEAD", url: "/v1/me", schema: {} })).toBeUndefined();
    expect(problemGroupsFor({ method: ["OPTIONS"], url: "/v1/me", schema: {} })).toBeUndefined();
  });

  it("treats a GET+HEAD method array as a documented operation", () => {
    expect(
      problemGroupsFor({ method: ["GET", "HEAD"], url: "/v1/me", schema: {}, config: { problems: [] } }),
    ).toBeDefined();
  });

  it("ignores routes outside /v1/ — including a /v1-prefixed lookalike", () => {
    expect(problemGroupsFor({ method: "GET", url: "/openapi.json", schema: {} })).toBeUndefined();
    expect(problemGroupsFor({ method: "GET", url: "/v1foo", schema: {} })).toBeUndefined();
  });

  it("throws, naming the method and URL, when a documented /v1 route has no config.problems", () => {
    expect(() =>
      problemGroupsFor({ method: "POST", url: "/v1/widgets", schema: { body: {} } }),
    ).toThrow(/POST \/v1\/widgets.*config\.problems/);
  });
});

function docWithOperation(extension: unknown): OpenApiDocument {
  return {
    openapi: "3.1.0",
    info: { title: "t", version: "1" },
    paths: {
      "/v1/widgets": {
        delete: {
          responses: { "204": { description: "Default Response" } },
          [PROBLEMS_EXTENSION]: extension,
        },
      },
      "/v1/plain": { get: { responses: { "200": { description: "ok" } } } },
    },
  } as unknown as OpenApiDocument;
}

type Resp = {
  description: string;
  content: Record<string, { schema: { allOf: [{ $ref: string }, { properties: { type: { enum: string[] } } }] } }>;
};

describe("#28 — addProblemResponses: rewriting the emitted document", () => {
  const groups: ProblemGroup[] = [
    { status: 403, types: [P("account-deleted"), P("exercise-immutable")], titles: ["Account deleted", "Exercise immutable"] },
    { status: 404, types: [P("not-found")], titles: ["Not found"] },
  ];

  it("adds components.schemas.Problem mirroring ProblemBody", () => {
    const doc = addProblemResponses(docWithOperation(groups)) as unknown as {
      components: { schemas: { Problem: { required: string[]; properties: Record<string, unknown> } } };
    };
    const problem = doc.components.schemas.Problem;
    expect(problem.required).toEqual(["type", "title", "status", "detail", "instance"]);
    expect(Object.keys(problem.properties)).toEqual(["type", "title", "status", "detail", "instance", "errors"]);
  });

  it("writes one problem+json response per group, $ref'ing Problem with a narrowed type enum", () => {
    const doc = addProblemResponses(docWithOperation(groups)) as unknown as {
      paths: Record<string, Record<string, { responses: Record<string, Resp> }>>;
    };
    const responses = doc.paths["/v1/widgets"]!.delete!.responses;
    expect(Object.keys(responses)).toEqual(["204", "403", "404"]);

    const forbidden = responses["403"]!;
    expect(forbidden.description).toBe("Account deleted / Exercise immutable");
    expect(Object.keys(forbidden.content)).toEqual(["application/problem+json"]);
    const [ref, narrow] = forbidden.content["application/problem+json"]!.schema.allOf;
    expect(ref).toEqual({ $ref: "#/components/schemas/Problem" });
    expect(narrow.properties.type.enum).toEqual([P("account-deleted"), P("exercise-immutable")]);
  });

  it("removes the x-sin-problems extension from every operation", () => {
    const doc = addProblemResponses(docWithOperation(groups));
    expect(JSON.stringify(doc)).not.toContain(PROBLEMS_EXTENSION);
  });

  it("leaves operations without the extension untouched", () => {
    const doc = addProblemResponses(docWithOperation(groups)) as unknown as {
      paths: Record<string, Record<string, unknown>>;
    };
    expect(doc.paths["/v1/plain"]!.get).toEqual({ responses: { "200": { description: "ok" } } });
  });
});
