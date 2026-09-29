import type fastifySwagger from "@fastify/swagger";
import { jsonSchemaTransform } from "fastify-type-provider-zod";
import {
  AccountDeletedError,
  AuthUnavailableError,
  InternalError,
  InvalidTokenError,
  PayloadTooLargeError,
  UnauthenticatedError,
  UnsupportedMediaTypeError,
  ValidationError,
  type AppError,
} from "../errors/app-error.js";
import { PROBLEM_BASE_URL } from "../errors/problem.js";
import { HTTP_METHODS, type OpenApiDocument } from "./optional-body.js";

/**
 * #28: document the problem+json responses each `/v1` operation can return.
 *
 * Documentation-only — nothing here runs on the request path. Each route lists
 * the domain errors its handler can raise in `config.problems`; the central
 * groups below add the ones every `/v1` route shares (auth, 500) and the ones
 * its schema shape implies (422 / 413 / 415). Two steps inside `app.swagger()`:
 *
 * 1. `problemAwareTransform` (per route) wraps `jsonSchemaTransform` and
 *    attaches the merged groups as an `x-sin-problems` schema key, which
 *    `@fastify/swagger` copies verbatim onto the operation (9.8.1,
 *    `lib/spec/openapi/utils.js:491`).
 * 2. `addProblemResponses` (document-wide, after BL-7's
 *    `markNullableBodiesOptional`) turns each extension into
 *    `responses[status]` entries that `$ref` the shared `Problem` schema, then
 *    deletes it.
 *
 * Built in the final document rather than through swagger's response
 * conversion so the `$ref` and the `application/problem+json` content type are
 * emitted exactly as written.
 */

/** An `AppError` subclass constructible with no arguments — every domain error is. */
export type ProblemClass = new () => AppError;

declare module "fastify" {
  interface FastifyContextConfig {
    /** #28 — documentation-only: the domain `AppError`s this route's handler can
     * raise. `[]` when none. Required on every documented `/v1` route; the auth,
     * 500 and schema-shape errors are added centrally, so do not list them. */
    problems?: ReadonlyArray<ProblemClass>;
  }
}

export const PROBLEMS_EXTENSION = "x-sin-problems";

/** One status's worth of problems for one operation — the extension's shape. */
export interface ProblemGroup {
  status: number;
  types: string[];
  titles: string[];
}

interface ProblemDescriptor {
  status: number;
  slug: string;
  title: string;
}

const descriptorOf = (error: AppError): ProblemDescriptor => ({
  status: error.status,
  slug: error.slug,
  title: error.title,
});

// Read status / slug / title off real instances so the document can never
// disagree with the class. The constructor arguments are placeholders — only
// the class's fixed fields are read.
const EVERY_V1_OPERATION: readonly ProblemDescriptor[] = [
  new UnauthenticatedError(),
  new InvalidTokenError("openapi placeholder"),
  new AccountDeletedError(),
  new InternalError(),
  new AuthUnavailableError("openapi placeholder"),
].map(descriptorOf);
const HAS_INPUT: readonly ProblemDescriptor[] = [new ValidationError([])].map(descriptorOf);
const HAS_BODY: readonly ProblemDescriptor[] = [
  new PayloadTooLargeError(),
  new UnsupportedMediaTypeError(),
].map(descriptorOf);

/** The parts of a Fastify `RouteOptions` this module reads. */
export interface ProblemRouteLike {
  method: string | readonly string[];
  url: string;
  schema?: {
    hide?: boolean;
    body?: unknown;
    params?: unknown;
    querystring?: unknown;
    [key: string]: unknown;
  };
  config?: { problems?: ReadonlyArray<ProblemClass> };
}

/** Methods whose request body Fastify's content-type parser reads. */
const BODY_PARSING_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const methodsOf = (route: ProblemRouteLike): readonly string[] =>
  typeof route.method === "string" ? [route.method] : route.method;

/** A public `/v1` operation: `/v1/…`, not hidden, and not a body-less
 * HEAD / OPTIONS twin (swagger calls `transform` for those too, and before
 * its own hide check). */
function isDocumentedV1(route: ProblemRouteLike): boolean {
  if (!route.url.startsWith("/v1/")) return false;
  if (route.schema?.hide === true) return false;
  return !methodsOf(route).every((m) => m === "HEAD" || m === "OPTIONS");
}

