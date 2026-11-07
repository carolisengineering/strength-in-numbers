import { beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";
import { collectRoutes, type RegisteredRoute } from "../integration/cross-user/registry.js";
import { LeakScanner, freshIdFor, normalizeResponse, schemaAt } from "../integration/cross-user/compare.js";

/** Spec 21.0 §6.3, §6.4 — the helpers behind AC8 (indistinguishability) and AC12 (the leak scan). */

const B_ID = "0192a1b2-0000-7000-8000-00000000b001";
const FRESH = "0192a1b2-0000-7000-8000-00000000f001";

const problem = (over: Record<string, unknown>) =>
  JSON.stringify({
    type: "https://strengthinnumbers.app/problems/not-found",
    title: "Not found",
    status: 404,
    detail: "The resource was not found.",
    instance: "d6f9b0a2-1111-4222-8333-444455556666",
    ...over,
  });

const res = (body: string, headers: Record<string, string> = {}) => ({
  status: 404,
  headers: { "content-type": "application/problem+json; charset=utf-8", "x-request-id": "r1", date: "now", ...headers },
  body,
});

describe("AC8 — responses are compared after substituting ids", () => {
  it("two 404 bodies that differ only in the instance id compare equal", () => {
    const a = normalizeResponse(res(problem({ instance: "d6f9b0a2-1111-4222-8333-444455556666" })), [B_ID, FRESH]);
    const b = normalizeResponse(res(problem({ instance: "a0000000-1111-4222-8333-444455556666" })), [B_ID, FRESH]);
    expect(a).toEqual(b);
  });

  it("the listed ids are replaced wherever they appear, headers included", () => {
    const a = normalizeResponse(res(problem({ detail: `no ${B_ID}` }), { location: `/v1/x/${B_ID}` }), [B_ID, FRESH]);
    const b = normalizeResponse(res(problem({ detail: `no ${FRESH}` }), { location: `/v1/x/${FRESH}` }), [B_ID, FRESH]);
    expect(a).toEqual(b);
  });

  it("x-request-id and date are dropped; other headers are compared", () => {
    const a = normalizeResponse(res(problem({}), { "x-request-id": "one", date: "Mon" }), []);
    const b = normalizeResponse(res(problem({}), { "x-request-id": "two", date: "Tue" }), []);
    expect(a).toEqual(b);
    const c = normalizeResponse(res(problem({}), { "cache-control": "private" }), []);
    expect(c).not.toEqual(a);
  });

  it("bodies that differ in detail wording compare unequal (Review Focus 3)", () => {
    const a = normalizeResponse(res(problem({ detail: "The resource was not found." })), [B_ID, FRESH]);
    const b = normalizeResponse(res(problem({ detail: "You may not see this workout." })), [B_ID, FRESH]);
    expect(a).not.toEqual(b);
  });

  it("bodies that differ in a field-error path or title compare unequal", () => {
    const err = (path: string) => problem({ status: 422, errors: [{ path, message: "must reference a visible exercise" }] });
    expect(normalizeResponse(res(err("items.0.exerciseId")), [B_ID, FRESH])).not.toEqual(normalizeResponse(res(err("items.1.exerciseId")), [B_ID, FRESH]));
    expect(normalizeResponse(res(problem({ title: "Forbidden" })), [])).not.toEqual(normalizeResponse(res(problem({})), []));
  });

  it("a different status compares unequal", () => {
    expect(normalizeResponse({ ...res(problem({})), status: 403 }, [])).not.toEqual(normalizeResponse(res(problem({})), []));
  });
});

describe("AC8 — a fresh id passes the slot's own schema (Review Focus 4)", () => {
  let routes: Map<string, RegisteredRoute>;
  beforeAll(async () => {
    const { v1 } = await collectRoutes((onRoute) => buildTestApp({ onRoute }).then((r) => r.app));
    routes = new Map(v1.map((r) => [r.key, r]));
  });

  it("for a path id", () => {
    const route = routes.get("GET /v1/workouts/:id")!;
    const id = freshIdFor(route, "params.id");
    const params = route.schema!.params as { safeParse(v: unknown): { success: boolean } };
    expect(params.safeParse({ id }).success).toBe(true);
  });

  it("for an id inside a body array", () => {
    const route = routes.get("POST /v1/routines")!;
    const id = freshIdFor(route, "body.items[].exerciseId");
    expect(schemaAt(route, "body.items[].exerciseId").safeParse(id).success).toBe(true);
  });

  it("is different on every call", () => {
    const route = routes.get("GET /v1/workouts/:id")!;
    expect(freshIdFor(route, "params.id")).not.toBe(freshIdFor(route, "params.id"));
  });
});

describe("AC12 — the leak scan", () => {
  it("passes when no recorded body holds an id or a marker", () => {
    const scan = new LeakScanner();
    scan.record('{"records":[]}');
    expect(() => scan.assertClean([B_ID], ["B-SECRET-routine-1"])).not.toThrow();
  });

  it("throws on a recorded body holding one of B's ids", () => {
    const scan = new LeakScanner();
    scan.record(`{"items":[{"id":"${B_ID}"}]}`, "GET /v1/routines");
    expect(() => scan.assertClean([B_ID], [])).toThrow(/GET \/v1\/routines/);
  });

  it("throws on a recorded body holding one of B's markers", () => {
    const scan = new LeakScanner();
    scan.record('{"name":"B-SECRET-routine-1"}');
    expect(() => scan.assertClean([], ["B-SECRET-routine-1"])).toThrow(/B-SECRET-routine-1/);
  });

  it("matches ids case-insensitively", () => {
    const scan = new LeakScanner();
    scan.record(`"${B_ID.toUpperCase()}"`);
    expect(() => scan.assertClean([B_ID], [])).toThrow();
  });
});
