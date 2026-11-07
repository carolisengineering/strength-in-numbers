import { uuidv7 } from "uuidv7";
import type { RegisteredRoute } from "./registry.js";

/**
 * Spec 21.0 §6.3, §6.4 — comparing two answers (AC8), fresh ids (AC8) and the
 * leak scan (AC12).
 */

export interface RawResponse {
  status: number;
  headers: Record<string, unknown>;
  body: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DROPPED_HEADERS = new Set(["x-request-id", "date"]);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The parts of a response that must match between B's id and a fresh id:
 * status, every header but `x-request-id` and `date`, and the body. Each listed
 * id string becomes `"<ID>"` wherever it appears, and a UUID `instance` (the
 * request id) becomes `"<ID>"`. Nothing else is touched, so a different word in
 * `title`, `detail` or a field-error path still compares unequal.
 */
export function normalizeResponse(r: RawResponse, ids: readonly string[]): { status: number; headers: Record<string, string>; body: unknown } {
  const swap = (text: string) => ids.reduce((acc, id) => acc.replace(new RegExp(escapeRe(id), "gi"), "<ID>"), text);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(r.headers)) {
    if (DROPPED_HEADERS.has(name.toLowerCase())) continue;
    headers[name.toLowerCase()] = swap(String(value));
  }
  const text = swap(r.body);
  let body: unknown = text;
  try {
    body = text === "" ? "" : JSON.parse(text);
  } catch {
    // Not JSON: compare the text.
  }
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    const instance = (body as { instance?: unknown }).instance;
    if (typeof instance === "string" && UUID_RE.test(instance)) body = { ...body, instance: "<ID>" };
  }
  return { status: r.status, headers, body };
}

/** Enough of a Zod schema to validate a value. */
export interface Parser {
  safeParse(value: unknown): { success: boolean };
}

interface ZodDef {
  type: string;
  shape?: Record<string, unknown>;
  element?: unknown;
  innerType?: unknown;
  options?: unknown[];
  in?: unknown;
  getter?: () => unknown;
}
const defOf = (schema: unknown) => (schema as { _zod?: { def?: ZodDef } } | undefined)?._zod?.def;
const UNWRAP = new Set(["optional", "nullable", "default", "prefault", "readonly", "catch", "nonoptional"]);

function unwrap(schema: unknown): unknown {
  let s = schema;
  for (let def = defOf(s); def; def = defOf(s)) {
    if (UNWRAP.has(def.type)) s = def.innerType;
    else if (def.type === "pipe") s = def.in;
    else if (def.type === "lazy") s = def.getter?.();
    else break;
  }
  return s;
}

function child(schema: unknown, segment: string): unknown {
  const s = unwrap(schema);
  const def = defOf(s);
  if (!def) return undefined;
  if (def.type === "union") {
    for (const option of def.options ?? []) {
      const found = child(option, segment);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const isArray = segment.endsWith("[]");
  const key = isArray ? segment.slice(0, -2) : segment;
  if (def.type !== "object") return undefined;
  const next = def.shape?.[key];
  if (next === undefined || !isArray) return next;
  return defOf(unwrap(next))?.element;
}

/** The schema of one id slot (`params.id`, `query.workoutId`, `body.items[].exerciseId`). */
export function schemaAt(route: RegisteredRoute, slot: string): Parser {
  const [root, ...path] = slot.split(".");
  const schema = route.schema as { params?: unknown; querystring?: unknown; body?: unknown } | undefined;
  let s: unknown = root === "params" ? schema?.params : root === "query" ? schema?.querystring : root === "body" ? schema?.body : undefined;
  for (const segment of path) s = child(s, segment);
  if (s === undefined || typeof (s as Parser).safeParse !== "function") {
    throw new Error(`${route.key}: no schema for slot ${slot}`);
  }
  return s as Parser;
}

/**
 * A well-formed UUIDv7 that exists nowhere, checked against the slot's own
 * schema, so a "fresh" id can never answer 422 where B's id answers 404 (Review
 * Focus 4). A path param with no schema accepts any string.
 */
export function freshIdFor(route: RegisteredRoute, slot: string): string {
  const id = uuidv7();
  const params = (route.schema as { params?: unknown } | undefined)?.params;
  if (slot.startsWith("params.") && params === undefined) return id;
  if (!schemaAt(route, slot).safeParse(id).success) {
    throw new Error(`${route.key}: a fresh UUIDv7 fails the schema of ${slot}; the case needs another fresh value`);
  }
  return id;
}

/**
 * AC12 — every response body the suite sees is recorded; at the end none may
 * hold one of B's ids or marker strings.
 */
export class LeakScanner {
  private readonly bodies: { where: string; body: string }[] = [];

  record(body: string, where = "a response"): void {
    this.bodies.push({ where, body: body.toLowerCase() });
  }

  get size(): number {
    return this.bodies.length;
  }

  assertClean(ids: readonly string[], markers: readonly string[]): void {
    const needles = [...ids, ...markers];
    const hits: string[] = [];
    for (const { where, body } of this.bodies) {
      for (const needle of needles) if (body.includes(needle.toLowerCase())) hits.push(`${where} contains ${needle}`);
    }
    if (hits.length > 0) throw new Error(`leak scan: B's data reached A's responses:\n${hits.join("\n")}`);
  }
}