function groupByStatus(descriptors: readonly ProblemDescriptor[]): ProblemGroup[] {
  const groups = new Map<number, ProblemGroup>();
  for (const d of descriptors) {
    const type = `${PROBLEM_BASE_URL}${d.slug}`;
    const group = groups.get(d.status) ?? { status: d.status, types: [], titles: [] };
    if (!group.types.includes(type)) {
      group.types.push(type);
      group.titles.push(d.title);
    }
    groups.set(d.status, group);
  }
  return [...groups.values()].sort((a, b) => a.status - b.status);
}

/**
 * The problem groups for one route, or `undefined` when the route is not a
 * documented `/v1` operation. Throws when it is one but declares no
 * `config.problems` — a forgotten declaration fails boot, the emit script and
 * the drift test rather than silently shipping an under-documented route.
 */
export function problemGroupsFor(route: ProblemRouteLike): ProblemGroup[] | undefined {
  if (!isDocumentedV1(route)) return undefined;

  const declared = route.config?.problems;
  if (declared === undefined) {
    throw new Error(
      `Route ${methodsOf(route).join(",")} ${route.url} is a documented /v1 route but ` +
        "declares no `config.problems`. List the AppError classes its handler can " +
        "raise (`[]` if none) — see src/openapi/problem-responses.ts (#28).",
    );
  }

  const schema = route.schema ?? {};
  // Fastify parses a body by method, not by whether the route declares one: a
  // body-less DELETE still answers 413 / 415 / 422 for a bad or oversized body.
  const hasBody =
    schema.body !== undefined || methodsOf(route).some((m) => BODY_PARSING_METHODS.has(m));
  const hasInput = hasBody || schema.params !== undefined || schema.querystring !== undefined;

  return groupByStatus([
    ...EVERY_V1_OPERATION,
    ...(hasInput ? HAS_INPUT : []),
    ...(hasBody ? HAS_BODY : []),
    ...declared.map((ProblemError) => descriptorOf(new ProblemError())),
  ]);
}

/** `jsonSchemaTransform`, plus the route's problem groups as `x-sin-problems`. */
export const problemAwareTransform: fastifySwagger.SwaggerTransform = (input) => {
  const result = jsonSchemaTransform(input);
  const groups = problemGroupsFor(input.route as unknown as ProblemRouteLike);
  if (groups === undefined) return result;
  return { ...result, schema: { ...result.schema, [PROBLEMS_EXTENSION]: groups } };
};

function problemSchema(): Record<string, unknown> {
  return {
    type: "object",
    description: "RFC 9457 problem details (Spec 01 §5).",
    required: ["type", "title", "status", "detail", "instance"],
    properties: {
      type: { type: "string", format: "uri" },
      title: { type: "string" },
      status: { type: "integer" },
      detail: { type: "string" },
      instance: { type: "string" },
      errors: {
        type: "array",
        items: {
          type: "object",
          required: ["path", "message"],
          properties: { path: { type: "string" }, message: { type: "string" } },
        },
      },
    },
  };
}

function problemResponseObject(group: ProblemGroup): Record<string, unknown> {
  return {
    description: group.titles.join(" / "),
    content: {
      "application/problem+json": {
        schema: {
          allOf: [
            { $ref: "#/components/schemas/Problem" },
            { properties: { type: { enum: group.types } } },
          ],
        },
      },
    },
  };
}

interface OperationLike {
  responses?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Add `components.schemas.Problem`, turn every operation's `x-sin-problems`
 * into `responses[status]` entries, and delete the extension. Mutates in
 * place (like BL-7) so key order — and the byte-exact drift check against the
 * committed `openapi.json` — stays stable.
 */
export function addProblemResponses(doc: OpenApiDocument): OpenApiDocument {
  const d = doc as {
    components?: { schemas?: Record<string, unknown>; [key: string]: unknown };
    paths?: Record<string, Record<string, unknown> | undefined>;
  };

  for (const pathItem of Object.values(d.paths ?? {})) {
    if (!pathItem) continue;
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method] as OperationLike | undefined;
      if (!operation || typeof operation !== "object") continue;
      const groups = operation[PROBLEMS_EXTENSION] as ProblemGroup[] | undefined;
      if (!Array.isArray(groups)) continue;
      delete operation[PROBLEMS_EXTENSION];
      operation.responses ??= {};
      for (const group of groups) {
        operation.responses[String(group.status)] = problemResponseObject(group);
      }
    }
  }

  d.components ??= {};
  d.components.schemas ??= {};
  d.components.schemas["Problem"] = problemSchema();
  return doc;
}
