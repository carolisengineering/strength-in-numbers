import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { RegisteredRoute, RouteKey } from "../integration/cross-user/registry.js";
import { EXEMPTIONS } from "../integration/cross-user/exemptions.js";
import { NOT_A_SIN_ID, idSlots, requiredSlots } from "../integration/cross-user/slots.js";
import { checkCoverage } from "../integration/cross-user/gate.js";
import type { CrossUserCase } from "../integration/cross-user/cases.js";
import { collectRoutes } from "../integration/cross-user/registry.js";
import { buildTestApp } from "../helpers/build-test-app.js";

/** Spec 21.0 §6.1, §6.5: the coverage gate, the exemption list and the id-slot walker. */

function route(key: RouteKey, schema: RegisteredRoute["schema"] = {}): RegisteredRoute {
  const [method, url] = key.split(" ") as [string, string];
  return { key, method, url, schema };
}

/** A case with only the fields the gate reads. */
function caseFor(key: RouteKey, covers: string[] = [], name = "case"): CrossUserCase {
  return {
    route: key,
    name,
    covers,
    kind: "foreign-id",
    expect: { status: 404 },
    actor: "A",
    call: () => ({ method: "GET", url: "/" }),
    control: () => ({ method: "GET", url: "/", expectStatus: 200 }),
  };
}

const noSlots = () => [];

describe("AC3 — the coverage gate", () => {
  it("names a registered route with neither a case nor an exemption", () => {
    const failures = checkCoverage(["GET /v1/things/:id", "GET /v1/other"], [caseFor("GET /v1/other")], {}, noSlots);
    expect(failures).toEqual(["GET /v1/things/:id has no cross-user case or exemption"]);
  });

  it("names a case or an exemption for a route the app does not register (stale entry)", () => {
    const failures = checkCoverage(
      ["GET /v1/other"],
      [caseFor("GET /v1/other"), caseFor("DELETE /v1/gone/:id")],
      { "GET /v1/retired": "a reason" },
      noSlots,
    );
    expect(failures).toContain("stale entry: case for DELETE /v1/gone/:id names a route the app does not register");
    expect(failures).toContain("stale entry: exemption for GET /v1/retired names a route the app does not register");
    expect(failures).toHaveLength(2);
  });

  it("names a route that is both covered and exempt", () => {
    const failures = checkCoverage(["GET /v1/me"], [caseFor("GET /v1/me")], { "GET /v1/me": "a reason" }, noSlots);
    expect(failures).toEqual(["GET /v1/me is both covered by a case and exempt"]);
  });

  it("names an id slot no case covers", () => {
    const slots = (k: RouteKey) => (k === "POST /v1/routines/:id" ? ["params.id", "body.items[].exerciseId"] : []);
    const failures = checkCoverage(["POST /v1/routines/:id"], [caseFor("POST /v1/routines/:id", ["params.id"])], {}, slots);
    expect(failures).toEqual(["POST /v1/routines/:id slot body.items[].exerciseId is not covered"]);
  });

  it("names a case that claims a slot the route does not have", () => {
    const slots = () => ["params.id"];
    const failures = checkCoverage(["GET /v1/x/:id"], [caseFor("GET /v1/x/:id", ["params.id", "body.nope"], "B's x")], {}, slots);
    expect(failures).toEqual(['GET /v1/x/:id case "B\'s x" covers body.nope, which the route does not have']);
  });

  it("passes when every route and slot is accounted for", () => {
    const slots = (k: RouteKey) => (k === "GET /v1/x/:id" ? ["params.id"] : []);
    expect(checkCoverage(["GET /v1/x/:id", "GET /v1/me"], [caseFor("GET /v1/x/:id", ["params.id"])], { "GET /v1/me": "r" }, slots)).toEqual([]);
  });
});

describe("AC5 — exemptions carry reasons", () => {
  it("are exactly the five routes of spec §5", () => {
    expect(Object.keys(EXEMPTIONS).sort()).toEqual(
      ["GET /v1/_authcheck", "GET /v1/equipment", "GET /v1/me", "GET /v1/muscle-groups", "PATCH /v1/me"].sort(),
    );
  });

  it("each has a non-empty reason", () => {
    for (const [key, reason] of Object.entries(EXEMPTIONS)) expect(reason.trim(), key).not.toBe("");
  });
});

