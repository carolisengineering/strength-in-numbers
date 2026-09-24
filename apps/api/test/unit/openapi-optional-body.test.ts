import { describe, expect, it } from "vitest";
import {
  markNullableBodiesOptional,
  type OpenApiDocument,
} from "../../src/openapi/optional-body.js";

/**
 * BL-7 — `@fastify/swagger` hardcodes `requestBody.required: true` for every
 * route with a body schema, even ones whose Zod schema admits `null` (e.g.
 * the `POST /v1/exercises/{id}/fork` overlay, which the runtime happily
 * accepts with no body at all). `markNullableBodiesOptional` is the pure
 * function that corrects the emitted document; these tests exercise it in
 * isolation from the swagger plugin wiring.
 */

// Minimal fixture builder: a document with a single path/operation whose
// requestBody schema is the thing under test.
function docWithBody(schema: Record<string, unknown>): OpenApiDocument {
  return {
    openapi: "3.1.0",
    info: { title: "t", version: "1" },
    paths: {
      "/widgets": {
        post: {
          requestBody: {
            required: true,
            content: {
              "application/json": { schema },
            },
          },
          responses: {},
        },
      },
    },
  } as unknown as OpenApiDocument;
}

// Reads back requestBody.required for a given path/method, so tests don't
// each repeat the same `as unknown as { paths: … }` cast.
function requestBodyOf(
  doc: OpenApiDocument,
  path: string,
  method: string,
): { required: boolean } {
  const paths = (
    doc as unknown as {
      paths: Record<string, Record<string, { requestBody: { required: boolean } }>>;
    }
  ).paths;
  const pathItem = paths[path];
  if (!pathItem) throw new Error(`no path item for ${path}`);
  const operation = pathItem[method];
  if (!operation) throw new Error(`no operation for ${method} ${path}`);
  return operation.requestBody;
}

describe("BL-7 — nullable body schemas are documented as optional", () => {
  it("an anyOf body admitting null becomes required: false", () => {
    const doc = docWithBody({
      anyOf: [{ type: "object", properties: {} }, { type: "null" }],
      default: {},
    });

    const result = markNullableBodiesOptional(doc);

    expect(requestBodyOf(result, "/widgets", "post").required).toBe(false);
  });

  it("a plain object body (no null admitted) stays required: true", () => {
    const doc = docWithBody({ type: "object", properties: {} });

    const result = markNullableBodiesOptional(doc);

    expect(requestBodyOf(result, "/widgets", "post").required).toBe(true);
  });

  it('a type: ["object", "null"] body becomes required: false', () => {
    const doc = docWithBody({ type: ["object", "null"] });

    const result = markNullableBodiesOptional(doc);

    expect(requestBodyOf(result, "/widgets", "post").required).toBe(false);
  });

  it("a nullable: true body (OpenAPI 3.0.x form) becomes required: false", () => {
    const doc = docWithBody({ type: "object", nullable: true });

    const result = markNullableBodiesOptional(doc);

    expect(requestBodyOf(result, "/widgets", "post").required).toBe(false);
  });

  it("a oneOf body with a { type: null } member becomes required: false", () => {
    const doc = docWithBody({
      oneOf: [{ type: "object", properties: {} }, { type: "null" }],
    });

    const result = markNullableBodiesOptional(doc);

    expect(requestBodyOf(result, "/widgets", "post").required).toBe(false);
  });

  it("a nested anyOf (null inside an inner anyOf) becomes required: false", () => {
    const doc = docWithBody({
      anyOf: [
        { type: "object", properties: {} },
        { anyOf: [{ type: "string" }, { type: "null" }] },
      ],
    });

    const result = markNullableBodiesOptional(doc);

    expect(requestBodyOf(result, "/widgets", "post").required).toBe(false);
  });

  it("a requestBody with two media types stays required: false when only one schema admits null", () => {
    const doc = {
      openapi: "3.1.0",
      info: { title: "t", version: "1" },
      paths: {
        "/widgets": {
          post: {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { anyOf: [{ type: "object" }, { type: "null" }] },
                },
                "application/xml": {
                  schema: { type: "object", properties: {} },
                },
              },
            },
            responses: {},
          },
        },
      },
    } as unknown as OpenApiDocument;

    const result = markNullableBodiesOptional(doc);

    expect(requestBodyOf(result, "/widgets", "post").required).toBe(false);
  });

  it("an operation with no requestBody is left untouched", () => {
    const doc = {
      openapi: "3.1.0",
      info: { title: "t", version: "1" },
      paths: {
        "/widgets": {
          get: { responses: {} },
        },
      },
    } as unknown as OpenApiDocument;

    const result = markNullableBodiesOptional(doc);

    expect(
      (result as unknown as { paths: { "/widgets": { get: { requestBody?: unknown } } } })
        .paths["/widgets"].get,
    ).toEqual({ responses: {} });
  });

  it("preserves the operation object's key order", () => {
    const doc = {
      openapi: "3.1.0",
      info: { title: "t", version: "1" },
      paths: {
        "/widgets": {
          post: {
            summary: "s",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { anyOf: [{ type: "object" }, { type: "null" }] },
                },
              },
            },
            responses: {},
            operationId: "createWidget",
          },
        },
      },
    } as unknown as OpenApiDocument;

    const result = markNullableBodiesOptional(doc);

    const operation = (
      result as unknown as {
        paths: { "/widgets": { post: Record<string, unknown> } };
      }
    ).paths["/widgets"].post;
    expect(Object.keys(operation)).toEqual([
      "summary",
      "requestBody",
      "responses",
      "operationId",
    ]);
  });
});
