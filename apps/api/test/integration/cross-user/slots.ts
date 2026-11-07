import type { RegisteredRoute } from "./registry.js";

/**
 * Spec 21.0 §6.5, AC6 — id slots. Every id a route accepts must be covered by a
 * cross-user case, so the slots are derived from the route itself: every path
 * parameter, and every body or querystring key named `id` / `ids` or ending in `Id` / `Ids`,
 * found by walking the route's Zod schemas. A new `fooId` field fails the suite
 * until a case covers it or it is listed here with a reason.
 */

/**
 * Keys that look like ids but are not another row of ours. Keyed by
 * `"<METHOD> <url> <slot path>"` for one route, or `"* <key name>"` for every route.
 */
export const NOT_A_SIN_ID: Record<string, string> = {
  "* clientGeneratedId":
    "The caller's own idempotency key, scoped to the caller (workouts) or to a parent the caller owns (sets); the AC14 collision cases cover reuse of B's key.",
  "* hevyTemplateId": "Hevy's id namespace, not ours; every Hevy table is scoped by user_id, and an AC14 collision case covers B's template id.",
  "* hevyWorkoutId": "Hevy's id namespace, not ours; hevy_link is scoped by user_id.",
  "* sourceExerciseId": "A response-only field; never read from a request.",
  "* primaryMuscleId": "Shared reference data (muscle_group has no user column); every user may name any row.",
  "* equipmentId": "Shared reference data (equipment has no user column); every user may name any row.",
  "* secondaryMuscleIds": "Shared reference data (muscle_group has no user column); every user may name any row.",
  "* exerciseTemplateId": "Hevy's exercise template id (Hevy's namespace); the import resolves it through the caller's own pairs.",
  "* supersetId": "Hevy's superset number inside one imported workout, not a row id.",
  "PUT /v1/workout-sections/:id/round-times/:round params.round": "An integer round number inside the section, not a row id.",
  "DELETE /v1/workout-sections/:id/round-times/:round params.round": "An integer round number inside the section, not a row id.",
};

/** `id`, `exerciseId`, and the plural forms that carry a list of ids (`ids`, `workoutIds`). */
const isIdKey = (key: string) => key === "id" || key === "ids" || key.endsWith("Id") || key.endsWith("Ids");

/** Zod 4 internals: every schema carries `_zod.def` with a `type` tag. */
interface ZodDef {
  type: string;
  shape?: Record<string, unknown>;
  element?: unknown;
  innerType?: unknown;
  options?: unknown[];
  left?: unknown;
  right?: unknown;
  in?: unknown;
  out?: unknown;
  getter?: () => unknown;
  items?: unknown[];
  rest?: unknown;
}

const defOf = (schema: unknown): ZodDef | undefined =>
  (schema as { _zod?: { def?: ZodDef } } | null | undefined)?._zod?.def;

/** Schema kinds that can't hold a nested key: the walk stops here. */
const LEAF_TYPES = new Set([
  "string",
  "number",
  "int",
  "bigint",
  "boolean",
  "date",
  "enum",
  "literal",
  "null",
  "undefined",
  "void",
  "nan",
  "template_literal",
  "transform",
  "unknown",
  "any",
]);

/** Wrappers whose one inner schema keeps the same path. */
const PASS_THROUGH = new Set(["optional", "nullable", "default", "prefault", "readonly", "catch", "nonoptional", "success"]);

function walk(schema: unknown, path: string, out: string[], where: string, seen: Set<unknown>): void {
  const def = defOf(schema);
  if (!def) throw new Error(`${where}: ${path} is not a Zod schema`);
  if (LEAF_TYPES.has(def.type)) return;
  if (PASS_THROUGH.has(def.type)) return walk(def.innerType, path, out, where, seen);
  switch (def.type) {
    case "object":
      for (const [key, child] of Object.entries(def.shape ?? {})) {
        const childPath = `${path}.${key}`;
        if (isIdKey(key)) out.push(childPath);
        walk(child, childPath, out, where, seen);
      }
      return;
    case "array":
      return walk(def.element, `${path}[]`, out, where, seen);
    case "tuple":
      for (const item of def.items ?? []) walk(item, `${path}[]`, out, where, seen);
      if (def.rest) walk(def.rest, `${path}[]`, out, where, seen);
      return;
    case "union":
      for (const option of def.options ?? []) walk(option, path, out, where, seen);
      return;
    case "intersection":
      walk(def.left, path, out, where, seen);
      return walk(def.right, path, out, where, seen);
    case "pipe":
      walk(def.in, path, out, where, seen);
      return walk(def.out, path, out, where, seen);
    case "lazy": {
      // A recursive schema would loop forever; each lazy is expanded once per walk.
      if (seen.has(schema)) return;
      seen.add(schema);
      return walk(def.getter?.(), path, out, where, seen);
    }
    default:
      throw new Error(
        `${where}: ${path} uses a Zod "${def.type}" schema the id-slot walker does not know. ` +
          "Teach slots.ts to look inside it, so an id hidden there is still found (Spec 21.0 AC6).",
      );
  }
}

/** Every id slot of a route, in a stable order: path params, then querystring, then body. Duplicates removed. */
export function idSlots(route: RegisteredRoute): string[] {
  const out: string[] = [];
  for (const segment of route.url.split("/")) {
    if (segment.startsWith(":")) out.push(`params.${segment.slice(1)}`);
  }
  const schema = route.schema as { querystring?: unknown; body?: unknown } | undefined;
  if (schema?.querystring !== undefined) walk(schema.querystring, "query", out, route.key, new Set());
  if (schema?.body !== undefined) walk(schema.body, "body", out, route.key, new Set());
  return [...new Set(out)];
}

const lastKey = (slot: string) => slot.slice(slot.lastIndexOf(".") + 1).replace(/\[\]$/, "");

/** `idSlots` minus the ones `NOT_A_SIN_ID` explains. */
export function requiredSlots(route: RegisteredRoute): string[] {
  return idSlots(route).filter(
    (slot) => NOT_A_SIN_ID[`${route.key} ${slot}`] === undefined && NOT_A_SIN_ID[`* ${lastKey(slot)}`] === undefined,
  );
}
