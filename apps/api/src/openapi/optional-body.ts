import type fastifySwagger from "@fastify/swagger";

/**
 * BL-7: `@fastify/swagger` emits `requestBody.required: true` for every route
 * with a body schema, even where the schema itself admits `null` (an
 * optional body such as the `POST /v1/exercises/{id}/fork` overlay). Where
 * that is true, the honest contract is `required: false`.
 *
 * Derived from `@fastify/swagger`'s own `transformObject` signature rather
 * than importing `openapi-types` directly — that package is only a
 * transitive dependency here (pulled in by `@fastify/swagger` and
 * `fastify-type-provider-zod`), so it does not resolve from `apps/api`'s own
 * `node_modules`.
 *
 * This "admits null ⇒ optional" mapping relies on Fastify handing a
 * body-less request to the validator as `null` (see the comment at
 * `apps/api/src/routes/exercises.ts` ~lines 152-159) — schemas for optional
 * bodies should therefore be declared `.nullish()` rather than `.nullable()`,
 * since `.nullable()` rejects `undefined`.
 *
 * The check below is deliberately conservative: it does not follow `$ref`,
 * nor inspect `allOf`, `const: null`, an `enum` containing `null`, or empty
 * schemas (`{}`). Any of those misses just leaves the library's default
 * `required: true` in place, which is the safe direction to fail in.
 */
type SwaggerDocumentObjectArg = Parameters<
  fastifySwagger.SwaggerTransformObject
>[0];
export type OpenApiDocument = Extract<
  SwaggerDocumentObjectArg,
  { openapiObject: unknown }
>["openapiObject"];

/**
 * A loose local shape for just the parts of a schema/operation/requestBody
 * this transform reads or mutates. The full `openapi-types` unions (which
 * also cover `$ref`, Swagger 2.0, etc.) are not useful for this narrow,
 * already-built-document mutation.
 */
interface SchemaLike {
  type?: string | string[];
  nullable?: boolean;
  anyOf?: SchemaLike[];
  oneOf?: SchemaLike[];
  [key: string]: unknown;
}

interface MediaTypeLike {
  schema?: SchemaLike;
  [key: string]: unknown;
}

interface RequestBodyLike {
  required?: boolean;
  content?: Record<string, MediaTypeLike>;
  [key: string]: unknown;
}

interface OperationLike {
  requestBody?: RequestBodyLike;
  [key: string]: unknown;
}

/** The HTTP-method keys a `PathItemObject` may carry (the rest — `parameters`,
 * `summary`, `$ref`, etc. — are not operations and are left alone). */
const HTTP_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;

/** Does this schema admit `null` — directly, as a `type` array member, the
 * OpenAPI 3.0.x `nullable: true` form, or recursively through `anyOf`/`oneOf`? */
function admitsNull(schema: SchemaLike | undefined): boolean {
  if (!schema) return false;
  if (schema.type === "null") return true;
  if (Array.isArray(schema.type) && schema.type.includes("null")) return true;
  if (schema.nullable === true) return true;
  if (schema.anyOf?.some(admitsNull)) return true;
  if (schema.oneOf?.some(admitsNull)) return true;
  return false;
}

/**
 * Walk `doc.paths[*][method].requestBody`. Where `required` is `true` and
 * any `content[*].schema` admits `null`, flip `required` to `false` — in
 * place, so JSON key order (and therefore the byte-identical drift check
 * against the committed `openapi.json`) is preserved.
 */
export function markNullableBodiesOptional(
  doc: OpenApiDocument,
): OpenApiDocument {
  const paths = (
    doc as { paths?: Record<string, Record<string, unknown> | undefined> }
  ).paths;
  if (!paths) return doc;

  for (const pathItem of Object.values(paths)) {
    if (!pathItem) continue;
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method] as OperationLike | undefined;
      if (!operation || typeof operation !== "object") continue;
      const requestBody = operation.requestBody;
      if (!requestBody || requestBody.required !== true) continue;

      const schemas = Object.values(requestBody.content ?? {}).map(
        (mediaType) => mediaType.schema,
      );
      if (schemas.some(admitsNull)) {
        requestBody.required = false;
      }
    }
  }

  return doc;
}