describe("AC6 — id slots are derived from the route's schemas", () => {
  it("every path parameter is a slot", () => {
    expect(idSlots(route("PUT /v1/workout-sections/:id/round-times/:round"))).toEqual(["params.id", "params.round"]);
  });

  it("walks objects and arrays in the body", () => {
    const body = z.object({ name: z.string(), items: z.array(z.object({ exerciseId: z.string(), reps: z.number() })) });
    expect(idSlots(route("POST /v1/routines", { body }))).toEqual(["body.items[].exerciseId"]);
  });

  it("walks optional, nullable, default and readonly wrappers", () => {
    const body = z.object({ routineId: z.string().nullable().optional(), sectionId: z.string().default("x").readonly() });
    expect(idSlots(route("POST /v1/x", { body }))).toEqual(["body.routineId", "body.sectionId"]);
  });

  it("finds an id inside a union, a discriminated union, an intersection, a pipe and a lazy schema", () => {
    const body = z.object({
      u: z.union([z.object({ aId: z.string() }), z.object({ bId: z.string() })]),
      d: z.discriminatedUnion("k", [z.object({ k: z.literal("x"), cId: z.string() })]),
      i: z.intersection(z.object({ dId: z.string() }), z.object({ eId: z.string() })),
      p: z.object({ fId: z.string() }).pipe(z.object({ fId: z.string() })),
      l: z.lazy(() => z.object({ gId: z.string() })),
      t: z.string().transform((s) => s.trim()),
    });
    expect(idSlots(route("POST /v1/x", { body }))).toEqual([
      "body.u.aId",
      "body.u.bId",
      "body.d.cId",
      "body.i.dId",
      "body.i.eId",
      "body.p.fId",
      "body.l.gId",
    ]);
  });

  it("reads the querystring as well as the body", () => {
    const querystring = z.object({ exerciseId: z.string().optional(), workoutId: z.string().optional(), limit: z.number() });
    expect(idSlots(route("GET /v1/personal-records", { querystring }))).toEqual(["query.exerciseId", "query.workoutId"]);
  });

  it("a plural key (`ids`, `workoutIds`) holding an array of ids is a slot", () => {
    const body = z.object({ ids: z.array(z.string()), workoutIds: z.array(z.string()).optional(), idsCount: z.number() });
    expect(idSlots(route("POST /v1/bulk", { body }))).toEqual(["body.ids", "body.workoutIds"]);
  });

  it("an `id` key counts, a key merely containing `id` does not", () => {
    const body = z.object({ id: z.string(), idempotent: z.boolean(), valid: z.boolean() });
    expect(idSlots(route("POST /v1/x", { body }))).toEqual(["body.id"]);
  });

  it("throws, naming the route and the wrapper, on a schema kind it does not know (fails closed)", () => {
    const body = z.object({ byId: z.record(z.string(), z.string()) });
    expect(() => idSlots(route("POST /v1/x", { body }))).toThrow(/POST \/v1\/x.*record/);
  });

  it("a slot on NOT_A_SIN_ID is not required", () => {
    const body = z.object({ clientGeneratedId: z.string(), routineId: z.string().optional() });
    expect(requiredSlots(route("POST /v1/workouts", { body }))).toEqual(["body.routineId"]);
    expect(requiredSlots(route("PUT /v1/workout-sections/:id/round-times/:round"))).toEqual(["params.id"]);
  });

  it("every NOT_A_SIN_ID entry carries a reason", () => {
    for (const [key, reason] of Object.entries(NOT_A_SIN_ID)) expect(reason.trim(), key).not.toBe("");
  });
});

describe("AC6 — the walker reads every real /v1 route", () => {
  it("derives slots for all 51 routes without meeting an unknown schema kind", async () => {
    const { v1 } = await collectRoutes((onRoute) => buildTestApp({ onRoute }).then((r) => r.app));
    const all = Object.fromEntries(v1.map((r) => [r.key, idSlots(r)]));
    expect(all["POST /v1/routines"]).toContain("body.items[].exerciseId");
    expect(all["PUT /v1/hevy/mapping"]).toContain("body.pairs[].exerciseId");
    expect(all["GET /v1/personal-records"]).toEqual(["query.exerciseId", "query.workoutId"]);
    expect(all["POST /v1/workouts"]).toEqual(["body.clientGeneratedId", "body.routineId"]);
    const required = Object.fromEntries(v1.map((r) => [r.key, requiredSlots(r)]));
    // Spec §5 rows 9 and 50: shared reference ids and Hevy's own ids are not slots.
    expect(all["POST /v1/exercises"]).toContain("body.secondaryMuscleIds");
    expect(required["POST /v1/exercises"]).toEqual([]);
    expect(required["PATCH /v1/exercises/:id"]).toEqual(["params.id"]);
    expect(required["POST /v1/hevy/import/workouts"]).toEqual([]);
    expect(required["PUT /v1/hevy/mapping"]).toEqual(["body.pairs[].exerciseId"]);
  });
});
